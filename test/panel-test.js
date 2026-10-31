// 原生设置面板（host 半边）的离线断言：不启 HTTP 服务器，直接喂假的 req/res。
import assert from 'node:assert/strict'
import { registerPanel } from '../src/panel.js'

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
let syncs = 0
const state = {
  get settings() {
    return settings
  },
  devices: [{ id: 'a' }, { id: 'b' }],
  patchSettings(patch) {
    settings = { ...settings, ...patch }
    return settings
  },
}
const gateListeners = new Set()
const gate = {
  adminPort: 18080,
  // SSE 推送靠这个：面板订阅网关的变更通知
  onChange(fn) {
    gateListeners.add(fn)
    return () => gateListeners.delete(fn)
  },
  // 票据桩：v1.5.1 起二维码只在有活票据时生成，得能出票才看得到码
  pairing: (() => {
    let cur = null
    return {
      peekTicket: () => (cur && cur.expiresAt > Date.now() ? cur : null),
      peek: () => null, // 6 位码通道已停用，面板只读这个字段
      issueTicket: () => (cur = { ticket: 'test-ticket-1234567890', expiresAt: Date.now() + 180000 }),
    }
  })(),
  issueTicket() {
    this.pairing.issueTicket()
    return this.pairing.peekTicket()
  },
  pairingUrl: (ticket) => `http://192.168.1.107:18081/__myphone/pair?t=${ticket}`,
}

const dispose = registerPanel(ctx, {
  state,
  gate,
  getAddresses: () => ['http://192.168.1.107:18081/'],
  sync: async () => {
    syncs += 1
  },
})

// 假请求：只实现 handler 用到的部分
function fakeReq({ method = 'GET', address = '127.0.0.1', headers = {}, body } = {}) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    method,
    headers,
    socket: { remoteAddress: address },
    async *[Symbol.asyncIterator]() {
      for (const chunk of payload) yield chunk
    },
  }
}

function fakeRes() {
  const res = {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      res.status = status
      res.headers = headers
    },
    end(buf) {
      res.body = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '')
    },
  }
  return res
}

const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)
}

// 1. 挂载了两条路由
check('挂载了状态路由', routes.has('/__myphone/panel'))
check('挂载了开关路由', routes.has('/__myphone/panel/toggle'))

// 2. GET 返回面板需要的字段
{
  const res = fakeRes()
  await routes.get('/__myphone/panel').handler(fakeReq(), res)
  const data = JSON.parse(res.body)
  check('GET 状态 200', res.status === 200, `HTTP ${res.status}`)
  check(
    '状态含面板字段',
    ['lanEnabled', 'tunnelEnabled', 'autoOffMinutes', 'url', 'qrSvg', 'adminUrl', 'devices'].every((k) => k in data),
    Object.keys(data).join(','),
  )
  check('没有活票据时不画二维码（免得扫出「已失效」）', String(data.qrSvg) === '', `${String(data.qrSvg).length}B`)

  // v1.5.1：二维码只在有活票据时生成 —— 出了票再看
  {
    const res2 = fakeRes()
    await routes.get('/__myphone/panel/ticket').handler(
      fakeReq({ method: 'POST', headers: { 'x-myphone-panel': '1' } }),
      res2,
    )
    const data2 = JSON.parse(res2.body)
    check('出票后带二维码 SVG', String(data2.qrSvg).startsWith('<svg'), `${String(data2.qrSvg).length}B`)
    check('出票后带过期时间', Number(data2.ticketExpiresAt) > Date.now(), String(data2.ticketExpiresAt))
  }
  check('状态含配对地址', data.url === 'http://192.168.1.107:18081/', data.url)
  check('状态含「跑完一轮」通知数组', Array.isArray(data.turns), typeof data.turns)
}

// 3. 非本机来源一律 404（不暴露存在性）
{
  const res = fakeRes()
  await routes.get('/__myphone/panel').handler(fakeReq({ address: '192.168.1.50' }), res)
  check('非本机来源 404', res.status === 404, `HTTP ${res.status}`)
}

// 4. 开关需要 CSRF 头
{
  const res = fakeRes()
  await routes.get('/__myphone/panel/toggle').handler(fakeReq({ method: 'POST', body: { key: 'lan' } }), res)
  check('缺 CSRF 头 403', res.status === 403, `HTTP ${res.status}`)
  check('被拒时状态未变', settings.lanEnabled === false)
}

// 5. 带头的开关生效并触发 sync
{
  const res = fakeRes()
  await routes
    .get('/__myphone/panel/toggle')
    .handler(fakeReq({ method: 'POST', headers: { 'x-myphone-panel': '1' }, body: { key: 'lan' } }), res)
  check('开关生效 200', res.status === 200, `HTTP ${res.status}`)
  check('状态已翻转', settings.lanEnabled === true)
  check('触发了 sync', syncs === 1, `syncs=${syncs}`)
  const data = JSON.parse(res.body)
  check('开关后回传新状态', data.lanEnabled === true)
}

// 6. 未知 key 400
{
  const res = fakeRes()
  await routes
    .get('/__myphone/panel/toggle')
    .handler(fakeReq({ method: 'POST', headers: { 'x-myphone-panel': '1' }, body: { key: 'nope' } }), res)
  check('未知 key 400', res.status === 400, `HTTP ${res.status}`)
}

// 6b. 自动关闭按通道设置（v0.6.1：局域网/外网各一份，互不影响）
{
  const res = fakeRes()
  await routes
    .get('/__myphone/panel/autooff')
    .handler(fakeReq({ method: 'POST', headers: { 'x-myphone-panel': '1' }, body: { key: 'lan', minutes: 15 } }), res)
  check('按通道设置自动关闭 200', res.status === 200, `HTTP ${res.status}`)
  check('只改了局域网那条', settings.lanAutoOffMinutes === 15 && settings.tunnelAutoOffMinutes === undefined, JSON.stringify(settings))
  const data = JSON.parse(res.body)
  check('状态里能看到两条通道的档位', data.lanAutoOffMinutes === 15 && data.tunnelAutoOffMinutes === 0)
}

// 6c. 不带 key 时两条一起设（老客户端兼容）
{
  const res = fakeRes()
  await routes
    .get('/__myphone/panel/autooff')
    .handler(fakeReq({ method: 'POST', headers: { 'x-myphone-panel': '1' }, body: { minutes: 30 } }), res)
  check('不带 key 两条一起改 200', res.status === 200, `HTTP ${res.status}`)
  check('两条都成了 30', settings.lanAutoOffMinutes === 30 && settings.tunnelAutoOffMinutes === 30)
}

// 6d. 变更推送（SSE）：一连上先给一帧快照，之后网关有动静就再推一帧
{
  const frames = []
  const req = { method: 'GET', headers: {}, socket: { remoteAddress: '127.0.0.1' }, on() {} }
  const res = {
    status: 0,
    headers: {},
    writeHead(s, h) {
      res.status = s
      res.headers = h
    },
    write(chunk) {
      frames.push(String(chunk))
    },
    end() {},
    on() {},
  }
  await routes.get('/__myphone/panel/stream').handler(req, res)
  check('推送路由返回 200', res.status === 200, 'HTTP ' + res.status)
  check('响应头是事件流', String(res.headers['content-type'] || '').includes('text/event-stream'))
  check('连上先推一帧快照', frames.length === 1 && frames[0].startsWith('data: '), frames[0].slice(0, 24))
  const first = JSON.parse(String(frames[0]).replace(/^data: /, ''))
  check('推送的内容就是面板快照', first && typeof first.lanEnabled === 'boolean' && Array.isArray(first.deviceList))
  // 模拟网关发生一件事（授权请求、设备连入…）
  for (const fn of gateListeners) fn()
  check('网关一有动静就再推一帧', frames.length === 2)
  // 非回环地址不给：手机不该拿到管理快照
  const blocked = fakeRes()
  await routes
    .get('/__myphone/panel/stream')
    .handler({ method: 'GET', headers: {}, socket: { remoteAddress: '192.168.1.50' }, on() {} }, blocked)
  check('外部地址拿不到推送流', blocked.status === 404, 'HTTP ' + blocked.status)
}

// 7. dispose 后路由消失
dispose()
check('dispose 后路由已摘除', !routes.has('/__myphone/panel') && !routes.has('/__myphone/panel/toggle'))

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
