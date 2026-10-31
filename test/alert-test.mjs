// 即时提醒（等你回答 / 出错 / 整理上下文 / 计划模式）的合并与收尾规则（只跑逻辑，不开端口）
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

const state = {
  settings: { lanEnabled: false, tunnelEnabled: true, maxDevices: 8, lanPort: 0, publicPort: 0 },
  devices: [],
  patchSettings() {},
  touchDevice() {},
  addDevice() {
    return null
  },
  removeDevice() {},
  trustDevice() {},
  untrustDevice() {},
  noteDevice() {},
}
const gate = createGate({ state, session: null, log: { info() {}, warn() {}, error() {}, debug() {} } })

// 1. 「等你回答」：带 ref → 同一个 callId 反复触发只有一条
gate.noteAlert('question', '[嘉然] 正在等你回答...', { ref: 'ask:c1', sticky: true })
gate.noteAlert('question', '[嘉然] 正在等你回答...', { ref: 'ask:c1', sticky: true })
let list = gate.pendingAlerts()
check('同一 callId 只留一条', list.length === 1, `len=${list.length}`)
check('sticky 为真（气泡不自动消失）', list[0].sticky === true, String(list[0].sticky))

// 2. 回答完了（tool/result）→ 按 ref 收掉
const cleared = gate.clearAlertRef('ask:c1')
check('clearAlertRef 按 ref 收掉', cleared === true && gate.pendingAlerts().length === 0, String(cleared))

// 3. 不带 ref 的同类提醒 5 秒内合并计数
gate.noteAlert('warn', '[嘉然] 上下文压缩出错')
gate.noteAlert('warn', '[嘉然] 上下文压缩出错')
list = gate.pendingAlerts()
check('同类无 ref 的提醒合并成一条', list.length === 1 && list[0].count === 2, `len=${list.length} count=${list[0]?.count}`)

// 4. 不同 kind 不合并
gate.noteAlert('plan', '[嘉然] 切到了计划模式')
check('不同 kind 各自一条', gate.pendingAlerts().length === 2, `len=${gate.pendingAlerts().length}`)

// 5. 人工点 ✕ → 只收那一条
const target = gate.pendingAlerts()[0]
gate.dismissAlert(target.seq)
const left = gate.pendingAlerts()
check('dismissAlert 只收指定那条', left.length === 1 && left[0].seq !== target.seq, `len=${left.length}`)

// 6. 未知 seq 不抛
check('未知 seq 不误删', gate.dismissAlert(999999) === false)

// 7. 压缩开始 → 结束按 ref 收掉
gate.noteAlert('compaction', '[嘉然] 正在整理上下文...', { ref: 'compact:s1', sticky: true })
check('压缩提醒挂上', gate.pendingAlerts().some((a) => a.kind === 'compaction'))
gate.clearAlertRef('compact:s1')
check('压缩结束自动收掉', !gate.pendingAlerts().some((a) => a.kind === 'compaction'))

// 8. 面板快照用的就是这个函数（`panel.js` 里 `alerts: gate.pendingAlerts?.() ?? []`）
check('pendingAlerts 返回可序列化数组', Array.isArray(gate.pendingAlerts()), `len=${gate.pendingAlerts().length}`)

console.log(`\n${pass}/${pass + fail} 通过`)
if (fail) process.exitCode = 1
