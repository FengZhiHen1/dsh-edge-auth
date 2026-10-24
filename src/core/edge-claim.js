// core — 判据：这条请求是否带着边缘代理的已认证断言。
// 纯函数，只处理 headers 形状，不导入 cordis / @deepseek-ai/*，可裸 Node 测试。

/** Cloudflare Access 在转发到 origin 时添加的断言头（大小写不敏感匹配）。 */
export const DEFAULT_EDGE_HEADER = 'cf-access-jwt-assertion'

/**
 * 从 Headers 实例或普通 headers 记录里取一个头，大小写不敏感。
 * 被删除的头、非字符串值、缺失头一律返回 undefined——本插件只认“有且非空的字符串”。
 * @param {object | undefined} headers - 请求头（`Headers` 或 Node 的 `IncomingHttpHeaders`）。
 * @param {string} name - 头名；比较时两侧都小写。
 * @returns {string | undefined} 该头的字符串值。
 */
export function readHeader(headers, name) {
  if (headers === undefined || headers === null || typeof headers !== 'object') return undefined
  if (typeof headers.get === 'function') {
    const value = headers.get(name)
    return typeof value === 'string' ? value : undefined
  }
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue
    const first = Array.isArray(value) ? value[0] : value
    return typeof first === 'string' ? first : undefined
  }
  return undefined
}

/**
 * 请求是否由边缘代理断言过。
 *
 * 判据刻意只有“该头存在且去掉空白后非空”一条：本插件不验签，安全性由
 * “origin 只能经该边缘代理到达”这一部署事实承担（见 README 的安全边界）。
 * @param {object | undefined} headers - 请求头。
 * @param {string} [headerName] - 断言头名，默认 {@link DEFAULT_EDGE_HEADER}。
 * @returns {boolean} 为 true 时，调用方可以把该请求当作已认证。
 */
export function edgeClaim(headers, headerName = DEFAULT_EDGE_HEADER) {
  const value = readHeader(headers, headerName)
  return typeof value === 'string' && value.trim().length > 0
}
