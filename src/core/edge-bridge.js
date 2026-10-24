// core — 把“边缘断言”接进一个 connection 形状的对象的认证判定。
// 纯逻辑：只依赖鸭子类型的 connection（admit / authorizeIndex / requestRejection /
// browserPeer），不导入 cordis 或 @deepseek-ai/*，因此可在裸 Node 里用假对象验证分支顺序。
// 分支顺序是安全语义本身：只把 401 放大为已认证，403 围栏与已真实认证的请求必须原样返回。
//
// 装饰（而非替换）官方实例，因此按本仓 .local/agent-notes.md 2026-10-20 的教训：
// ① 在安装阶段捕获原型方法；② 用 Symbol.for 记录自己的包装，恢复时校验仍是自己那个，
// 避免重复叠层与误删后装者的包装。
//
// 2026-10-24 实测修正（test 实例，0.2.1-rc.2）：`ctx.connection` 是 cordis 的 **traceable
// proxy**，读函数型成员时 get 陷阱每次返回一个新的 `createShadowMethod` 包装
// （`@deepseek-ai/cordis` lib `createTraceable`）⇒ `connection.admit === 我装的包装` 恒为 false。
// 早期版本用这个恒等判断做撤除守卫，结果：停用/卸载时方法没删、防重 symbol 却被删掉，
// 表现为“卸载后边缘放行仍然生效，且重装不再报重复”。所以：
// ① 归属判断一律走 `Object.getOwnPropertyDescriptor`（该 proxy 没设 ownKeys/
//    getOwnPropertyDescriptor 陷阱，读的是实例上的真实自有属性）；
// ② 安装后自检自有属性确实落到实例上，没落到就回滚并抛错（fail-loud）；
// ③ 安装前若实例上已有他人的自有 admit/authorizeIndex，也抛错——那通常是上一轮泄漏的
//    残留，继续叠层只会把问题藏起来。

import { edgeClaim } from './edge-claim.js'

/** 本插件在 connection 实例上留下的安装标记（跨模块实例稳定）。 */
const BRIDGE = Symbol.for('dsh-edge-auth.edge-bridge')

/** 被装饰的方法名；顺序即安装与自检顺序。 */
const METHODS = ['admit', 'authorizeIndex']

/**
 * 读实例上**自有**方法的值。
 *
 * 不能用 `connection[name]` 判身份：traceable proxy 会把它换成新包装。这里读描述符，
 * 拿到的才是我们当初写进去的那个函数。
 * @param {object} connection - connection 实例或它的 traceable proxy。
 * @param {string} name - 方法名。
 * @returns {unknown} 自有属性的值；没有自有属性时为 undefined。
 */
function ownMethod(connection, name) {
  return Object.getOwnPropertyDescriptor(connection, name)?.value
}

/**
 * 包装 connection 的认证入口，返回恢复函数。
 *
 * 通过给实例定义**自有属性**遮蔽原型方法实现；恢复时删除自有属性即回到原型实现。
 * @param {object} connection - `ctx.connection` 形状的对象。
 * @param {object} options - 接线参数。
 * @param {string} options.header - 断言头名。
 * @param {(message: string) => void} [options.onGrant] - 每次按断言放行时的诊断回调。
 * @returns {() => void} 恢复函数（重复调用无副作用）。
 * @throws {Error} connection 不再暴露预期成员、实例上已有他人的自有方法、本插件已安装过
 * （重复行），或自有属性没有落到实例上时。
 */
export function installEdgeBridge(connection, options) {
  if (connection?.[BRIDGE] !== undefined) {
    throw new Error('dsh-edge-auth: the edge claim bridge is already installed on ctx.connection; drop the duplicate row.')
  }
  const { header, onGrant } = options
  const originalAdmit = connection.admit
  const originalAuthorizeIndex = connection.authorizeIndex
  if (typeof originalAdmit !== 'function' || typeof originalAuthorizeIndex !== 'function') {
    throw new Error(
      'dsh-edge-auth: the connection service no longer exposes admit()/authorizeIndex(); refusing to load '
      + 'rather than silently leaving edge-attested requests unauthenticated.',
    )
  }
  const orphaned = METHODS.filter((name) => Object.getOwnPropertyDescriptor(connection, name) !== undefined)
  if (orphaned.length > 0) {
    throw new Error(
      `dsh-edge-auth: ctx.connection already carries its own ${orphaned.join('/')} although this plugin is not `
      + 'installed — a decoration from an earlier install was left behind. Restart the host before installing '
      + 'again instead of stacking another wrapper on top of it.',
    )
  }
  const attested = (request) => edgeClaim(request?.headers, header)

  const admitWithEdgeClaim = function admitWithEdgeClaim(request) {
    const admission = originalAdmit.call(this, request)
    if (!('rejection' in admission) || admission.rejection !== 401) return admission
    if (!attested(request)) return admission
    const peer = this.browserPeer
    if (peer === undefined) return admission
    onGrant?.('dsh-edge-auth: admitting an edge-attested request as the owner browser peer')
    return { peer }
  }

  const authorizeIndexWithEdgeClaim = function authorizeIndexWithEdgeClaim(request, response) {
    if (attested(request) && connection.requestRejection(request) === undefined) return true
    return originalAuthorizeIndex.call(this, request, response)
  }

  connection.admit = admitWithEdgeClaim
  connection.authorizeIndex = authorizeIndexWithEdgeClaim
  connection[BRIDGE] = { admitWithEdgeClaim, authorizeIndexWithEdgeClaim }

  const landed = ownMethod(connection, 'admit') === admitWithEdgeClaim
    && ownMethod(connection, 'authorizeIndex') === authorizeIndexWithEdgeClaim
  if (!landed) {
    delete connection.admit
    delete connection.authorizeIndex
    delete connection[BRIDGE]
    throw new Error(
      'dsh-edge-auth: the connection service did not keep the wrapper as its own property; refusing to run '
      + 'with a decoration that cannot be removed again.',
    )
  }

  return () => {
    const installed = connection[BRIDGE]
    if (installed === undefined) return
    if (ownMethod(connection, 'admit') === installed.admitWithEdgeClaim) delete connection.admit
    if (ownMethod(connection, 'authorizeIndex') === installed.authorizeIndexWithEdgeClaim) delete connection.authorizeIndex
    delete connection[BRIDGE]
  }
}
