import assert from 'node:assert/strict'
import test from 'node:test'
import { installEdgeBridge } from '../src/core/edge-bridge.js'

/**
 * 仿 `HostConnectionService` 的最小替身：`trusted`/cookie 决定 403/401/已认证，
 * 三个入口都是**原型方法**，因此“删除自有属性即恢复原型实现”可被验证。
 */
class FakeConnection {
  browserPeer = { id: 'browser-peer' }
  indexCalls = 0
  constructor({ trusted = true } = {}) {
    this.trustedFlag = trusted
  }
  isTrusted() {
    return this.trustedFlag
  }
  admit(request) {
    if (!this.isTrusted(request)) return { rejection: 403 }
    if (request.cookie === true) return { peer: this.browserPeer }
    return { rejection: 401 }
  }
  requestRejection(request) {
    const admission = this.admit(request)
    return 'rejection' in admission ? admission.rejection : undefined
  }
  authorizeIndex(request, response) {
    this.indexCalls += 1
    if (request.cookie === true) return true
    response.writeHead(401)
    return false
  }
}

const CLAIM = { 'cf-access-jwt-assertion': 'header.payload.signature' }
const fakeResponse = () => {
  const written = []
  return { written, writeHead(status) { written.push(status); return this }, end() {} }
}

test('401 + 断言头 ⇒ 放大为 browserPeer', () => {
  const connection = new FakeConnection()
  const grants = []
  installEdgeBridge(connection, { header: 'cf-access-jwt-assertion', onGrant: (m) => grants.push(m) })
  const admission = connection.admit({ headers: CLAIM })
  assert.deepEqual(admission, { peer: connection.browserPeer })
  assert.equal(grants.length, 1)
})

test('401 + 无断言头 ⇒ 保持 401', () => {
  const connection = new FakeConnection()
  installEdgeBridge(connection, { header: 'cf-access-jwt-assertion' })
  assert.deepEqual(connection.admit({ headers: {} }), { rejection: 401 })
})

test('403 围栏拒绝在带断言头时也必须原样返回', () => {
  const connection = new FakeConnection({ trusted: false })
  installEdgeBridge(connection, { header: 'cf-access-jwt-assertion' })
  assert.deepEqual(connection.admit({ headers: CLAIM }), { rejection: 403 })
})

test('已真实认证的请求原样返回，且不触发放行诊断', () => {
  const connection = new FakeConnection()
  const grants = []
  installEdgeBridge(connection, { header: 'cf-access-jwt-assertion', onGrant: (m) => grants.push(m) })
  assert.deepEqual(connection.admit({ headers: {}, cookie: true }), { peer: connection.browserPeer })
  assert.equal(grants.length, 0)
})

test('authorizeIndex：断言 + 围栏通过 ⇒ 直接放行且不写响应', () => {
  const connection = new FakeConnection()
  installEdgeBridge(connection, { header: 'cf-access-jwt-assertion' })
  const response = fakeResponse()
  assert.equal(connection.authorizeIndex({ headers: CLAIM }, response), true)
  assert.equal(connection.indexCalls, 0)
  assert.deepEqual(response.written, [])
})

test('authorizeIndex：断言但围栏拒绝 ⇒ 交回原实现（不放行 index）', () => {
  const connection = new FakeConnection({ trusted: false })
  installEdgeBridge(connection, { header: 'cf-access-jwt-assertion' })
  const response = fakeResponse()
  assert.equal(connection.authorizeIndex({ headers: CLAIM }, response), false)
  assert.equal(connection.indexCalls, 1)
  assert.deepEqual(response.written, [401])
})

test('authorizeIndex：无断言头 ⇒ 原实现接管（401 与 token 交换不变）', () => {
  const connection = new FakeConnection()
  installEdgeBridge(connection, { header: 'cf-access-jwt-assertion' })
  const response = fakeResponse()
  assert.equal(connection.authorizeIndex({ headers: {} }, response), false)
  assert.equal(connection.indexCalls, 1)
})

test('自定义头名生效，默认头不再放行', () => {
  const connection = new FakeConnection()
  installEdgeBridge(connection, { header: 'x-edge-claim' })
  assert.deepEqual(connection.admit({ headers: CLAIM }), { rejection: 401 })
  assert.deepEqual(connection.admit({ headers: { 'x-edge-claim': '1' } }), { peer: connection.browserPeer })
})

test('恢复函数删除自有属性，行为回到原型实现', () => {
  const connection = new FakeConnection()
  const restore = installEdgeBridge(connection, { header: 'cf-access-jwt-assertion' })
  assert.equal(Object.hasOwn(connection, 'admit'), true)
  restore()
  assert.equal(Object.hasOwn(connection, 'admit'), false)
  assert.equal(Object.hasOwn(connection, 'authorizeIndex'), false)
  assert.deepEqual(connection.admit({ headers: CLAIM }), { rejection: 401 })
})

test('契约不符时抛错，而不是静默不生效', () => {
  assert.throws(() => installEdgeBridge({}, { header: 'cf-access-jwt-assertion' }), /admit\(\)\/authorizeIndex\(\)/)
  assert.throws(
    () => installEdgeBridge({ admit() {} }, { header: 'cf-access-jwt-assertion' }),
    /refusing to load/,
  )
})

test('重复安装抛错，且不叠层', () => {
  const connection = new FakeConnection()
  installEdgeBridge(connection, { header: 'cf-access-jwt-assertion' })
  assert.throws(() => installEdgeBridge(connection, { header: 'cf-access-jwt-assertion' }), /already installed/)
})

test('恢复后重装干净可用；恢复函数重复调用无副作用', () => {
  const connection = new FakeConnection()
  const first = installEdgeBridge(connection, { header: 'cf-access-jwt-assertion' })
  first()
  first()
  const second = installEdgeBridge(connection, { header: 'x-edge-claim' })
  assert.deepEqual(connection.admit({ headers: { 'x-edge-claim': '1' } }), { peer: connection.browserPeer })
  assert.deepEqual(connection.admit({ headers: CLAIM }), { rejection: 401 })
  second()
  assert.deepEqual(connection.admit({ headers: { 'x-edge-claim': '1' } }), { rejection: 401 })
})

/**
 * 仿 `ctx.connection` 的 cordis traceable proxy：读**函数型**成员时每次返回一个新的包装函数
 * （官方 `createTraceable` + `createShadowMethod`），而自有属性的读写与删除仍落在目标实例上。
 * 2026-10-24 的泄漏事故就是这个形状：`connection.admit === 我装的包装` 恒为 false。
 */
const traceable = (target) => new Proxy(target, {
  get(inner, prop, receiver) {
    const value = Reflect.get(inner, prop, receiver)
    if (typeof value !== 'function' || prop === 'constructor') return value
    return (...args) => Reflect.apply(value, inner, args)
  },
})

test('traceable proxy：停用时仍然撤得掉包装（身份判断不走代理读值）', () => {
  const connection = traceable(new FakeConnection())
  const restore = installEdgeBridge(connection, { header: 'cf-access-jwt-assertion' })
  assert.deepEqual(connection.admit({ headers: CLAIM }), { peer: connection.browserPeer })
  restore()
  assert.equal(Object.hasOwn(connection, 'admit'), false)
  assert.equal(Object.hasOwn(connection, 'authorizeIndex'), false)
  assert.deepEqual(connection.admit({ headers: CLAIM }), { rejection: 401 })
  assert.equal(connection.authorizeIndex({ headers: CLAIM }, fakeResponse()), false)
})

test('traceable proxy：重复安装仍被拦下，且标记不被撤除动作提前清掉', () => {
  const connection = traceable(new FakeConnection())
  installEdgeBridge(connection, { header: 'cf-access-jwt-assertion' })
  assert.throws(() => installEdgeBridge(connection, { header: 'cf-access-jwt-assertion' }), /already installed/)
})

test('实例上已有他人的自有 admit/authorizeIndex ⇒ 拒绝加载，不叠层', () => {
  const connection = new FakeConnection()
  connection.admit = function leftBehindByAnEarlierInstall() {
    return { rejection: 401 }
  }
  assert.throws(
    () => installEdgeBridge(connection, { header: 'cf-access-jwt-assertion' }),
    /left behind/,
  )
  assert.equal(connection.admit.name, 'leftBehindByAnEarlierInstall')
})

test('恢复时不误删后装者的包装', () => {
  const connection = new FakeConnection()
  const restore = installEdgeBridge(connection, { header: 'cf-access-jwt-assertion' })
  const later = function laterAdmit() {
    return { peer: 'later' }
  }
  connection.admit = later
  restore()
  assert.equal(connection.admit, later)
  assert.equal(Object.hasOwn(connection, 'authorizeIndex'), false)
})
