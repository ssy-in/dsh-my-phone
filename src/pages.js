import { toSvg } from './qr.js'

const BASE_CSS = `:root{
  --bg:#f2f6fb; --card:#ffffff; --line:#d9e3f0; --line2:#eef3f9;
  --fg:#101a2c; --dim:#4e5f78; --accent:#1f6feb; --accent-dark:#1558c4;
  --danger:#c0271b; --danger-bg:#fff3f1; --danger-line:#f3c3bc;
  --ok:#0a7a4b; --ok-bg:#eafaf1; --amber:#a56a00; --amber-bg:#fff8e8;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--fg);
  font:15px/1.65 "PingFang SC","Microsoft YaHei",system-ui,-apple-system,"Segoe UI",sans-serif;
  -webkit-text-size-adjust:100%}
/* 手机上下滑动要正常：iOS 上被 100% 高度夹死就滑不动了 */
html{min-height:100%;overflow-y:auto;-webkit-overflow-scrolling:touch}
body{padding:22px 16px calc(72px + env(safe-area-inset-bottom,0px));max-width:720px;margin:0 auto;
  min-height:100%;overflow-x:hidden;-webkit-overflow-scrolling:touch}
.scroll{max-height:48vh;overflow-y:auto;-webkit-overflow-scrolling:touch}
h1{font-size:26px;margin:0 0 4px;letter-spacing:.3px;color:#0b1424}
h2{font-size:13px;margin:28px 0 10px;color:var(--dim);font-weight:700;
  text-transform:uppercase;letter-spacing:1.2px}
.sub{color:var(--dim);font-size:13px;margin:0 0 18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;
  padding:16px;margin:0 0 14px;box-shadow:0 1px 2px rgba(16,26,44,.04)}
.danger{border:1px solid var(--danger-line);background:var(--danger-bg);border-left:6px solid var(--danger);
  border-radius:14px;padding:14px 16px;margin:16px 0;color:#5d1a13}
.danger strong{color:var(--danger);font-size:17px;display:block;margin-bottom:6px;letter-spacing:.2px}
.danger ul{margin:8px 0 0;padding-left:20px}
.danger li{margin:6px 0;font-size:14px;color:#4a211c}
.warn{color:#8a4b00;font-weight:700}
.row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 0}
.row+.row{border-top:1px solid var(--line2)}
.row .label{font-size:15px;font-weight:600}
.row .hint{color:var(--dim);font-size:12.5px;margin-top:3px}
.badge{font-size:12px;padding:3px 10px;border-radius:999px;border:1px solid var(--line);
  color:var(--dim);white-space:nowrap;background:#f7f9fc}
.badge.on{color:var(--ok);border-color:#bfe7d2;background:var(--ok-bg)}
.badge.off{color:var(--dim);background:#f4f6fa}
.badge.hot{color:var(--danger);border-color:var(--danger-line);background:var(--danger-bg)}
button{font:inherit;cursor:pointer;border-radius:12px;border:1px solid var(--line);
  background:#fff;color:var(--fg);padding:11px 18px;font-weight:600;transition:.15s;
  box-shadow:0 1px 2px rgba(16,26,44,.05)}
button:hover{background:#f5f8fd;border-color:#c4d4e8}
button:active{transform:scale(.985)}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
button.primary:hover{background:var(--accent-dark);border-color:var(--accent-dark)}
/* 开关打开时高亮：一眼能看出「现在是开着的」 */
button.on{background:var(--ok);border-color:var(--ok);color:#fff;
  box-shadow:0 3px 12px rgba(10,122,75,.28)}
button.on:hover{background:#086339;border-color:#086339}
button.on.hot{background:var(--danger);border-color:var(--danger);
  box-shadow:0 3px 12px rgba(192,39,27,.28)}
button.on.hot:hover{background:#9e1f15;border-color:#9e1f15}
button.dangerbtn{background:#fff;border-color:var(--danger-line);color:var(--danger);font-weight:600}
button.dangerbtn:hover{background:var(--danger-bg)}
button:disabled{opacity:.5;cursor:not-allowed;box-shadow:none}
code,.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.url{font-size:16px;word-break:break-all;background:#f7f9fc;border:1px solid var(--line);
  border-radius:12px;padding:13px;margin-top:10px;color:#0b1424;font-weight:600}
.code{font-family:ui-monospace,Consolas,monospace;font-size:44px;letter-spacing:10px;
  text-align:center;padding:20px 8px 18px;background:#eef4ff;border:2px dashed #a9c4ee;
  border-radius:14px;color:#0b3f8f;font-weight:800;line-height:1.15}
.code.empty{font-size:15px;letter-spacing:0;color:var(--dim);font-weight:500;
  background:#f7f9fc;border:2px dashed var(--line);padding:26px 12px}
.devs{width:100%;border-collapse:collapse;font-size:14px}
.devs th{color:var(--dim);font-weight:600;text-align:left;padding:8px 6px;font-size:12px;
  border-bottom:1px solid var(--line)}
.devs td{padding:11px 6px;border-bottom:1px solid var(--line2);vertical-align:middle}
.devs tr:last-child td{border-bottom:none}
.err{color:#7d1a12;background:var(--danger-bg);border:1px solid var(--danger-line);
  border-radius:12px;padding:11px 13px;margin:12px 0;font-size:14px;font-weight:600}
.muted{color:var(--dim);font-size:13px}
.center{text-align:center}
input[type=text]{width:100%;font:inherit;font-family:ui-monospace,Consolas,monospace;
  font-size:26px;letter-spacing:6px;text-align:center;padding:16px 10px;border-radius:12px;
  border:1.5px solid var(--line);background:#f7f9fc;color:var(--fg);margin:10px 0;font-weight:700}
input[type=text]:focus{outline:3px solid #bcd4f7;outline-offset:1px;border-color:var(--accent);
  background:#fff}
.foot{margin-top:38px;color:#7c8aa3;font-size:12px;text-align:center;line-height:1.9}
.qrbox{background:#fff;border:1px solid var(--line);border-radius:16px;padding:10px;
  display:flex;justify-content:center;margin:8px auto 0;width:max-content;max-width:100%}
.qrbox svg{width:260px;height:260px;max-width:78vw;max-height:78vw;display:block}
.pill{display:inline-flex;gap:6px;margin:6px 6px 0 0}
.pill button{padding:8px 14px;border-radius:999px;font-size:13px}
.pill button.sel{background:var(--accent);border-color:var(--accent);color:#fff}
select{font:inherit;background:#fff;color:var(--fg);border:1px solid var(--line);
  border-radius:12px;padding:10px 12px;font-weight:600}
.btnrow{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
.btnrow button{flex:1 1 160px}
`

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** 把入口地址画成二维码；太长或编码失败就返回空串，页面退化成"只有文字地址"。 */
function qrBlock(address) {
  if (!address) return ''
  try {
    const { svg, version } = toSvg(address, { scale: 7, margin: 3, dark: '#0b1220', light: '#ffffff' })
    return `<div class="qrbox">${svg}</div><p class="muted" style="text-align:center;margin:8px 0 0">用手机相机直接扫 · v${version}</p>`
  } catch (err) {
    return `<p class="muted">二维码生成失败（${esc(err?.message ?? err)}），请手动输入下面的地址</p>`
  }
}

const HEAD = (title) => `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'self'; form-action 'self'; base-uri 'none'">
<title>${esc(title)}</title><style>${BASE_CSS}</style>
</head><body>
`

export function loginPage({ error = '', next = '/', code = '', attemptsLeft = null } = {}) {
  const hint =
    attemptsLeft === null || attemptsLeft === undefined
      ? ''
      : attemptsLeft > 0
        ? `<div class="muted" style="margin-top:8px">再错 ${attemptsLeft} 次后会锁 15 分钟。</div>`
        : `<div class="muted" style="margin-top:8px">已经锁住了，等 15 分钟再试。</div>`

  return `${HEAD('DSH My Phone · 设备配对')}
<h1>DSH My Phone</h1>
<p class="sub">这是一台私人电脑的远程入口</p>

<div class="danger">
  <strong>⚠ 非本人请立刻关闭此页面</strong>
  <ul>
    <li>进入后，你能以<strong>电脑主人的身份</strong>操作他的 DSH：读文件、跑命令、看聊天记录。</li>
    <li>配对码只能使用一次，3 分钟后自动失效。</li>
    <li>不要在别人的手机、公共电脑或借来的设备上配对。</li>
  </ul>
</div>

<form method="POST" action="/__myphone/pair" class="card" autocomplete="off" id="pairForm">
  <label class="muted" for="code">输入电脑上显示的 6 位配对码</label>
  <input id="code" name="code" type="text" inputmode="latin" maxlength="7"
         placeholder="ABC-DEF" autofocus spellcheck="false" autocapitalize="characters"
         value="${esc(code)}">
  <input type="hidden" name="next" value="${esc(next)}">
  ${error ? `<div class="err"><strong>配对没成功</strong><br>${esc(error)}${hint}</div>` : ''}
  <button class="primary" type="submit" id="pairSubmit" style="width:100%;padding:15px;font-size:17px">配对这台设备</button>
</form>

<p class="foot">
  电脑端打开：DSH → 设置 → DSH My Phone → 生成配对码<br>
  配对所有设备都能在电脑端单独移除
</p>
<script>
(function () {
  var form = document.getElementById('pairForm')
  var btn = document.getElementById('pairSubmit')
  var input = document.getElementById('code')
  if (input) {
    // 自动大写、自动补横杠：输 6 位字母数字就变成 ABC-DEF
    input.addEventListener('input', function () {
      var v = input.value.toUpperCase().replace(/[^0-9A-Z]/g, '')
      input.value = v.length > 3 ? v.slice(0, 3) + '-' + v.slice(3, 6) : v
    })
  }
  if (form && btn) {
    form.addEventListener('submit', function () {
      btn.disabled = true
      btn.textContent = '正在配对…'
      btn.style.opacity = '0.75'
    })
  }
})()
</script>
</body></html>`
}

/**
 * 手机跑过来但没凭据（或凭据过期）时看到的页。
 *
 * 这里不再有输入框：入口没有密码，也不接受手输的配对码 —— 只能扫电脑上的码。
 * 网页只负责把人挡回去并告诉他下一步做什么。
 */
export function scanPage({ error = '', device = '', host = '' } = {}) {
  return `${HEAD('DSH My Phone · 请扫码')}
<h1>用手机扫电脑上的码</h1>
<p class="sub">这个入口没有密码，只认扫过码、点过信任的手机</p>

<div class="danger">
  <strong>⚠ 不是你自己扫的码，请立刻关掉</strong>
  <ul>
    <li>入口<strong>不需要记住任何密码</strong>，也不要在这里输任何东西。</li>
    <li>扫码之后还要你亲手点一次「信任这台电脑」，点了那台电脑上才会出现这台设备。</li>
    <li>不认识这台电脑，或者不知道二维码是谁给的 —— 直接关掉。</li>
  </ul>
</div>

${error ? `<div class="err"><strong>没能进得去</strong><br>${esc(error)}</div>` : ''}

<div class="card">
  <div class="row" style="padding-top:0">
    <div>
      <div class="label">怎么连</div>
      <div class="hint">到那台电脑上打开 DSH → 点右下角圆形按钮 → 用这台手机的相机扫它显示出来的二维码</div>
    </div>
  </div>
  ${
    device
      ? `<div class="row"><div><div class="label">这台设备</div><div class="hint">${esc(device)}</div></div></div>`
      : ''
  }
  ${
    host
      ? `<div class="row"><div><div class="label">你现在访问的地址</div><div class="hint"><span class="mono">${esc(host)}</span><br>凭据是按「地址」记的：同一个地址配一次就长期有效；<strong>换网络（WiFi ↔ 流量）或换了入口地址，就等于换了一台新设备，要在这个地址上再扫一次</strong>。</div></div></div>`
      : ''
  }
</div>

<div class="card" id="autoCard" style="display:none">
  <div class="row" style="padding-top:0">
    <div>
      <div class="label">这台手机记得这台电脑</div>
      <div class="hint" id="autoMsg">正在用记住的凭据自动登录…</div>
    </div>
  </div>
</div>

<p class="foot">凭据丢了就在电脑上点「换一个二维码」重新扫一次 · <a href="/__myphone/diag">网络自检</a></p>
<script>
(function () {
  var KEY = 'dsh-my-phone.pass'
  var k = null
  try { k = localStorage.getItem(KEY) } catch (e) { k = null }
  if (!k) return
  var card = document.getElementById('autoCard')
  var msg = document.getElementById('autoMsg')
  if (card) card.style.display = 'block'
  fetch('/__myphone/pair', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'lt=' + encodeURIComponent(k),
  })
    .then(function (r) {
      if (r.ok || r.redirected) {
        if (msg) msg.textContent = '连上了，正在进入…'
        location.replace('/')
        return
      }
      try { localStorage.removeItem(KEY) } catch (e) {}
      if (card) card.style.display = 'none'
    })
    .catch(function () {
      if (card) card.style.display = 'none'
    })
})()
</script>
</body></html>`
}

/**
 * 旧隧道域名。
 *
 * 免费隧道（quick tunnel）每次启动都换一个新域名，手机上存的书签/历史里的那个
 * 早就不是这台电脑了。浏览器转到它只会得到 Cloudflare 的 502/1033 或"不是私密连接"，
 * 很容易被看成"我被人劫持了"。所以提前认出来，给一句人话，节省一次心慌。
 */
export function staleHostPage({ host = '', current = '' } = {}) {
  return `${HEAD('DSH My Phone · 这个地址过期了')}
<h1>这个地址已经过期了</h1>
<p class="sub">不是你被劫持，是免费隧道换域名了</p>

<div class="danger">
  <strong>⚠ 你打开的这个地址现在不指向这台电脑</strong>
  <ul>
    <li>免费隧道（Cloudflare 临时通道）<strong>每次启动都会换一个新域名</strong>：重启 DSH、关掉再开外网入口，地址就变了。</li>
    <li>你开的这个：<code>${esc(host)}</code></li>
    <li>这台电脑现在的地址：<code>${esc(current || '（外网入口暂时没开）')}</code></li>
  </ul>
</div>

<div class="card">
  <div class="row" style="padding-top:0">
    <div>
      <div class="label">怎么回来</div>
      <div class="hint">到电脑上打开 DSH → 点右下角那个图标 → 用手机相机扫它显示出来的二维码。设备不用重新信任，只要重扫一次地址。</div>
    </div>
  </div>
  <div class="row">
    <div>
      <div class="label">不想地址老变？</div>
      <div class="hint">在家用局域网地址（192.168.x.x）是固定的；出门要用就在电脑上把「外网入口」开着，扫最新那个码即可。</div>
    </div>
  </div>
</div>
</body></html>`
}

/**
 * 手机扫完二维码后看到的「信任」页。
 *
 * 这是整套设计里唯一一个"人要主动点一下"的地方：光扫到二维码什么都不给，
 * 点了这个按钮才建立设备凭据。二维码被偷看、被转发，最多也就是让别人看到
 * 这一页 —— 他点下去，你在电脑端能立刻看到多了一台设备并撤销。
 */
export function trustPage({ ticket = '', device = '这台设备', error = '', relink = false } = {}) {
  return `${HEAD(relink ? 'DSH My Phone · 正在恢复连接' : 'DSH My Phone · 信任这台电脑')}
<h1>${relink ? '正在恢复连接…' : '信任这台电脑？'}</h1>
<p class="sub">${relink ? '这台手机之前已经信任过这台电脑，正在自动接上' : '确认一下：你要走进的是一台真实的电脑'}</p>
${error ? `<div class="danger"><strong>⚠ ${esc(error)}</strong></div>` : ''}

${relink
      ? `<div class="card" style="text-align:center">
  <div class="label">这台手机</div>
  <div class="hint" style="margin-top:4px">${esc(device)}</div>
  <p class="muted center" style="margin:12px 0 0">之前已经信任过这台电脑，不用再点一次信任。</p>
</div>`
      : `<div class="danger">
  <strong>⚠ 只有在你自己的手机、你自己的电脑上才点</strong>
  <ul>
    <li>点下去之后，这台手机就能<strong>以电脑主人的身份</strong>使用 DSH：读文件、跑命令、看全部聊天记录。</li>
    <li>凭据在手机上保留 180 天，期间不用再扫。</li>
    <li>不认识这台电脑，或者不知道是谁发来的二维码 —— 直接关掉，不要点。</li>
  </ul>
</div>`}

<form method="POST" action="/__myphone/pair" class="card" autocomplete="off" id="trustForm">
  <input type="hidden" name="t" value="${esc(ticket)}">
  <div class="row" style="padding-top:0">
    <div>
      <div class="label">这台手机将记为</div>
      <div class="hint">${esc(device)}</div>
    </div>
    <span class="badge">180 天</span>
  </div>
  <button class="primary" type="submit" id="trustBtn" style="width:100%;padding:16px;font-size:17px;margin-top:6px"
    ${relink ? 'disabled' : ''}>
    ${relink ? '正在连接 DSH…' : '信任这台电脑，进入 DSH'}
  </button>
  <p class="muted center" style="margin:14px 0 0" id="trustHint">
    ${relink
      ? '请稍候，正在自动进入，不用点按钮'
      : '这一步只是在手机上记下这台电脑；点了不想要，可以在电脑端随时断开。'}
  </p>
</form>

<p class="foot">
  配对过的设备都能在电脑端「DSH My Phone → 已配对设备」里单独断开<br>
  这个二维码 3 分钟内有效，且只能用一次
</p>
<script>
(function () {
  var form = document.getElementById('trustForm')
  var btn = document.getElementById('trustBtn')
  var hint = document.getElementById('trustHint')
  var relink = ${relink ? 'true' : 'false'}
  var sent = false
  if (form && btn) {
    form.addEventListener('submit', function (e) {
      // 只允许提交一次：连点 / 自动提交 + 手点撞在一起时，第二下直接吞掉
      if (sent) {
        e.preventDefault()
        return false
      }
      sent = true
      btn.disabled = true
      btn.textContent = '正在连接 DSH…'
      btn.style.opacity = '0.75'
      if (hint) hint.textContent = '请稍候，正在进入…'
    })
  }
  // 已信任的设备：不用人再点一下，进来就自动提交（票据依旧只能用一次、3 分钟过期）
  if (relink && form) {
    setTimeout(function () { form.submit() }, 80)
    // 8 秒还没走出去，说明网络卡住了 —— 把按钮换成"别点"的提示，别让人越点越乱
    setTimeout(function () {
      if (btn) btn.textContent = '正在连接 DSH…'
      if (hint) hint.textContent = '网络有点慢，还在重试；如果一直停在这里，回电脑上换一个二维码重扫一次'
    }, 8000)
  }
})()
</script>
</body></html>`
}

export function adminPage({ state, pairing, status, addresses = [] }) {
  const s = state.settings
  const devices = state.devices
  // v0.6 起不再自动发票：没票就显示「点下面按钮生成」，过期也停在失效状态等人点。
  const liveTicket = pairing.peekTicket()
  const pairUrl = liveTicket && addresses[0]
    ? `${addresses[0].replace(/\/?$/, '/')}__myphone/pair?t=${encodeURIComponent(liveTicket.ticket)}`
    : ''
  const data = JSON.stringify({
    lanEnabled: s.lanEnabled,
    tunnelEnabled: s.tunnelEnabled,
    pairing: pairing.peek(),
    pairUrl,
    address: pairUrl || addresses[0] || '',
    autoOffMinutes: Number(s.autoOffMinutes || 0),
    lanAutoOffMinutes: Number(s.lanAutoOffMinutes || 0),
    tunnelAutoOffMinutes: Number(s.tunnelAutoOffMinutes || 0),
    tunnel: status.tunnel,
  }).replace(/</g, '\\u003c')

  const deviceRows = devices.length
    ? devices
        .map(
          (d) => `<tr>
      <td>${esc(d.label)}</td>
      <td>${
        d.trustedAt
          ? `<span class="badge on">已信任</span>`
          : `<span class="badge hot">未信任</span>`
      }</td>
      <td class="muted">${d.lastSeen ? timeAgo(d.lastSeen) : '从未连接'}</td>
      <td style="text-align:right;white-space:nowrap">
        ${
          d.trustedAt
            ? `<button class="dangerbtn" data-untrust="${esc(d.id)}">断开</button>`
            : `<button data-trust="${esc(d.id)}">信任</button>`
        }
        <button class="dangerbtn" data-remove="${esc(d.id)}">移除</button>
      </td>
    </tr>`,
        )
        .join('')
    : `<tr><td colspan="4" class="muted" style="padding:16px 6px">还没有配对的设备</td></tr>`

  return `${HEAD('DSH My Phone · 设置')}
<h1>DSH My Phone</h1>
<p class="sub">把这台电脑上的 DSH 装进口袋</p>

<div class="danger">
  <strong>⚠ 打开后就是一台「没有锁」的电脑</strong>
  <ul>
    <li>任何拿到入口的人，都能以你的身份使用这台电脑上的 DSH —— 包括读文件、执行命令、看全部对话。</li>
    <li>两个入口<strong>默认都开着</strong>（装好就能用）。不用的时候请直接关掉，别长期挂着。</li>
    <li>外网模式会经过第三方中继，流量在那里是<strong>可被看到</strong>的。</li>
    <li>不要在公共 Wi-Fi 下配对，不要在别人的设备上配对。</li>
  </ul>
</div>

<h2>入口</h2>
<div class="card">
  <div class="row">
    <div>
      <div class="label">局域网访问 <span class="badge ${s.lanEnabled ? 'on' : 'off'}">${s.lanEnabled ? '已开启' : '已关闭'}</span></div>
      <div class="hint">同一 Wi-Fi 下可用，不经第三方，最安全</div>
    </div>
    <button class="${s.lanEnabled ? 'on' : ''}" data-toggle="lan">${s.lanEnabled ? '已开启 · 点击关闭' : '开启'}</button>
  </div>
  <div class="row">
    <div>
      <div class="label">外网访问 <span class="badge ${s.tunnelEnabled ? 'hot' : 'off'}">${s.tunnelEnabled ? '已开启 · 高风险' : '已关闭'}</span></div>
      <div class="hint">经 Cloudflare 隧道，在公司/外地也能用</div>
    </div>
    <button class="${s.tunnelEnabled ? 'on hot' : ''}" data-toggle="tunnel">${s.tunnelEnabled ? '已开启 · 点击关闭' : '开启'}</button>
  </div>
  <div class="row" style="padding-top:0">
    <div><div class="hint">外网入口自动关闭</div></div>
    <select id="autooff-tunnel">
      ${[0, 15, 30, 60, 120]
        .map((m) => `<option value="${m}" ${Number(s.tunnelAutoOffMinutes || 0) === m ? 'selected' : ''}>${m === 0 ? '不自动关' : m + ' 分钟'}</option>`)
        .join('')}
    </select>
  </div>
  ${
    pairUrl
      ? `${qrBlock(pairUrl)}
         <p class="muted center" style="margin:8px 0 0">手机扫这个码 → 点「信任这台电脑」就进得去</p>
         <div class="url mono" id="addr">${esc(pairUrl)}</div>
         <div class="btnrow">
           <button data-reload>换一个二维码</button>
           <button data-copy>复制链接</button>
         </div>`
      : `<div class="url mono muted" style="text-align:center;padding:26px 12px;border:1px dashed #dbe4f0;background:#fbfdff">还没有二维码 —— 点下面的按钮生成</div>
         <div class="btnrow"><button class="primary" data-reload>生成二维码</button></div>`
  }
</div>

<h2>怎么让手机连上</h2>
<div class="card">
  <p class="muted" style="margin:0 0 8px">
    上面那个二维码就是全部流程：手机相机扫它 → 手机上点一次「信任这台电脑」→ 就进去了。
  </p>
  <p class="muted" style="margin:0">
    手机端<strong>没有输密码的地方，也没有配对码</strong>，只能扫码 —— 这样就算某个 6 位数字被看到，也变不成后门。
    二维码 3 分钟内有效、只能用一次，而且<strong>不会自动刷新</strong>：过期或不想用了，点一下「换一个二维码」。
  </p>
</div>

<h2>已配对设备（${devices.length}/${s.maxDevices}）</h2>
<div class="card">
  <table class="devs">
    <thead><tr><th>设备</th><th>信任</th><th>最近连接</th><th></th></tr></thead>
    <tbody>${deviceRows}</tbody>
  </table>
  <p class="muted" style="margin:12px 0 0">没被信任的设备进不去。断开后会立刻失效（下次要重新扫码）。</p>
</div>

<h2>开启之前，先读这段</h2>
<div class="danger">
  <strong>三条硬规矩</strong>
  <ul>
    <li><span class="warn">别常开。</span>只在需要时打开，用完就关。开着就等于把电脑钥匙插在门锁上。</li>
    <li><span class="warn">别共享配对码。</span>一台设备一个码，用一次即废。朋友要用，请他自己配对，用完你在这里移除。</li>
    <li><span class="warn">外网模式信任链更长。</span>流量经 Cloudflare 中继，虽然加密但端点可见；敏感对话不要在外网模式下进行。</li>
  </ul>
</div>

<p class="foot">
  DSH My Phone v0.3 · 状态目录里的 state.json 含本机签名密钥，请勿外传<br>
  本页只允许从本机（127.0.0.1）访问
</p>

<script>
const S = ${data};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function timeAgo(ts){const d=(Date.now()-ts)/1000;if(d<60)return '刚刚';if(d<3600)return Math.floor(d/60)+' 分钟前';if(d<86400)return Math.floor(d/3600)+' 小时前';return Math.floor(d/86400)+' 天前'}

/* ---- 配对码：点了就地显示，不再整页刷新 ---- */
const pairBox = document.getElementById('pairBox');
const pairMsg = document.getElementById('pairMsg');
const pairBtn = document.getElementById('pairBtn');
let ttlTimer = null;

function codeHtml(code){
  return '<div class="code">' + esc(code) + '</div>' +
         '<p class="muted center" style="margin:10px 0 0">剩余 <span id="ttl">--</span> 秒 · 只能用一次</p>';
}
function startTtl(end){
  if (ttlTimer) clearInterval(ttlTimer);
  const tick = () => {
    const el = document.getElementById('ttl');
    if (!el) { clearInterval(ttlTimer); return; }
    const left = Math.max(0, Math.round((end - Date.now()) / 1000));
    el.textContent = left;
    if (left <= 0) {
      clearInterval(ttlTimer);
      if (pairBox) pairBox.innerHTML = '<div class="code empty">配对码已过期 —— 点下面的按钮换一个</div>';
      if (pairBtn) pairBtn.textContent = '生成配对码';
    }
  };
  tick(); ttlTimer = setInterval(tick, 1000);
}
if (S.pairing && S.pairing.expiresAt) startTtl(S.pairing.expiresAt);

async function post(action, payload){
  const r = await fetch('/__myphone/api/' + action, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-myphone-admin': '1' },
    body: JSON.stringify(payload || {})
  });
  let data = {};
  try { data = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error(data && data.error ? data.error : ('HTTP ' + r.status));
  return data;
}

if (pairBtn) pairBtn.addEventListener('click', async () => {
  pairBtn.disabled = true;
  if (pairMsg) pairMsg.innerHTML = '';
  try {
    const data = await post('pair');
    if (pairBox) pairBox.innerHTML = codeHtml(data.code);
    startTtl(data.expiresAt);
    pairBtn.textContent = '换一个配对码';
  } catch (e) {
    if (pairMsg) pairMsg.innerHTML = '<div class="err">生成失败：' + esc(e.message) + '</div>';
  } finally {
    pairBtn.disabled = false;
  }
});

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.toggle) {
    t.disabled = true;
    try { await post('toggle', { key: t.dataset.toggle }); location.reload(); }
    catch (err) { alert('操作失败：' + err.message); t.disabled = false; }
  } else if (t.dataset.trust) {
    t.disabled = true;
    try { await post('trust', { id: t.dataset.trust }); location.reload(); }
    catch (err) { alert('操作失败：' + err.message); t.disabled = false; }
  } else if (t.dataset.untrust) {
    if (!confirm('断开这台设备？它会立刻失效，下次要重新扫码。')) return;
    t.disabled = true;
    try { await post('untrust', { id: t.dataset.untrust }); location.reload(); }
    catch (err) { alert('操作失败：' + err.message); t.disabled = false; }
  } else if (t.dataset.remove) {
    if (!confirm('移除这台设备？它下次需要重新配对。')) return;
    try { await post('remove', { id: t.dataset.remove }); location.reload(); }
    catch (err) { alert('操作失败：' + err.message); }
  } else if (t.hasAttribute('data-reload')) {
    // 「换一个二维码」要真的换：后端直接发一张新票据，再刷新本页
    t.disabled = true;
    try { await post('ticket'); location.reload(); }
    catch (err) { alert('换码失败：' + err.message); t.disabled = false; }
  } else if (t.hasAttribute('data-copy')) {
    navigator.clipboard?.writeText(S.address || '');
    t.textContent = '已复制'; setTimeout(() => t.textContent = '复制链接', 1200);
  }
});
// 自动关闭只留外网这一条：局域网只在家里的 Wi-Fi 内可达，不需要自动收口
for (const key of ['tunnel']) {
  document.getElementById('autooff-' + key)?.addEventListener('change', async (e) => {
    try { await post('autooff', { key, minutes: Number(e.target.value) }); location.reload(); }
    catch (err) { alert('操作失败：' + err.message); }
  });
}
</script>
</body></html>`
}

export function errorPage(code, message) {
  const help =
    code === '503'
      ? `<div class="card" style="margin-top:16px">
    <h2 style="margin-top:0">怎么办</h2>
    <ol style="margin:0;padding-left:20px;line-height:1.9">
      <li>确认<strong>电脑上的 DSH 还开着</strong>（关掉窗口 = 入口失效）。</li>
      <li>在电脑上打开 <code>~/.dsh/.dsh-my-phone/pair.log</code>，最后一行写着真正的原因。</li>
      <li>回到这个页面重试；还是不行就在电脑端把「局域网入口」关掉再打开一次。</li>
    </ol>
  </div>`
      : code === '500'
        ? `<div class="card" style="margin-top:16px">
    <h2 style="margin-top:0">怎么办</h2>
    <ol style="margin:0;padding-left:20px;line-height:1.9">
      <li>先<strong>刷新一次</strong> —— 多半是刚启动那一瞬间，插件还没准备好。</li>
      <li>还不行就在电脑上打开 <code>~/.dsh/.dsh-my-phone/error.log</code>，最后一段是完整堆栈。</li>
      <li>入口地址可以用电脑上的设置页 <code>http://127.0.0.1:8080/__myphone/</code> 重新扫码换一个。</li>
    </ol>
  </div>`
        : ''
  return `${HEAD(`DSH My Phone · ${code}`)}
<h1>${code}</h1>
<div class="danger"><strong>⚠ ${esc(message)}</strong></div>
${help}
<p class="foot">DSH My Phone</p>
</body></html>`
}

function timeAgo(ts) {
  const d = (Date.now() - ts) / 1000
  if (d < 60) return '刚刚'
  if (d < 3600) return `${Math.floor(d / 60)} 分钟前`
  if (d < 86400) return `${Math.floor(d / 3600)} 小时前`
  return `${Math.floor(d / 86400)} 天前`
}

/** 「空闲自动关闭」这一行的说明文字，随设置变化。 */
function autoOffHint(s) {
  const m = Number(s.autoOffMinutes || 0)
  if (!m) return '不自动关：入口会一直开着，直到你手动关掉（不推荐长期这样）'
  return `连续 ${m} 分钟没有任何访问，入口会自己关闭并释放端口`
}

/** 配对码区域：有码显示大字码 + 倒计时，没码显示"还没生成"。 */
function pairingBlock(pairing) {
  const p = pairing.peek()
  if (!p) return `<div class="code empty">还没有配对码 —— 点下面的按钮生成</div>`
  return `<div class="code">${esc(p.code)}</div>
  <p class="muted center" style="margin:10px 0 0">剩余 <span id="ttl">--</span> 秒 · 只能用一次</p>`
}
