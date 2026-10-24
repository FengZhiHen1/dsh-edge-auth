import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_EDGE_HEADER, edgeClaim, readHeader } from '../src/core/edge-claim.js'

test('DEFAULT_EDGE_HEADER is Cloudflare Access 的断言头', () => {
  assert.equal(DEFAULT_EDGE_HEADER, 'cf-access-jwt-assertion')
})

test('普通 headers 记录：大小写不敏感，命中即断言', () => {
  assert.equal(edgeClaim({ 'Cf-Access-Jwt-Assertion': 'a.b.c' }), true)
  assert.equal(edgeClaim({ 'cf-access-jwt-assertion': 'a.b.c' }), true)
})

test('Headers 实例同样命中', () => {
  const headers = new Headers({ 'Cf-Access-Jwt-Assertion': 'a.b.c' })
  assert.equal(edgeClaim(headers), true)
})

test('缺失、空串与纯空白都不算断言', () => {
  assert.equal(edgeClaim({}), false)
  assert.equal(edgeClaim({ 'Cf-Access-Jwt-Assertion': '' }), false)
  assert.equal(edgeClaim({ 'Cf-Access-Jwt-Assertion': '   ' }), false)
})

test('数组头取首个元素；非字符串值不算断言', () => {
  assert.equal(edgeClaim({ 'cf-access-jwt-assertion': ['a.b.c', 'd.e.f'] }), true)
  assert.equal(edgeClaim({ 'cf-access-jwt-assertion': [] }), false)
  assert.equal(edgeClaim({ 'cf-access-jwt-assertion': 42 }), false)
})

test('无头对象 / 非对象输入返回 false，不抛错', () => {
  assert.equal(edgeClaim(undefined), false)
  assert.equal(edgeClaim(null), false)
  assert.equal(edgeClaim('cf-access-jwt-assertion'), false)
})

test('自定义头名只认自己那个头', () => {
  const headers = { 'x-edge-claim': '1', 'cf-access-jwt-assertion': 'a.b.c' }
  assert.equal(edgeClaim(headers, 'x-edge-claim'), true)
  assert.equal(edgeClaim({ 'cf-access-jwt-assertion': 'a.b.c' }, 'x-edge-claim'), false)
})

test('readHeader 对 Headers 实例与记录给出一致结果', () => {
  assert.equal(readHeader(new Headers({ 'x-a': 'v' }), 'X-A'), 'v')
  assert.equal(readHeader({ 'X-A': 'v' }, 'x-a'), 'v')
  assert.equal(readHeader({}, 'x-a'), undefined)
})
