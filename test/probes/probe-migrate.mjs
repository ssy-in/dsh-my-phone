// 迁移检查：老 state.json（两个开关都关、空闲 30 分钟）载入后必须变成「默认全开」
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MyPhoneState } from '../src/state.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myphone-migrate-'))
const legacy = {
  version: 1,
  pluginSecret: 'x'.repeat(43),
  devices: [],
  settings: {
    lanEnabled: false,
    lanPort: 8080,
    publicPort: 8081,
    tunnelEnabled: false,
    cloudflaredPath: '',
    maxDevices: 8,
    autoOffMinutes: 30,
  },
  migratedV2: true,
  migratedV3: true,
}
fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(legacy, null, 2))

const st = new MyPhoneState(dir)
const out = []
const check = (ok, text) => {
  out.push(`${ok ? '✓' : '✗'} ${text}`)
  if (!ok) process.exitCode = 1
}
check(st.settings.lanEnabled === true, `lanEnabled → ${st.settings.lanEnabled}`)
check(st.settings.tunnelEnabled === true, `tunnelEnabled → ${st.settings.tunnelEnabled}`)
check(st.settings.autoOffMinutes === 0, `autoOffMinutes → ${st.settings.autoOffMinutes}`)
check(st.data.migratedV4 === true, 'migratedV4 标记已写')

// 用户手动关掉之后，再载入不能被改回来
st.patchSettings({ lanEnabled: false })
const again = new MyPhoneState(dir)
check(again.settings.lanEnabled === false, `用户关掉后重载保持关闭（${again.settings.lanEnabled}）`)

// 全新安装：默认就是全开
const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'myphone-fresh-'))
const s2 = new MyPhoneState(fresh)
check(s2.settings.lanEnabled === true && s2.settings.tunnelEnabled === true, '全新安装默认两个入口都开')
check(s2.settings.autoOffMinutes === 0, `全新安装空闲不自动关（${s2.settings.autoOffMinutes}）`)

console.log(out.join('\n'))
