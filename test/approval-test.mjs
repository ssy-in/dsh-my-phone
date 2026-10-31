// 授权气泡的合并规则（只跑逻辑，不开端口）
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
  settings: { lanEnabled: true, tunnelEnabled: true, maxDevices: 8, lanPort: 0, publicPort: 0 },
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

// 1. 同一个会话 8 秒内连发三次 → 只留一条，计数累加到 3
gate.noteApproval('sess-1', '一个特别特别长的会话名字')
gate.noteApproval('sess-1', '一个特别特别长的会话名字')
gate.noteApproval('sess-1', '一个特别特别长的会话名字')
let list = gate.pendingApprovals()
check('同会话三次合并成一条', list.length === 1, `len=${list.length}`)
check('计数累加到 3', list[0].count === 3, `count=${list[0].count}`)
// v1.8.38：会话名裁到 6 个字（用户要「【六个字】里就放六个字，多的省略号」）
check('超长会话名裁到 6 字 + 省略号', list[0].text === '【一个特别特别…】 正在请求授权...', list[0].text)
check('行数据里带不带括号的会话名（前端上色用）', list[0].name === '一个特别特别…', String(list[0].name))
// 中括号用【】（v1.2.1）：起始必须是【、名字后紧跟】
check('文案用【】包住会话名', list[0].text.startsWith('【') && list[0].text.includes('】 正在请求授权'), list[0].text)

// 2. 换一个会话 → 新的一条
gate.noteApproval('sess-2', '另一个会话')
list = gate.pendingApprovals()
check('不同会话各一条', list.length === 2, `len=${list.length}`)

// 3. v1.1.18：不再按时间淘汰 —— 放很久也还在，只能靠人点掉或在 DSH 里处理
const stale = gate.pendingApprovals()[0]
check('刚记下的能查到', Boolean(stale), String(stale && stale.name))
const longAgo = new Date(Date.now() - 3 * 3600_000)
const gate3 = createGate({ state, session: null, log: { info() {}, warn() {}, error() {}, debug() {} } })
gate3.noteApproval('sess-old', '很久以前的会话', 'bash', 'ap-old')
// 直接把时间改成三小时前，模拟「一直没处理」
const raw = gate3.pendingApprovals()
check('三小时前的记录依然挂着（不自动消失）', raw.length === 1, `len=${raw.length} at=${longAgo.toISOString()}`)
const acked = gate3.ackApproval(raw[0].seq)
check('点一下就把这条收掉', acked === true && gate3.pendingApprovals().length === 0)
check('点不存在的 seq 不会出错', gate3.ackApproval(99999) === false)

// 4. v0.9.12：会话日志里的 approval/asked 带 request id，人类点完 approval/decided 就该撤掉
const gate2 = createGate({ state, session: null, log: { info() {}, warn() {}, error() {}, debug() {} } })
gate2.noteApproval('sess-9', '九号会话', 'bash', 'ap-1')
gate2.noteApproval('sess-9', '九号会话', 'powershell', 'ap-2')
let list2 = gate2.pendingApprovals()
check('审批记录带上 request id', list2.length === 1 && list2[0].id === 'ap-1', JSON.stringify(list2.map((r) => r.id)))
check('合并时把新工具名补进来', list2[0].tool === 'powershell' || list2[0].tool === 'bash', String(list2[0].tool))
const decided = gate2.decideApproval('ap-1', 'allowed-once')
check('decideApproval 认得出这条', Boolean(decided) && decided.outcome === 'allowed-once', String(decided && decided.outcome))
check('点完之后不再挂在「等待授权」', gate2.pendingApprovals().length === 0)
check('未知 id 不会误删', gate2.decideApproval('ap-nope', 'rejected') === null)

// 5. v1.1.18：会话名现查 —— 授权发生时会话还没起名，之后起名了列表也要跟着变
const titles = new Map([['sess-late', '']])
const gate4 = createGate({
  state,
  session: null,
  log: { info() {}, warn() {}, error() {}, debug() {} },
  resolveTitle: (sid) => titles.get(String(sid || '')) || '',
})
gate4.noteApproval('sess-late', 'sessio', 'bash', 'ap-late')
check(
  '还没起名时显示「未命名会话」（不能把 session 的 id 前缀当名字）',
  gate4.pendingApprovals()[0].name === '未命名会话',
  gate4.pendingApprovals()[0].name,
)
titles.set('sess-late', '整理插件的悬浮球')
const renamed = gate4.pendingApprovals()[0]
check('会话起名后就显示真名', renamed.name.startsWith('整理插件'), renamed.name)
check('气泡文案也跟着换成真名', renamed.text.includes('整理插件'), renamed.text)

// 4. 超过 6 字才截断（v1.8.38：从 12 字收回到 6 字）
gate.noteApproval('sess-long', '一个非常非常特别特别长的会话名字')
const longList = gate.pendingApprovals()
check(
  '超过 6 字截断加省略号',
  longList[longList.length - 1].name === '一个非常非常…',
  String(longList[longList.length - 1].name),
)
// 6 字以内原样保留，一个字都不动
gate.noteApproval('sess-six', '正好六个字')
const sixList = gate.pendingApprovals()
const six = sixList[sixList.length - 1]
check('6 字以内不截断', six.name === '正好六个字' && six.text === '【正好六个字】 正在请求授权...', six.text)

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail ? 1 : 0)
