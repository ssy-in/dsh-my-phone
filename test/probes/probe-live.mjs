// 对用户真实运行中的实例做一次完整流程体检（8080 管理 / 8081 入口）
// 用 PROBE_ADMIN / PROBE_PUBLIC 覆盖端口
import http from 'node:http'

const ADMIN = Number(process.env.PROBE_ADMIN || 8080)
const PUBLIC = Number(process.env.PROBE_PUBLIC || 8081)

const call = (port, path, { headers = {}, method = 'GET', body = null } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }),
      )
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })

const short = (s, n = 90) => String(s).slice(0, n)

// 1. 管理页
const admin = await call(ADMIN, '/__myphone/')
console.log(`1. 管理页 → ${admin.status} / ${admin.body.length}B${admin.status === 200 ? '' : ' ' + short(admin.body)}`)

// 2. 出票
const ticketRes = await call(ADMIN, '/__myphone/api/ticket', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-myphone-admin': '1' },
  body: '{}',
})
let ticket = null
try {
  ticket = JSON.parse(ticketRes.body).ticket
} catch {
  console.log(`2. 出票 → ${ticketRes.status} 非 JSON: ${short(ticketRes.body, 200)}`)
}
if (ticket) console.log(`2. 出票 → ${ticketRes.status}, 票 ${short(ticket, 10)}…`)

// 3. 扫码页
if (ticket) {
  const trust = await call(PUBLIC, `/__myphone/pair?t=${ticket}`, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone)' } })
  const ok = trust.status === 200 && trust.body.includes('信任这台电脑')
  console.log(`3. 扫码信任页 → ${trust.status} / ${trust.body.length}B ${ok ? '✓' : '✗ ' + short(trust.body, 200)}`)
}

// 4. 点信任
let cookie = null
if (ticket) {
  const body = `t=${encodeURIComponent(ticket)}`
  const post = await new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PUBLIC,
        path: '/__myphone/pair',
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': 'Mozilla/5.0 (iPhone)',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume()
        resolve({ status: res.statusCode, cookie: (res.headers['set-cookie'] || [])[0] || '', loc: res.headers.location })
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
  cookie = post.cookie ? post.cookie.split(';')[0] : null
  console.log(`4. 点「信任」→ ${post.status} ${cookie ? '+ 凭据' : '无凭据'}`)
}

// 5. 带凭据访问真实 DSH
if (cookie) {
  const home = await call(PUBLIC, '/', { headers: { cookie, 'user-agent': 'Mozilla/5.0 (iPhone)' } })
  const ok = home.status === 200 && /DeepSeek Harness|<html/i.test(home.body)
  console.log(`5. 进 DSH → ${home.status} / ${home.body.length}B ${ok ? '✓' : '✗ ' + short(home.body.replace(/\s+/g, ' '), 200)}`)
  if (!ok && home.status === 500) {
    console.log('   500 页面标题/原因：', short(home.body.match(/<p[^>]*>([^<]{0,160})/)?.[1] || home.body, 200))
  }

  // 6. 资源
  const asset = [...home.body.matchAll(/\.?\/?assets\/[A-Za-z0-9._-]+\.js/g)].map((m) => m[0].replace(/^\.\//, '/'))[0]
  if (asset) {
    const js = await call(PUBLIC, asset, { headers: { cookie } })
    console.log(`6. 静态资源 ${asset} → ${js.status} / ${js.body.length}B`)
  }
}

// 7. 清理：把刚才建的测试设备删掉
const snap = await call(ADMIN, '/__myphone/panel', { headers: { 'x-myphone-panel': '1' } })
try {
  const s = JSON.parse(snap.body)
  console.log(`7. 设备数 ${s.devices}（已信任 ${s.trustedDevices}）`)
} catch {
  console.log(`7. 面板 → ${snap.status}`)
}
const list = await call(ADMIN, '/__myphone/api/devices', { headers: { 'x-myphone-admin': '1' } }).catch(() => null)
if (list && list.status === 200) {
  try {
    const devs = JSON.parse(list.body)
    for (const d of devs.devices || []) {
      if (d.label && /iPhone/.test(d.label)) {
        const del = await call(ADMIN, '/__myphone/api/remove', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-myphone-admin': '1' },
          body: JSON.stringify({ id: d.id }),
        })
        console.log(`   清理测试设备 ${d.id} → ${del.status}`)
      }
    }
  } catch {}
}
