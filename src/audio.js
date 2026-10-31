/**
 * DSH My Phone —— 音效引擎（纯 DOM，独立于 React）
 *
 * v1.6.0 从旧的 React 前端里整块搬出来的：以前它写在组件函数体里，组件一卸载音效就没了。
 * 现在只有 widget.js 的弹窗用它，走 window.__dshMyPhoneAudio（单例，跨重渲染不丢）。
 * 浏览器要求先有用户交互才能出声，所以第一次点击时 resume 一次，拿不到就静默失败。
 */
;(function () {
  if (typeof window === 'undefined') return
  const prev = window.__dshMyPhoneAudio
  if (
    prev &&
    typeof prev.setVolume === 'function' &&
    typeof prev.setTimbre === 'function' &&
    typeof prev.preview === 'function' &&
    typeof prev.bubble === 'function'
  )
    return

  window.__dshMyPhoneAudio = (() => {
        let ctx = null
        let lastAt = 0
        const get = () => {
          if (ctx) return ctx
          const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
          if (!AC) return null
          try {
            ctx = new AC()
          } catch {
            ctx = null
          }
          return ctx
        }
        // 音量总闸：所有音效最后都接到这里。默认 50% = 增益 1.5（映射 gain = 百分比 × 0.03）
        // 想整体调音量只改 volGain 的来源，不用动每个音自己的 gain
        let bus = null
        let volGain = 1.5
        const masterBus = (c) => {
          if (!bus) {
            bus = c.createGain()
            bus.gain.value = volGain
            // 注意：这里必须直连 c.destination，绝不能写成 masterBus(c)（那会自环、声音出不来）
            bus.connect(c.destination)
          }
          return bus
        }
        // 「卡林巴」单音：正弦为体 + 两个弱
        // 之所以选它：高频很克制（不刺耳）、尾音
        // 这种声音连按十次也不烦，反而会想再点一下
        const tink = (c, freq, { at = 0, dur = 0.34, gain = 0.036, wood = 0 } = {}) => {
          const t0 = c.currentTime + at
          const lp = c.createBiquadFilter()
          lp.type = 'lowpass'
          lp.frequency.setValueAtTime(2600, t0)
          lp.Q.setValueAtTime(0.6, t0)
          const master = c.createGain()
          master.gain.setValueAtTime(0.0001, t0)
          master.gain.exponentialRampToValueAtTime(gain, t0 + 0.003)
          master.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
          lp.connect(master).connect(masterBus(c))
          for (const p of [
            { f: 1, g: 1, k: 1, type: 'sine' },
            { f: 2, g: 0.18, k: 0.5, type: 'sine' },
            { f: 3.01, g: 0.06, k: 0.3, type: 'sine' },
          ]) {
            const o = c.createOscillator()
            const g = c.createGain()
            const d = Math.max(0.06, dur * p.k)
            o.type = p.type
            o.frequency.setValueAtTime(freq * p.f, t0)
            g.gain.setValueAtTime(0.0001, t0)
            g.gain.exponentialRampToValueAtTime(p.g, t0 + 0.004)
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + d)
            o.connect(g).connect(lp)
            o.start(t0)
            o.stop(t0 + d + 0.02)
          }
          // 木头「哒」：8ms 噪声 + 带通，音量很小，只负责音头的实体感
          if (wood > 0) {
            const n = Math.floor(c.sampleRate * 0.008)
            const buf = c.createBuffer(1, n, c.sampleRate)
            const ch = buf.getChannelData(0)
            for (let i = 0; i < n; i += 1) ch[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2
            const src = c.createBufferSource()
            src.buffer = buf
            const bp = c.createBiquadFilter()
            bp.type = 'bandpass'
            bp.frequency.setValueAtTime(1800, t0)
            bp.Q.setValueAtTime(1.1, t0)
            const ng = c.createGain()
            ng.gain.setValueAtTime(wood, t0)
            src.connect(bp).connect(ng).connect(masterBus(c))
            src.start(t0)
          }
        }
        // 频率滑音音色（
        const sweep = (c, f1, f2, { dur = 0.2, gain = 0.05, at = 0, echo = 0 } = {}) => {
          const t0 = c.currentTime + at
          const o = c.createOscillator()
          const g = c.createGain()
          o.type = 'sine'
          o.frequency.setValueAtTime(f1, t0)
          o.frequency.exponentialRampToValueAtTime(f2, t0 + dur * 0.6)
          g.gain.setValueAtTime(0.0001, t0)
          g.gain.exponentialRampToValueAtTime(gain, t0 + 0.004)
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
          o.connect(g).connect(masterBus(c))
          o.start(t0)
          o.stop(t0 + dur + 0.02)
          if (echo > 0) sweep(c, f1, f2, { dur: dur * 0.8, gain: gain * echo, at: at + 0.085 })
        }

        // 按音色说话：同一件事（
        const voice = (c, kind, freq, opts) => {
          if (kind === 'water') {
            sweep(c, freq * 1.55, freq * 0.92, {
              dur: opts.dur || 0.26,
              gain: (opts.gain || 0.04) * 1.1,
              at: opts.at || 0,
              echo: 0.35,
            })
            return
          }
          if (kind === 'pop') {
            sweep(c, freq * 0.42, freq * 1.02, { dur: 0.085, gain: (opts.gain || 0.04) * 1.15, at: opts.at || 0 })
            return
          }
          if (kind === 'bell') {
            const t0 = c.currentTime + (opts.at || 0)
            const lp = c.createBiquadFilter()
            lp.type = 'lowpass'
            lp.frequency.setValueAtTime(6000, t0)
            const m = c.createGain()
            m.gain.setValueAtTime(0.0001, t0)
            m.gain.exponentialRampToValueAtTime((opts.gain || 0.04) * 0.62, t0 + 0.003)
            m.gain.exponentialRampToValueAtTime(0.0001, t0 + (opts.dur || 0.3) * 2.2)
            lp.connect(m).connect(masterBus(c))
            for (const p of [
              { f: 1, g: 1, k: 1 },
              { f: 2.76, g: 0.5, k: 0.8 },
              { f: 5.4, g: 0.26, k: 0.6 },
              { f: 8.93, g: 0.1, k: 0.45 },
            ]) {
              const o = c.createOscillator()
              const g = c.createGain()
              const d = Math.max(0.1, (opts.dur || 0.3) * 2.2 * p.k)
              o.type = 'sine'
              o.frequency.setValueAtTime(freq * p.f, t0)
              g.gain.setValueAtTime(0.0001, t0)
              g.gain.exponentialRampToValueAtTime(p.g, t0 + 0.003)
              g.gain.exponentialRampToValueAtTime(0.0001, t0 + d)
              o.connect(g).connect(lp)
              o.start(t0)
              o.stop(t0 + d + 0.02)
            }
            return
          }
          // 钢琴：非谐泛音列 + 快起音 + 低通随音尾下扫，尾巴单独拉长
          if (kind === 'piano') {
            const t0 = c.currentTime + (opts.at || 0)
            const dur = opts.dur || 1.05
            const gain = (opts.gain || 0.04) * 0.92
            const lp = c.createBiquadFilter()
            lp.type = 'lowpass'
            lp.frequency.setValueAtTime(5400, t0)
            lp.frequency.exponentialRampToValueAtTime(1500, t0 + dur)
            const m = c.createGain()
            m.gain.setValueAtTime(0.0001, t0)
            m.gain.exponentialRampToValueAtTime(gain, t0 + 0.005)
            m.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
            lp.connect(m).connect(masterBus(c))
            for (const p of [
              { f: 1, g: 1, k: 1 },
              { f: 2.002, g: 0.46, k: 0.74 },
              { f: 3.006, g: 0.24, k: 0.56 },
              { f: 4.012, g: 0.13, k: 0.44 },
              { f: 5.021, g: 0.075, k: 0.34 },
              { f: 6.035, g: 0.042, k: 0.26 },
            ]) {
              const o = c.createOscillator()
              const g = c.createGain()
              const d = Math.max(0.08, dur * p.k)
              o.type = 'sine'
              o.frequency.setValueAtTime(freq * p.f, t0)
              g.gain.setValueAtTime(0.0001, t0)
              g.gain.exponentialRampToValueAtTime(p.g, t0 + 0.003)
              g.gain.exponentialRampToValueAtTime(0.0001, t0 + d)
              o.connect(g).connect(lp)
              o.start(t0)
              o.stop(t0 + d + 0.02)
            }
            // 槌击：3ms 噪声点一下，只负责「哒」，音量为泛音的 1/3
            const n = Math.floor(c.sampleRate * 0.003)
            const buf = c.createBuffer(1, n, c.sampleRate)
            const ch = buf.getChannelData(0)
            for (let i = 0; i < n; i += 1) ch[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2
            const src = c.createBufferSource()
            src.buffer = buf
            const hp = c.createBiquadFilter()
            hp.type = 'highpass'
            hp.frequency.setValueAtTime(1400, t0)
            const ng = c.createGain()
            ng.gain.setValueAtTime(gain * 0.32, t0)
            src.connect(hp).connect(ng).connect(masterBus(c))
            src.start(t0)
            return
          }
          // 小提琴：锯齿波 + 慢起音 + 5Hz 揉弦 + 低通，别让它刺耳
          if (kind === 'violin') {
            const t0 = c.currentTime + (opts.at || 0)
            const dur = opts.dur || 0.78
            const gain = (opts.gain || 0.04) * 0.72
            const lp = c.createBiquadFilter()
            lp.type = 'lowpass'
            lp.frequency.setValueAtTime(2500, t0)
            lp.Q.setValueAtTime(1.6, t0)
            const m = c.createGain()
            m.gain.setValueAtTime(0.0001, t0)
            m.gain.exponentialRampToValueAtTime(gain * 0.85, t0 + 0.07) // 慢起音：像弓子刚贴上去
            m.gain.exponentialRampToValueAtTime(gain, t0 + 0.2)
            m.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
            lp.connect(m).connect(masterBus(c))
            // 揉弦：5.2Hz 的正弦推一点频率，深度从 0 渐入
            const lfo = c.createOscillator()
            lfo.type = 'sine'
            lfo.frequency.setValueAtTime(5.2, t0)
            const lg = c.createGain()
            lg.gain.setValueAtTime(0, t0)
            lg.gain.linearRampToValueAtTime(freq * 0.007, t0 + 0.22)
            lfo.connect(lg)
            for (const p of [
              { f: 1, g: 1 },
              { f: 2, g: 0.3 },
              { f: 3, g: 0.12 },
            ]) {
              const o = c.createOscillator()
              const g = c.createGain()
              o.type = 'sawtooth'
              o.frequency.setValueAtTime(freq * p.f, t0)
              lg.connect(o.frequency)
              g.gain.setValueAtTime(p.g, t0)
              o.connect(g).connect(lp)
              o.start(t0)
              o.stop(t0 + dur + 0.05)
            }
            lfo.start(t0)
            lfo.stop(t0 + dur + 0.05)
            return
          }
          if (kind === 'marimba') {
            tink(c, freq, { ...opts, dur: (opts.dur || 0.3) * 0.6, wood: (opts.wood || 0) + 0.028 })
            return
          }
          tink(c, freq, opts) // kalimba（默认）
        }

        // 一次
        const one = (freq, opts) => {
          const c = get()
          if (!c) return
          const now = Date.now()
          if (now - lastAt < 45) return // 飞快划过时不叠加
          lastAt = now
          // 浏览器要求先有交互：这里 resume 完补响一次，别把这一声吞掉
          if (c.state === 'suspended') {
            c.resume()
              .then(() => voice(c, liveTimbre(), freq, opts || {}))
              .catch(() => {})
            return
          }
          voice(c, liveTimbre(), freq, opts || {})
        }
        let timbre = 'kalimba'
        // 每次发声都回看一眼本地存着的音色。
        // 只靠 setTimbre 同步会有个坑：模块热替换/多实例时，正在发声的那个实例可能没收到新音色，
        // 表现就是「下拉里换了乐器，听起来还是老声音」。这里读 localStorage（下游 saveSound 已写好）兜底。
        const liveTimbre = () => {
          try {
            const saved = JSON.parse(window.localStorage.getItem(SOUND_KEY) || 'null')
            if (saved && TIMBRES.some((x) => x.id === saved.timbre)) return saved.timbre
          } catch {
            /* 读不到就用内存里这份 */
          }
          return timbre
        }

        // 一串音按当前音色发声：气泡音、授权提示音都从这里走，
        // 这样换乐器时它们也会一起变，而不是永远卡在卡林巴上
        const melody = (notes) => {
          const c = get()
          if (!c) return
          const play = () => {
            for (const [freq, at, opts] of notes) voice(c, liveTimbre(), freq, { ...opts, at })
          }
          if (c.state === 'suspended') {
            c.resume().then(play).catch(() => {})
            return
          }
          play()
        }

        return {
          // 静默解锁：浏览器要求先有用户手势，这里只把上下文建起来并 resume，不发任何声
          unlock() {
            const c = get()
            if (c && c.state === 'suspended') c.resume().catch(() => {})
            return Boolean(c)
          },
          setTimbre(t) {
            timbre = TIMBRES.some((x) => x.id === t) ? t : 'kalimba'
          },
          // 移入：G5 上行，很轻（滑入滑出音默认是关的，鼠标扫来扫去太吵）
          enter() {
            one(783.99, { dur: 0.3, gain: 0.028 })
          },
          // 移出：E5，比移入低一档、更短，听起来是「退出去」的
          leave() {
            one(659.25, { dur: 0.22, gain: 0.017 })
          },
          // 按下：C6 一声，带木头「哒」的音头，有按下去的实体
          press() {
            one(1046.5, { dur: 0.4, gain: 0.04, wood: 0.03 })
          },
          // 松手：A5，比按下低一档、不带木头音头，像是「弹回来」
          release() {
            one(880, { dur: 0.3, gain: 0.024 })
          },
          // 试听：给「音效」里的音色下拉用，统一走当前音色
          preview(t) {
            const c = get()
            if (!c) return
            const id = TIMBRES.some((x) => x.id === t) ? t : 'kalimba'
            // C6 对小提琴太尖、对钢琴太短：这两个降到 A4 并拉长，一耳朵才分得清
            const soft = id === 'violin' || id === 'piano'
            const play = () => voice(c, id, soft ? 880 : 1046.5, { dur: soft ? 0.95 : 0.4, gain: 0.04, wood: 0.03 })
            // 浏览器还没解锁音频时先 resume，然后**补响一次**（以前直接 return，试听像没反应）
            if (c.state === 'suspended') {
              c.resume().then(play).catch(() => {})
              return
            }
            play()
          },
          // 音量：传百分比（0~100）。映射 gain = 百分比 × 0.02 —— 100% 就是整体系数 2.0
          setVolume(percent) {
            const pct = Math.max(0, Math.min(100, Number(percent) || 0))
            volGain = pct * 0.02
            const c = get()
            if (bus && c) {
              try {
                // 用 setValueAtTime 立刻生效（0 就是真静音），避免与正在跑的包络打架
                bus.gain.setValueAtTime(volGain, c.currentTime)
              } catch {
                /* 关掉音效时总线可能已断开，忽略 */
              }
            }
            return volGain
          },
          // 会话在等授权：比「有人连进来」更急，五个音上行 + 收尾
          alert() {
            melody([
              [783.99, 0, { gain: 0.05, dur: 0.5 }], // G5
              [1046.5, 0.13, { gain: 0.05, dur: 0.5 }], // C6
              [1318.51, 0.26, { gain: 0.048, dur: 0.55 }], // E6
              [1567.98, 0.39, { gain: 0.045, dur: 0.6 }], // G6
              [1567.98, 0.62, { gain: 0.03, dur: 0.85 }], // G6 收尾
            ])
          },
          // P2 普通消息：两声，短
          short() {
            melody([
              [659.25, 0, { gain: 0.04, dur: 0.3 }], // E5
              [880, 0.12, { gain: 0.036, dur: 0.5 }], // A5
            ])
          },
          // 按等级挑长度：0 = P0 最急（最长），1 = P1 中等，2 = P2 最短
          byLevel(level) {
            const lv = Number(level)
            if (lv === 0) return this.alert()
            if (lv === 2) return this.short()
            return this.notice()
          },
          // 有人连
          notice() {
            melody([
              [523.25, 0, { gain: 0.046, dur: 0.7 }], // C5
              [659.25, 0.17, { gain: 0.042, dur: 0.7 }], // E5
              [783.99, 0.34, { gain: 0.038, dur: 0.86 }], // G5
            ])
          },
        }
  })()
})()
