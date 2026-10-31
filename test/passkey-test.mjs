// 长期凭据（第二把钥匙）的规则：手机 cookie 被浏览器清掉后还能自己认回来
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MyPhoneState as State } from '../src/state.js'

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

const dir = mkdtempSync(join(tmpdir(), 'myphone-passkey-'))
const file = join(dir, 'state.json')
const quiet = { info() {}, warn() {}, error() {}, debug() {} }

const s = new State(file, quiet)
s.load()

// 1. 新设备自带一把长期凭据
const d1 = s.addDevice('iPhone', 'UA-A')
check('新设备带 passKeys', Array.isArray(d1.passKeys) && d1.passKeys.length === 1, JSON.stringify(d1.passKeys))
const key1 = d1.passKeys[0]
check('凭据够长（18 字节 base64url）', key1.length >= 24, `${key1.length} 字符`)

// 2. 能按钥匙找回设备
check('按钥匙能找到设备', s.findByPassKey(key1)?.id === d1.id)
check('乱写的钥匙找不到', s.findByPassKey('x'.repeat(30)) === null)
check('太短的输入直接拒（防爆破）', s.findByPassKey('abc') === null)

// 3. 同 UA 重复扫码 → 复用原记录，且原有钥匙不丢
const d1b = s.upsertDevice('iPhone', 'UA-A')
check('同 UA 复用同一条设备', d1b.id === d1.id)
check('复用后钥匙还在', s.findByPassKey(key1)?.id === d1.id)

// 4. 合并多条同 UA 时，各条历史钥匙都要接过来（老浏览器存的那把不能失效）
const d2 = s.addDevice('Android 设备', 'UA-B')
const keyB1 = d2.passKeys[0]
// 手工造一条同 UA 的老记录（模拟老版本每扫一次就 add）
s.data.devices.push({
  id: 'legacy0001',
  label: 'Android 设备',
  note: '',
  userAgent: 'UA-B',
  createdAt: Date.now() - 1000,
  lastSeen: null,
  trustedAt: Date.now(),
  passKeys: ['legacy-key-0123456789'],
})
const merged = s.upsertDevice('Android 设备', 'UA-B')
check('同 UA 合并成一条', s.data.devices.filter((d) => d.userAgent === 'UA-B').length === 1)
check('合并后保留新钥匙', Boolean(s.findByPassKey(keyB1)))
check('合并后老的钥匙也还有效', Boolean(s.findByPassKey('legacy-key-0123456789')), `merged=${merged.id}`)

// 5. 删掉设备 = 钥匙立刻作废
s.trustDevice(d1.id)
check('信任后是可信设备', Boolean(s.data.devices.find((d) => d.id === d1.id)?.trustedAt))
s.removeDevice(d1.id)
check('删设备后钥匙作废', s.findByPassKey(key1) === null)

// 6. 撤销信任不影响钥匙本身（钥匙还在，但服务端会检查 trustedAt）
const d3 = s.addDevice('iQ', 'UA-C')
const key3 = d3.passKeys[0]
s.untrustDevice(d3.id)
const found = s.findByPassKey(key3)
check('撤销信任后仍能找到设备（由 gate 判断能不能进）', found?.id === d3.id)
check('撤销后 trustedAt 为空', !found.trustedAt)

// 7. 落盘再读回来，钥匙不丢
const s2 = new State(file, quiet)
s2.load()
check('重启后钥匙仍可查', s2.findByPassKey(key3)?.id === d3.id)
check('重启后设备数没变', s2.devices.length === s.devices.length, `${s2.devices.length}`)

// 8. 闲置过期：30 天没用过就作废
check('新设备的钥匙刚登记时是有效的', s2.passKeyFresh(d3.id))
const d3rec = s2.data.devices.find((d) => d.id === d3.id)
d3rec.passKeyAt = Date.now() - 31 * 24 * 60 * 60 * 1000
check('31 天没用过 → 失效', !s2.passKeyFresh(d3.id))
s2.touchPassKey(d3.id)
check('用过一次 → 重新有效', s2.passKeyFresh(d3.id))

// 9. 作废钥匙：设备记录还在（备注不丢），只是钥匙没了
s2.noteDevice(d3.id, '嘉然')
s2.clearPassKeys(d3.id)
check('作废后钥匙查不到', s2.findByPassKey(key3) === null)
check('作废后设备还在、备注还在', Boolean(s2.data.devices.find((d) => d.id === d3.id && d.note === '嘉然')))

// 10. 没有 passKeyAt 的老记录按创建时间算（升级上来的数据不会立刻失效）
s2.data.devices.push({ id: 'old0001', label: 'Old', userAgent: 'UA-OLD', createdAt: Date.now() - 1000, passKeys: ['old-key-0123456789'] })
check('老记录按 createdAt 判定，仍有效', s2.passKeyFresh('old0001'))

rmSync(dir, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
