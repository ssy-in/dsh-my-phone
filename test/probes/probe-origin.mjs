// 复现手机那一次失败：验证 `Origin: null` 不再把配对打断（以前 → 500 Invalid URL）。
// 用法：node test/probe-origin.mjs <adminPort> <publicPort> <hostPort>
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

// 1. 电脑端出票
const ticketRes = await req(adminPort, {
  method: 'POST',
  path: '/__myphone/api/ticket',
  headers: { 'x-myphone-admin': '1' },
})
const ticket = JSON.parse(ticketRes.body).ticket
check(Boolean(ticket), `出票 ${ticket ? ticket.slice(0, 10) : '失败'}`)

// 2. 手机扫码打开信任页
const trust = await req(publicPort, { method: 'GET', path: `/__myphone/pair?t=${encodeURIComponent(ticket)}` })
check(trust.status === 200 && trust.body.includes('信任这台电脑'), `扫码页 ${trust.status}`)

// 3. 关键回归：Origin: null（Android 浏览器就此崩过）
const nullOrigin = await req(
  publicPort,
  {
    method: 'POST',
    path: `/__myphone/pair?t=${encodeURIComponent(ticket)}`,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'null',
      host: `127.0.0.1:${publicPort}`,
      'user-agent': 'Mozilla/5.0 (Linux; U; Android 16; zh-cn) Chrome/140 Mobile Safari/537.36',
    },
  },
  `t=${encodeURIComponent(ticket)}`,
)
const cookie = String(nullOrigin.headers['set-cookie'] || '')
check(nullOrigin.status === 303, `Origin: null 配对 → ${nullOrigin.status}（期望 303）`)
check(cookie.includes('myphone_dev='), '下发了设备凭据')
if (nullOrigin.status !== 303) out.push('  页面：' + nullOrigin.body.replace(/\s+/g, ' ').slice(0, 160))

// 4. 带凭据进真实 DSH
const device = cookie.split(';')[0]
const page = await req(publicPort, { method: 'GET', path: '/', headers: { cookie: device } })
check(page.status === 200 && page.body.includes('DeepSeek'), `进 DSH ${page.status} / ${Buffer.byteLength(page.body)}B`)

// 5. 悬浮按钮图标（挂在宿主 web 服务器上）
const icon = await req(hostPort, { method: 'GET', path: '/__myphone/icon.png' })
check(icon.status === 200 && String(icon.headers['content-type']).startsWith('image/png'), `图标 ${icon.status} ${icon.headers['content-type']}`)

console.log(out.join('\n'))
