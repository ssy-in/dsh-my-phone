// check: edit src/client.js -> does a page refresh (no DSH restart) get the new code?
import fs from 'node:fs'
import http from 'node:http'
import crypto from 'node:crypto'

const PORT = Number(process.argv[2] || 64744)
const AUTHORITY = `127.0.0.1:${PORT}`
const secretB64 = fs
  .readFileSync('C:/Users/Administrator/.dsh/.credentials.yaml', 'utf8')
  .match(/client-connection\/browser-session:\s*\n(?:[ \t].*\n)*?\s*secret:\s*([A-Za-z0-9_-]+)/)[1]
const SECRET = Buffer.from(secretB64.replaceAll('-', '+').replaceAll('_', '/'), 'base64')
const b64u = (b) => Buffer.from(b).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const now = Date.now()
const body = b64u(Buffer.from(JSON.stringify({ version: 1, authority: AUTHORITY, issuedAt: now, expiresAt: now + 3600e3 }), 'utf8'))
const sig = crypto.createHmac('sha256', SECRET).update(body).digest()
const COOKIE = `dsh-auth-${b64u(crypto.createHash('sha256').update(AUTHORITY).digest())}=v1.${body}.${b64u(sig)}`

function get(path, ms = 4000) {
  return new Promise((resolve) => {
    const bufs = []
    let done = false
    const finish = (status, headers) => {
      if (done) return
      done = true
      resolve({ status, headers, body: Buffer.concat(bufs).toString('utf8') })
    }
    const r = http.request(
      { host: '127.0.0.1', port: PORT, path, headers: { cookie: COOKIE, host: AUTHORITY, 'sec-fetch-site': 'same-origin' } },
      (res) => {
        res.on('data', (c) => bufs.push(c))
        res.on('end', () => finish(res.statusCode, res.headers))
      },
    )
    r.on('error', (e) => {
      if (done) return
      done = true
      resolve({ status: 0, headers: {}, body: String(e.message) })
    })
    // SSE 不会自己 end：到点就把已经收到的字节当结果
    r.setTimeout(ms, () => {
      const partial = Buffer.concat(bufs).toString('utf8')
      r.destroy()
      if (done) return
      done = true
      resolve({ status: partial ? 200 : 0, headers: {}, body: partial || 'timeout' })
    })
    r.end()
  })
}

const ev = await get('/plugins/events', 5000)
const i = ev.body.indexOf('dsh-my-phone/client.js')
if (i < 0) {
  console.log('miss in graph, head =', ev.body.slice(0, 160))
  process.exit(1)
}
const seg = ev.body.slice(Math.max(0, i - 260), i + 300)
const endQ = ev.body.indexOf('"', i)
const startQ = ev.body.lastIndexOf('"', i)
const url = ev.body.slice(startQ + 1, endQ)
const mr = seg.match(/"rev":"([0-9a-f]{8,})"/)
const rev = mr ? mr[1] : '?'
console.log(`graph rev = ${rev}`)
console.log(`graph url = ${url}`)
if (!url) {
  console.log('SEG>>>', seg)
  process.exit(1)
}

for (const p of ['/' + url, '/' + url.replace('??', '')]) {
  const r = await get(p, 6000)
  console.log(`\n${p}\n  -> ${r.status} ${r.body.length}B cache-control=${r.headers['cache-control'] || '-'}`)
  if (r.status === 200) {
    const mark = (s) => (r.body.includes(s) ? 'YES' : 'no')
    console.log(`  new code? audio.enter=${mark('audio.enter')} pluck=${mark('pluck')} dmp-info=${mark('dmp-info')}`)
  }
}
