// 扫码地址规则（用户定的）：外网开着 → 固定 https 隧道地址；外网关着 → 局域网 IP 地址。
// 外网开着但隧道还没起来 → 留空 + entryMode='pending'，绝不悄悄换成 IP。
import { registerPanel } from '../src/panel.js'
import { createGate } from '../src/gate.js'

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

const LAN = 'http://192.168.1.107:8082/'
const TUN = 'https://devoted-teams-epic-giants.trycloudflare.com/'

function mount({ settings, qrBase }) {
  const routes = new Map()
  const ctx = { webServer: { register: (r) => (routes.set(r.path, r), () => routes.delete(r.path)) } }
  const state = {
    settings,
    devices: [],
    patchSettings(patch) {
      Object.assign(state.settings, patch)
      return state.settings
    },
  }
  const gate = createGate({
    state,
    session: null,
    log: { info() {}, warn() {}, error() {}, debug() {} },
    getAddresses: () => (settings.tunnelEnabled ? [TUN, LAN] : [LAN]),
    getQrBase: qrBase === undefined ? undefined : () => qrBase,
  })
  // gate 的端口是只读 getter，快照会自动回退到 settings.lanPort / publicPort
  registerPanel(ctx, {
    state,
    gate,
    getAddresses: () => (settings.tunnelEnabled ? [TUN, LAN] : [LAN]),
    getQrBase: qrBase === undefined ? null : () => qrBase,
    sync: async () => {},
  })
  return routes.get('/__myphone/panel')
}

async function snap(route) {
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
  const req = {
    method: 'GET',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {},
  }
  await route.handler(req, res)
  return JSON.parse(res.body)
}

// 1. 外网开着 + 隧道就绪 → https
let s = await snap(
  mount({ settings: { lanEnabled: true, tunnelEnabled: true, lanPort: 8081, publicPort: 8082 }, qrBase: TUN }),
)
check('外网开着：二维码用 https 隧道地址', s.url === TUN, s.url)
check('外网开着：entryMode = tunnel', s.entryMode === 'tunnel', String(s.entryMode))

// 2. 外网关着 → 局域网 IP
s = await snap(
  mount({ settings: { lanEnabled: true, tunnelEnabled: false, lanPort: 8081, publicPort: 8082 }, qrBase: LAN }),
)
check('外网关着：二维码用 IP 地址', s.url === LAN, s.url)
check('外网关着：entryMode = lan', s.entryMode === 'lan', String(s.entryMode))

// 3. 外网开着但隧道还没起来 → 留空，不偷偷退回 IP
s = await snap(
  mount({ settings: { lanEnabled: true, tunnelEnabled: true, lanPort: 8081, publicPort: 8082 }, qrBase: '' }),
)
check('外网开着但隧道没就绪：不退回 IP', s.url === '', JSON.stringify(s.url))
check('外网开着但隧道没就绪：entryMode = pending', s.entryMode === 'pending', String(s.entryMode))

// 4. pairingUrl 也遵守同一套规则（二维码里带的就是它）
const g = createGate({
  state: { settings: { tunnelEnabled: true }, devices: [], patchSettings() {} },
  session: null,
  log: { info() {}, warn() {}, error() {}, debug() {} },
  getAddresses: () => [LAN],
  getQrBase: () => TUN,
})
check('pairingUrl 用 https 基底', g.pairingUrl('tk123').startsWith(`${TUN}__myphone/pair?t=tk123`), g.pairingUrl('tk123'))
const g2 = createGate({
  state: { settings: { tunnelEnabled: true }, devices: [], patchSettings() {} },
  session: null,
  log: { info() {}, warn() {}, error() {}, debug() {} },
  getAddresses: () => [LAN],
  getQrBase: () => '',
})
check('隧道没就绪时 pairingUrl 为空（不悄悄给 IP）', g2.pairingUrl('tk123') === '', JSON.stringify(g2.pairingUrl('tk123')))

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail ? 1 : 0)
