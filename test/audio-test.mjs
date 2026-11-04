// 音效引擎的「几声」规则（纯逻辑，不开端口、不出声）
// v1.8.38：用户要「P2 的两声改一声响」—— 普通消息最频繁，两声听着像有急事。
// 这里用假 AudioContext 真跑一遍 src/audio.js，数它到底排了几个振荡器：
// 卡林巴（默认音色）每个音 5 个泛音 → 5 个振荡器，所以「几声」= 振荡器数 / 5。
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

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

const root = path.dirname(fileURLToPath(import.meta.url))
const code = fs.readFileSync(path.join(root, '..', 'src', 'audio.js'), 'utf8')

let starts = []
let freqs = []
const param = () => ({
  setValueAtTime(v) {
    if (typeof v === 'number') freqs.push(v)
  },
  exponentialRampToValueAtTime() {},
  linearRampToValueAtTime() {},
  setTargetAtTime() {},
  cancelScheduledValues() {},
})
const node = () => ({
  connect(x) {
    return x
  },
  disconnect() {},
  start() {
    starts.push(1)
  },
  stop() {},
  frequency: param(),
  gain: param(),
  Q: param(),
  detune: param(),
  type: '',
  buffer: null,
})
class FakeCtx {
  constructor() {
    this.currentTime = 0
    this.sampleRate = 48000
    this.state = 'running'
    this.destination = node()
  }
  resume() {
    this.state = 'running'
    return Promise.resolve()
  }
  createGain() {
    return node()
  }
  createOscillator() {
    return node()
  }
  createBiquadFilter() {
    return node()
  }
  createBufferSource() {
    return node()
  }
  createBuffer(ch, len) {
    return { getChannelData: () => new Float32Array(len) }
  }
}
const store = {}
const win = {
  AudioContext: FakeCtx,
  localStorage: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v)
    },
  },
}
// one() 里有 45ms 节流（飞快划过时不叠加），测试里连着调会被吞掉，
// 所以注入一个「每次问时间都往前走 100ms」的假 Date。
let clock = 1760000000000
const FakeDate = { now: () => (clock += 100) }
new Function('window', 'Date', code)(win, FakeDate) // eslint-disable-line no-new-func
const e = win.__dshMyPhoneAudio
check('引擎挂到了 window.__dshMyPhoneAudio', Boolean(e) && typeof e.short === 'function')

const run = (fn) => {
  starts = []
  freqs = []
  fn()
  return { n: starts.length, freqs: freqs.slice() }
}
const a = run(() => e.alert())
const no = run(() => e.notice())
const s = run(() => e.short())

// 卡林巴一个音 3 个泛音振荡器（tink() 里的 partials）
const PARTIALS = 3
check('P0（alert）是 5 声', a.n === 5 * PARTIALS, `振荡器 ${a.n} 个 = ${a.n / PARTIALS} 声`)
check('P1（notice）是 3 声', no.n === 3 * PARTIALS, `振荡器 ${no.n} 个 = ${no.n / PARTIALS} 声`)
check('P2（short）是 1 声（v1.8.38 从两声改一声）', s.n === PARTIALS, `振荡器 ${s.n} 个 = ${s.n / PARTIALS} 声`)
check('P2 那一声是 A5（880Hz）', s.freqs.includes(880), String(s.freqs.slice(0, 6)))
check('P2 不再带 E5（原来两声里的第一声）', !s.freqs.includes(659.25), String(s.freqs.slice(0, 6)))
check('P2 比 P1 短', s.n < no.n && no.n < a.n, `${s.n} < ${no.n} < ${a.n}`)

// 马林巴删了（v1.8.37）：源码里不该再出现
check('音色里没有马林巴了', !/marimba/.test(code), code.includes('marimba') ? '还有 marimba' : '')

// 非气泡音都只有一声。press 带木槌（wood=1），会多一个高频振荡器当「哒」，
// 所以它是 PARTIALS + 1 个，仍然是「一个音」。
for (const [name, fn, extra] of [
  ['滑入 enter', () => e.enter(), 0],
  ['滑出 leave', () => e.leave(), 0],
  ['按下 press', () => e.press(), 1],
  ['松手 release', () => e.release(), 0],
]) {
  const r = run(fn)
  check(`${name} 只响一声`, r.n === PARTIALS + extra, `振荡器 ${r.n} 个`)
}

// 音量映射（v1.8.43：×0.02 → ×0.025）：0 = 真静音、50% = 1.25（原声基准）、100% = 2.5（增强 2.5 倍）
check('音量 0% 是真静音（增益 0）', e.setVolume(0) === 0, String(e.setVolume(0)))
check('音量 50% = 增益 1.25（原声基准）', e.setVolume(50) === 1.25, String(e.setVolume(50)))
check('音量 100% = 增益 2.5（增强 2.5 倍）', e.setVolume(100) === 2.5, String(e.setVolume(100)))
check('映射就是 ×0.025，旧的 ×0.02 已经没有了', /\*\s*0\.025/.test(code) && !/\*\s*0\.02(?!\d)/.test(code))

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail ? 1 : 0)
