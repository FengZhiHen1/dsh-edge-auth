# Unreleased

## 0.1.0

- 首个版本：把带边缘认证断言（默认 `Cf-Access-Jwt-Assertion`）的请求认作已认证的 owner 浏览器会话，
  使经 Cloudflare Access 访问的浏览器不再需要 DSH 启动 token 登录。
- 包 `ctx.connection` 的已声明成员 `admit` / `authorizeIndex`，只把 401 放大为已认证；403（Host/Origin 围栏）
  与 `/connect` 的程序化 API operator 认证保持原样。
- 卸载时删除自有属性恢复原始实现；`ctx.connection` 契约不符时拒绝加载而非静默不生效。
- 撤除与防重改为按**自有属性描述符**判身份，并在安装后自检包装确实落到实例上（否则回滚报错）；实例上若已有他人的
  自有 `admit`/`authorizeIndex` 则拒绝加载。修复点：`ctx.connection` 是 cordis traceable proxy，读函数型成员每次返回新包装，
  早期用 `connection.admit === 包装` 做守卫会在停用/卸载时静默留下有效包装（test 实例 0.2.1-rc.2 实测）。
