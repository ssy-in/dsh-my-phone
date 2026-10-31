// 演示模式：只在本机回环上起两个监听器，方便直接看界面长什么样。
//   node test/demo.js     → 打开 http://127.0.0.1:8080/__myphone/
// 与 dev-boot 的区别：public 绑在 127.0.0.1，不会暴露到局域网。
import path from 'node:path'
import fs from 'node:fs'
import { MyPhoneState } from '../src/state.js'
import { createGate } from '../src/gate.js'
import { devSession } from './dev-session.js'

const ADMIN_PORT = Number(process.env.POCKET_ADMIN_PORT || 8080)
const PUBLIC_PORT = Number(process.env.POCKET_PUBLIC_PORT || 8081)

const stateDir = path.join(process.cwd(), '.demo-state')
fs.mkdirSync(stateDir, { recursive: true })
const state = new MyPhoneState(stateDir)
const session = devSession()
const log = { info: (...a) => console.log('·', ...a), error: (...a) => console.error('✗', ...a) }

let gate
gate = createGate({
  state,
  session,
  log,
  getAddresses: () => (gate.publicPort ? [`http://127.0.0.1:${gate.publicPort}/`] : []),
  getStatus: () => ({ tunnel: null }),
})

async function sync() {
  const s = state.settings
  await gate.startAdmin(ADMIN_PORT)
  if (s.lanEnabled || s.tunnelEnabled) await gate.startPublic(PUBLIC_PORT, '127.0.0.1')
  else await gate.stopPublic()
}
gate.setSettingsHandler(sync)
await sync()

console.log(`\n  设置页 → http://127.0.0.1:${gate.adminPort}/__myphone/`)
console.log(`  手机模拟 → http://127.0.0.1:${gate.publicPort ?? PUBLIC_PORT}/`)
console.log('  Ctrl+C 退出\n')
