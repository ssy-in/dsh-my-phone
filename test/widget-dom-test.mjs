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
  el.querySelector = () => null
  el.querySelectorAll = () => []
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
  addEventListener: () => {},
  removeEventListener: () => {},
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
const fetchShim = (url, opts) => {
  fetchCalls.push({ url: String(url), opts })
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
check('气泡有尖角元素', bubble.children.some((c) => c && c.tagName === 'SPAN'))
const bubbleText = bubble.textContent
check('气泡里是那条授权而不是兜底文案', bubbleText.includes('重建产物') && !bubbleText.includes('点一下 · 手机扫码连 DSH'), bubbleText.slice(0, 60))

// 3. 红点跟着 pendingCount 走
const dot = el.children.find((c) => (c.className || '').includes('dmp-w-dot'))
check('红点显示待处理数 1', !!dot && dot.style.display === 'flex' && dot.textContent === '1', `display=${dot && dot.style.display} text=${dot && dot.textContent}`)

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
  if (!node || typeof node !== 'object') return ''
  let s = node.children && node.children.length ? '' : node.textContent || ''
  for (const k of node.children || []) s += typeof k === 'string' ? k : allText(k)
  return s
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
    tech: [{ kind: 'tool', count: 2, at: Date.now(), text: '(无标题会话) 正在用 Read' }],
    techRaw: [],
    techCount: 1,
    unread: 1,
    pendingCount: 0,
  },
}
runTimers('interval') // 6 秒轮询那条
await tick()
await tick()

const advTab = findByText(root, '高级')
check('面板里有「高级」标签页', !!advTab)
if (advTab) advTab.dispatch('click')
await tick()

const panelText = allText(root)
check('消息列表列出了新连接', panelText.includes('IS（iPhone）刚连进来'), panelText.slice(0, 80))
check('「正在用 Read」也能看见', panelText.includes('正在用 Read'))
check('技术动态只是列出来，不弹气泡', bubble.style.opacity === '0' || !bubble.textContent.includes('正在用 Read'))

console.log(`\n${pass}/${total} 通过`)
if (pass !== total) process.exitCode = 1
