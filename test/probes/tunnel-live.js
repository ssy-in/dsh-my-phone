// 外网真机验证：起 cloudflared 快速隧道 → 从公网地址访问插件的公网口 → 关掉。
import https from 'node:https'
import { TunnelManager } from '../src/tunnel.js'

const BINARY = process.argv[2]
const TARGET = process.argv[3] || 'http://127.0.0.1:18081'

function get(url, insecure) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { ...(insecure ? { rejectUnauthorized: false } : {}) }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }))
    })
    req.setTimeout(20_000, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

const t = new TunnelManager({ log: { info: (m) => console.log(m), warn: (m) => console.log('WARN', m) } })
const t0 = Date.now()
const st = await t.start({ target: TARGET, binary: BINARY })
console.log('phase:', st.phase, 'url:', st.url, 'error:', st.error, `${((Date.now() - t0) / 1000).toFixed(1)}s`)
if (st.phase !== 'running' || !st.url) {
  t.stop()
  process.exit(1)
}
try {
  // 第一次握手可能因为 DNS/TLS 还没就绪而失败，重试几次
  let r
  for (let i = 0; i < 6; i++) {
    try {
      r = await get(st.url + '/', true)
      break
    } catch (e) {
      console.log(`  第 ${i + 1} 次失败：${e.code || e.message}`)
      await new Promise((res) => setTimeout(res, 4000))
    }
  }
  if (!r) throw new Error('公网地址一直连不上')
  console.log('HTTP', r.status, 'bytes', r.body.length, 'server', r.headers.server || '-', 'ct', r.headers['content-type'] || '-')
  console.log('有配对表单：', /id="code"|配对|myphone/i.test(r.body))
  console.log('片段：', r.body.replace(/\s+/g, ' ').slice(0, 160))
} finally {
  t.stop()
  console.log('已停止隧道')
}
