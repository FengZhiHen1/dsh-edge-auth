# dsh-edge-auth

把**已由边缘代理认证**的请求认作 DSH 的 owner 浏览器会话，从而让浏览器不再需要 DSH 自己的启动 token 登录。
典型用途：云端 DSH 挂在 Cloudflare Tunnel + Cloudflare Access 之后，手机浏览器只过一次 Access 就能用。

## 为什么要它

DSH 的浏览器认证是「进程级启动 token → 签名 cookie」：token 每次重启更换、要从服务器日志里取，cookie 会绑定 authority
且是 `SameSite=Strict`。于是移动端的常见痛点是——**每次 Cloudflare Access 会话到期后**，浏览器从 Access 登录域跨站重定向回来，
Strict cookie 在这一跳不发 ⇒ 首次访问 401；刷新一次才好。本插件让“边缘已认证”本身就足以放行，不需要 cookie 参与。

## 机制

只包 `ctx.connection` 的**已声明**成员（不触碰 `BrowserAuth` 等实现细节）：

| 成员 | 行为 |
| --- | --- |
| `admit(request)` | 原实现返回 **401** 且请求带断言头 ⇒ 返回 `{ peer: ctx.connection.browserPeer }`；**403（Host/Origin 围栏）原样保留**，已真实认证的请求也原样返回 |
| `authorizeIndex(request, response)` | 带断言头且 `requestRejection()` 无拒绝 ⇒ 直接允许服务 index；否则交回原实现（token 交换与 401 都不变） |

`admitConnection()`（WebSocket 升级）与 `requestRejection()` 内部都经 `this.admit`，因此自动覆盖。`/api`、SSE、
`/api/remote.mux` 与 index 页面全部走同一条判定。

**不放宽的部分**：Host/Origin 围栏（403）、`sec-fetch-site: cross-site` 拒绝、`GET /connect` 的程序化 API operator
（仍需启动 token）、loopback 专属的设置写权限（按浏览器地址栏 hostname 判定，与本插件无关）。

## 配置

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `header` | `cf-access-jwt-assertion` | 携带边缘断言的请求头名（大小写不敏感）。换用 Transform Rule 注入的自定义头时改这里 |

```yaml
- id: edge-auth
  config:
    header: cf-access-jwt-assertion
```

## 安全边界（必读）

- **不验签**：判据只有“该头存在且非空”。安全性完全由部署事实承担——**origin 只能经该边缘代理到达**。
  若 origin 还有其他可达路径，那个路径上的任何人都能伪造该头并取得 owner 权限。
- **本机进程等价于已认证**：cloudflared 自身也从 `127.0.0.1` 连到 DSH，因此无法按来源地址区分“边缘代理”与
  “本机任意进程”。能直连 3080 的本机进程可以自带该头拿到 owner peer。
- **单层化的代价**：启用后，边缘侧（Cloudflare Access 策略、hostname 是否挂 Access、ingress catch-all 顺序）
  成为唯一身份来源；DSH 层不再是独立的第二道门。要恢复纵深防御，可升级为校验 Access JWT（本插件当前不做）。
- **放行不下发 cookie**：经断言放行的浏览器不会拿到 DSH 会话 cookie。**卸载本插件后这些浏览器需要重新走一次 token 登录。**
- **失败即关闭**：`ctx.connection` 不再暴露 `admit`/`authorizeIndex` 时**拒绝加载**并报错，不会静默留下“装上了但没生效”。
  同时配置两行（重复安装）也会报错，不会叠层包装；卸载只删除自己那次包装，不误删后装者的。
  若实例上已残留他人的自有 `admit`/`authorizeIndex`（通常是上一轮异常留下的包装），同样**拒绝加载**并提示先重启宿主，
  而不是再叠一层把问题藏起来。
- **撤除依赖自有属性身份，不看 `connection.admit === 包装`**：`ctx.connection` 是 cordis 的 traceable proxy，读函数型
  成员时每次都返回新的 `createShadowMethod` 包装，恒等比较永远为假。2026-10-24 的 test 实测曾因此出现“停用/卸载后边缘放行
  仍然生效、且重装不再报重复”的静默泄漏（方法没删、防重标记却被删掉）；现在归属判断统一走
  `Object.getOwnPropertyDescriptor`，安装后还会自检自有属性确实落到实例上，否则回滚并报错。

## 兼容性

只对 **DSH `0.2.1-rc.2`** 核对与验证。宿主仍处预发布，插件不承诺跨宿主版本兼容：升级 DSH 后须重新核对
`ctx.connection` 是否仍暴露上述成员与 401/403 语义（契约不符时插件会大声失败，不会静默放宽）。

## 开发与检查

```sh
node --check index.js && node --check src/adapter/host.js && node --check src/core/edge-claim.js
node --test test/*.test.mjs          # 判据纯函数单测
node ../../tools/plugin-layering-check.mjs .   # 在管理仓库根执行：node tools/plugin-layering-check.mjs plugins/dsh-edge-auth
```

安装与生效验证走目标实例的创造模式（`plugin_manager`），本插件无 Client 半区，因此没有设置页；
展示文案在 `locale/{en,zh}.json`，图标为 `icon.svg`。
