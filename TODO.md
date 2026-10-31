## 版本号约定（2026-10-29 定）

- 小改动、UI 打磨、文案修正：**只升 patch**（1.8.0 → 1.8.1 → 1.8.2 …），不再为了几次样式调整跳 minor。
- **2.0.0 只在用户明确说「可以了，出终版」之后**再打，用来标记对外发布的那一版。
- 每升一版仍要在 README 版本表加一行，说明改了什么。

# DSH My Phone · 还没做的事

> 对应当前版本 `0.9.9`（2026-10-27）。这份清单是「审计发现了但这一轮**故意没动**」的部分，按「值不值得做」排序，不按紧急度。
> 急不急都行——每一条都写清了**为什么不做**、**做起来要动哪里**、**做完怎么验**，下次想动手时不用重新推一遍。

图例：**A** 建议做（真实隐患 / 影响可用性） · **B** 看情况（体验提升，有取舍） · **C** 不建议做（成本 > 收益，或会破坏现有设计）

---

## 一、安全（审计剩下的 3 条）

- [x] ~~**删掉 React 弹窗（等用户实测通过后）**~~ → v1.7.0 已删（整份 client.js 去掉，只留纯 DOM 一套）：v1.5.0 起弹窗已由  纯 DOM 提供， 里的 React 面板只是后备（React 先接管时它才会开）。用户确认新弹窗顺手后，把 client.js 里  的面板部分删掉，只留「设置 → 插件」那张卡片。


### A1 · 管理口加 Host / Origin 白名单 — ✅ v1.5.0 已完成

- **现状**：管理口只监听 `127.0.0.1`，代码里 `isLoopback()` 对这个监听器**恒为真**，等于只剩 `x-myphone-admin: 1` 这一道自定义头在挡。这个头挡住了普通网页（浏览器不允许跨站自定义头 + 会触发预检），但**挡不住 DNS rebinding**：攻击者把自己的域名解析到 `127.0.0.1`，受害者浏览器就把请求当成同源发出来，`Origin` 是 `http://evil.com`，我们目前不看它。
- **为什么没做**：要真正做成 rebinding 无效，必须校验 `Host` 是 `127.0.0.1:<port>` 或 `localhost:<port>`，且 `Origin`（如果有）与 Host 同源。改起来 30 行，但会把「用 `--trusted-host` 起 DSH 的人从别的域名访问」这条路径弄复杂，得先想清楚放行规则，不适合塞在赶进度的这一版里。
- **怎么修**：`src/gate.js` 的 `handleAdmin()` 入口处加 `assertAdminOrigin(req)`：
  1. 取 `req.headers.host`，只接受 `127.0.0.1:<adminPort>` / `localhost:<adminPort>` / `[::1]:<adminPort>`；
  2. 若有 `origin` 头，`hostOf(origin)` 必须等于上面的 host（`hostOf` 已经有了）；
  3. 不通过 → `json(res, 403, { ok: false, error: '管理口只接受本机同源请求' })`。
- **怎么验**：`test/panel-test.js` 加两条：`Host: evil.com` → 403；`Host: 127.0.0.1:<port>` + `Origin: http://evil.com` → 403。正常路径（无 Origin 的 curl / 带正确 Origin 的前端）必须继续 200。

### A2 · WebSocket Upgrade 也要拦旧隧道域名

- **现状**：HTTP 侧已经做了 `rejectStaleHost()`（旧域名来请求 → 给「这个地址已经过期了」的页面）。但 `handleUpgrade()` 里**没有这一步**，旧域名上如果还有页面残留、试图开 WebSocket，会被直接转到本机 DSH。
- **为什么没做**：DSH 目前不用 WebSocket（我实测过，Upgrade 会被上游直接关掉），这条现在是「理论上能摸到、实际上拿不到东西」。属于补洞，不是救火。
- **怎么修**：`handleUpgrade(req, socket, head)` 开头加：`if (rejectStaleHost(req, socket)) return`（该函数已存在，只是签名要支持 socket 写回 400 + 关闭）；另外把 `forward()` 里那段 header 改写（host/origin/sec-fetch-site/x-forwarded-* 清理）抽成 `rewriteRequestHeaders(req, authority)` 让两边共用，避免以后改一处漏一处。
- **怎么验**：`test/probe-v5.mjs` 加一条：对旧域名发 `Upgrade: websocket` 请求，期望连接被关掉而不是 101。

### A3 · 日志别再同步写盘 — ✅ v1.5.0 已完成

- **现状**：`appendCapped()` 用的是同步 `appendFileSync`，每个请求都可能触发一次磁盘写（Windows + 杀毒软件下几十毫秒）。已经做了「256KB 轮转」和「同类事件 60 秒合并一次」，公网口天天被扫也不会撑爆，但**同步 I/O 仍在请求路径上**。
- **为什么没做**：改成异步要引入一个写队列 + 进程退出前 `flush()`，还要保证「崩溃时最多丢最近几行」是可接受的；这版已经在改 30 处，不想同时把日志子系统换血。
- **怎么修**：`src/gate.js` 里加 `class LogSink`：
  - `push(text)` 只入内存队列（上限 200 行，满了丢最老）；
  - `setInterval(500ms)` 或队列长度 ≥ 20 时 `appendFile()` 异步落盘；
  - `process.on('exit')` 里做一次同步 flush；
  - 轮转逻辑（`LOG_MAX_BYTES`）搬到异步写回调里判断。
- **怎么验**：`test/probe-logs.mjs`：连续打 500 次匿名 401 → 事件循环不阻塞（记录总耗时 < 1s）、`pair.log` 行数 ≤ 合理值、进程正常退出后日志不丢最后一行。

---

## 二、功能缺口

### B1 · 命名隧道（固定地址，不再每次重启换域名）

- **现状**：用的是 cloudflared *快速隧道*，免注册、不用域名，代价是**每次隧道进程启动都会拿到新的 `*.trycloudflare.com`**。所以手机上要重新扫码——凭据还在（180 天），麻烦的只是地址。
- **为什么没做**：命名隧道要一个**自己的域名**（Cloudflare 账号 + 把域名 NS 托管过去 + `cloudflared tunnel login` 出证书），一年 60–100 元。这不是代码问题，是「你得先有域名」，我不能替你决定。
- **怎么修**：`src/tunnel.js` 加 `startNamed({ token })` 分支（`cloudflared tunnel run --token <token>`），配置里加 `tunnelMode: 'quick' | 'named'` 与 `tunnelToken`；UI 在「高级 → 外网」下加一个切换 + 粘贴 token 的输入框。地址固定后再把 `rejectStaleHost()` 的历史域名列表换成「主动清理旧记录」。
- **怎么验**：真机跑一次重启，确认域名不变、手机不用重扫码。

### B2 · 真正的手机版布局

- **现状**：手机打开 DSH 用的是**桌面版界面**（我们只是给了一行提示 + 「放大成桌面宽度 / 全屏横屏」两个按钮）。窄屏上侧边栏、对话区、输入框都会挤。
- **为什么没做**：这是「另一个产品」的量级。参考实现 `dsh-pocket` 专门写了 `client/mobile/`（45KB 的 `mobile.css.ts` + 底部导航/抽屉/布局模式/文件守卫一整套），我们目前只有悬浮球这一个注入点。
- **怎么修**（如果要）：在 `client.js` 里按 `window.matchMedia('(max-width: 720px)')` 切一套移动端外壳：底部 tab（会话 / 文件 / 设置）、会话列表抽屉、输入框贴底 + `env(safe-area-inset-bottom)`。风险是 DSH 宿主内部布局一变就跟着碎，需要长期维护。
- **怎么验**：手机真机 + DevTools iPhone 视口，跑通「新建会话 → 发消息 → 看流式输出 → 切会话」。

### B3 · 96px 图标其实是位图

- **现状**：`icon-96.png` 是 96×96 位图，Retina / 高 DPI 下会糊一点；`icon.svg` 是 base64 内嵌 PNG（不是真矢量）。
- **为什么没做**：手上只有 AI 生成的位图源，转真矢量要重画（鲸尾 + 圆角块）。
- **怎么修**：`tools/make_icon_tile.py` 里加个 `--sizes 96,128,192,256,512` 批量导出 + 前端用 `srcset`；或者干脆手写一份 SVG（鲸尾路径已存在 `FAB_LOGO` 里，可以把那条 path 拿来做真矢量）。

### B4 · 访问日志（按会话/按天）

- **现状**：「排查日志」是**事件流**（谁连进来、谁被拒、入口开关、地址变更），不是访问日志——没有「今天从手机发了几条消息、打开过哪些页面」。
- **为什么没做**：得在 `forward()` 里落一行结构化记录（方法、路径、状态码、耗时、设备 id），这是额外写盘量，跟 A3 的日志异步化是同一件事，顺序应该 A3 先做。
- **怎么修**：A3 完成后，`forward()` 结束时 `logSink.pushAccess({ at, method, path, status, ms, deviceId })`，写 `access.log`（按天切分），「高级 → 排查日志」加一个「查看访问日志」折叠区。

### B5 · 「待信任」的二维码请求没有独立列表

- **现状**：有人扫了二维码、还没点「信任」，你不会收到任何提示（气泡只在**已经连上**时弹）。
- **为什么没做**：需要服务端在「票被兑换成信任页」时就记一条（现在只在 POST 成功那一刻记），并且要想清楚「扫了没点」算不算未读——噪声可能很大（微信扫一扫预览都会请求一次）。
- **怎么修**：`handlePair` 的 GET 分支加 `note('pair-pending', ...)`，但**不置红点**，只在「高级 → 排查日志」里以灰字出现。

### B6 · 长期链接（同一把钥匙跨浏览器通用）

- **现状**：长期钥匙只存在**配对时那个浏览器**的 `localStorage` 里。所以「同一台手机 + 同一个浏览器」不用再扫；换浏览器 / 换手机 / 换隧道域名都要再扫一次（各算一台设备）。
- **为什么没默认做**：二维码和「复制链接」里装的是**一次性票据**（3 分钟、单次），故意短命——码会被截图、被镜头带出去。把长期钥匙塞进二维码等于「谁看到码，谁永久有后门」。
- **想做的形态**（用户 2026-10-27 明确「同浏览器同手机就行」，所以列为可选）：高级页加一个「长期链接」按钮，生成一条**独立设备记录**（名字就叫「长期链接」），链接形如 `https://<域名>/#_k=<钥匙>`，任何浏览器粘上就能进；旁边三个动作「复制 / 换一个新链接（旧的立刻失效）/ 删除」；沿用现在的规则：闲置 30 天自动作废、删记录即刻失效、只用于换 cookie 不给管理权限。
- **怎么修**：`state.addDevice('长期链接', 'long-link')` + 复用 `passKeyFresh/touchPassKey/clearPassKeys`；`gate` 加 `POST /__myphone/api/longlink`（生成/轮换/删除）与 `GET /__myphone/api/longlink`（取现链接）；前端「高级」页加一行按钮 + `addrRow` 样式复用。

### C1 · 双因素 / 双向信任

- 你之前问过「要不要双向信任」，结论是**不做**：设备凭据 180 天、二维码 3 分钟单次，再加一层只会让「换个手机就要折腾半天」。真要加，最轻的形式是「新设备连入时电脑端弹一个确认弹窗」，但它会打断你正在做的事，所以维持现状。

### C2 · 自动锁横屏

- 浏览器禁止网页强制旋转屏幕（`screen.orientation.lock()` 只在全屏下、且 Android Chrome 部分支持）。现在已经给了「全屏横屏」按钮 + 「放大成桌面宽度」，再往上是 PWA + manifest，投入大、收益小。

### C3 · 电脑端「小 logo、点了没反应 / 点一下闪一下大 logo」（**v1.3.1 已修**）

- 真因不是兜底球逻辑，而是**渲染期异常**：`entryOpen`（判断两个入口是否开着）被 `remoteConnect` 用到，但声明写在 300 行之后 → 每次渲染抛 `Cannot access 'entryOpen' before initialization` → React 错误边界把整颗球换成兜底小球。点兜底球会清掉错误再渲染一次 → 又崩 → 屏幕上是「点一下，大 logo 闪一下又回到小 logo」。
- 修法：把那行声明移到 `remoteConnect` 之前（`src/client.js` 约 3290 行）。
- 防复发：新增 `test/tdz-scan.mjs`，扫描 `PhoneFab` 里「渲染路径先用后声明」的 const；`node --check` 只查语法，抓不到这一类。

### C4 · 兜底球补最小交互（**v1.3.2 已修**）

- 兜底球原来只有一个 `<img>`，除了 `pointer-events: none` 什么事件都没绑，点它等于点空气。
- 现在：①`domFallback()` 给 `<img>` 加 `pointer-events: auto`，容器绑 `pointerdown` → `onFallbackTap()` = 清 `FabBoundary.hasError` + `standaloneMounted = false` + `setStandaloneTick(+1)` + `ensureFab()`，探测失败时把原因写进排查事件（走本地队列，下一次 `/panel` 请求时补发）；②React 正常渲染的球在 `standaloneMounted === false` 时也走 `domFallback()`，两条路径点下去行为一致；③日志按 60 秒窗口合并成 `dom-fallback ×N`，并带 `source: 'react' | 'standalone'` 区分是谁在报。

---

## 三、上传 GitHub 之前要补的

- [x] `.gitignore`（`node_modules/`、`.dsh*/`、`*.log`、`state.json`、`test/*.png`、`test/probes/qr-*.json`）
- [x] `LICENSE`（MIT，版权人 ssyin）
- [x] **密钥扫描**：全仓扫过 `secret|api_key|password|token = "<12+ 字符>"`，零命中；`.credentials.yaml` / `state.json` / `*.log` 均不在仓库里
- [x] `package.json` 补 `repository` / `homepage` / `bugs` / `files`（`files` 里原先漏了运行时真正要读取的 `icon-96.png`、`icon-transparent.png`、`icon-tight.png`，发 npm 会 404）
- [x] 目录整理：`test/` 只留能离线跑的回归测试，一次性排查脚本进 `test/probes/`，设计对比图进 `docs/design/`；`.gitattributes` 统一 LF
- [x] `git init` + 首个提交（分支 `main`）
- [x] 新增 [TESTING.md](./TESTING.md)：每项测试断言什么、怎么单独跑、探针要什么参数
- [ ] 截图 3 张 + 一个 GIF：悬浮球 / 弹窗两页 / 手机端扫码（**等界面定稿再做**）
- [ ] 英文 README（`README.en.md`），至少把「它是什么 / 三步安装 / 安全边界」翻掉
- [ ] 建远端仓库并 push（`package.json` 里先按 `github.com/ssyin158/dsh-my-phone` 填的，实际仓库名以你建的为准）
- [ ] Release 说明里明确写三件事：**会监听端口**、**外网入口默认开着**（可在设置里关）、**拿到二维码链接的人 3 分钟内可以进来**

## 四、这一轮（0.9.9）已经修掉的，附在上面这份清单的位置

安全：cloudflared 供应链 RCE（A3 的同类问题）· 关入口卡死 · 长 turn 被 25s 超时截断 · state.json 非原子写 + 损坏即重置 · 限流键在隧道下塌成同一个桶 · 配对码明文落盘 · 手输 6 位码后门 · `next` 开放重定向 · 监听器 error 逃逸 · handleUpgrade 缺 touch/超时 · `sync()` 静默吞并发 · 413 不可达 · `addedAt`/`createdAt` 字段名错。
前端：音效引擎非单例（音色不生效 + AudioContext 泄漏）· 水滴/气泡音丢 `at` · 备注框 Esc 关窗 · 触摸 `pointerleave` 秒杀长按气泡 · 关闭后浮层残留 · 键盘打不开弹窗 · 复制谎报成功 · 快速拖动回弹 · 手机端「入口都关着」永不显示 · 轮询与操作竞态 · 定时器/监听器泄漏 · fetch 无超时 · 气泡长文撑破版面 · 后台仍在轮询。

**v0.9.12（本轮）· 授权提醒为什么会「日志里什么都没有」**：原来挂的是 `approval/request` 瀑布钩子，本宿主上那条线注册了也不一定被调到；改成听**持久会话事件** `approval/asked` / `approval/decided`（跟「跑完一轮」同一条 `ctx.on('session/event')` 线，宿主自己写进会话日志，一定会经过），拿到 `event.id` 后人类点完允许/拒绝立刻把气泡撤掉。同时：音色默认改成第一项「风铃」、音色下拉改成自绘（原生 `<option>` 列表样式由系统控制，改不了）、「自动关闭」也补了「！」说明。

---

## 五、验证这套东西的标准动作

```bash
# 语法
node --check src/*.js

# 单元 / 集成（不需要真实 DSH）
node test/panel-test.js      # 21/21
node test/state-test.js      # 7/7

# 起一个临时宿主跑真机流程（另开一窗，端口冲突就改）
DSH_HOME=H:\因爱而生的鱼\.dshtest \
  H:\deepseek\resources\runtime\cli\bin\dsh.cmd web --no-open --port 14000
node test/dev-boot.js --selftest        # 26/27（唯一红项：环境里没上游 → 502）
node test/probe-v5.mjs 14000 18080 18081
node test/probe-phone.mjs 18080 18081 14000
node test/probe-origin.mjs 18080 18081 14000
```

真机验收：重启 DSH 桌面端 → 右下角悬浮球在默认位置 → 点开「连接」页手动生成二维码 → 手机扫码 → 点「信任这台电脑」→ 进到 DSH。
