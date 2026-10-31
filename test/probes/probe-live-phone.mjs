// 真机路径自检：管理口出票 → 隧道扫码页 → 点信任 → 带凭据进 DSH → 只读状态口 → 拉前端 bundle。
// 用法：node test/probe-live-phone.mjs [adminPort] [tunnelBase]
const adminPort = Number(process.argv[2] || 8081)
const tunnelBase = String(process.argv[3] || '').replace(/\/$/, '')
const UA =
  'Mozilla/5.0 (Linux; Android 16; 25067PYE3C Build/BP2A.250605.031.A3; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36'

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) {
    pass += 1
    console.log(`✓ ${name}${extra ? ` — ${extra}` : ''}`)
  } else {
    fail += 1
    console.log(`✗ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

const req = (url, opts = {}) =>
  fetch(url, { redirect: 'manual', ...opts, headers: { 'user-agent': UA, ...(opts.headers || {}) } })

const admin = `http://127.0.0.1:${adminPort}`
if (!tunnelBase) {
  console.log('需要隧道基址：node test/probe-live-phone.mjs 8081 https://xxx.trycloudflare.com')
  process.exit(2)
}

// 1. 管理口出票
const tRes = await req(`${admin}/__myphone/api/ticket`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-myphone-admin': '1' },
  body: '{}',
})
const tJson = await tRes.json().catch(() => ({}))
const ticket = tJson.ticket || ''
check('管理口能出票', Boolean(ticket), ticket ? `票据 ${String(ticket).slice(0, 8)}…` : `HTTP ${tRes.status}`)
check('出票返回的地址是 https 隧道地址', String(tJson.pairUrl || tJson.url || '').startsWith('https://'), String(tJson.pairUrl || tJson.url || ''))

// 2. 扫码页
const scan = await req(`${tunnelBase}/__myphone/pair?t=${encodeURIComponent(ticket)}`)
const scanBody = await scan.text()
check('手机上扫码页 200 且是「信任这台电脑」', scan.status === 200 && scanBody.includes('信任这台电脑'), `HTTP ${scan.status} ${scanBody.length}B`)

// 3. 点信任
const trust = await req(`${tunnelBase}/__myphone/pair`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: `t=${encodeURIComponent(ticket)}`,
})
const cookie = String(trust.headers.get('set-cookie') || '').split(';')[0]
check('点信任拿到设备凭据', trust.status === 303 && cookie.includes('myphone_dev='), `HTTP ${trust.status}`)

// 4. 带凭据进 DSH
const home = await req(`${tunnelBase}/`, { headers: { cookie } })
const homeBody = await home.text()
check('手机进得去 DSH 主界面', home.status === 200 && homeBody.length > 20000, `HTTP ${home.status} ${homeBody.length}B`)

// 5. 前端 bundle 里有没有我们这版的新东西（判断「展示不出来」是代码还是缓存）
const m = homeBody.match(/plugins\/\?\?dsh-my-phone\/client\.js[^"']*/)
check('页面引到了我们的 client.js', Boolean(m), m ? m[0] : '没找到')
if (m) {
  const bundle = await req(`${tunnelBase}/${m[0]}`, { headers: { cookie } })
  const js = await bundle.text()
  check('bundle 拉得到', bundle.status === 200 && js.length > 10000, `HTTP ${bundle.status} ${js.length}B`)
  check('bundle 是点击版下拉（有 dmp-menu.on）', js.includes('dmp-menu.on'), '')
  check('bundle 里还有 hover 打开规则吗', !/dmp-selwrap:hover \.dmp-menu/.test(js), '没有就对了')
  check('bundle 带版本号显示（pluginVersion）', js.includes('pluginVersion'), '')
}

// 6. 只读状态口（手机端弹窗靠它）
const st = await req(`${tunnelBase}/__myphone/state`, { headers: { cookie } })
const stJson = await st.json().catch(() => ({}))
check('只读状态口可用', st.status === 200 && stJson.ok === true, `HTTP ${st.status} ${JSON.stringify(Object.keys(stJson))}`)

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail ? 1 : 0)
