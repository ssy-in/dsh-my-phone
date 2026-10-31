// 公网口要能拿到悬浮球用的紧裁图标（icon-fab.png）。
// 手机通过隧道访问时，`/__myphone/icon-fab.png` 必须 200，否则 <img> onError 会退回旧的鲸尾 SVG
// —— 用户看到的就是「手机上图标不对」。
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

const PORT = 18099
const state = {
  settings: { lanEnabled: true, tunnelEnabled: false, lanPort: 18098, publicPort: PORT, autoOffMinutes: 0 },
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
  getAddresses: () => [`http://127.0.0.1:${PORT}/`],
})

await gate.startPublic(PORT)
await new Promise((r) => setTimeout(r, 120))

const get = async (path) => {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`)
  const buf = Buffer.from(await res.arrayBuffer())
  return { status: res.status, type: res.headers.get('content-type') || '', len: buf.length, head: buf.subarray(0, 8) }
}

const fab = await get('/__myphone/icon-fab.png')
check('公网口能取到 icon-fab.png', fab.status === 200 && /image\/png/.test(fab.type), `HTTP ${fab.status} ${fab.type} ${fab.len}B`)
check('icon-fab.png 是真 PNG', fab.head[0] === 0x89 && fab.head[1] === 0x50, fab.head.toString('hex'))

const fabQ = await get('/__myphone/icon-fab.png?v=3')
check('带查询串也能取到（前端就是带 ?v= 请求的）', fabQ.status === 200 && /image\/png/.test(fabQ.type), `HTTP ${fabQ.status}`)

const png = await get('/__myphone/icon.png')
check('老图标路由仍然可用', png.status === 200 && /image\/png/.test(png.type), `HTTP ${png.status}`)

const panel = await get('/__myphone/panel')
check('管理接口在公网口仍然一律 404（安全边界没被放宽）', panel.status === 404, `HTTP ${panel.status}`)

const api = await get('/__myphone/api/ticket')
check('管理 API 在公网口 404', api.status === 404, `HTTP ${api.status}`)

await gate.stopPublic()
await new Promise((r) => setTimeout(r, 60))
console.log(`\n${pass}/${pass + fail} 通过`)
if (fail) process.exitCode = 1
