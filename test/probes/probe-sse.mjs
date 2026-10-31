// 真宿主上的推送通道验证：连上即时来一帧，网关有事就立刻再来一帧。
// 用法：node test/probe-sse.mjs <adminPort>
import http from 'node:http'

const adminPort = Number(process.argv[2] || 18080)
const base = { host: '127.0.0.1', port: adminPort }

const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)
}

function post(path) {
  return new Promise((resolve) => {
    const req = http.request(
      { ...base, path, method: 'POST', headers: { 'content-type': 'application/json', 'x-myphone-panel': '1' } },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
      },
    )
    req.on('error', () => resolve({ status: 0, body: '' }))
    req.end('{}')
  })
}

const frames = []
let contentType = ''
const done = new Promise((resolve) => {
  const req = http.request({ ...base, path: '/__myphone/panel/stream', method: 'GET' }, (res) => {
    contentType = String(res.headers['content-type'] || '')
    res.setEncoding('utf8')
    let buf = ''
    res.on('data', (chunk) => {
      buf += chunk
      let i
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const raw = buf.slice(0, i)
        buf = buf.slice(i + 2)
        if (raw.startsWith('data: ')) {
          try {
            frames.push(JSON.parse(raw.slice(6)))
          } catch {
            frames.push(null)
          }
        }
      }
      if (frames.length >= 2) resolve()
    })
  })
  req.on('error', () => resolve())
  req.end()
  setTimeout(() => {
    try {
      req.destroy()
    } catch {}
    resolve()
  }, 9000)
})

const first = await Promise.race([
  (async () => {
    // 等到第一帧就发个会触发变更的请求（标记已读会走 emitChange）
    while (frames.length === 0) await new Promise((r) => setTimeout(r, 50))
    await post('/__myphone/panel/read')
    return true
  })(),
  new Promise((r) => setTimeout(() => r(false), 4000)),
])
await done

check('推送流响应头是事件流', contentType.includes('text/event-stream'), contentType)
check('连上立刻收到一帧快照', Boolean(first) && frames.length >= 1, `frames=${frames.length}`)
check('快照内容可用（含 deviceList）', Boolean(frames[0]) && Array.isArray(frames[0].deviceList))
check('网关一有变更就推第二帧', frames.length >= 2, `frames=${frames.length}`)

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
