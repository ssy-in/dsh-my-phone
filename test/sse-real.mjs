// SSE 走真实 socket 验证：把面板路由真的挂到一个 node http.Server 上，
// 再用真 HTTP 客户端连 /__myphone/panel/stream，确认「连上就来一帧、网关有动静再来一帧」。
import http from 'node:http'
import { registerPanel } from '../src/panel.js'

const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const route = routes.get(url.pathname)
  if (!route) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('no')
    return
  }
  route.handler(req, res).catch(() => {
    try {
      res.writeHead(500)
      res.end('err')
    } catch {}
  })
})
const routes = new Map()

const ctx = {
  webServer: {
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  },
}

let settings = { lanEnabled: false, tunnelEnabled: true, autoOffMinutes: 30, lanPort: 18080 }
const listeners = new Set()
const state = {
  get settings() {
    return settings
  },
  devices: [],
  patchSettings(patch) {
    settings = { ...settings, ...patch }
    return settings
  },
}
const gate = {
  adminPort: 18080,
  onChange(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

const dispose = registerPanel(ctx, {
  state,
  gate,
  getAddresses: () => ['http://127.0.0.1:18081/'],
  sync: async () => {},
})

await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const frames = []
let contentType = ''
const firstFrame = new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port, path: '/__myphone/panel/stream' }, (res) => {
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
          frames.push(JSON.parse(raw.slice(6)))
          if (frames.length >= 2) resolve('both')
          else resolve('one')
        }
      }
    })
  })
  req.on('error', () => resolve('error'))
  req.end()
})

const first = await firstFrame
check('响应头是 text/event-stream', contentType.includes('text/event-stream'), contentType)
check('连上立刻收到一帧', first === 'one' || first === 'both', `state=${first}`)
check('帧内容是面板快照', Boolean(frames[0]) && Array.isArray(frames[0].deviceList) && typeof frames[0].lanEnabled === 'boolean')

// 真机上「有人连进来 / 有人在等授权 / 开关变化」都会走这条通知
for (const fn of listeners) fn()
const got = await Promise.race([
  (async () => {
    const t0 = Date.now()
    while (frames.length < 2 && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 40))
    return frames.length >= 2
  })(),
  new Promise((r) => setTimeout(() => r(false), 3500)),
])
check('网关一有变更就推第二帧（不需要轮询）', got, `frames=${frames.length}`)

server.closeAllConnections?.()
await new Promise((r) => server.close(r))
dispose()

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
