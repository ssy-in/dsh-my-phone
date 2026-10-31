// 消息中心三段式：待处理 / 最近动态 / 技术日志（只跑逻辑，不开端口）
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

// 1. 三类事件混在一起，feed 要能把它们分开
gate.noteEvent('scan', '匿名扫描 /favicon.ico → 401')
gate.noteEvent('scan', '匿名扫描 /dz/gopro.js → 401')
gate.noteEvent('tunnel', '入口地址已变更：旧 → 新')
gate.noteEvent('autooff', '入口空闲 15 分钟，已自动收回连接')
gate.noteApproval('sess-9', '整理插件的悬浮球', 'workspace_write')
gate.noteConnect({ id: 'dev-1', label: '嘉然（iPhone）' }, 'Mozilla/5.0 (iPhone)')

const feed = gate.feed()
check('feed 有 pending', Array.isArray(feed.pending) && feed.pending.length === 1, `len=${feed.pending.length}`)
check('pending 里是授权文案', /正在请求授权/.test(feed.pending[0].text), feed.pending[0].text)
check('pending 带会话名（不带中括号）', feed.pending[0].name === '整理插件的悬浮球', String(feed.pending[0].name))
check('feed 有 human', Array.isArray(feed.human) && feed.human.length === 3, `len=${feed.human.length}`)
check('human 里有连接事件', feed.human.some((h) => h.kind === 'join' && /刚连进来/.test(h.text)))
check('human 里有入口自动关闭', feed.human.some((h) => h.kind === 'autooff'))
check('human 里有地址变更', feed.human.some((h) => h.kind === 'tunnel'))
check('human 里没有授权与扫描', !feed.human.some((h) => /正在请求授权|匿名扫描/.test(h.text)))
check('tech 只留技术类', feed.tech.length === 1 && feed.tech[0].kind === 'scan', JSON.stringify(feed.tech.map((t) => t.kind)))
check('tech 同类合并计数', feed.tech[0].count === 2, `count=${feed.tech[0].count}`)
check('techRaw 逐条（含重复）', feed.techRaw.length === 2)
check('techRaw 不含人类事件', !feed.techRaw.some((e) => e.kind === 'autooff' || e.kind === 'tunnel'))
check('事件带自增 seq', feed.techRaw.every((e) => Number.isInteger(e.seq) && e.seq > 0))

// 2. 处理掉授权 → pending 清空
gate.ackApproval(feed.pending[0].seq)
check('ack 后 pending 清空', gate.feed().pending.length === 0)

// 3. 清日志不该把「待处理」也清掉（它们是两套东西）
gate.noteApproval('sess-10', '另一个会话')
gate.clearLogs()
const after = gate.feed()
// 清日志只清「技术日志」；「有人连进来」属于收件箱（红点靠它），要留着
check('清日志后技术日志归零', after.tech.length === 0, `t=${after.tech.length}`)
check('清日志后连接通知仍在（靠已读标记收起）', after.human.length === 1 && after.human[0].kind === 'join', `h=${after.human.length}`)
check('清日志不影响待处理授权', after.pending.length === 1, `len=${after.pending.length}`)


// 4. v1.2.2 优先级：首次连入 P0（琥珀）、同一台再连降为 P1（橙）、其余人工动态 P2
gate.noteConnect({ id: 'dev-2', label: 'iPhone' }, 'Mozilla/5.0 (iPhone)', 1)
gate.noteConnect({ id: 'dev-2', label: 'iPhone' }, 'Mozilla/5.0 (iPhone)', 2)
const lv = gate.feed()
const joins = lv.human.filter((x) => x.kind === 'join')
check('首次连入算 P0（两条：dev-1 与 dev-2 首连）', joins.filter((x) => x.level === 0).length === 2, `p0=${joins.filter((x) => x.level === 0).length}`)
check('同一台再连降为 P1（只有一条）', joins.filter((x) => x.level === 1).length === 1, `p1=${joins.filter((x) => x.level === 1).length}`)
check('非连接类动态一律 P2', lv.human.filter((x) => x.kind !== 'join').every((x) => x.level === 2))
check('待处理授权也是 P0', lv.pending.every((x) => x.level === 0))
check(
  'pendingCount = 待处理 + 未读新设备',
  lv.pendingCount === lv.pending.length + 2,
  `c=${lv.pendingCount}`,
)
check('连接通知可单条收（ackable）', joins.every((x) => x.ackable === true))

// 5. 单条 ack：只收自己那条，别的还在
const firstJoin = lv.human.find((x) => x.kind === 'join')
check('ackNotice 能收掉一条', gate.ackNotice(firstJoin.seq) === true)
const after2 = gate.feed()
check('收掉一条后 pendingCount 减一', after2.pendingCount === lv.pendingCount - 1, `c=${after2.pendingCount}`)
check('未知 seq 不报错也不误删', gate.ackNotice(99999) === false)

// 6. v1.2.3：会话层面的失败 / 重试 / 模型不可用 → 人工动态里的 P1（不埋进技术日志）
gate.noteEvent('turnfail', '某会话 这一轮失败：stream-error')
gate.noteEvent('retry', '某会话 的一次尝试没成功，正在重试')
gate.noteEvent('model', '某会话 模型不可用')
gate.noteEvent('scan', '匿名扫描 /x.js → 401')
const f3 = gate.feed()
const warn = f3.human.filter((x) => x.kind === 'turnfail' || x.kind === 'retry' || x.kind === 'model')
check('一轮失败/重试/模型不可用都进人工动态', warn.length === 3, `n=${warn.length}`)
check('这三类都是 P1（橙）', warn.every((x) => x.level === 1), warn.map((x) => x.level).join(','))
check('扫描这类技术噪音仍在技术日志', f3.tech.some((x) => x.kind === 'scan') && !f3.human.some((x) => x.kind === 'scan'))
console.log(`\n${pass}/${pass + fail} 通过`)
if (fail) process.exit(1)
