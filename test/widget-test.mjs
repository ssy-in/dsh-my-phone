// v1.5.0 的两条硬约束：
//  1. 弹窗必须由 widget.js（纯 DOM）提供 —— 静态检查关键标记，防止以后又搬回 React；
//  2. 管理口必须挡住 DNS rebinding（Host / Origin 不是回环就直接 403）。
import fs from 'node:fs'
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

// ---------- 1. 静态：纯 DOM 弹窗 ----------
const src = fs.readFileSync(new URL('../src/widget.js', import.meta.url), 'utf8')
check('widget.js 自带弹窗创建函数', src.includes('function createPanel()'))
check('弹窗容器与样式都在 widget.js 里', src.includes("id: 'dmp-panel'") && src.includes('#dmp-panel .dmp-card'))
// v1.8.32：桌面 121，手机端再缩 40%（73）。断言两个常量都在，别写死只认 121。
check('球尺寸（桌面 121 / 手机 73）', /var TILE = IS_MOBILE \? 73 : 121/.test(src))
check('悬停气泡仍在纯 DOM 里', src.includes('dmp-w-bubble'))
check('不再用 window.open 兜底（Electron 会拦）', !src.includes("window.open('/__myphone/'"))
check(
  'React 先接管时不会叠两套面板',
  src.includes('window.__dshMyPhoneOpened') && src.includes('if (window.__dshMyPhoneOpened) return'),
)
check('纯 DOM 球就位后让 React 球让位（dmp-widget-on）', src.includes("classList.add('dmp-widget-on')"))
check(
  '连接页文案与「生成二维码」按钮在 DOM 版里',
  src.includes('相机或浏览器扫码连接 DSH 桌面版') && src.includes('生成二维码') && !src.includes('扫码连接 DeepSeek Harness 桌面版'),
)

const audioSrc = fs.readFileSync(new URL('../src/audio.js', import.meta.url), 'utf8')
check('音效引擎已抽成独立脚本', audioSrc.includes('window.__dshMyPhoneAudio') && audioSrc.includes('setVolume('))
check('音效引擎带三档事件音', /alert\(\)/.test(audioSrc) && /notice\(\)/.test(audioSrc) && /short\(\)/.test(audioSrc))
check('widget 会去拉 audio.js', src.includes("'/__myphone/audio.js'"))
check('默认位置：右上角、往下让一个图标高', src.includes('function defaultAnchor()') && src.includes('H * 1.5'))
check('手机退到只读快照', src.includes("'/__myphone/state'") && src.includes('手机上是只读视图'))
check('音效设置（开关/音量/音色）在 DOM 面板里', src.includes('function soundRows()') && src.includes("SOUND_KEY = 'dsh-my-phone.sound.v2'"))

// ---------- 1b. 回归：气泡定位函数与 feed 形状（v1.8.19） ----------
check('气泡定位函数 placeBubble 有定义', /function placeBubble\s*\(/.test(src))
check(
  '气泡状态变量都有声明（否则 showBubble 一跑就 ReferenceError）',
  /var bubbleSig\s*=/.test(src) && /var bubbleSide\s*=/.test(src) && /var bubbleTail\s*=/.test(src),
)
check('气泡尖角随球左右换边', src.includes('bubbleSide = ') && src.includes('bubbleTail'))
check('把对象形状的 feed 摊平（feedItems）', /function feedItems\s*\(/.test(src))
const feedReads = src
  .split('\n')
  .filter((line) => !/^\s*(?:\*|\/\/)/.test(line)) // 注释里提到旧写法不算
  .filter((line) => /Array\.isArray\(\s*(?:data|d)\.feed\s*\)/.test(line))
check('不再把 data.feed 当数组读（代码里只剩 feedItems 一处兼容分支）', feedReads.length === 0, feedReads.join(' | '))
check('feed 的消费方都走 feedItems()', (src.match(/feedItems\(\)/g) || []).length >= 4)

// ---------- 2. 运行时：管理口 Host / Origin 白名单 ----------
const PORT = 18097
const state = {
  settings: { lanEnabled: false, tunnelEnabled: false, lanPort: PORT, publicPort: 0, autoOffMinutes: 0 },
  devices: [],
  patchSettings(patch) {
    Object.assign(state.settings, patch)
    return state.settings
  },
}
const gate = createGate({
  state,
  session: null,
  log: { info() {}, warn() {}, error() {}, debug() {} },
  getAddresses: () => [`http://127.0.0.1:${PORT}/`],
})
await gate.startAdmin(PORT)
await new Promise((r) => setTimeout(r, 120))

const req = async (headers) => {
  const res = await fetch(`http://127.0.0.1:${PORT}/__myphone/`, { headers })
  return { status: res.status, body: await res.text() }
}

const ok = await req({ host: `127.0.0.1:${PORT}` })
check('本机直连管理页照常 200', ok.status === 200, `HTTP ${ok.status}`)

const localhost = await req({ host: `localhost:${PORT}` })
check('localhost 也放行', localhost.status === 200, `HTTP ${localhost.status}`)

const rebinding = await req({ host: `evil.example.com:${PORT}` })
check('非回环 Host（DNS rebinding）→ 403', rebinding.status === 403, `HTTP ${rebinding.status}`)

const badOrigin = await req({ host: `127.0.0.1:${PORT}`, origin: 'https://evil.example.com' })
check('同源校验：跨站 Origin → 403', badOrigin.status === 403, `HTTP ${badOrigin.status}`)

const goodOrigin = await req({ host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}` })
check('同源 Origin → 放行', goodOrigin.status === 200, `HTTP ${goodOrigin.status}`)

await gate.close()
console.log(`\n${pass}/${pass + fail} 通过`)
if (fail) process.exit(1)
