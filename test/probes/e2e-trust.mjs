import http from 'node:http'

const get = (port, path, headers = {}, method = 'GET', body = null) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
  })
  req.on('error', reject)
  if (body) req.write(body)
  req.end()
})

// 1. 从管理页拿二维码链接里的票据
const admin = await get(18080, '/__myphone/')
const m = /__myphone\/pair\?t=([A-Za-z0-9_-]+)/.exec(admin.body)
if (!m) { console.log('✗ 管理页里没有票据链接'); process.exit(1) }
const ticket = m[1]
console.log('取到票据:', ticket.slice(0, 12) + '…')

// 2. 手机扫开 → 信任页
const trust = await get(18081, `/__myphone/pair?t=${ticket}`, { 'user-agent': 'Mozilla/5.0 (iPhone)' })
console.log(trust.status === 200 && trust.body.includes('信任这台电脑') ? '✓ 扫码打开的是「信任」页' : `✗ 信任页异常 HTTP ${trust.status}`)

// 3. 点「信任这台电脑」
const post = await new Promise((resolve, reject) => {
  const body = `t=${encodeURIComponent(ticket)}`
  const req = http.request(
    { host: '127.0.0.1', port: 18081, path: '/__myphone/pair', method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Mozilla/5.0 (iPhone)', 'content-length': Buffer.byteLength(body) } },
    (res) => { res.resume(); resolve({ status: res.statusCode, cookie: (res.headers['set-cookie'] || [])[0] || '' }) })
  req.on('error', reject); req.write(body); req.end()
})
console.log(post.status === 303 && post.cookie ? '✓ 点信任 → 303 + 设备凭据' : `✗ 配对失败 HTTP ${post.status}`)

// 4. 带凭据访问真实 DSH
const cookie = post.cookie.split(';')[0]
const home = await get(18081, '/', { cookie, 'user-agent': 'Mozilla/5.0 (iPhone)' })
console.log(home.status === 200 && /DeepSeek Harness/.test(home.body)
  ? `✓ 手机进到真实 DSH：200 / ${home.body.length} bytes`
  : `✗ 进不去 HTTP ${home.status}`)

// 5. 票据不能重放
const replay = await get(18081, `/__myphone/pair?t=${ticket}`)
console.log(replay.status === 410 ? '✓ 同一张二维码第二次扫 → 410' : `✗ 重放没被拦（${replay.status}）`)

// 6. 面板接口（悬浮按钮用它）
const panel = await get(18080, '/__myphone/panel', { 'x-myphone-panel': '1' })
const p = JSON.parse(panel.body)
console.log('面板:', JSON.stringify({ devices: p.devices, trusted: p.trustedDevices, pairUrl: (p.pairUrl || '').slice(0, 46) + '…', qr: p.qrSvg.length + 'B' }))
