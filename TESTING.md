# 测试与自检

这个仓库的测试分成三类。全部用 Node 直接跑，**不需要** `node_modules`（插件本身零依赖），也不需要先编译。

## 一、单元 / 回归测试（离线即可跑）

```bash
node test/widget-test.mjs      # 悬浮球 / 弹窗 / 气泡的结构与文案（25 项）
node test/widget-dom-test.mjs  # 假 DOM 里真跑 widget.js：挂载、气泡定位（不压球）、队列、去重、消息卡（左上事件标签）、页签、文案与事件对得上、高频事件不弹、指纹不发空、滚动位置不跳顶、手机端不白跑 404、手机端红点与已读、一键清空设备凭证、单台设备删除两次确认、手机端高级页音效可操作、连接页两张二维码卡片可切换、按开关出侧、页签选中态、倒计时单独一行、高级页无链接行、授权气泡会话名不重复、消息涌进来不互相饿死、技术类出错按 P1 提示、红点不带数字、气泡按等级 3/6/10 秒自动收起、「等你回答」按 P0 走、声音跟着消息走不被气泡队列拖住、点页面任意位置解锁音频（112 项）
node test/panel-test.js        # 面板 HTTP 接口 + 快照字段（29 项）
node test/audio-test.mjs       # 假 AudioContext 跑 audio.js：P0 五声 / P1 三声 / P2 一声、音量映射 ×0.025（16 项）
node test/feed-test.mjs        # 消息中心三段流：非人记录 / 人做的事 / 待处理、会话名裁 6 字、autooff 归 P1、ctx 降 P2（46 项）
node test/state-test.js        # state.json 读写、迁移、设备 upsert、静默设置、一键清空设备（11 项）
node test/approval-test.mjs    # 授权提醒：会话名、【】文案、合并、ack、6 字截断（20 项）
node test/passkey-test.mjs     # 长期凭据（第二把钥匙）：签发/校验/作废（22 项）
node test/entry-test.mjs       # 扫码地址规则：外网开→https，关→IP，未就绪→pending（8 项）
node test/alert-test.mjs       # 提醒分级：P0/P1/P2、合并窗口、静默（10 项）
node test/modes-test.js        # 电脑/手机两种形态的判定与只读边界（13 项）
node test/icon-public-test.mjs # 公网口静态图标白名单（6 项）
node test/public-assets-test.mjs # 公网口可以拿到的静态资源清单（5 项）
node test/stale-host-test.js   # 旧隧道域名拦截（5 项）
node test/sse-real.mjs         # 真 http.Server 上的 SSE 推送（4 项）
node test/tdz-scan.mjs         # 静态扫描：渲染路径上「先用后声明」的 const
```

`tdz-scan.mjs` 是为一个真实事故加的：`entryOpen` 在渲染路径上被引用、声明却写在 300 行之后，每次渲染都抛 `Cannot access 'entryOpen' before initialization`，错误边界把整颗悬浮球换成兜底小球，表现为「只剩一个小 logo，点一下闪一下大 logo」。`node --check` 只查语法，抓不到这类运行时 TDZ。

## 二、自检（会起一个临时 DSH 宿主）

```bash
node test/dev-boot.js --selftest
```

它会用 `dev-session.js` 在活动库里建一个临时会话，把插件按真实加载路径跑一遍：`imported` / `applied` 两个阶段、端口监听、配对票据、设备信任、SSE、护栏断言等（30+ 项）。

唯一的“红项”通常是：

```
✗ 带凭据代理到真实 DSH — HTTP 502
```

这不是失败——临时环境里没有上游 DSH 可代理，属于预期。真实宿主上这一步是 200。

## 三、探针（需要真实宿主 / 隧道地址，不在自动测试里）

`test/probes/` 下都是**一次性排查脚本**，用来对真实运行中的实例取证。它们需要参数或一个活着的宿主，直接跑会报错退出，这是正常的：

```bash
# 例：对真实实例跑一遍完整链路
node test/probes/probe-live.mjs 8081
node test/probes/probe-live-phone.mjs 8081 https://xxx.trycloudflare.com
node test/probes/probe-tunnel.mjs https://xxx.trycloudflare.com
node test/probes/probe-origin.mjs          # 验证手机发 Origin: null 时配对仍然 303
node test/probes/probe-fresh.mjs           # 验证「改完客户端代码，刷新页面就能看到」
```

它们产出的 `*.png` / `*.json` 已被 `.gitignore` 忽略。

## 四、跑测试时的两个坑

1. **Node 版本**：这些脚本用 ESM，Node ≥ 18 即可。Windows 上如果 `node` 不在 PATH，用绝对路径（例如 `E:\node\node.exe`）。
2. **临时宿主**：不要用 `Start-Process` 去启动 `dsh.cmd`（PowerShell 会把它当 JS 读，报 `SyntaxError: Invalid token`）。正确写法是先设 `ELECTRON_RUN_AS_NODE=1`，再用 exe 直接跑 `cli.js`：

```powershell
$env:DSH_HOME = "H:\path\to\.dshtest"
$env:ELECTRON_RUN_AS_NODE = "1"
& "H:\deepseek\DeepSeek Harness.exe" "H:\deepseek\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" web --no-open --port 14000
```

面板路由挂在**宿主 web 服务器端口**（上面这个 `14000`）上，不是插件自己的管理口（默认 8080）。
