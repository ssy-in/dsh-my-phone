// 手机端那条路：没有手输页 + 只读状态口 + 悬浮球在手机上能读到东西。
// 用法：node test/probe-phone.mjs <adminPort> <publicPort> <hostPort>
import http from 'node:http'

const [adminPort, publicPort, hostPort] = process.argv.slice(2).map(Number)

function req(port, options = {}, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, ...options }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      )
    })
    r.on('error', reject)
    if (body) r.write(body)
    r.end()
  })
}

const out = []
const check = (ok, text) => {
  out.push(`${ok ? '✓' : '✗'} ${text}`)
  if (!ok) process.exitCode = 1
}

const UA = 'Mozilla/5.0 (Linux; U; Android 16; zh-cn; 25067PYE3C) Chrome/140 Mobile Safari/537.36'

// 1. 手机上直接打开入口：不再有输入框，只有「请扫码」
const anon = await req(publicPort, { method: 'GET', path: '/', headers: { 'user-agent': UA } })
check(
  anon.status === 401 && anon.body.includes('用手机扫电脑上的码') && !anon.body.includes('name="code"'),
  `未配对 → 扫码页 ${anon.status}（没有输入框）`,
)

// 2. 扫码 + 点信任 → 拿到凭据
const ticketRes = await req(adminPort, {
  method: 'POST',
  path: '/__myphone/api/ticket',
  headers: { 'x-myphone-admin': '1' },
})
const ticket = JSON.parse(ticketRes.body).ticket
const trust = await req(publicPort, { method: 'GET', path: `/__myphone/pair?t=${encodeURIComponent(ticket)}` })
check(trust.status === 200 && trust.body.includes('信任这台电脑'), `扫码页 ${trust.status}`)
check(!trust.body.includes('6 位配对码'), '信任页不再提供手输配对码')
const posted = await req(
  publicPort,
  {
    method: 'POST',
    path: `/__myphone/pair?t=${encodeURIComponent(ticket)}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'null', 'user-agent': UA },
  },
  `t=${encodeURIComponent(ticket)}`,
)
const device = String(posted.headers['set-cookie'] || '').split(';')[0]
check(posted.status === 303 && device.includes('myphone_dev='), `点信任 → ${posted.status}`)

// 3. 手机悬浮球读的只读口
const st = await req(publicPort, { method: 'GET', path: '/__myphone/state', headers: { cookie: device, 'user-agent': UA } })
let body = null
try {
  body = JSON.parse(st.body)
} catch {
  body = null
}
check(
  st.status === 200 && body && body.ok === true && body.device && body.device.label,
  `手机只读状态 ${st.status} · ${body && body.device ? body.device.label : '无数据'}`,
)
check(Boolean(body && Array.isArray(body.events)), `带排查事件 ${body && body.events ? body.events.length : 0} 条`)

// 4. 只读口不能被当成管理口用：开关/设备在手机上收不到
const toggle = await req(
  publicPort,
  {
    method: 'POST',
    path: '/__myphone/panel/toggle',
    headers: { 'content-type': 'application/json', 'x-myphone-panel': '1', cookie: device },
  },
  JSON.stringify({ key: 'tunnel' }),
)
check(toggle.status === 404, `手机改不了开关 ${toggle.status}（期望 404）`)

// 5. 有凭据进真实 DSH
const page = await req(publicPort, { method: 'GET', path: '/', headers: { cookie: device, 'user-agent': UA } })
check(page.status === 200, `进 DSH ${page.status} / ${Buffer.byteLength(page.body)}B`)

// 6. 宿主侧：悬浮球图标还在
const icon = await req(hostPort, { method: 'GET', path: '/__myphone/icon.png' })
check(icon.status === 200, `图标 ${icon.status}`)

console.log(out.join('\n'))
