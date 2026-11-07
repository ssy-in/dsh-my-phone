// 用极小的假 DOM 真正**执行** src/widget.js，验证「气泡真的会弹」。
//
// 为什么要有这个文件：v1.8.19 那个 bug（placeBubble 有调用没实现、bubbleSig 没声明）
// 靠读源码、靠静态字符串断言都发现不了 —— 只有把代码跑起来才会抛 ReferenceError。
// 这里不引入 jsdom，只实现 widget.js 用到的那一小撮 DOM 接口。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

// ---------- 假 DOM ----------
const all = new Set()
const idMap = new Map()

function mkStyle() {
  const s = {}
  let cssText = ''
  Object.defineProperty(s, 'cssText', {
    get: () => cssText,
    set: (v) => {
      cssText = String(v || '')
      for (const k of Object.keys(s)) if (k !== 'cssText') delete s[k]
      for (const part of cssText.split(';')) {
        const i = part.indexOf(':')
        if (i < 0) continue
        const key = part.slice(0, i).trim()
        if (key) s[key] = part.slice(i + 1).trim()
      }
    },
  })
  return s
}

function mkEl(tag = 'div') {
  const listeners = new Map()
  const kids = []
  const el = {
    tagName: String(tag).toUpperCase(),
    children: kids,
    parentNode: null,
    offsetWidth: 0,
    offsetHeight: 0,
    classList: null,
  }
  el.style = mkStyle()
  let className = ''
  Object.defineProperty(el, 'className', {
    get: () => className,
    set: (v) => {
      className = String(v || '')
    },
  })
  Object.defineProperty(el, 'id', {
    get: () => el._id || '',
    set: (v) => {
      el._id = String(v || '')
      if (el._id) idMap.set(el._id, el)
    },
  })
  el.classList = {
    add: (c) => {
      if (!className.split(/\s+/).includes(c)) className = (className + ' ' + c).trim()
    },
    remove: (c) => {
      className = className
        .split(/\s+/)
        .filter((x) => x && x !== c)
        .join(' ')
    },
    contains: (c) => className.split(/\s+/).includes(c),
  }
  el.setAttribute = (k, v) => {
    if (k === 'class') el.className = v
    else if (k === 'id') el.id = v
    else el['attr_' + k] = v
  }
  el.getAttribute = (k) => (k === 'class' ? el.className : el['attr_' + k])
  el.appendChild = (c) => {
    kids.push(c)
    if (c && typeof c === 'object') c.parentNode = el
    return c
  }
  el.removeChild = (c) => {
    const i = kids.indexOf(c)
    if (i >= 0) kids.splice(i, 1)
    if (c) c.parentNode = null
    return c
  }
  el.insertBefore = (c, ref) => {
    const i = kids.indexOf(ref)
    kids.splice(i < 0 ? kids.length : i, 0, c)
    if (c) c.parentNode = el
    return c
  }
  el.remove = () => {
    if (el.parentNode) el.parentNode.removeChild(el)
    all.delete(el)
  }
  el.addEventListener = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, [])
    listeners.get(type).push(fn)
  }
  el.removeEventListener = (type, fn) => {
    const arr = listeners.get(type) || []
    const i = arr.indexOf(fn)
    if (i >= 0) arr.splice(i, 1)
  }
  el.dispatch = (type, ev = {}) => {
    for (const fn of listeners.get(type) || []) fn({ pointerType: 'mouse', preventDefault() {}, ...ev })
  }
  el.fire = (type, ev) => el.dispatch(type, ev)
  el.getBoundingClientRect = () => ({ left: 800, top: 40, right: 921, bottom: 148, width: 121, height: 108 })
  // 支持只有「类选择器 + 逗号」的极简选择器（widget.js 只用这两种写法）
  el.querySelectorAll = (sel) => {
    const want = String(sel)
      .split(',')
      .map((s) => s.trim().replace(/^\./, ''))
      .filter(Boolean)
    const out = []
    const walk = (n) => {
      for (const k of n.children) {
        if (!k || typeof k === 'string') continue
        const cls = String(k.className || '').split(/\s+/)
        if (want.some((c) => cls.includes(c))) out.push(k)
        walk(k)
      }
    }
    walk(el)
    return out
  }
  el.querySelector = (sel) => el.querySelectorAll(sel)[0] || null
  // 文本
  let textContent = ''
  Object.defineProperty(el, 'textContent', {
    get: () => (textContent || kids.map((k) => (typeof k === 'string' ? k : k.textContent || '')).join('')),
    set: (v) => {
      textContent = String(v == null ? '' : v)
      kids.length = 0
    },
  })
  Object.defineProperty(el, 'innerHTML', {
    get: () => textContent,
    set: (v) => {
      textContent = String(v == null ? '' : v)
      kids.length = 0
    },
  })
  all.add(el)
  return el
}

const documentEl = mkEl('html')
const headEl = mkEl('head')
const bodyEl = mkEl('body')
documentEl.appendChild(headEl)
documentEl.appendChild(bodyEl)

const docListeners = new Map()
const document = {
  documentElement: documentEl,
  head: headEl,
  body: bodyEl,
  hidden: false,
  createElement: (t) => mkEl(t),
  createTextNode: (t) => {
    const n = mkEl('#text')
    n.textContent = t
    return n
  },
  getElementById: (id) => idMap.get(id) || null,
  contains: (n) => !!(n && all.has(n)),
  addEventListener: (type, fn) => {
    if (!docListeners.has(type)) docListeners.set(type, [])
    docListeners.get(type).push(fn)
  },
  removeEventListener: (type, fn) => {
    const arr = docListeners.get(type) || []
    const i = arr.indexOf(fn)
    if (i >= 0) arr.splice(i, 1)
  },
  dispatch: (type, ev = {}) => {
    for (const fn of [...(docListeners.get(type) || [])]) fn({ preventDefault() {}, ...ev })
  },
  execCommand: () => true,
}

// ---------- 假计时器（不自动跑，测试里手动推） ----------
let timerSeq = 0
const timers = new Map()
const setTimeoutShim = (fn, ms) => {
  const id = ++timerSeq
  timers.set(id, { fn, ms, kind: 'timeout', cleared: false })
  return id
}
const clearTimeoutShim = (id) => {
  const t = timers.get(id)
  if (t) t.cleared = true
}
const setIntervalShim = (fn, ms) => {
  const id = ++timerSeq
  timers.set(id, { fn, ms, kind: 'interval', cleared: false })
  return id
}
const clearIntervalShim = clearTimeoutShim
function runTimers(kind) {
  // 先把当前这一批拍下来：执行期间新排进来的（比如 showBubble 排的自动隐藏）
  // 不能在同一轮里跟着跑，否则刚弹出来就被藏回去
  const batch = [...timers.entries()].filter(([, t]) => !t.cleared && t.kind === kind)
  for (const [, t] of batch) if (!t.cleared) t.fn()
}

// ---------- 假网络 ----------
let snapshot = null
const fetchCalls = []
// v1.8.27：模拟「手机端」—— 管理口 404、只有 /__myphone/state 能拿到只读快照
let panelIs404 = false
let remoteSnapshot = null
const fetchShim = (url, opts) => {
  fetchCalls.push({ url: String(url), opts })
  const u = String(url)
  if (panelIs404 && u.includes('/__myphone/panel')) {
    return Promise.resolve({ ok: false, status: 404, json: async () => null })
  }
  if (u.includes('/__myphone/state')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => JSON.parse(JSON.stringify(remoteSnapshot)),
    })
  }
  return Promise.resolve({
    ok: true,
    json: async () => JSON.parse(JSON.stringify(snapshot)),
  })
}

const storage = new Map()
const window = {
  innerWidth: 1440,
  innerHeight: 900,
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
  prompt: () => null,
}
const navigator = { clipboard: { writeText: async () => {} } }

// 假音效引擎：v1.8.22 起「一条消息 = 一次气泡 + 一次音」，靠它数到底响了几次
const audioLog = []
window.__dshMyPhoneAudio = {
  setVolume: () => {},
  setTimbre: () => {},
  unlock: () => audioLog.push('unlock'),
  enter: () => audioLog.push('enter'),
  leave: () => audioLog.push('leave'),
  press: () => audioLog.push('press'),
  release: () => audioLog.push('release'),
  alert: () => audioLog.push('alert'),
  notice: () => audioLog.push('notice'),
  short: () => audioLog.push('short'),
}

class FakeEventSource {
  constructor(url) {
    this.url = url
    FakeEventSource.last = this
    FakeEventSource.all.push(this)
  }
  close() {}
}
FakeEventSource.all = []

// ---------- 执行 widget.js ----------
const src = fs.readFileSync(new URL('../src/widget.js', import.meta.url), 'utf8')
const fn = new Function(
  'window',
  'document',
  'navigator',
  'fetch',
  'EventSource',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'requestAnimationFrame',
  src + '\n//# sourceURL=widget.js',
)
fn(
  window,
  document,
  navigator,
  fetchShim,
  FakeEventSource,
  setTimeoutShim,
  clearTimeoutShim,
  setIntervalShim,
  clearIntervalShim,
  // 面板渲染走 requestAnimationFrame；测试里直接同步跑，免得再维护一套帧队列
  (cb) => cb(),
)

const tick = () => new Promise((r) => setTimeout(r, 0))

let pass = 0
let total = 0
const check = (name, ok, extra = '') => {
  total += 1
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)
  if (ok) pass += 1
  else process.exitCode = 1
}

// 1. 球挂上去了
const el = document.getElementById('dsh-my-phone-widget')
check('悬浮球已挂到 documentElement 下', !!el)
const bubble = documentEl.children.find((c) => (c.className || '').includes('dmp-w-bubble'))
check('气泡容器已创建（初始透明）', !!bubble && bubble.style.opacity === '0')

// 2. 喂一帧「有会话等你授权」的快照
snapshot = {
  lanEnabled: true,
  tunnelEnabled: false,
  lanUrl: 'http://192.168.1.107:18391/',
  pairUrl: 'http://192.168.1.107:18391/pair?t=abc',
  ticketExpiresAt: Date.now() + 120000,
  tunnelAutoOffMinutes: 0,
  mutedUntil: 0,
  unread: 0,
  deviceList: [],
  notices: [],
  approvals: [{ seq: 7, at: Date.now(), text: '要不要删掉 dist/', name: '重建产物' }],
  events: [],
  // 关键：feed 是**对象**，不是数组
  feed: {
    pending: [{ id: 'a7', seq: 7, at: Date.now(), text: '要不要删掉 dist/', name: '重建产物', level: 0 }],
    human: [],
    tech: [],
    techRaw: [],
    techCount: 0,
    unread: 0,
    pendingCount: 1,
  },
}
await tick()
await tick()

check('气泡弹出来了（opacity=1）', bubble.style.opacity === '1', `opacity=${bubble.style.opacity}`)
check('气泡有定位（left/top 是 px）', /px$/.test(bubble.style.left || '') && /px$/.test(bubble.style.top || ''), `${bubble.style.left}/${bubble.style.top}`)
// v1.8.28：气泡放在球的左侧时，右边缘必须 <= 球的左边缘（以前用球心算，会压住球的一半）
{
  const r = el.getBoundingClientRect()
  const bx = parseFloat(bubble.style.left)
  const bw = parseFloat(bubble.style.width) || 244
  check('气泡在球的左侧且不压住球', bx + bw <= r.left, `bubble right=${bx + bw} ball left=${r.left}`)
}
check('气泡有尖角元素', bubble.children.some((c) => c && c.tagName === 'SPAN'))
const bubbleText = bubble.textContent
check('气泡里是那条授权而不是兜底文案', bubbleText.includes('重建产物') && !bubbleText.includes('点一下 · 手机扫码连 DSH'), bubbleText.slice(0, 60))

// 3. 红点跟着 pendingCount 走
const dot = el.children.find((c) => (c.className || '').includes('dmp-w-dot'))
// v1.8.36：红点不再带数字（只留一颗会呼吸的小点），所以断言改成「亮着 + 没有文字」
check('红点在有未读时亮起、且不带数字', !!dot && dot.style.display === 'block' && !dot.textContent, `display=${dot && dot.style.display} text=${dot && dot.textContent}`)

// 4. 藏起来之后，鼠标放上去还能再弹（悬停路径）
bubble.style.opacity = '0'
el.dispatch('pointerenter')
runTimers('timeout')
check('悬停 300ms 后气泡再次弹出', bubble.style.opacity === '1')

// 5. 手机端只读快照（没有管理口）也不该炸
const callsBefore = fetchCalls.length
await tick()
check('启动时确实向面板接口要过快照', callsBefore >= 1, `${fetchCalls.length} 次 ${fetchCalls[0] && fetchCalls[0].url}`)

// 5b. feed 给 null（老存档 / gate 抽风）但仍有待授权：气泡也要弹，不能一条路走死
bubble.style.opacity = '0'
snapshot = { ...snapshot, feed: null }
runTimers('interval')
await tick()
await tick()
check('feed 为 null 时靠 approvals 兜底弹气泡', bubble.style.opacity === '1' && bubble.textContent.includes('重建产物'), bubble.textContent.slice(0, 40))

// 6. 面板：消息能列出来，「正在用工具」的技术动态只摆着、不弹气泡
function findByText(node, text) {
  if (!node || typeof node !== 'object') return null
  const own = node.textContent || ''
  if (own.trim() === text) return node
  for (const k of node.children || []) {
    const hit = findByText(k, text)
    if (hit) return hit
  }
  return null
}
function allText(node) {
  // 假 DOM 的 textContent getter 已经是「自己 + 所有子节点」的递归拼接，
  // 直接用它就行。原来这里手写了一遍递归，遇到「先设 text 再 append 图标」的元素
  // （比如开关行的标题 = 文字 + 「！」图标）会把文字丢掉，断言就查不到标题了。
  if (!node || typeof node !== 'object') return ''
  return node.textContent || ''
}

el.dispatch('click')
const root = document.getElementById('dmp-panel')
check('点球能打开面板', !!root && root.style.display === 'flex', root && root.style.display)

snapshot = {
  ...snapshot,
  approvals: [],
  notices: [],
  events: [],
  feed: {
    pending: [],
    human: [{ id: 'j3', seq: 3, at: Date.now(), kind: 'join', text: 'IS（iPhone）刚连进来', level: 0 }],
    tech: [
      { kind: 'tool', count: 2, at: Date.now(), text: '(无标题会话) 正在用 Read' },
      // v1.8.24：「正在用工具」不再弹气泡，所以另外放一条真的会弹的技术动态来测「技术动态也会弹」
      { kind: 'upstream', count: 1, at: Date.now() + 1, text: '连不上本机 DSH：ECONNREFUSED' },
    ],
    techRaw: [],
    techCount: 2,
    unread: 1,
    pendingCount: 0,
  },
}
runTimers('interval') // 6 秒轮询那条
await tick()
await tick()

const advTab = findByText(root, '高级')
check('面板里有「高级」标签页', !!advTab)
// v1.8.22：消息 / 技术动态 / 排查日志搬到第三个 tab「消息/日志」
const feedTab = findByText(root, '消息/日志')
check('面板里有「消息/日志」标签页', !!feedTab)
if (feedTab) feedTab.dispatch('click')
await tick()

const panelText = allText(root)
check('消息列表列出了新连接', panelText.includes('IS（iPhone）刚连进来'), panelText.slice(0, 80))
check('「正在用 Read」也能看见', panelText.includes('正在用 Read'))
// v1.8.22：面板开着时气泡压住不弹（不然看面板被气泡糊脸），关掉面板才继续排
for (let i = 0; i < 4; i++) {
  runTimers('timeout')
  await tick()
}
check('面板开着时气泡先压住不弹', !bubble.textContent.includes('连不上本机 DSH'), bubble.textContent.slice(0, 40))
const backEl = findByClass(root, 'dmp-back')[0]
if (backEl) backEl.dispatch('click')
await tick()
for (let i = 0; i < 8; i++) {
  runTimers('timeout')
  await tick()
}
check('技术动态也会弹气泡（v1.8.24：只有「正在用工具」这类高频的不弹）', bubble.textContent.includes('连不上本机 DSH') || bubble.textContent.includes('正在用 Read'), bubble.textContent.slice(0, 60))
// 高级页只剩设置项，不再堆消息
if (backEl) el.dispatch('click')
await tick()
const advTabNow = findByText(root, '高级')
if (advTabNow) advTabNow.dispatch('click')
await tick()
const advText = allText(root)
// v1.8.25：高级页末尾那条「消息与日志」指路标题也去掉了（页签上已经写着）
check(
  '高级页里不再堆消息（只剩设置项）',
  advText.includes('局域网访问') && advText.includes('外网访问') && !advText.includes('IS（iPhone）刚连进来') && !advText.includes('消息与日志'),
  advText.slice(-80),
)
// v1.8.34：高级页两个连接下面不再重复贴「链接 + 复制」（都收进「连接」页的二维码卡片了）
check('高级页不再出现链接行与复制按钮', findByText(root, '复制') === null && !advText.includes('http://') && !advText.includes('https://'))
const feedTabAgain = findByText(root, '消息/日志')
if (feedTabAgain) feedTabAgain.dispatch('click')
await tick()

// 7. v1.8.21 消息卡重新设计：信笺格式、时间倒序、无「知道了」、超长可滚、NEW 点高级后消失
function findByClass(node, cls, acc = []) {
  if (!node || typeof node !== 'object') return acc
  if ((node.className || '').split(/\s+/).includes(cls)) acc.push(node)
  for (const k of node.children || []) findByClass(k, cls, acc)
  return acc
}

// 7a. 卡片里没有可点的「知道了」
check('卡片里去掉了「知道了」按钮', !panelText.includes('知道了'), panelText.slice(0, 100))

// 7b. 滚动：.feed 容器存在且有卡片
const feedBox = findByClass(root, 'feed')[0]
check('消息卡装在有滚动条的 .feed 容器里', !!feedBox, feedBox && feedBox.className)

// 7c. 三级都上色：给三条不同级别的事件，看 p0/p1/p2 三个类都落到卡上
const now = Date.now()
snapshot = {
  ...snapshot,
  feed: {
    pending: [{ id: 'a9', seq: 9, at: now, text: '要不要删掉 dist/', name: '重建产物', level: 0 }],
    human: [
      { id: 'j1', seq: 1, at: now - 60000, kind: 'join', text: 'IS（iPhone）刚连进来', level: 1 },
      { id: 'j2', seq: 2, at: now - 120000, kind: 'tool', text: '【整理插件的悬浮球】 完成了一轮', level: 2 },
    ],
    tech: [],
    techRaw: [],
    techCount: 0,
    unread: 1,
    pendingCount: 1,
  },
}
runTimers('interval')
await tick()
await tick()
const cards = findByClass(root, 'it')
const clsAll = cards.map((c) => c.className).join(' | ')
check('p0/p1/p2 三级卡片都上色', cards.some((c) => c.className.includes('p0')) && cards.some((c) => c.className.includes('p1')) && cards.some((c) => c.className.includes('p2')), clsAll)

// 7d. 时间倒序：第一张卡是最新的（at 最大）
const times = cards.map((c) => (findByClass(c, 'tm')[0] || {}).textContent || '')
const order = cards.map((c) => allText(c))
check('最新的一条排在第一张卡', order[0] && order[0].includes('要不要删掉 dist/'), order[0] && order[0].slice(0, 40))
// v1.8.25：事件类型从右下角搬到左上角当信笺 title，右下角只留时间
check('每张卡右下角只剩时间', times.length === 3 && times.every((t) => /^\d{2}:\d{2}$/.test(t.trim())), times.join(','))
const tags = cards.map((c) => ((findByClass(c, 'tag')[0] || {}).textContent || '').trim())
check('每张卡左上角都有事件标签', tags.length === 3 && tags.every((t) => t.length > 0), tags.join(','))
check('事件标签是中文事件名（不是 level 术语）', tags.includes('正在用工具') || tags.includes('新连接') || tags.includes('等授权'), tags.join(','))

// 7e. NEW 徽标：这条是「刚发生的」，还没读完之前应该带 NEW
const newBefore = findByClass(root, 'new').length
check('未读卡片带 NEW 徽标', newBefore >= 1, `new=${newBefore}`)
// 离开消息页 → 记已读；再回来 NEW 全消失
const connectTab = findByText(root, '连接')
if (connectTab) connectTab.dispatch('click')
await tick()
const feedTab2 = findByText(root, '消息/日志')
if (feedTab2) feedTab2.dispatch('click')
await tick()
await tick()
const newAfter = findByClass(root, 'new').length
check('读完离开消息页后 NEW 就消失', newAfter === 0, `new=${newAfter}`)

// 8. v1.8.22：所有消息都会弹气泡 + 响一次提示音，且短时间里不重复
// 先把面板关掉：面板开着时气泡是「压住」的（这是设计），不关就永远等不到
const backNow = findByClass(root, 'dmp-back')[0]
if (backNow) backNow.dispatch('click')
await tick()
// 再把上一段排着的队列放空，免得 bubbleBusy 卡着
for (let i = 0; i < 12; i++) {
  runTimers('timeout')
  await tick()
}
audioLog.length = 0
const t8 = Date.now()
snapshot = {
  ...snapshot,
  approvals: [],
  notices: [],
  events: [],
  feed: {
    pending: [],
    human: [{ id: 'h8', seq: 88, at: t8, kind: 'turnfail', text: '【整理插件的悬浮球】 这一轮失败：timeout', level: 1 }],
    tech: [],
    techRaw: [],
    techCount: 0,
    unread: 0,
    pendingCount: 0,
  },
}
runTimers('interval')
await tick()
await tick()
for (let i = 0; i < 6; i++) {
  runTimers('timeout')
  await tick()
}
check('普通消息（这轮失败）会弹成气泡', bubble.style.opacity === '1' && bubble.textContent.includes('这一轮失败'), bubble.textContent.slice(0, 50))
check('弹气泡时同时响一次音', audioLog.length >= 1, audioLog.join(','))
// 同一条消息（同 seq + 同文本）45 秒内再来一帧：不再弹、不再响
audioLog.length = 0
runTimers('interval')
await tick()
await tick()
for (let i = 0; i < 6; i++) {
  runTimers('timeout')
  await tick()
}
check('同一条消息 45 秒内不重复响', audioLog.length === 0, audioLog.join(','))

// 8b. v1.8.24：「正在用工具」这种高频事件只进列表，不弹气泡、不响音
bubble.style.opacity = '0'
const t8b = Date.now() + 500
snapshot = {
  ...snapshot,
  feed: {
    pending: [],
    human: [{ id: 'h88', seq: 188, at: t8b, kind: 'tool', text: '【整理插件的悬浮球】 正在用 Bash', level: 2 }],
    tech: [],
    techRaw: [],
    techCount: 0,
    unread: 0,
    pendingCount: 0,
  },
}
audioLog.length = 0
runTimers('interval')
await tick()
await tick()
for (let i = 0; i < 8; i++) {
  runTimers('timeout')
  await tick()
}
check('「正在用工具」不弹气泡', !bubble.textContent.includes('正在用 Bash'), bubble.textContent.slice(0, 40))
check('「正在用工具」也不响音', audioLog.length === 0, audioLog.join(','))

// 9. 文案必须对得上事件：有未读的新连接 + 有人正等着授权，气泡要说授权
const t9 = Date.now() + 1000
snapshot = {
  ...snapshot,
  unread: 1,
  notices: [{ at: t9 - 500, label: 'isis（iPhone）', join: 1, readAt: 0 }],
  approvals: [{ seq: 91, at: t9, text: '要不要删掉 dist/', name: '排查会话响应' }],
  feed: {
    pending: [{ id: 'a91', seq: 91, at: t9, text: '要不要删掉 dist/', name: '排查会话响应', level: 0 }],
    human: [
      { id: 'h90', seq: 90, at: t9 - 500, kind: 'join', text: 'isis（iPhone）刚连进来', name: 'isis（iPhone）', level: 0 },
    ],
    tech: [],
    techRaw: [],
    techCount: 0,
    unread: 1,
    pendingCount: 1,
  },
}
bubble.style.opacity = '0'
runTimers('interval')
await tick()
await tick()
for (let i = 0; i < 10; i++) {
  runTimers('timeout')
  await tick()
}
check(
  '等授权时气泡说的是授权，不是新连接',
  bubble.textContent.includes('授权') && bubble.textContent.includes('排查会话响应') && !bubble.textContent.includes('刚连进来'),
  bubble.textContent.slice(0, 70),
)
check('标签是「等授权」而不是「新连接」', bubble.textContent.includes('等授权'), bubble.textContent.slice(0, 40))

// 9b. v1.8.35：gate 的授权文案自带「【会话名】」，气泡不能再补一遍
//     （用户反馈「授权气泡正文每次看都是两个会话名称」）
{
  bubble.style.opacity = '0'
  const t9b = Date.now() + 3000
  snapshot = {
    ...snapshot,
    unread: 0,
    notices: [],
    approvals: [],
    feed: {
      pending: [
        {
          id: 'a92',
          seq: 92,
          at: t9b,
          text: '【排查会话响应】 正在请求授权...',
          name: '排查会话响应',
          level: 0,
        },
      ],
      human: [],
      tech: [],
      techRaw: [],
      techCount: 0,
      unread: 0,
      pendingCount: 1,
    },
  }
  runTimers('interval')
  await tick()
  await tick()
  for (let i = 0; i < 10; i++) {
    runTimers('timeout')
    await tick()
  }
  const times9b = bubble.textContent.split('排查会话响应').length - 1
  check('授权气泡里会话名只出现一次（不会【A】【A】）', times9b === 1, '出现 ' + times9b + ' 次：' + bubble.textContent.slice(0, 80))
  check('授权气泡仍说清了它在等授权', bubble.textContent.includes('正在请求授权'), bubble.textContent.slice(0, 60))
}

// 9c. v1.8.35：一次涌进来 4 条以上的新消息时，被队列截掉的也不能永远不弹
{
  bubble.style.opacity = '0'
  const base9c = Date.now() + 4000
  const mk = (i) => ({ id: 'h' + (200 + i), seq: 200 + i, at: base9c + i, kind: 'turnok', text: '第 ' + i + ' 条测试消息', level: 2 })
  snapshot = {
    ...snapshot,
    unread: 0,
    notices: [],
    approvals: [],
    feed: { pending: [], human: [mk(1), mk(2), mk(3), mk(4), mk(5)], tech: [], techRaw: [], techCount: 0, unread: 0, pendingCount: 0 },
  }
  const seen9c = new Set()
  const grab9c = () => {
    const m = /第 (\d) 条测试消息/.exec(bubble.textContent)
    if (m && bubble.style.opacity === '1') seen9c.add(m[1])
  }
  // 只跑「最新排进来的那一个」定时器：runTimers() 会把历史上所有 timeout 一起跑，
  // 一步就窜到底，中间的几张气泡根本观察不到。
  const runLatestTimeout = () => {
    let best = null
    for (const [id, t] of timers) if (!t.cleared && t.kind === 'timeout' && (!best || id > best[0])) best = [id, t]
    if (!best) return false
    best[1].cleared = true
    best[1].fn()
    return true
  }
  for (let r = 0; r < 40; r++) {
    runTimers('interval')
    await tick()
    grab9c()
    for (let i = 0; i < 2; i++) {
      if (!runLatestTimeout()) break
      await tick()
      grab9c()
    }
  }
  check('一次涌进 5 条消息，5 条都轮得到弹一次', seen9c.size === 5, '弹过：' + Array.from(seen9c).sort().join(','))
}

// 9d. v1.8.35：技术类里「出错了 / 上游不通」要按 P1 提示，不能一律当最不紧急的 P2
{
  bubble.style.opacity = '0'
  const t9d = Date.now() + 6000
  snapshot = {
    ...snapshot,
    unread: 0,
    notices: [],
    approvals: [],
    feed: {
      pending: [],
      human: [],
      tech: [{ kind: 'error', at: t9d, text: '【整理插件的悬浮球】 上下文压缩出错' }],
      techRaw: [],
      techCount: 1,
      unread: 0,
      pendingCount: 0,
    },
  }
  runTimers('interval')
  await tick()
  await tick()
  for (let i = 0; i < 10; i++) {
    runTimers('timeout')
    await tick()
  }
  check('技术类「出错」弹的是「出错了」而不是泛泛的「新消息」', bubble.textContent.includes('出错了'), bubble.textContent.slice(0, 50))
}

// 9e. v1.8.36：所有会响声音的气泡都自动消失（不再需要手点），只是按等级停不同时长
//     P0 10 秒 / P1 6 秒 / P2 3 秒。这里直接看排出去的定时器时长对不对，
//     再把那张「收起」定时器跑掉，确认气泡自己就没了。
{
  const findTimer = (ms) => {
    for (const [id, t] of timers) if (!t.cleared && t.kind === 'timeout' && t.ms === ms) return [id, t]
    return null
  }
  const runTimer = (ms) => {
    const hit = findTimer(ms)
    if (!hit) return false
    hit[1].cleared = true
    hit[1].fn()
    return true
  }
  const showOne = async (kind, level, seq, text) => {
    bubble.style.opacity = '0'
    bubble.textContent = ''
    snapshot = {
      ...snapshot,
      unread: 0,
      notices: [],
      approvals: [],
      feed: {
        pending: kind === 'approval' ? [{ id: 'p' + seq, seq, at: Date.now() + 1000, name: '【会话' + seq + '】', text, level }] : [],
        human: kind === 'approval' ? [] : [{ id: 'h' + seq, seq, at: Date.now() + 1000, kind, text, level }],
        tech: [],
        techRaw: [],
        techCount: 0,
        unread: 0,
        pendingCount: kind === 'approval' ? 1 : 0,
      },
    }
    runTimers('interval')
    await tick()
    await tick()
    // 注意：这里**不能**把 timeout 全跑掉 —— 那会把刚排好的「收起」定时器也跑掉，
    // 气泡直接变透明，就看不到「到点自己收起」之前的样子了。
    return bubble.style.opacity === '1'
  }

  const p0shown = await showOne('approval', 0, 301, '【会话301】 正在请求授权：Bash')
  check('P0（等授权）气泡会弹出来', p0shown, `opacity=${bubble.style.opacity}`)
  check('P0 的停留时长排的是 10 秒', !!findTimer(10000), '没找到 10000ms 的收起定时器')
  check('P0 排了下一条的间隔（10 秒 + 间隔）', !!findTimer(10000 + 1400), '没找到 11400ms 的推进定时器')
  check('P0 到点自己收起，不用手点', runTimer(10000) && bubble.style.opacity === '0', `opacity=${bubble.style.opacity}`)
  runTimer(10000 + 1400) // 放掉队列占位，否则后面的气泡排不进来

  const p1shown = await showOne('longrun', 1, 302, '【会话302】 一轮已经跑了 8 分钟还没结束')
  check('P1（值得留意）气泡会弹出来', p1shown, `opacity=${bubble.style.opacity}`)
  check('P1 的停留时长排的是 6 秒', !!findTimer(6000), '没找到 6000ms 的收起定时器')
  check('P1 到点自己收起', runTimer(6000) && bubble.style.opacity === '0', `opacity=${bubble.style.opacity}`)
  runTimer(6000 + 1400)

  const p2shown = await showOne('turnok', 2, 303, '【会话303】 完成了一轮')
  check('P2（一般消息）气泡会弹出来', p2shown, `opacity=${bubble.style.opacity}`)
  check('P2 的停留时长排的是 3 秒', !!findTimer(3000), '没找到 3000ms 的收起定时器')
  check('P2 到点自己收起', runTimer(3000) && bubble.style.opacity === '0', `opacity=${bubble.style.opacity}`)
  runTimer(3000 + 1400)

  // v1.8.37：「等你回答」提到 P0 —— 5 声 + 停 10 秒，跟「等授权」同一档
  const qAt = audioLog.length
  const qshown = await showOne('question', 0, 304, '【会话304】 正在等你回答：要不要继续')
  check('「等你回答」气泡会弹出来', qshown, `opacity=${bubble.style.opacity}`)
  check('「等你回答」按 P0 走：停 10 秒', !!findTimer(10000), '没找到 10000ms 的收起定时器')
  check(
    '「等你回答」响的是五声那档（alert）',
    audioLog.slice(qAt).includes('alert') && !audioLog.slice(qAt).includes('short'),
    audioLog.slice(qAt).join(',') || '(没响)',
  )
  runTimer(10000)
  runTimer(10000 + 1400)
}

// 10. 事件类型决定标签：level 1 的消息，kind=longrun 要写「跑得有点久」，不能一律按 level 猜成「值得留意」
bubble.style.opacity = '0'
const t10 = Date.now() + 2000
snapshot = {
  ...snapshot,
  unread: 0,
  notices: [],
  approvals: [],
  feed: {
    pending: [],
    human: [
      { id: 'h95', seq: 95, at: t10, kind: 'longrun', text: '【整理插件的悬浮球】 一轮已经跑了 20 分钟还没结束', level: 1 },
    ],
    tech: [],
    techRaw: [],
    techCount: 0,
    unread: 0,
    pendingCount: 0,
  },
}
runTimers('interval')
await tick()
await tick()
for (let i = 0; i < 10; i++) {
  runTimers('timeout')
  await tick()
}
check('kind=longrun 的标签是「跑得有点久」', bubble.textContent.includes('跑得有点久'), bubble.textContent.slice(0, 60))
check('不再一律按 level 猜标签', !bubble.textContent.includes('值得留意'), bubble.textContent.slice(0, 60))

// 11. v1.8.26：不该「每过几秒整块重载」
// 手机自己每访问一次（含全部静态资源）服务端就刷新 deviceList[].lastSeen，
// 以前这个精确到毫秒的时间戳进了 render() 的指纹 → 每几秒指纹变一次 → 整块重建面板 DOM。
// 现在指纹里按分钟取整：同一分钟内的 lastSeen 变化不再触发重画。
if (backNow) el.dispatch('click')
await tick()
const advAt11 = findByText(root, '高级')
if (advAt11) advAt11.dispatch('click')
await tick()
// 基准时间落在一分钟的正中间，+3 秒也不会跨分钟边界（跨了就真该重画，测的就不是这件事了）
const t11 = Math.floor(Date.now() / 60000) * 60000 + 20000
snapshot = {
  ...snapshot,
  deviceList: [{ id: 'd1', label: 'iPhone', note: 'isis', trusted: true, lastSeen: t11, remembered: true }],
  feed: { pending: [], human: [], tech: [], techRaw: [], techCount: 0, unread: 0, pendingCount: 0 },
}
runTimers('interval')
await tick()
await tick()
const bodyNode = findByClass(root, 'dmp-body')[0]
const firstRow = bodyNode && bodyNode.children[0]
check('高级页能显示出设备行', !!bodyNode && allText(bodyNode).includes('isis（iPhone）'), bodyNode && allText(bodyNode).slice(0, 60))

// 只把 lastSeen 往后推 3 秒（同一分钟内）：不该重画
snapshot = {
  ...snapshot,
  deviceList: [{ id: 'd1', label: 'iPhone', note: 'isis', trusted: true, lastSeen: t11 + 3000, remembered: true }],
}
runTimers('interval')
await tick()
await tick()
check(
  '同一分钟内 lastSeen 变化不重建面板 DOM',
  bodyNode.children[0] === firstRow,
  bodyNode.children[0] === firstRow ? '同一个节点' : '被重建了',
)

// 控制组：真正影响画面的字段变了（备注改了）必须重画
snapshot = {
  ...snapshot,
  deviceList: [{ id: 'd1', label: 'iPhone', note: 'isis 改过备注', trusted: true, lastSeen: t11 + 3000, remembered: true }],
}
runTimers('interval')
await tick()
await tick()
check('备注变了才重画', bodyNode.children[0] !== firstRow && allText(bodyNode).includes('isis 改过备注'), allText(bodyNode).slice(0, 60))

// 12. v1.8.27：往下翻着看消息时，来新消息不能跳回第一行
// 原来 render() 是 body.textContent='' 再重建，新节点 scrollTop 天然为 0 → 每次刷新都跳顶。
{
  const feedTab12 = findByText(root, '消息/日志')
  if (feedTab12) feedTab12.dispatch('click')
  await tick()
  const t12 = Date.now()
  snapshot = {
    ...snapshot,
    feed: {
      pending: [],
      human: [
        { id: 'h1', seq: 101, at: t12, kind: 'longrun', text: '【A】第一行', level: 1 },
        { id: 'h2', seq: 102, at: t12 - 1000, kind: 'longrun', text: '【B】第二行', level: 1 },
        { id: 'h3', seq: 103, at: t12 - 2000, kind: 'longrun', text: '【C】第三行', level: 1 },
      ],
      tech: [],
      techRaw: [],
      techCount: 0,
      unread: 0,
      pendingCount: 0,
    },
  }
  runTimers('interval')
  await tick()
  await tick()
  const fb = findByClass(root, 'feed')[0]
  check('消息页有 .feed 滚动容器', !!fb, fb && fb.className)
  // 假装用户往下滚了 180px
  if (fb) fb.scrollTop = 180
  // 来一条新消息（会触发整块重画）
  snapshot = {
    ...snapshot,
    feed: {
      ...snapshot.feed,
      human: [
        { id: 'h0', seq: 100, at: t12 + 5000, kind: 'longrun', text: '【新】刚到的一条', level: 1 },
        ...snapshot.feed.human,
      ],
    },
  }
  runTimers('interval')
  await tick()
  await tick()
  const fb2 = findByClass(root, 'feed')[0]
  check('来新消息后滚动位置还在（不跳回第一行）', !!fb2 && fb2.scrollTop === 180, fb2 && `scrollTop=${fb2.scrollTop}`)
  check('新消息确实渲染出来了', !!fb2 && allText(fb2).includes('刚到的一条'), fb2 && allText(fb2).slice(0, 40))
}

// 15. v1.8.31：高级页「已配对设备」下面的一键清空按钮
// 第一次点只变成「确认清除全部（N 台）」，4 秒内再点才真的 POST removeAll。
// 放在第 13/14 组之前：那两组会把 widget 切进「手机端只读模式」，
// 之后 refresh() 只走 /__myphone/state，管理口的 device 请求就再也发不出去了。
{
  snapshot = {
    ...snapshot,
    deviceList: [
      { id: 'd1', label: 'iPhone', note: 'isis', trusted: true, lastSeen: t11, remembered: true },
      { id: 'd2', label: 'iPad', note: '', trusted: false, lastSeen: t11, remembered: true },
    ],
  }
  runTimers('interval')
  await tick()
  await tick()
  el.dispatch('click')
  await tick()
  const advTab15 = findByText(root, '高级')
  if (advTab15) advTab15.dispatch('click')
  await tick()
  // 注意：findByText() 会先命中包着按钮的 div（div 的 textContent 也是这几个字），
  // 但它没有监听器，点上去什么都不会发生 —— 这里必须拿到真正的 <button>。
  function findButtonByText(text) {
    const walk = (n) => {
      if (!n || typeof n !== 'object') return null
      if (String(n.tagName || '').toUpperCase() === 'BUTTON' && String(n.textContent || '').trim() === text) return n
      for (const k of n.children || []) {
        const hit = walk(k)
        if (hit) return hit
      }
      return null
    }
    return walk(root)
  }
  const wipeBtn = findButtonByText('删除所有设备凭证')
  check('已配对设备下面有「删除所有设备凭证」按钮', !!wipeBtn)
  const postsBefore = fetchCalls.filter((c) => c.url.includes('/__myphone/panel/device')).length
  if (wipeBtn) wipeBtn.dispatch('click')
  await tick()
  const armedText = allText(root)
  check('点一次只是二次确认（不立刻删）', armedText.includes('确认清除全部'), armedText.slice(-120))
  check('二次确认文案里带设备台数', armedText.includes('确认清除全部（2 台）'), '')
  check('第一下没有发 removeAll 请求', fetchCalls.filter((c) => c.url.includes('/__myphone/panel/device')).length === postsBefore, '')
  const armedBtn = findButtonByText('确认清除全部（2 台）')
  if (armedBtn) armedBtn.dispatch('click')
  await tick()
  await tick()
  const devPosts = fetchCalls.filter((c) => c.url.includes('/__myphone/panel/device'))
  check(
    '再点一次才真的发 removeAll',
    devPosts.length > postsBefore && String(devPosts[devPosts.length - 1].opts.body).includes('removeAll'),
    String(devPosts[devPosts.length - 1] && devPosts[devPosts.length - 1].opts.body),
  )
  const back15 = findByClass(root, 'dmp-back')[0]
  if (back15) back15.dispatch('click')
  await tick()
}

// 13. v1.8.33：连接页改成两张二维码卡片（局域网 / 外出），可点切换，文案按侧不同
{
  panelIs404 = false
  remoteSnapshot = null
  const fakeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><rect width="21" height="21" fill="#fff"/></svg>'
  snapshot = {
    lanEnabled: true,
    tunnelEnabled: true,
    lanUrl: 'http://192.168.1.107:18391/',
    pairUrl: 'https://strict-women.trycloudflare.com/pair?t=abc',
    lanPairUrl: 'http://192.168.1.107:18391/pair?t=abc',
    lanAvailable: true,
    qrSvg: fakeSvg,
    qrSvgLan: fakeSvg,
    ticketExpiresAt: Date.now() + 165000,
    tunnelAutoOffMinutes: 0,
    mutedUntil: 0,
    unread: 0,
    deviceList: [],
    notices: [],
    approvals: [],
    events: [],
    feed: { pending: [], human: [], tech: [], techRaw: [], techCount: 0, unread: 0, pendingCount: 0 },
  }
  runTimers('interval')
  await tick()
  await tick()
  el.dispatch('click')
  await tick()
  const connTab18 = findByText(root, '连接')
  if (connTab18) connTab18.dispatch('click')
  await tick()
  const t18a = allText(root)
  check('连接页有「局域网连接 / 外出连接」两个切换按钮', t18a.includes('局域网连接') && t18a.includes('外出连接'), t18a.slice(0, 60))
  check('主文案改成「相机或浏览器扫码连接 DSH 桌面版」', t18a.includes('相机或浏览器扫码连接 DSH 桌面版'))
  check('旧主文案「扫码连接 DeepSeek Harness 桌面版」已去掉', !t18a.includes('扫码连接 DeepSeek Harness 桌面版'))
  check('默认给局域网卡片，并写明只有同一网络才能连', t18a.includes('只有手机和电脑在同一个网络才能连接'), t18a.slice(0, 120))
  check('卡片下面带 m:ss 后失效倒计时', /\d+:\d\d 后失效/.test(t18a), t18a.match(/\d+:\d\d 后失效/)?.[0] || '')
  const sw18 = findByClass(root, 'dmp-qrsw')[0]
  check('二维码卡片区可点切换', !!sw18 && (sw18.className || '').includes('switchable'), sw18 && sw18.className)
  if (sw18) sw18.dispatch('click')
  await tick()
  const t18b = allText(root)
  check('切到外出后文案变成「任何时间都能连接」', t18b.includes('任何时间都能连接'), t18b.slice(0, 140))
  // v1.8.34：切换条是「选中实心」的页签样式，当前那张一眼能看出来
  const seg18 = findByClass(root, 'side')
  const onBtn18 = seg18[0] && seg18[0].children.find((c) => (c.className || '').includes('on'))
  check('切换条有选中态（.on 落在当前那张上）', !!onBtn18 && onBtn18.textContent === '外出连接', onBtn18 && onBtn18.textContent)
  // v1.8.34：只开一个连接时不该出切换条
  snapshot = { ...snapshot, tunnelEnabled: false }
  runTimers('interval')
  await tick()
  await tick()
  const t18c = allText(root)
  check('只开局域网时不出切换条', !t18c.includes('外出连接'), t18c.slice(0, 80))
  // v1.8.34：两个都关 → 提示去高级页打开
  snapshot = { ...snapshot, lanEnabled: false, tunnelEnabled: false }
  runTimers('interval')
  await tick()
  await tick()
  const t18d = allText(root)
  check('两个连接都关时提示去高级页打开', t18d.includes('两个连接都关着') && t18d.includes('去高级页打开'), t18d.slice(0, 100))
  const back18 = findByClass(root, 'dmp-back')[0]
  if (back18) back18.dispatch('click')
  await tick()
}

// 14. v1.8.27：手机上不再每轮先撞一次管理口的 404
{
  panelIs404 = true
  remoteSnapshot = {
    ok: true,
    device: { id: 'd1', label: 'iPhone', note: 'isis', trusted: true, lastSeen: Date.now() },
    devices: 1,
    lanEnabled: true,
    tunnelEnabled: false,
    feed: { pending: [], human: [], tech: [], techRaw: [], techCount: 0, unread: 0, pendingCount: 0 },
    events: [],
    approvals: [],
    alerts: [],
  }
  // 先让它吃一次 404、转进只读模式
  runTimers('interval')
  await tick()
  await tick()
  const afterFirst = fetchCalls.length
  const firstHadState = fetchCalls.slice(-3).some((c) => c.url.includes('/__myphone/state'))
  check('手机上第一次会退到只读快照 /__myphone/state', firstHadState, fetchCalls.slice(-3).map((c) => c.url).join(' , '))
  // 第二轮开始：不该再打 /__myphone/panel
  fetchCalls.length = 0
  runTimers('interval')
  await tick()
  await tick()
  const secondRound = fetchCalls.map((c) => c.url).join(' , ')
  check('进入只读模式后不再白跑一次管理口 404', fetchCalls.length > 0 && !fetchCalls.some((c) => c.url.includes('/__myphone/panel')), secondRound || '(无请求)')
  check('第二轮直达 /__myphone/state', fetchCalls.some((c) => c.url.includes('/__myphone/state')), secondRound || '(无请求)')
  panelIs404 = false
}

// 14. v1.8.29：手机端（只读快照）也要能清掉红点与 NEW
// 原来三处写死 `data`：unreadCount() 直接 `if (!data) return 0`（手机红点恒 0）、
// markFeedSeen() 只 post('read') 打到 /__myphone/panel/read（那头只认回环地址 → 手机必 404）、
// close() 又不落已读 —— 于是「NEW 和红点消不掉」。
{
  const t14 = Date.now()
  remoteSnapshot = {
    ok: true,
    device: { id: 'd1', label: 'iPhone', note: 'isis', trusted: true, lastSeen: t14 },
    devices: 1,
    lanEnabled: true,
    tunnelEnabled: false,
    feed: {
      pending: [{ id: 'a9', seq: 9, at: t14, text: '要不要删掉 dist/', name: '重建产物', level: 0 }],
      human: [{ id: 'h9', seq: 109, at: t14, kind: 'longrun', text: '【手机端】刚到的一条', level: 1 }],
      tech: [],
      techRaw: [],
      techCount: 0,
      unread: 3,
      pendingCount: 3,
    },
    unread: 3,
    pendingCount: 3,
    events: [],
    approvals: [],
    alerts: [],
  }
  runTimers('interval')
  await tick()
  await tick()
  const dot14 = el.children.find((c) => (c.className || '').includes('dmp-w-dot'))
  check(
    '手机端红点跟着只读快照的未读亮起（不带数字）',
    !!dot14 && dot14.style.display === 'block' && !dot14.textContent,
    `display=${dot14 && dot14.style.display} text=${dot14 && dot14.textContent}`,
  )
  // 打开面板 → 进「消息/日志」→ 直接点返回关掉（用户的正常路径）
  el.dispatch('click')
  await tick()
  const feedTab14 = findByText(root, '消息/日志')
  check('手机端也有「消息/日志」页签', !!feedTab14)
  if (feedTab14) feedTab14.dispatch('click')
  await tick()
  const feedText14 = allText(findByClass(root, 'feed')[0] || root)
  check(
    '手机端消息列表走同一套信笺卡片（有事件标签）',
    feedText14.includes('刚到的一条') && feedText14.includes('跑得有点久'),
    feedText14.slice(0, 60),
  )
  check('手机端新消息带 NEW', findByClass(root, 'new').length > 0, String(findByClass(root, 'new').length))
  const ackBefore = fetchCalls.filter((c) => c.url.includes('/__myphone/ack')).length
  const back14 = findByClass(root, 'dmp-back')[0]
  if (back14) back14.dispatch('click')
  await tick()
  const ackCalls = fetchCalls.filter((c) => c.url.includes('/__myphone/ack'))
  check(
    '关面板时手机端走 /__myphone/ack 标已读（不再白撞 /panel/read）',
    ackCalls.length > ackBefore && String(ackCalls[ackCalls.length - 1].opts && ackCalls[ackCalls.length - 1].opts.body).includes('read'),
    fetchCalls.slice(-2).map((c) => c.url).join(' , '),
  )
  check('关面板时本地也记了已读时间', Boolean(storage.get('dsh-my-phone.feedSeen.v1')))
  // 已读之后 NEW 不该再冒出来
  runTimers('interval')
  await tick()
  await tick()
  el.dispatch('click')
  await tick()
  const feedTab14b = findByText(root, '消息/日志')
  if (feedTab14b) feedTab14b.dispatch('click')
  await tick()
  check('标过已读后 NEW 消失', findByClass(root, 'new').length === 0, String(findByClass(root, 'new').length))
  const back14b = findByClass(root, 'dmp-back')[0]
  if (back14b) back14b.dispatch('click')
  await tick()
  panelIs404 = false
}

// 16. v1.8.32：手机端「高级」页不放消息，改成能操作的音效设置；「消息/日志」页补排查日志
{
  panelIs404 = true
  const t16 = Date.now()
  remoteSnapshot = {
    ok: true,
    device: { id: 'd1', label: 'iPhone', note: 'isis', trusted: true, lastSeen: t16 },
    devices: 1,
    lanEnabled: true,
    tunnelEnabled: false,
    feed: {
      pending: [],
      human: [{ id: 'h16', seq: 216, at: t16, kind: 'longrun', text: '【手机端】一条消息', level: 2 }],
      tech: [],
      techRaw: [],
      techCount: 0,
      unread: 0,
      pendingCount: 0,
    },
    unread: 0,
    pendingCount: 0,
    events: [
      { kind: 'boot', text: '插件已启动', at: t16, seq: 1 },
      { kind: 'lan', text: '局域网监听 8089', at: t16 + 1, seq: 2 },
    ],
    approvals: [],
    alerts: [],
  }
  runTimers('interval')
  await tick()
  await tick()
  el.dispatch('click')
  await tick()
  // 高级页
  const advTab16 = findByText(root, '高级')
  if (advTab16) advTab16.dispatch('click')
  await tick()
  const advText16 = allText(root)
  check('手机端高级页有音效三档开关', advText16.includes('滑入滑出音') && advText16.includes('点击音') && advText16.includes('气泡音'), '')
  check('手机端高级页有音色与音量', advText16.includes('音色') && advText16.includes('音量'), '')
  check('手机端高级页不再堆「消息」标题', !advText16.includes('暂时没有新消息'), '')
  // 音效开关真的能操作：点「点击音」应写入本地偏好
  storage.delete('dsh-my-phone.sound.v2')
  const clickSoundBtn = (function () {
    const walk = (n) => {
      if (!n || typeof n !== 'object') return null
      if (String(n.tagName || '').toUpperCase() === 'BUTTON' && String(n.textContent || '').trim() === '点击音') return n
      for (const k of n.children || []) {
        const hit = walk(k)
        if (hit) return hit
      }
      return null
    }
    return walk(root)
  })()
  check('手机端能点到「点击音」按钮', !!clickSoundBtn)
  if (clickSoundBtn) clickSoundBtn.dispatch('click')
  await tick()
  const soundSaved = storage.get('dsh-my-phone.sound.v2')
  check('点一下音效开关会写进本地偏好（手机端可操作）', !!soundSaved && String(soundSaved).includes('click'), String(soundSaved))
  // 消息/日志 页
  const feedTab16 = findByText(root, '消息/日志')
  if (feedTab16) feedTab16.dispatch('click')
  await tick()
  const feedText16 = allText(root)
  check('手机端「消息/日志」页也有排查日志', feedText16.includes('排查日志'), '')
  const back16 = findByClass(root, 'dmp-back')[0]
  if (back16) back16.dispatch('click')
  await tick()
  panelIs404 = false
}

// 17. v1.8.32：球一开始透明，等第一帧快照到了才显形（不再「logo 比连上桌面还早」）
{
  check('球最终是显形的（第一帧快照后淡入）', el.style.opacity === '1', 'opacity=' + el.style.opacity)
}

// 18. v1.8.38：红点只算「没看的 P0/P1」、气泡里会话名只说一次、三级配色要拉开
{
  panelIs404 = false
  remoteSnapshot = null
  // 直接喂 SSE 帧：它会走 data = json → paint() → autoBubble() 这条真实链路
  const push = (feed) => {
    const snap = {
      lanEnabled: true,
      tunnelEnabled: false,
      lanUrl: 'http://192.168.1.107:18391/',
      pairUrl: 'http://192.168.1.107:18391/pair?t=abc',
      ticketExpiresAt: Date.now() + 120000,
      tunnelAutoOffMinutes: 0,
      mutedUntil: 0,
      unread: 0,
      deviceList: [],
      notices: [],
      approvals: [],
      events: [],
      feed,
    }
    FakeEventSource.last.onmessage({ data: JSON.stringify(snap) })
  }
  const feedObj = (human, pending = []) => ({
    pending,
    human,
    tech: [],
    techRaw: [],
    techCount: 0,
    unread: 0,
    pendingCount: pending.length,
  })
  const dotOf = () => el.children.filter((c) => (c.className || '').includes('dmp-w-dot'))
  // 比任何已读时间都新，保证被算成「没看」
  const far = Date.now() + 86400000

  // 18a. 只有 P2 未读 —— 红点不亮（P2 是「一轮完成」这类，不值得喊人）
  push(feedObj([{ id: 'q2', seq: 401, at: far, kind: 'turnok', text: '【某会话】一轮完成', level: 2 }]))
  const dotA = dotOf()
  check('只有 P2 未读时红点不亮', dotA.length > 0 && dotA.every((d) => d.style.display === 'none'), (dotA[0] || {}).style && dotA[0].style.display)

  // 18b. 有一条 P1 未读 —— 红点亮
  push(
    feedObj([
      { id: 'q2', seq: 401, at: far, kind: 'turnok', text: '【某会话】一轮完成', level: 2 },
      { id: 'q1', seq: 402, at: far, kind: 'retry', text: '【某个会话正在重试】正在重试（第 2 次）', level: 1 },
    ]),
  )
  const dotB = dotOf()
  check('有一条 P1 未读时红点亮', dotB.length > 0 && dotB.every((d) => d.style.display === 'block'), (dotB[0] || {}).style && dotB[0].style.display)

  // 18c. 气泡正文里会话名只说一次（gate 的文案自带【名】，前端不能再补一遍）
  push(feedObj([], [{ id: 'a18', seq: 903, at: Date.now(), text: '【重建产物】 正在请求授权…', name: '重建产物', level: 0 }]))
  // 放掉上一次气泡占着的名额（bubbleBusy 是靠一个 timeout 释放的），多转两轮
  for (let i = 0; i < 4; i += 1) {
    runTimers('timeout')
    await tick()
  }
  const bub18 = bubble.textContent || ''
  const nameHits = bub18.split('重建产物').length - 1
  check('气泡里会话名只出现一次', nameHits === 1, `${nameHits} 次：${bub18.slice(0, 70)}`)

  // 18d. 三级卡片配色：P2 走灰、P0/P1 各自一色，源码里的 CSS 要两两不同
  const css = fs.readFileSync(new URL('../src/widget.js', import.meta.url), 'utf8')
  const grab = (sel) => {
    const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'))
    return m ? m[1] : ''
  }
  const bgOf = (lv) => (grab('.it.p' + lv).match(/background:([^;]+)/) || [])[1] || ''
  const b0 = bgOf(0)
  const b1 = bgOf(1)
  const b2 = bgOf(2)
  check('P0/P1/P2 三种卡片底色两两不同', Boolean(b0 && b1 && b2) && b0 !== b1 && b1 !== b2 && b0 !== b2, `${b0} / ${b1} / ${b2}`)
  // P2 是灰的：hex 里 R/G/B 三通道差得不多
  const hex = (b2.match(/#([0-9a-fA-F]{6})/) || [])[1] || ''
  const ch = hex ? [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) : []
  check('P2 卡片是灰调（三通道接近）', ch.length === 3 && Math.max(...ch) - Math.min(...ch) <= 24, `${b2} → ${ch.join(',')}`)
}

// 19. v1.8.39：声音跟着「消息」走 —— 气泡被压住、队列忙的时候也必须响
{
  panelIs404 = false
  remoteSnapshot = null
  const push19 = (feed) => {
    const snap = {
      lanEnabled: true,
      tunnelEnabled: false,
      lanUrl: 'http://192.168.1.107:18391/',
      pairUrl: 'http://192.168.1.107:18391/pair?t=abc',
      ticketExpiresAt: Date.now() + 120000,
      tunnelAutoOffMinutes: 0,
      mutedUntil: 0,
      unread: 0,
      deviceList: [],
      notices: [],
      approvals: [],
      events: [],
      feed,
    }
    FakeEventSource.last.onmessage({ data: JSON.stringify(snap) })
  }
  const feed19 = (human, pending = []) => ({
    pending,
    human,
    tech: [],
    techRaw: [],
    techCount: 0,
    unread: 0,
    pendingCount: pending.length,
  })

  // 19a. 上一条气泡还占着名额（bubbleBusy 为 true）时又来一条 —— 老版本要等上一条走完才响
  const a0 = audioLog.length
  const m1 = { id: 's1', seq: 501, at: Date.now(), kind: 'turnok', text: '【甲会话】一轮完成', level: 2 }
  const m2 = { id: 's2', seq: 502, at: Date.now(), kind: 'turnok', text: '【乙会话】一轮完成', level: 2 }
  push19(feed19([m1]))
  push19(feed19([m2, m1]))
  const got19a = audioLog.slice(a0)
  check('气泡被占着时新消息也立刻响（不等队列）', got19a.length === 2 && got19a.every((x) => x === 'short'), JSON.stringify(got19a))

  // 19b. 同一条消息反复收到快照，不能重复响
  const b0 = audioLog.length
  push19(feed19([m2, m1]))
  push19(feed19([m2, m1]))
  check('同一条消息反复收到快照不会重复响', audioLog.length === b0, JSON.stringify(audioLog.slice(b0)))

  // 19c. 面板开着时气泡会被压住不发，但声音照响
  const opened = (() => {
    el.dispatch('click')
    const r = document.getElementById('dmp-panel')
    return Boolean(r && r.style.display === 'flex')
  })()
  const c0 = audioLog.length
  push19(feed19([{ id: 's3', seq: 503, at: Date.now(), kind: 'retry', text: '【丙会话】正在重试（第 2 次）', level: 1 }], []))
  check('面板开着时新消息照样响', opened && audioLog.slice(c0).includes('notice'), JSON.stringify(audioLog.slice(c0)))

  // 19d. 一批补进一屏历史：只响一次 —— 以前每条各响一次，一轮收尾的
  //      「跑得有点久」(P1 三声) + 「完成了一轮」(P2 一声) 叠成五声连响
  const d0 = audioLog.length
  const many = []
  for (let i = 0; i < 6; i += 1) many.push({ id: 'h' + i, seq: 600 + i, at: Date.now(), kind: 'turnok', text: `【会话${i}】一轮完成`, level: 2 })
  push19(feed19(many))
  const got19d = audioLog.slice(d0)
  check('一批涌进多条时只响一次', got19d.length === 1, JSON.stringify(got19d))

  // 19d2. 同一批里混着 P1 和 P2：只响一声，而且是 P1 那声（最该被听见的）
  const d20 = audioLog.length
  push19(feed19([
    { id: 'x1', seq: 701, at: Date.now(), kind: 'longrun', text: '【丁会话】一轮已经跑了 5 分钟还没结束', level: 1 },
    { id: 'x2', seq: 702, at: Date.now(), kind: 'turnok', text: '【丁会话】完成了一轮', level: 2 },
    { id: 'x3', seq: 703, at: Date.now(), kind: 'ctx', text: '【丁会话】的上下文已用 96%', level: 2 },
  ]))
  const got19d2 = audioLog.slice(d20)
  check('一批里混着 P1/P2 时只响最紧急的那一声', got19d2.length === 1 && got19d2[0] === 'notice', JSON.stringify(got19d2))
  // 19e. 点文档任何地方都算「用户手势」—— 以前只在球和面板上绑，没点过球的时候音频一直是哑的
  const e0 = audioLog.length
  document.dispatch('pointerdown')
  check('点页面任意位置就能解锁音频', audioLog.slice(e0).includes('unlock'), JSON.stringify(audioLog.slice(e0)))
  const e1 = audioLog.length
  document.dispatch('pointerdown')
  check('解锁过一次就不再重复绑（第二次不再触发）', !audioLog.slice(e1).includes('unlock'), JSON.stringify(audioLog.slice(e1)))
}

console.log(`\n${pass}/${total} 通过`)
if (pass !== total) process.exitCode = 1
