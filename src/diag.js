/**
 * 手机端「网络自检」页。
 *
 * 为什么需要它：用户报「有的 https 一开就弹证书有问题」，而证书本身在这台电脑上验证是好的
 * （`*.trycloudflare.com`，Google Trust Services 签发）。那就只可能是「手机到 Cloudflare
 * 之间」出了问题，而这一类问题从服务端根本看不见，必须在手机浏览器里跑一次探测：
 *
 *   1. 本机时间 vs 服务器时间 → 时间偏了就会被判「证书未生效 / 已过期」
 *   2. 用 no-cors fetch 去摸三个不同的 https 站点 → 分清是「全网 https 都不通」还是「只有咱们那个域名不通」
 *   3. 把环境（协议/host/UA/网络类型）一起显示出来
 *
 * 页面本身不依赖任何外部脚本，也不读设备的配对凭据，纯只看网络。
 */

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const CSS = `
:root{--bg:#f2f6fb;--card:#fff;--fg:#101a2c;--dim:#4e5f78;--line:#dbe6f2;--ok:#0a7a4b;--warn:#b45309;--bad:#c0271b;--accent:#0d7c8c}
*{box-sizing:border-box}
body{margin:0;padding:20px 14px 60px;background:var(--bg);color:var(--fg);
  font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,"PingFang SC","Microsoft YaHei",sans-serif}
h1{margin:0 0 4px;font-size:19px;font-weight:800}
.sub{margin:0 0 16px;font-size:12.5px;color:var(--dim)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:0 0 12px;
  box-shadow:0 6px 20px rgba(16,42,67,.05)}
.card h2{margin:0 0 10px;font-size:14.5px;font-weight:800;display:flex;align-items:center;gap:8px}
.row{display:flex;gap:10px;align-items:flex-start;padding:4px 0;font-size:13px;border-bottom:1px dashed #eef3f9}
.row:last-child{border-bottom:0}
.row .k{flex:0 0 96px;color:var(--dim)}
.row .v{flex:1;min-width:0;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px}
.tag{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:700;line-height:18px}
.tag.ok{background:#e6f7ef;color:var(--ok)}
.tag.bad{background:#fff0ee;color:var(--bad)}
.tag.warn{background:#fff4e0;color:var(--warn)}
.tag.wait{background:#eef3f9;color:var(--dim)}
#verdict{margin:10px 0 0;font-size:13.5px;line-height:1.7}
#verdict b{color:var(--bad)}
.hint{margin:10px 0 0;font-size:12.5px;color:var(--dim);line-height:1.65}
button{font:inherit;font-weight:700;border-radius:10px;border:1px solid #c9dced;background:#fff;color:var(--accent);
  padding:8px 14px;cursor:pointer}
button:active{transform:scale(.98)}
.foot{margin-top:16px;font-size:12px;color:#8296ab;text-align:center}
`

/**
 * @param {{ host?: string, tunnelUrl?: string, lanUrl?: string }} opts
 */
export function diagPage({ host = '', tunnelUrl = '', lanUrl = '' } = {}) {
  // 探测目标：自己的隧道地址 + 两个公共站点做对照
  const selfHost = String(tunnelUrl || '').replace(/\/+$/, '')
  const targets = []
  if (selfHost) targets.push({ label: '本插件的隧道', url: `${selfHost}/__myphone/diag/time` })
  targets.push({ label: 'Cloudflare（对照）', url: 'https://cloudflare.com/cdn-cgi/trace' })
  targets.push({ label: '百度（对照）', url: 'https://www.baidu.com/' })

  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>网络自检 · DSH My Phone</title>
<style>${CSS}</style>
</head><body>
<h1>网络自检</h1>
<p class="sub">看看「证书有问题 / 打不开」到底出在哪一段。当前页面：<b>${esc(host || '未知')}</b></p>

<div class="card">
  <h2>1 · 环境</h2>
  <div class="row"><span class="k">页面地址</span><span class="v" id="env-url">—</span></div>
  <div class="row"><span class="k">协议</span><span class="v" id="env-proto">—</span></div>
  <div class="row"><span class="k">网络类型</span><span class="v" id="env-net">—</span></div>
  <div class="row"><span class="k">在线</span><span class="v" id="env-online">—</span></div>
  <div class="row"><span class="k">UA</span><span class="v" id="env-ua">—</span></div>
</div>

<div class="card">
  <h2>2 · 时间</h2>
  <div class="row"><span class="k">本机时间</span><span class="v" id="t-local">—</span></div>
  <div class="row"><span class="k">服务器时间</span><span class="v" id="t-server">—</span></div>
  <div class="row"><span class="k">偏差</span><span class="v" id="t-skew">—</span></div>
  <p class="hint">浏览器校验证书时会拿本机时间做比较。手机时间偏出几分钟，就可能出现「证书未生效 / 已过期」，实际证书是好的。</p>
</div>

<div class="card">
  <h2>3 · HTTPS 连通性</h2>
  <div id="probes"></div>
  <p class="hint">用的是 no-cors 探测：只要能建立 TLS 连接就算通过，不看内容。三个结果放一起才能分清是「这条链路被拦」还是「本机所有 https 都不行」。</p>
</div>

<div class="card">
  <h2>4 · 结论</h2>
  <div id="verdict"><span class="tag wait">检测中…</span></div>
  <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
    <button id="again">再测一次</button>
    <button id="copy">复制结果</button>
  </div>
</div>

<p class="foot">DSH My Phone · 这个页面不读任何设备凭据，只看网络</p>

<script>
(function () {
  var TARGETS = ${JSON.stringify(targets)};
  var LAN = ${JSON.stringify(String(lanUrl || '').replace(/\/+$/, ''))};
  var result = { at: '', skewMs: 0, probes: [], env: {} };

  function set(id, text, cls) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (cls) el.className = 'v ' + cls;
  }
  function tag(kind, text) {
    return '<span class="tag ' + kind + '">' + text + '</span>';
  }
  function fmt(ms) {
    if (!isFinite(ms)) return '—';
    var a = Math.abs(ms);
    if (a < 1000) return (ms >= 0 ? '+' : '-') + a + ' 毫秒';
    if (a < 60000) return (ms >= 0 ? '+' : '-') + (a / 1000).toFixed(1) + ' 秒';
    return (ms >= 0 ? '+' : '-') + Math.round(a / 60000) + ' 分钟';
  }

  // ── 环境 ──
  function env() {
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
    var e = {
      url: location.href,
      proto: location.protocol,
      net: [c.effectiveType || '', c.type || ''].filter(Boolean).join(' / ') || '未知',
      online: navigator.onLine ? '在线' : '离线',
      ua: navigator.userAgent,
      w: screen.width,
      h: screen.height,
      dpr: window.devicePixelRatio || 1,
    };
    result.env = e;
    set('env-url', e.url);
    set('env-proto', e.proto === 'https:' ? 'https（加密）' : 'http（明文）');
    set('env-net', e.net);
    set('env-online', e.online);
    set('env-ua', e.ua);
  }

  // ── 与服务器对表 ──
  function clock() {
    var t0 = Date.now();
    return fetch('/__myphone/diag/time', { cache: 'no-store' })
      .then(function (r) { return r.json() })
      .then(function (j) {
        var rtt = Date.now() - t0;
        var skew = Date.now() - j.now - Math.round(rtt / 2);
        result.skewMs = skew;
        set('t-local', new Date().toLocaleString());
        set('t-server', new Date(j.now).toLocaleString());
        set('t-skew', fmt(skew), Math.abs(skew) > 120000 ? 'bad' : 'ok');
        return skew;
      })
      .catch(function (e) {
        set('t-server', '取不到（' + (e && e.message ? e.message : '请求失败') + '）', 'bad');
        set('t-skew', '—');
        return NaN;
      });
  }

  // ── https 探测 ──
  function probe(t) {
    var t0 = Date.now();
    var box = document.createElement('div');
    box.className = 'row';
    box.innerHTML = '<span class="k">' + t.label + '</span><span class="v">' + tag('wait', '探测中…') + '</span>';
    document.getElementById('probes').appendChild(box);
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort() }, 8000);
    var opt = { mode: 'no-cors', cache: 'no-store', credentials: 'omit', redirect: 'follow' };
    if (ctrl) opt.signal = ctrl.signal;
    return fetch(t.url, opt)
      .then(function () {
        clearTimeout(timer);
        var ms = Date.now() - t0;
        box.lastChild.innerHTML = tag('ok', '通') + '　' + ms + ' ms';
        result.probes.push({ label: t.label, url: t.url, ok: true, ms: ms });
        return true;
      })
      .catch(function (e) {
        clearTimeout(timer);
        var ms = Date.now() - t0;
        var why = ctrl && ctrl.signal && ctrl.signal.aborted ? '超时 8s' : (e && e.name ? e.name : '失败');
        box.lastChild.innerHTML = tag('bad', '不通') + '　' + ms + ' ms · ' + why;
        result.probes.push({ label: t.label, url: t.url, ok: false, ms: ms, error: why });
        return false;
      });
  }

  // ── 结论 ──
  function verdict(skew) {
    var box = document.getElementById('verdict');
    var self = result.probes[0];
    var controls = result.probes.slice(1);
    var controlsOk = controls.filter(function (p) { return p.ok }).length;
    var httpPage = location.protocol === 'http:';
    var lines = [];

    if (isFinite(skew) && Math.abs(skew) > 120000) {
      lines.push('<b>手机时间不准</b>：比服务器' + (skew > 0 ? '快' : '慢') + ' ' + fmt(skew).replace('+', '').replace('-', '') +
        '。这会让浏览器把所有证书判成「未生效 / 已过期」。<br>去 设置 → 日期与时间，打开「自动设置」，再打开本页一次。');
    } else if (self && !self.ok && controlsOk > 0) {
      lines.push('<b>只有这个插件的域名不通，其他 https 正常</b>：说明中间有人在拦这条链路 —— ' +
        '最常见是这个 WiFi 的 DNS 劫持 / 路由器「上网保护、广告拦截、家长控制」，或运营商插页。<br>' +
        '换个 WiFi 或用移动流量对比一下；能通就说明是那个 WiFi 的问题。');
    } else if (self && !self.ok && controlsOk === 0) {
      lines.push('<b>这台手机上所有 https 都不通</b>：不是本插件的问题。检查：VPN / 抓包 App / 安全软件是否在拦，' +
        '或系统太旧根证书过期。关掉 VPN 再测一次。');
    } else if (self && self.ok) {
      lines.push('<b>链路是通的</b>：TLS 能建立、时间也对。刚才那次报错大概是偶发、浏览器缓存，或者用的链接已经过期（票据 3 分钟、只能用一次）。');
    } else {
      lines.push('<span class="tag warn">信息不足</span> 再点一次「再测一次」。');
    }

    if (httpPage) {
      lines.push('另：当前页面是 <b>http 明文</b>，浏览器必然标「不安全」，那是正常的，和证书无关。');
    }
    box.innerHTML = lines.join('<br><br>');
    result.verdict = box.textContent;
  }

  function run() {
    document.getElementById('probes').innerHTML = '';
    result = { at: new Date().toISOString(), skewMs: 0, probes: [], env: {} };
    document.getElementById('verdict').innerHTML = tag('wait', '检测中…');
    env();
    clock().then(function (skew) {
      return Promise.all(TARGETS.map(probe)).then(function () { verdict(skew); report() });
    });
  }

  function report() {
    try {
      fetch('/__myphone/diag/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(result),
      }).catch(function () {});
    } catch (e) {}
  }

  document.getElementById('again').onclick = run;
  document.getElementById('copy').onclick = function () {
    var text = JSON.stringify(result, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {});
    }
  };

  run();
})();
</script>
</body></html>`
}
