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
check('pending 带会话名（不带中括号，v1.8.38 起超过 6 字裁到「整理插件的悬…」）', feed.pending[0].name === '整理插件的悬…', String(feed.pending[0].name))
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

// 7. v1.8.30：技术动态不能被高频人工事件挤出列表。
// 原来技术类与 turnok/longrun 共用同一个 40 条环形缓冲，实测 40 条里 19 条 turnok、
// 10 条 longrun —— 技术动态只剩最早那两条，用户看到就截图问「这里漏数据了吧」。
for (let i = 0; i < 30; i += 1) gate.noteEvent('turnok', `某会话 完成了一轮 #${i}`)
gate.noteEvent('upstream', '连不上本机 DSH：ECONNREFUSED')
const f4 = gate.feed()
check('技术动态没被高频人工事件挤掉', f4.tech.length >= 2, JSON.stringify(f4.tech.map((t) => t.kind)))
check('新进来的技术事件也在', f4.tech.some((t) => t.kind === 'upstream'), JSON.stringify(f4.tech.map((t) => t.kind)))
check('技术动态里没有「会话在等授权」这类误会', !f4.tech.some((t) => t.kind === 'approval'), JSON.stringify(f4.tech.map((t) => t.kind)))
check('授权仍在 pending 里（没被藏掉）', f4.pending.length > 0, `n=${f4.pending.length}`)

// 8. v1.8.37：「在等你回答」是唯一「卡着等你」的事件，要按 P0 处理。
// 以前它不在 HUMAN_KINDS 里 → 落到技术动态、按 P2 走，提示音只有 2 声、气泡 3 秒就没了。
gate.noteEvent('question', '【嘉然】 正在等你回答：要不要继续')
const f5 = gate.feed()
const q = f5.human.filter((x) => x.kind === 'question')
check('「等你回答」进人工消息', q.length === 1, `n=${q.length}`)
check('「等你回答」是 P0（和等授权同档）', q.every((x) => x.level === 0), q.map((x) => x.level).join(','))
check('「等你回答」不再混进技术动态', !f5.tech.some((x) => x.kind === 'question'), JSON.stringify(f5.tech.map((x) => x.kind)))

// 9. v1.8.38：入口自动关闭提到 P1；正文里的【会话名】超过 6 字统一裁成「六字…」。
// 用户原话「入口自动关闭放到p1，会话名【六个字】里面就放六个字多的省略号」。
gate.noteEvent('autooff', '【超长名字的一个会话】 入口空闲 15 分钟，已自动收回连接')
const f6 = gate.feed()
const off = f6.human.filter((x) => x.kind === 'autooff').pop()
check('入口自动关闭是 P1', off.level === 1, `level=${off.level}`)
check('正文里的长会话名被裁到 6 字 + 省略号', /【超长名字的一…】/.test(off.text), off.text)
gate.noteEvent('retry', '【正好六个字】 正在重试（第 2 次）')
const f7 = gate.feed()
const six = f7.human.filter((x) => x.kind === 'retry').pop()
check('短名字不会被加省略号', !/…/.test(six.text), six.text)
check('裁的是名字不是整条文案（后面的正文还在）', /正在重试/.test(six.text), six.text)

// 10. v1.8.40：上下文提醒从 P1 降到 P2；「这一轮被停止」不进消息、只留技术日志。
// 用户原话「上下文已用xx 是怎么判定的 感觉很频繁」「手动停止不算」。
gate.noteEvent('ctx', '【正好六个字】 的上下文已用 92%（90% 提醒档）')
const f8 = gate.feed()
const cx = f8.human.filter((x) => x.kind === 'ctx').pop()
check('「上下文已用」还在人工消息里（仍能看到）', Boolean(cx), JSON.stringify(f8.human.map((x) => x.kind)))
check('「上下文已用」降为 P2（不再三声警报）', cx.level === 2, `level=${cx.level}`)
gate.noteEvent('turnstop', '【正好六个字】 这一轮被停止了')
const f9 = gate.feed()
check(
  '「这一轮被停止」不进人工消息（不是失败）',
  !f9.human.some((x) => x.kind === 'turnstop'),
  JSON.stringify(f9.human.map((x) => x.kind)),
)
check(
  '「这一轮被停止」留在技术日志里可查',
  f9.tech.some((x) => x.kind === 'turnstop'),
  JSON.stringify(f9.tech.map((x) => x.kind)),
)

console.log(`\n${pass}/${pass + fail} 通过`)
if (fail) process.exit(1)
