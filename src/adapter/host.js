// adapter — 把边缘断言接进 DSH Host 的浏览器认证判定。
// 只用 `ctx.connection` 的**已声明**成员（`admit`、`authorizeIndex`、`requestRejection`、
// `browserPeer`），判定与包装逻辑在 src/core/edge-bridge.js（可裸 Node 测试）。

import z from '@deepseek-ai/schemastery'
import { DEFAULT_EDGE_HEADER } from '../core/edge-claim.js'
import { installEdgeBridge } from '../core/edge-bridge.js'

/** Host plugin identity. */
export const name = 'dsh-edge-auth'

/** 没有 web 载体就没有浏览器认证可改；缺失时该行不该激活。 */
export const inject = ['connection']

/** 边缘断言头；换用自定义请求头（如 Transform Rule 注入的静态头）时改这里。 */
export const Config = z.object({
  header: z.string().default(DEFAULT_EDGE_HEADER).description('携带边缘认证断言的请求头名（大小写不敏感）。'),
})

/** Schemastery 字段可能以包装值到达；取出普通字符串。 */
function headerNameOf(config) {
  const raw = config?.header
  const value = raw !== null && typeof raw === 'object' && typeof raw.get === 'function' ? raw.get() : raw
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : DEFAULT_EDGE_HEADER
}

/**
 * 挂载边缘认证桥接：带断言的请求被当作已认证的 owner 浏览器连接。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
 * @param {{ header?: string }} [config] - resolved plugin config.
 * @throws {Error} 当 `ctx.connection` 不再暴露 `admit`/`authorizeIndex` 时拒绝加载。
 */
export function apply(ctx, config = {}) {
  const header = headerNameOf(config)
  const restore = installEdgeBridge(ctx.connection, {
    header,
    onGrant: (message) => ctx.logger.debug(message),
  })
  ctx.effect(() => restore, 'dsh-edge-auth: edge claim wrappers')
  ctx.logger.info('dsh-edge-auth: requests carrying "%s" are accepted as already authenticated', header)
}
