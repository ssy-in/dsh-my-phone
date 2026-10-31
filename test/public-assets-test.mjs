// v1.8.3 验证：公网口必须能拿到悬浮球脚本，其它 /__myphone/* 仍然 404
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createGate } from '../src/gate.js'
import { MyPhoneState } from '../src/state.js'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mphpub-'))
const state = new MyPhoneState(home)
state.load()
state.patchSettings({ lanEnabled: true, lanPort: 18310, publicPort: 18311, tunnelEnabled: false, autoOffMinutes: 0 })

let ok = 0
let fail = 0
const check = (name, cond, extra = '') => {
  if (cond) {
    ok++
    console.log('✓', name, extra)
  } else {
    fail++
    console.log('✗', name, extra)
  }
}

const get = (port, p) =>
  new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'GET' }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: String(e.message) }))
    req.end()
  })

const gate = createGate({
  state,
  log: { info() {}, warn() {}, error() {} },
  getAddresses: () => [],
  getStatus: () => ({ running: true, phase: 'idle' }),
  logFile: path.join(home, 'pair.log'),
})
await gate.startAdmin(0)
await gate.startPublic(18311)

const w = await get(18311, '/__myphone/widget.js?v=1')
check('公网口能拿到 widget.js', w.status === 200 && /javascript/.test(String(w.headers['content-type'])), `HTTP ${w.status}`)
check('widget.js 是内容不是报错页', w.body.includes('dmp-w-img') && w.body.length > 20000, `${w.body.length}B`)

const a = await get(18311, '/__myphone/audio.js')
check('公网口能拿到 audio.js', a.status === 200 && a.body.includes('__dshMyPhoneAudio'), `HTTP ${a.status}`)

const panel = await get(18311, '/__myphone/panel')
check('公网口仍然拒绝面板接口', panel.status === 404, `HTTP ${panel.status}`)

const icon = await get(18311, '/__myphone/icon-fab.png')
check('公网口仍然放行图标', icon.status === 200, `HTTP ${icon.status}`)

await gate.close?.()
state.stop?.()
console.log(`\n${ok}/${ok + fail} 通过`)
process.exit(fail ? 1 : 0)
