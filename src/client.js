// DSH My Phone 
//
// The host loads this file into the Web client and hands us a `require` that
// resolves the client packages listed in `dsh.client.inject`. We only need
// React + the slot registry: the panel itself is plain DOM styling so it
// follows whatever theme the host is in.
window.__ModuleLoader__.load({
  id: 'dsh-my-phone',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const API = '/__myphone/panel'

    /**
     * 长期凭据落地：配对成功后服务端会 303 到 `/?_k=<passKey>`，那一跳只有手机端
     * 会见到。这里把它存进 localStorage（浏览器清掉 cookie 后靠它自动认回来），
     * 然后立刻把地址栏里的 key 抹掉 —— 免得被好友/截图/历史记录顺手带走。
     */
    const PASS_KEY = 'dsh-my-phone.pass'
    try {
      const sp = new URLSearchParams(window.location.search)
      const rawHash = String(window.location.hash || '').replace(/^#/, '')
      const hp = new URLSearchParams(rawHash)
      const incoming = sp.get('_k') || hp.get('_k')
      if (incoming) {
        window.localStorage.setItem(PASS_KEY, incoming)
        sp.delete('_k')
        hp.delete('_k')
        const q = sp.toString()
        const h = hp.toString()
        window.history.replaceState(null, '', window.location.pathname + (q ? `?${q}` : '') + (h ? `#${h}` : ''))
      }
    } catch {
      /* 隐私模式下 localStorage 可能直接抛错，忽略即可 */
    }

    /**
     * 前端自检信标：把「界面走到哪一步了」报给宿主，写进 pair.log。
     * 存在的意义只有一个：手机上悬浮球不出现时，我们看不见控制台，
     * 只能靠这个知道是模块没加载、插槽没注册，还是挂载了但画在屏幕外。
     * 不带任何凭据，失败静默。
     */
    function report(stage, detail) {
      try {
        const payload = JSON.stringify({
          stage: String(stage || ''),
          detail: String(detail || '').slice(0, 160),
          w: typeof window !== 'undefined' ? window.innerWidth : 0,
          h: typeof window !== 'undefined' ? window.innerHeight : 0,
          dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
        })
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
          navigator.sendBeacon('/__myphone/client-report', new Blob([payload], { type: 'application/json' }))
          return
        }
        if (typeof fetch === 'function') {
          void fetch('/__myphone/client-report', {
            method: 'POST',
            keepalive: true,
            headers: { 'content-type': 'application/json' },
            body: payload,
          }).catch(() => {})
        }
      } catch {
        /* 信标失败不影响任何功能 */
      }
    }

    const box = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: '10px 0',
    }
    const dim = { opacity: 0.62, fontSize: 12, lineHeight: 1.5, margin: 0 }
    const label = { fontSize: 14, fontWeight: 600, margin: 0 }
    const divider = { borderTop: '1px solid color-mix(in srgb, currentColor 14%, transparent)' }
    const btn = {
      font: 'inherit',
      fontSize: 13,
      padding: '6px 12px',
      borderRadius: 8,
      cursor: 'pointer',
      color: 'inherit',
      background: 'transparent',
      border: '1px solid color-mix(in srgb, currentColor 26%, transparent)',
    }
    const dot = (on) => ({
      width: 8,
      height: 8,
      borderRadius: 999,
      display: 'inline-block',
      marginRight: 6,
      background: on ? '#2aa7b8' : 'color-mix(in srgb, currentColor 30%, transparent)',
    })

    function Switch({ on, busy, onClick, children, hot }) {
      // 开着就是实心高亮，一眼能看出当前状
      const onStyle = {
        background: hot ? '#e02020' : '#0d7c8c',
        borderColor: 'transparent',
        color: '#ffffff',
        fontWeight: 700,
      }
      return h(
        'button',
        {
          type: 'button',
          onClick,
          disabled: busy,
          style: { ...btn, minWidth: 88, opacity: busy ? 0.5 : 1, ...(on ? onStyle : null) },
        },
        on ? '已开启 · 关' : children || '开启',
      )
    }

    function Row({ title, hint, on, onToggle, busy, toggleText, hot }) {
      return h(
        'div',
        { style: box },
        h(
          'div',
          { style: { flex: 1, minWidth: 0 } },
          h('p', { style: label }, h('span', { style: dot(on) }), title),
          h('p', { style: dim }, hint),
        ),
        h(Switch, { on, busy, onClick: onToggle, hot }, toggleText),
      )
    }

    // 悬浮球的自检记录：设置卡片和「高级」页都能读到，用来回答「手机上到底有没有挂上」。
    // 手机端看不到日志时，用户只要截一张设置卡片的图就能定位。
    const FAB_PROBE = { mountedAt: 0, rect: '', slot: 'pending' }

    function MyPhonePanel() {
      const [state, setState] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [now, setNow] = useState(Date.now())

      useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(t)
      }, [])

      const load = useCallback(async () => {
        try {
          const res = await fetch(`${API}?t=${Date.now()}`, { headers: { 'x-myphone-panel': '1' } })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          setState(await res.json())
          setError('')
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        }
      }, [])

      useEffect(() => {
        load()
        const timer = setInterval(load, 5000)
        return () => clearInterval(timer)
      }, [load])

      const act = useCallback(
        async (action, body) => {
          setBusy(true)
          try {
            const res = await fetch(`${API}/${action}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-myphone-panel': '1' },
              body: JSON.stringify(body || {}),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            await load()
          } catch (err) {
            setError(String(err && err.message ? err.message : err))
          } finally {
            setBusy(false)
          }
        },
        [load],
      )

      if (error && !state) {
        return h(
          'div',
          { style: { padding: '8px 0' } },
          h('p', { style: label }, '口袋访问 · DSH My Phone'),
          h('p', { style: { ...dim, color: '#e02020' } }, `读不到状态：${error}`),
        )
      }
      if (!state) {
        return h('div', { style: { padding: '8px 0' } }, h('p', { style: dim }, '口袋访问 · 正在读取…'))
      }

      const on = state.lanEnabled || state.tunnelEnabled
      const pair = state.pairing
      const pairLeft = pair && pair.expiresAt ? Math.max(0, Math.round((pair.expiresAt - now) / 1000)) : 0

      return h(
        'div',
        { style: { padding: '4px 0 8px' } },
        INLINE_OLD_UI ? h(PhoneFab, { key: 'legacy-ui', autoOpen: true }) : null,
        h(
          'div',
          { style: { ...box, paddingTop: 0 } },
          h(
            'div',
            null,
            h('p', { style: label }, h('span', { style: dot(on) }), '口袋访问 · DSH My Phone'),
            h(
              'p',
              { style: dim },
              on
                ? state.autoOffMinutes
                  ? `已开启 · ${state.autoOffMinutes} 分钟没动静就自动关闭入口`
                  : '已开启 · 手机可以连接'
                : '关闭状态。手机现在连不上这台电脑。',
            ),
          ),
        ),
        h('div', { style: divider }),
        h(Row, {
          title: '局域网访问',
          hint: '同一 Wi-Fi 下可用，不经第三方',
          on: state.lanEnabled,
          busy,
          toggleText: '开启',
          onToggle: () => act('toggle', { key: 'lan' }),
        }),
        h(Row, {
          title: '外网访问',
          hint: '走 Cloudflare 隧道，出门在外也能连回来',
          on: state.tunnelEnabled,
          busy,
          toggleText: '开启',
          onToggle: () => act('toggle', { key: 'tunnel' }),
        }),
        on && (state.pairUrl || state.url)
          ? h(
              'div',
              { style: { display: 'flex', gap: 12, alignItems: 'center', paddingTop: 4 } },
              state.qrSvg
                ? h('div', {
                    style: { background: '#fff', borderRadius: 10, padding: 6, lineHeight: 0 },
                    dangerouslySetInnerHTML: { __html: state.qrSvg },
                  })
                : null,
              h(
                'div',
                { style: { minWidth: 0 } },
                h('p', { style: { ...label, fontSize: 13 } }, '手机扫码 → 点「信任这台电脑」'),
                h('p', { style: { ...dim, wordBreak: 'break-all' } }, state.pairUrl || state.url),
                h(
                  'a',
                  {
                    href: state.adminUrl,
                    target: '_blank',
                    rel: 'noreferrer',
                    style: { ...dim, color: 'inherit', textDecoration: 'underline' },
                  },
                  '打开完整设置页（设备列表、日志）',
                ),
              ),
            )
          : null,
        h('div', { style: divider }),
        h(
          'p',
          { style: { ...dim, paddingTop: 8 } },
          '右下角的悬浮按钮是日常入口：点一下就是二维码，拖着可以贴到任意一条边。',
        ),
      )
    }

    // ---- 右下角悬浮
    // 形态照手机桌面上的 App：一块圆角
    // 所以永远清楚、能随状态变、能换语言 —
    // 点

    const FAB_TILE = 135 // 图标宽度（用户要求再小 10%：150 → 135）
    // 图标透明底（已定稿）：鲸鱼本体直接贴在壁纸/桌面上，不要白方块、描边、投影。
    // 想换回方块样式，把这里改成 false 即可（下面三处样式会一起回来）。
    const FAB_TILE_ALPHA = true
    // 图标已经裁到内容边界（512x459，没有透明留白），所以盒子宽高就按图片比例来，
    // 高度不再凑成正方形 —— 正方形那两条透明边就是「没贴紧」的元凶。
    const FAB_RATIO = 459 / 512
    const FAB_W = FAB_TILE
    const FAB_H = Math.round(FAB_TILE * FAB_RATIO)
    const FAB_EDGE = 0 // 用户要求「靠墙」：贴到窗口边，不再留 12px
    // 默认落点：窗口右上角（对话区右上那块空白）——见 DEFAULT_ANCHOR
    // 位置语义换过三次（绝对
    const FAB_KEY = 'dsh-my-phone.fab.v12'
    const GUIDE_KEY = 'dsh-my-phone.guide.v1'
    const WIDE_KEY = 'dsh-my-phone.wide'
    const ICON_URL = '/__myphone/icon-fab.png?v=3' // 紧裁版（无透明留白），v=3 破缓存

    // 弹窗挂到 document.body 上：插槽容器可
    // 那样 position:fixed 会变成「相对容器」定位，弹窗就被裁掉了（手机放大成桌面宽度后点不开就是这个原因）
    let createPortal = null
    try {
      const rd = require('react-dom')
      createPortal = (rd && (rd.createPortal || (rd.default && rd.default.createPortal))) || null
    } catch {
      createPortal = null
    }

    /**
     * 悬浮球自己的挂载容器。
     *
     * 只挂 <body> 不够：实测手机上出现的现象是「球闪一下就没了」——
     * 宿主重渲染时会把 body 下不属于自己的子节点清掉。所以容器挂在
     * <html>（documentElement）下，并且每次渲染都检查一遍是否还在，
     * 被摘了就重新挂回去（顺便上一次报点，日志里能看到发生过）。
     */
    const PORTAL_ID = 'dsh-my-phone-root'
    // 必须留着引用：元素一旦被移出文档，document.getElementById 就找不到它了，
    // 而 React 的 portal 仍然在往这个「已脱离文档」的节点里渲染 —— 表现为「球闪一下就没了」。
    let portalEl = null
    // 容器本身必须参与「最顶层」的绘制：手机上有别的插件的浮层（壁纸/挂件）优先级更高，
    // 只给自己的 fixed 子元素设 z-index 是没用的 —— 父容器在同一个堆叠上下文里排后面就会被盖住。
    const HOST_Z = 2147483647
    function portalHost() {
      if (typeof document === 'undefined') return null
      // 必须优先 <html>：body 会被宿主整体重渲染换掉（手机端更频繁），html 不会
      const parent = document.documentElement || document.body
      if (!parent) return null
      // 先看自己手里的引用（脱离文档时 getElementById 找不到），再退回按 id 查
      let el = portalEl && portalEl.id === PORTAL_ID ? portalEl : document.getElementById(PORTAL_ID)
      if (!el) {
        el = document.createElement('div')
        el.id = PORTAL_ID
        el.style.position = 'relative'
        el.style.zIndex = String(HOST_Z)
        portalEl = el
        parent.appendChild(el)
        return el
      }
      portalEl = el
      // 每次都要确保：z-index 还是最大、而且排在同级最后一个（同 z 时后者画在上面）
      if (el.style.zIndex !== String(HOST_Z)) el.style.zIndex = String(HOST_Z)
      if (el.parentNode !== parent) {
        parent.appendChild(el)
        report('portal-reattach', '容器被移走了，已挂回 body')
      }
      // 以前这里是「只要后面还有兄弟节点就 appendChild 挪到末尾」，而 appendChild 对
      // 已存在的节点是「移动」——每次渲染都搬一次 DOM，手机上表现成图标一闪一闪。
      // 容器的 z-index 已经是 2147483647（同值时后者在上），没必要反复搬家。
      return el
    }
    // 错误边界：手机上曾出现「挂上就闪」——如果组件渲染抛异常，React 18 会把整棵树卸掉，
    // 我们只能靠看护发现「内容被清空」再重渲染，表现就是一闪一闪。这里把异常接住：
    // 上报一次 + 渲染一个纯 DOM 兜底球（点一下照样能开弹窗），宿主日志里就能看到真实原因。
    class FabBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { err: null }
      }

      static getDerivedStateFromError(err) {
        return { err }
      }

      componentDidCatch(err) {
        report('render-error', (err && err.message) || String(err))
      }

      render() {
        if (this.state.err) {
          return h(
            'button',
            {
              className: 'dmp-wrap dmp-fallback',
              title: 'DSH 手机入口（渲染出了点问题，点一下仍可打开）',
              onClick: () => {
                this.setState({ err: null })
              },
              style: {
                position: 'fixed',
                right: 14,
                bottom: 14,
                width: 72,
                height: 72,
                padding: 0,
                border: 'none',
                background: 'transparent',
                zIndex: 2147483000,
              },
            },
            h('img', {
              src: ICON_URL,
              alt: '',
              draggable: false,
              style: { width: '100%', height: '100%', objectFit: 'contain' },
            }),
          )
        }
        return this.props.children
      }
    }

    // 独立挂载：完全不依赖插槽，自己开一个 React root 挂到 <html> 下。
    // 只在「插槽里根本没渲染出球」时被调用一次，所以不会出现两个球。
    let standaloneMounted = false
    // 独立挂载的 root 与宿主节点：留着引用才能「只挂一次」，也才能在插槽恢复后干净卸载
    let standaloneRoot = null
    // 供纯 DOM 弹窗的「打开旧界面」按钮调用：把 React 版界面挂进它给的容器。
    // 挂进 DOM 弹窗自己的节点里，宿主不会清（它清的是我们挂在 <html>/<body> 上的外来节点）。
    function mountLegacyInto(target) {
      if (!target || typeof document === 'undefined') return false
      let RD = null
      try {
        RD = require('react-dom/client')
      } catch {
        RD = null
      }
      const createRoot = RD && (RD.createRoot || (RD.default && RD.default.createRoot))
      if (typeof createRoot !== 'function') {
        report('legacy-mount', 'react-dom/client 不可用')
        return false
      }
      const root = createRoot(target)
      root.render(h(FabBoundary, null, h(PhoneFab, { autoOpen: true })))
      report('legacy-mount', '旧界面已挂进 DOM 弹窗')
      return true
    }

    let standaloneHost = null
    function mountStandalone() {
      if (standaloneMounted) return true
      if (typeof document === 'undefined') return false
      let RD = null
      try {
        RD = require('react-dom/client')
      } catch {
        RD = null
      }
      const createRoot = RD && (RD.createRoot || (RD.default && RD.default.createRoot))
      if (typeof createRoot !== 'function') {
        report('standalone', 'react-dom/client 不可用，无法独立挂载')
        return false
      }
      const host = document.createElement('div')
      host.id = 'dsh-my-phone-standalone'
      // 尺寸给 0：宿主皮肤会按「fixed + z-index≥10 + 尺寸≥120×80」把满屏透明容器
      // 误判成「独立插件窗」去糊毛玻璃/背景（dsh-whale-widget #133 踩过）。
      // 子元素都是 fixed 定位，容器 0×0 不影响它们的位置。
      host.style.cssText =
        'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none'
      ;(document.documentElement || document.body).appendChild(host)
      standaloneHost = host
      if (typeof createRoot === 'function') {
        standaloneRoot = createRoot(host)
        standaloneRoot.render(h(FabBoundary, null, h(PhoneFab)))
      } else {
        // React 17 老接口兜底（本宿主是 18，走到这儿说明 require 的模块被裁剪过）
        let legacy = null
        try {
          legacy = require('react-dom')
        } catch {
          legacy = null
        }
        const render = legacy && (legacy.render || (legacy.default && legacy.default.render))
        if (typeof render !== 'function') {
          report('standalone', '拿不到 createRoot / render，无法独立挂载')
          return false
        }
        render(h(PhoneFab), host)
      }
      standaloneMounted = true
      portalEl = document.getElementById(PORTAL_ID) || portalEl
      report('standalone', '已独立挂载悬浮球（绕开插槽，只挂一次）')
      return true
    }

    // 盖住别的插件的
    const FAB_Z = 2147483000
    const FAB_Z_MODAL = 2147483200
    const LONG_PRESS_MS = 420
// 单击弹窗的「静默窗」：松手后这么久之内又按下去，就算连续点，一次都不开。
// 取 300ms：再短会把连点当成单击，再长会觉得「怎么点了不弹」。
const CLICK_SETTLE_MS = 300

    // ── 音效偏好（
    const SOUND_KEY = 'dsh-my-phone.sound.v2'
    // volume 是百分比：0 = 静音，50 = 原声（增益 1.0），100 = 增益 2.0（映射 gain = volume * 0.02）
    // 默认给满 100%：大部分人不会去调音量条，先响得清楚比先响得小声强
    const SOUND_DEFAULTS = { hover: false, button: true, bubble: true, timbre: 'bell', volume: 100 }
    // 可选音色：标签给下拉用，ttl 是试听时的音高（Hz
    const TIMBRES = [
      { id: 'bell', label: '风铃', note: '透亮，音量会压低一档' },
      { id: 'kalimba', label: '卡林巴木琴', note: '温润、有木头实体感，最耐听' },
      { id: 'water', label: '水滴', note: '快速下滑 + 一滴回声，很解压' },
      { id: 'marimba', label: '马林巴', note: '比卡林巴更短促、更「实」' },
      { id: 'piano', label: '钢琴', note: '有槌击音头 + 一串泛音，最像真乐器' },
      { id: 'violin', label: '小提琴', note: '慢起音 + 轻微揉弦，柔和但要久一点才听清' },
      { id: 'pop', label: '气泡', note: '俏皮的上滑音，适合当提醒' },
    ]
    function loadSound() {
      try {
        const raw = window.localStorage.getItem(SOUND_KEY)
        const got = raw ? JSON.parse(raw) : null
        return { ...SOUND_DEFAULTS, ...(got && typeof got === 'object' ? got : {}) }
      } catch {
        return { ...SOUND_DEFAULTS }
      }
    }
    function saveSound(s) {
      try {
        window.localStorage.setItem(SOUND_KEY, JSON.stringify(s))
      } catch {
        /* 隐私模式下写不进去，忽略 */
      }
    }

    // 动效只
    const CSS_ID = 'dsh-my-phone-fab-css'
    function ensureCss() {
      if (typeof document === 'undefined') return
      if (document.getElementById(CSS_ID)) return
      const el = document.createElement('style')
      el.id = CSS_ID
      el.textContent = `
.dmp-wrap{transition:transform .16s cubic-bezier(.2,.8,.3,1);pointer-events:auto}
html #dsh-my-phone-standalone,body #dsh-my-phone-standalone,html #dsh-my-phone-root,body #dsh-my-phone-root{background:transparent!important;background-image:none!important;border:0!important;outline:0!important;box-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;filter:none!important}
html #dsh-my-phone-standalone::before,html #dsh-my-phone-standalone::after,html #dsh-my-phone-root::before,html #dsh-my-phone-root::after{content:none!important;background:transparent!important;box-shadow:none!important;backdrop-filter:none!important}
/* 动画一律绕「贴着窗口的那条底边」放大（transform-origin: 50% 100%）：
   用户要求移入/移出时最下面那条边不许动，所以去掉所有 translateY 和 rotate。 */
.dmp-tile{transition:transform .3s cubic-bezier(.34,1.56,.64,1),box-shadow .3s ease;cursor:grab;will-change:transform;transform-origin:50% 100%}
.dmp-wrap.hov .dmp-tile{transform:scale(1.1);box-shadow:0 16px 34px rgba(8,38,56,.28)}
.dmp-tile.hov-in{animation:dmp-sway .34s cubic-bezier(.34,1.56,.64,1) 1}
@keyframes dmp-sway{
  0%{transform:scale(1)}
  55%{transform:scale(1.17)}
  100%{transform:scale(1.1)}
}
.dmp-tile.hov-out{animation:dmp-return .3s cubic-bezier(.34,1.56,.64,1) 1}
@keyframes dmp-return{
  0%{transform:scale(1.1)}
  60%{transform:scale(.95)}
  100%{transform:scale(1)}
}
/* 按下：横着压扁一点（同样锚在底边，不会离墙） */
.dmp-wrap .dmp-tile:active{animation:none;transform:scale(1.06,.86);transition-duration:.1s}
.dmp-selwrap{position:relative;display:inline-flex}
.dmp-selbtn{display:inline-flex;align-items:center;justify-content:center;font:inherit;font-size:12.5px;font-weight:600;color:#0f5265;background:#eaf8fb;border:1px solid #bfe6f0;border-radius:9px;padding:4px 9px;cursor:pointer;max-width:170px}
/* v0.9.21：这一组 hover/focus 高亮也去掉了 —— 用户明确要「不要 hover 效果」，点了才有反馈（.dmp-menu.on 控制展开） */
/* 空隙不用「空」的：外层 .dmp-menu 是透明定位盒，上面留 12px padding 当鼠标通道，
   白卡片放在里面的 .dmp-menu-card 上。这样从按钮移到列表全程都在 hover 范围内，不会闪消失。 */
.dmp-menu{display:none;position:absolute;right:0;bottom:100%;min-width:156px;padding-top:12px;z-index:30;text-align:left}
.dmp-menu-card{background:#fff;border:1px solid #bfe6f0;border-radius:12px;box-shadow:0 -14px 34px rgba(10,43,64,.18);padding:5px}
.dmp-menu.on{display:block}
.dmp-item{display:block;width:100%;text-align:left;font:inherit;font-size:12.5px;color:#12576b;background:transparent;border:none;border-radius:8px;padding:6px 9px;cursor:pointer}
/* v0.9.21：列表项也不做 hover 高亮，只保留选中态 .dmp-item.on */
.dmp-item.on{background:#eaf8fb;color:#0a5f75;font-weight:700}
.dmp-label{position:absolute;left:50%;transform:translateX(-50%);transition:transform .32s cubic-bezier(.34,1.56,.64,1),background .16s ease,color .16s ease}
/* widget.js（纯 DOM 球）在时，React 那颗让位：只隐藏，不销毁——弹窗还靠 React 树 */
.dmp-widget-on .dmp-wrap{display:none!important}
.dmp-wrap:hover .dmp-label{transform:translate(-50%,-2px) scale(1.06);background:rgba(255,255,255,.98);color:#0a5f75}
.dmp-dot{animation:dmp-pulse 1.7s ease-in-out infinite}
@keyframes dmp-pulse{0%,100%{transform:scale(1);opacity:1}55%{transform:scale(1.22);opacity:.7}}
.dmp-bubble{animation:dmp-in .14s ease-out}
@keyframes dmp-in{from{opacity:0;transform:translateY(4px) scale(.97)}to{opacity:1;transform:none}}
/* 弹窗：从浮球所在的那一点放大到屏幕中央（--dpx/--dpy 是浮球相对屏幕中心的偏移） */
.dmp-modal{animation:dmp-pop .36s cubic-bezier(.2,.92,.26,1) both}
@keyframes dmp-pop{from{opacity:0;transform:translate(var(--dpx,0px),var(--dpy,0px)) scale(.14)}60%{opacity:1}to{opacity:1;transform:none}}
/* 音色下拉：跟弹窗同一套配色（深青字 + 鲸青描边） */
.dmp-sel{font:inherit;font-size:12.5px;font-weight:600;padding:4px 8px;border-radius:9px;border:1px solid #cfe6ee;background:#f7fdff;color:#12566b;cursor:pointer;max-width:156px}
.dmp-sel:hover{border-color:#40d0d0;background:#fff}
.dmp-sel:focus-visible{outline:2px solid rgba(64,208,208,.5);outline-offset:1px}
/* 「！」的说明浮层：从图标旁边淡入 */
.dmp-tip{animation:dmp-in .12s ease-out}
.dmp-info{width:15px;height:15px;flex:0 0 15px;padding:5px;margin:-5px;box-sizing:content-box;border:0;background:transparent;line-height:0;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;cursor:help;opacity:.62;transition:opacity .14s ease,transform .14s ease}
.dmp-info:hover,.dmp-info:focus-visible{opacity:1;transform:scale(1.12);outline:none}
/* 弹窗内容区：细滚动条 + 轨道透明，别把内容挤瘦 */
.dmp-pane{scrollbar-width:thin;scrollbar-color:#c6dcea transparent}
.dmp-pane::-webkit-scrollbar{width:9px;height:9px}
.dmp-pane::-webkit-scrollbar-track{background:transparent}
.dmp-pane::-webkit-scrollbar-thumb{background:#c6dcea;border-radius:9px;border:2px solid transparent;background-clip:content-box}
.dmp-pane::-webkit-scrollbar-thumb:hover{background:#a4cdde;background-clip:content-box}
@media (prefers-reduced-motion: reduce){.dmp-wrap,.dmp-tile,.dmp-label,.dmp-dot,.dmp-bubble,.dmp-modal,.dmp-tip{transition:none;animation:none}}
`
      document.head.appendChild(el)
    }

    // 图标加载失败时的兜底：一枚鲸尾，形状和插件图标一
    const FAB_LOGO = h(
      'svg',
      { viewBox: '0 0 48 48', width: 36, height: 36, 'aria-hidden': 'true' },
      h('path', {
        d: 'M24 40 C20 33 14 29 7 27 C11 22 17 21 22 24 C23 19 21 14 17 10 C24 12 28 17 29 23 C32 18 38 15 44 15 C41 23 34 30 24 40 Z',
        fill: '#0a5f75',
      }),
    )

    const actionBtn = {
      flex: 1,
      padding: '10px 12px',
      borderRadius: 11,
      font: 'inherit',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer',
      border: '1px solid #d7e6ee',
      background: '#ffffff',
      color: '#0d2436',
    }
    const ghostBtn = {
      padding: '6px 10px',
      borderRadius: 9,
      font: 'inherit',
      fontSize: 12,
      cursor: 'pointer',
      border: '1px solid transparent',
      background: 'transparent',
      color: '#7d93a8',
    }
    const timeInputStyle = {
      border: '1px solid #cfdae6',
      borderRadius: 7,
      padding: '3px 6px',
      fontSize: 12.5,
      color: '#12243d',
      background: '#fff',
      colorScheme: 'light',
    }
    const smallBtn = {
      padding: '5px 10px',
      borderRadius: 8,
      font: 'inherit',
      fontSize: 12.5,
      cursor: 'pointer',
      border: '1px solid #d7e6ee',
      background: '#ffffff',
      color: '#3c5670',
      whiteSpace: 'nowrap',
    }
    const paneTitle = { margin: 0, fontSize: 14.5, fontWeight: 700, color: '#0d2436' }
    const paneHint = { margin: '2px 0 0', fontSize: 12.5, color: '#5f7b93', lineHeight: 1.55 }
    const monoLink = {
      fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
      fontSize: 12.5,
      color: '#3c5670',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      flex: 1,
      minWidth: 0,
    }
    // 危险提示用橙色（用户选的）：红字看着像报错，橙字是「注意一下」
    const warnStrong = { margin: '3px 0 0', fontSize: 11.5, fontWeight: 800, color: '#e06c00', lineHeight: 1.5 }
    // 「！」展开后的解释块：浅蓝底，比正文更像备
    const infoText = {
      margin: '7px 0 2px',
      padding: '9px 11px',
      borderRadius: 10,
      background: '#f2fbfe',
      border: '1px solid #d3ecf4',
      fontSize: 11.5,
      lineHeight: 1.62,
      color: '#3a587f',
    }

    // ---- 手机端：同一份前端代码也跑在手机浏览器里 --------------------------
    // 手机是从入口口（隧道 / 局域网 IP）进来的，够不
    // 所以先试管理口，失败就切到手机形态：只读、看状态、能放大
    try {
      // 上次选了「桌面宽度」：页面一加载就把 viewport 撑到 1280，手机竖屏也能看全三
      if (window.localStorage.getItem(WIDE_KEY) === '1') {
        const meta = document.querySelector('meta[name="viewport"]')
        if (meta) meta.setAttribute('content', 'width=1280')
      }
    } catch {
      /* 无痕模式读不到，按普通宽度走 */
    }
    const isWide = () => {
      try {
        return window.localStorage.getItem(WIDE_KEY) === '1'
      } catch {
        return false
      }
    }
    function setWide(on) {
      try {
        window.localStorage.setItem(WIDE_KEY, on ? '1' : '0')
      } catch {
        /* 存不了也照样切一次 */
      }
      const meta = document.querySelector('meta[name="viewport"]')
      if (meta) meta.setAttribute('content', on ? 'width=1280' : 'width=device-width,initial-scale=1,viewport-fit=cover')
      window.location.reload()
    }
    /** 自动横屏：浏览器只有在全屏 + 系统允许的情况下才让锁方向（iOS 基本不行）。 */
    async function goLandscape() {
      const el = document.documentElement
      try {
        if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen()
        if (screen.orientation && typeof screen.orientation.lock === 'function') {
          await screen.orientation.lock('landscape')
          return ''
        }
        return '这个浏览器不让自动横屏，把手机横过来就行'
      } catch (e) {
        return `没能自动横屏（${String(e && e.message ? e.message : e)}），把手机横过来就行`
      }
    }

    function clampXy(p) {
      const maxX = Math.max(FAB_EDGE, window.innerWidth - FAB_W - FAB_EDGE)
      const maxY = Math.max(FAB_EDGE, window.innerHeight - FAB_H - FAB_EDGE)
      return {
        x: Math.min(Math.max(FAB_EDGE, p.x), maxX),
        y: Math.min(Math.max(FAB_EDGE, p.y), maxY),
      }
    }

    // 位置记成「球心占窗口的百分比」而不是像素：
    // 全屏时
    // 渲染时才把百分比换成像素，并夹一次边界（球心离边至少半
    // 默认贴窗口右上角（对话区右上那块空白）
    // edge 显式存下来：角落里「右边」和「下边」都算贴死，靠像素反推会有歧义。
    // v1.2.0：默认挪到窗口右上角（用户点名要的位置：不挡输入框和右下角的一排工具栏）
    const DEFAULT_ANCHOR = { xp: 0.999, yp: 0.17, edge: 'right' }

    // 贴边朝向：图片的「底边」永远朝着墙那边。
    //   贴下边 → 0°；贴右边 → -90°；贴上边 → 180°；贴左边 → 90°
    // （CSS rotate 正角度是顺时针：down=(0,1) 转 -90° 得 (1,0) 即朝右，所以右边是 -90）
    const FAB_ROT = { bottom: 0, right: -90, top: 180, left: 90 }

    // 判定「贴着哪条边」：跟「贴死时该有的 xp/yp」比像素差（不是比百分比）。
    // 贴右边时 xp 约是 1-(FAB_H/2)/vw（≈0.957），用固定的 0.02 百分比阈值会误判。
    const EDGE_TOL_PX = 3
    function edgeOf(a, vw, vh) {
      // 吸附时把边记在锚点上了，直接用（老数据没这个字段就往下走像素反推）
      if (a && typeof a.edge === 'string' && FAB_ROT[a.edge] !== undefined) return a.edge
      if (a && a.edge === null) return null
      const xp = Number(a && a.xp)
      const yp = Number(a && a.yp)
      if (!Number.isFinite(xp) || !Number.isFinite(yp) || !vw || !vh) return null
      const cands = [
        ['left', Math.abs(xp - FAB_H / 2 / vw) * vw],
        ['right', Math.abs(xp - (1 - FAB_H / 2 / vw)) * vw],
        ['top', Math.abs(yp - FAB_H / 2 / vh) * vh],
        ['bottom', Math.abs(yp - (1 - FAB_H / 2 / vh)) * vh],
      ]
      cands.sort((m, n) => m[1] - n[1])
      return cands[0][1] <= EDGE_TOL_PX ? cands[0][0] : null
    }
    // 贴左右边时整块图转 90°，外接盒子的宽高互换
    function viewSize() {
      const de = typeof document === 'undefined' ? null : document.documentElement
      const w = (de && de.clientWidth) || (typeof window === 'undefined' ? 0 : window.innerWidth) || 1
      const h = (de && de.clientHeight) || (typeof window === 'undefined' ? 0 : window.innerHeight) || 1
      return { w: Math.round(w), h: Math.round(h) }
    }

    function boxFor(edge) {
      const side = edge === 'left' || edge === 'right'
      return side ? { w: FAB_H, h: FAB_W } : { w: FAB_W, h: FAB_H }
    }

    function posOf(a, vw, vh) {
      const box = boxFor(edgeOf(a, vw, vh))
      const halfW = box.w / 2
      const halfH = box.h / 2
      const minX = halfW + FAB_EDGE
      const minY = halfH + FAB_EDGE
      const maxX = Math.max(minX, vw - minX)
      const maxY = Math.max(minY, vh - minY)
      return {
        x: Math.min(Math.max(minX, (a.xp ?? 0.968) * vw), maxX),
        y: Math.min(Math.max(minY, (a.yp ?? 0.13) * vh), maxY),
      }
    }

    function anchorStyle(a, vw, vh) {
      const p = posOf(a, vw, vh)
      const box = boxFor(edgeOf(a, vw, vh))
      return {
        position: 'fixed',
        zIndex: FAB_Z,
        width: box.w,
        height: box.h,
        left: Math.round(p.x - box.w / 2),
        top: Math.round(p.y - box.h / 2),
      }
    }

    function loadAnchor() {
      try {
        const raw = window.localStorage.getItem(FAB_KEY)
        if (raw) {
          const saved = JSON.parse(raw)
          if (saved && Number.isFinite(saved.xp) && Number.isFinite(saved.yp)) {
            return { xp: saved.xp, yp: saved.yp, edge: typeof saved.edge === 'string' ? saved.edge : null }
          }
        }
      } catch {
        /* 无痕模式读不到 localStorage：退回默认位置 */
      }
      return DEFAULT_ANCHOR
    }

    function saveAnchor(a) {
      try {
        window.localStorage.setItem(
          FAB_KEY,
          JSON.stringify({ xp: a.xp, yp: a.yp, edge: typeof a.edge === 'string' ? a.edge : null }),
        )
      } catch {
        /* 存不了就算了，下次回到默认位置 */
      }
    }

    // 「上次记住的位置」：双击浮球就回这儿。只在亲手拖完松手时写，窗口缩放/被宿主挤走都不算。
    const REMEMBER_KEY = 'dsh-my-phone.fab.remember.v1'
    function loadRemember() {
      try {
        const a = JSON.parse(window.localStorage.getItem(REMEMBER_KEY) || 'null')
        return a && Number.isFinite(a.xp) && Number.isFinite(a.yp)
          ? { xp: a.xp, yp: a.yp, edge: typeof a.edge === 'string' ? a.edge : null }
          : null
      } catch {
        return null
      }
    }
    function saveRemember(a) {
      try {
        window.localStorage.setItem(
          REMEMBER_KEY,
          JSON.stringify({ xp: a.xp, yp: a.yp, edge: typeof a.edge === 'string' ? a.edge : null }),
        )
      } catch {
        /* 无痕模式忽略 */
      }
    }

    function loadSeen() {
      try {
        const raw = window.localStorage.getItem(GUIDE_KEY)
        if (raw) {
          const saved = JSON.parse(raw)
          if (saved && typeof saved === 'object') return saved
        }
      } catch {
        /* 读不到就当没看过 */
      }
      return { startedAt: 0, url: '' }
    }

    function saveSeen(v) {
      try {
        window.localStorage.setItem(GUIDE_KEY, JSON.stringify(v))
      } catch {
        /* 存不了就算了，下次可能多弹一次 */
      }
    }

    const pad2 = (n) => String(n).padStart(2, '0')
    const clockOf = (at) => {
      if (!at) return ''
      const d = new Date(at)
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    }

    // v1.6.2 临时：用户要截旧界面的图，但点球打不开（老 bug），所以让弹窗自己弹出来。
    // 截完图把这里改回 false（或整段删掉）即可恢复「点球才开」。
    const AUTO_OPEN_FOR_SHOT = false
    // 截图用：把旧的 React 界面内联渲染进「设置 → 插件」那张卡片里。
    // 卡片是宿主自己渲染的插槽子树，宿主不会清它，所以这套界面能一直留在屏幕上。
    const INLINE_OLD_UI = true
    // 截图期间：弹窗一旦打开就别被「点一下背景」关掉（之前就是这么「闪一下消失」的）。
    // 只留右上角 × 和 Esc 关闭。
    const PANEL_STICKY = true

    function PhoneFab(props) {
      const [open, setOpen] = useState(Boolean(props && props.autoOpen) || AUTO_OPEN_FOR_SHOT)
      const [tab, setTab] = useState('connect')
      // 初始是 'unknown'：手机上第一次 refresh() 就会判成 'remote'。
      // 以前初始值是 'local'，于是手机上第一帧会先按「电脑端」画一遍（带「连接 DSH」那行字），
      // 等 remote 状态回来才消失 —— 用户看到的就是「先闪一下文字然后没了」。
      // v1.2.0：形态一进来就定 —— 手机按电脑版先渲染一遍再切，看起来就是「点了没反应」
      const isPhoneUA = () => {
        try {
          const ua = String((navigator && navigator.userAgent) || '')
          if (/Android|iPhone|iPod|Windows Phone|Mobile/i.test(ua)) return true
          if (/iPad|Tablet/i.test(ua)) return true
          const touch = Number((navigator && navigator.maxTouchPoints) || 0) > 0
          const vw = Math.min(window.innerWidth || 9999, window.innerHeight || 9999)
          return touch && vw < 820
        } catch {
          return false
        }
      }
      const [mode, setMode] = useState(() => (isPhoneUA() ? 'remote' : 'unknown'))
      const [remote, setRemote] = useState(null)
      const [data, setData] = useState(null)
      const [err, setErr] = useState('')
      const [busy, setBusy] = useState(false)
      const [copied, setCopied] = useState('')
      const [anchor, setAnchor] = useState(loadAnchor)
      const [dragPos, setDragPos] = useState(null)
      // 窗口尺寸：位置按百分比存、按像素画，所以尺寸一变就得重
      const [vpSize, setVpSize] = useState(() => ({
        w: viewSize().w,
        h: typeof window === 'undefined' ? 800 : window.innerHeight,
      }))
      const [now, setNow] = useState(Date.now())
      const [iconOk, setIconOk] = useState(true)
      // 气泡只展示、不带按钮，几秒后自己消
      const [bubble, setBubble] = useState(null)
      // P0 气泡点一下 → 开弹窗并滚到「消息」那一段
      const [focusMsg, setFocusMsg] = useState(false)
      // 设备备注：正在给哪台设备写备注、草稿内
      const [noteFor, setNoteFor] = useState(null)
    const [infoKey, setInfoKey] = useState('')
    // 音色下拉：只点击开合（不要 hover）
    const [selOpen, setSelOpen] = useState(false)
    const selRef = React.useRef(null)
    useEffect(() => {
      if (!selOpen) return undefined
      const onDocDown = (e) => {
        const el = selRef.current
        if (el && !el.contains(e.target)) setSelOpen(false)
      }
      document.addEventListener('pointerdown', onDocDown, true)
      return () => document.removeEventListener('pointerdown', onDocDown, true)
    }, [selOpen])
    // 音效偏好：
    const [sound, setSound] = useState(loadSound)
    const soundRef = React.useRef(sound)
    soundRef.current = sound
    const setSoundKey = (key, value) => {
      setSound((s) => {
        const next = { ...s, [key]: value }
        saveSound(next)
        return next
      })
    }
    const [noteText, setNoteText] = useState('')
    // 音色改了立刻生效（下一次响就是新音色）
    useEffect(() => {
      audio.setTimbre(sound.timbre)
    }, [sound.timbre])
    // 音量条同理：拖到哪，下一声就多大声
    useEffect(() => {
      audio.setVolume?.(sound.volume)
    }, [sound.volume])
      // 排查日志默认折叠：正常人不需要天天看堆栈，展开才占地方
      const [logOpen, setLogOpen] = useState(false)
      const drag = React.useRef(null)
      const hoverTimer = React.useRef(null)
      const bubbleTimer = React.useRef(null)
      const pendingGuide = React.useRef(null)
      // 快速连点：只在最后一次真的开弹窗（
      const clickTimer = React.useRef(null)
      const lastTap = React.useRef(0)
      const openRef = React.useRef(false)
      // 悬浮球（widget.js，纯 DOM）点一下会派发这个事件；也把直调挂到 window 上给老浏览器兜底。
      React.useEffect(() => {
        const onOpen = () => {
          window.__dshMyPhoneOpened = true
          setOpen(true)
        }
        window.addEventListener('dsh-my-phone:open', onOpen)
        window.__dshMyPhoneOpen = onOpen
        return () => {
          window.removeEventListener('dsh-my-phone:open', onOpen)
          if (window.__dshMyPhoneOpen === onOpen) delete window.__dshMyPhoneOpen
        }
      }, [])
      React.useEffect(() => {
        openRef.current = open
      }, [open])
      const fabRef = React.useRef(null)
      const modalRef = React.useRef(null)
      // 弹窗从浮球那一点「长出来」的起点（相对屏幕中心），开的时候算一
      const [popFrom, setPopFrom] = useState(null)
      // 弹窗「从浮球那一点放大过来」的起始变换；量完就清掉，免得
      const [zoom, setZoom] = React.useState(null)
      // 「！」说明的浮层位置（position:fixed，不受弹窗滚动容器裁剪）
      const [tip, setTip] = React.useState(null)

      useEffect(() => {
        ensureCss()
        FAB_PROBE.mountedAt = Date.now()
        const t = setInterval(() => setNow(Date.now()), 1000)
        // 挂载了却没显示 = 位置/层级问题；没这条上报 = 组件压根没渲染
        report('mount', `pos=${JSON.stringify(anchor)}`)
        // 容器被宿主摘掉时补挂回来（手机上「球闪一下就消失」就是这个原因）
        const keep = setInterval(() => portalHost(), 3000)
        // 挂载 600ms 后量一次真实位置：rect + 球心那一点到底是谁在接收点击
        const probe = setTimeout(() => {
          try {
            const host = document.getElementById(PORTAL_ID)
            const el = host && host.querySelector('.dmp-wrap')
            if (!el) {
              report('rect', 'portal 里找不到 .dmp-wrap')
              return
            }
            const r = el.getBoundingClientRect()
            const cs = getComputedStyle(el)
            const at = document.elementFromPoint(
              Math.round(r.x + r.width / 2),
              Math.round(r.y + r.height / 2),
            )
            // 命中链：万一有 pointer-events:none 的层压在球上面，elementFromPoint 会跳过它，
            // 光看「球心处」是查不出来的，所以把整条栈都打出来
            let stack = 'n/a'
            try {
              const list = document.elementsFromPoint(
                Math.round(r.x + r.width / 2),
                Math.round(r.y + r.height / 2),
              )
              stack = list
                .slice(0, 4)
                .map((n) => String(n.id || n.className || n.tagName).slice(0, 18))
                .join('>')
            } catch {
              /* 老浏览器没有 elementsFromPoint */
            }
            const hostEl = document.getElementById(PORTAL_ID)
            FAB_PROBE.rect = `${Math.round(r.width)}×${Math.round(r.height)} @${Math.round(r.x)},${Math.round(r.y)}`
            report(
              'rect',
              `x=${Math.round(r.x)} y=${Math.round(r.y)} w=${Math.round(r.width)} h=${Math.round(r.height)} vis=${cs.visibility} op=${cs.opacity} z=${cs.zIndex} 球心处=${at ? String(at.className || at.tagName).slice(0, 40) : 'none'} 栈=${stack} 容器z=${hostEl ? getComputedStyle(hostEl).zIndex : '?'}`,
            )
          } catch (err) {
            report('rect', `测量失败 ${(err && err.message) || ''}`)
          }
        }, 600)
        return () => {
          clearInterval(t)
          clearInterval(keep)
          clearTimeout(probe)
        }
      }, [])

      useEffect(() => {
        // 窗口尺寸变了：重算一次（百
        const onResize = () => {
          setDragPos(null)
          setVpSize(viewSize())
        }
        window.addEventListener('resize', onResize)
        window.addEventListener('orientationchange', onResize)
        // 手机浏览器的地址栏收起/展开不触发 window.resize，只改 visualViewport
        const vv = typeof window !== 'undefined' ? window.visualViewport : null
        if (vv) {
          vv.addEventListener('resize', onResize)
          vv.addEventListener('scroll', onResize)
        }
        return () => {
          window.removeEventListener('resize', onResize)
          window.removeEventListener('orientationchange', onResize)
          if (vv) {
            vv.removeEventListener('resize', onResize)
            vv.removeEventListener('scroll', onResize)
          }
        }
      }, [])

      // Esc 关弹窗：键盘用户不用去找那个 ×
      useEffect(() => {
        if (!open) return
        const onKey = (e) => {
          if (e.key === 'Escape') setOpen(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open])

      // 弹窗关掉时，鼠标还停在某个「！」上的话，那个 position:fixed 的说明
      // 不会收到 mouseleave，会一直浮在页面上。
      useEffect(() => {
        if (!open) {
          setTip(null)
          setBubble(null)
        }
      }, [open])

      // 卸载时把三个定时器都清掉，避免卸载后还 setState
      useEffect(
        () => () => {
          for (const ref of [bubbleTimer, clickTimer, hoverTimer]) {
            if (ref.current) clearTimeout(ref.current)
          }
        },
        [],
      )

      // 读请求的序号：有更新的写操作后，旧读的回包直接丢掉
      const reqSeq = React.useRef(0)
      // 服务端字段偶尔可能不是数组（老版本缓存、异常快照），直接 .map/.filter 会整块崩掉
      const arr = (x) => (Array.isArray(x) ? x : [])

      const showBubble = useCallback((b, ms) => {
        setBubble(b)
        if (bubbleTimer.current) clearTimeout(bubbleTimer.current)
        // ms === 0 表示「常驻」：授权这种关键信息不能自己消失，
        // 要等人类点了窗口、或者被下一条消息顶掉才收起来。
        if (ms === 0) return
        bubbleTimer.current = setTimeout(() => setBubble(null), ms || 4200)
      }, [])

      // 隧道半死时 fetch 可能永远不 settle，busy 就一直是 true，
      // 于是所有按钮永久置灰、只能重开页面。
      const timeoutSignal = (ms) => {
        try {
          return typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined
        } catch {
          return undefined
        }
      }

      const request = useCallback(async (path, body, opts) => {
        const silent = Boolean(opts && opts.silent)
        const quiet = Boolean(opts && opts.quiet)
        const isWrite = Boolean(body)
        // 写操作一发起，就作废所有在途的读请求（否则旧 GET 晚到会把开关状态盖回去）
        const my = isWrite ? reqSeq.current + 1 : reqSeq.current
        if (isWrite) reqSeq.current = my
        if (!quiet) setBusy(true)
        try {
          const res = await fetch(`${API}${path}?t=${Date.now()}`, {
            method: body ? 'POST' : 'GET',
            headers: body
              ? { 'content-type': 'application/json', 'x-myphone-panel': '1' }
              : { 'x-myphone-panel': '1' },
            body: body ? JSON.stringify(body) : undefined,
            signal: timeoutSignal(8000),
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const next = await res.json()
          if (!isWrite && my !== reqSeq.current) return next
          setData(next)
          setErr('')
          return next
        } catch (e) {
          // 手机上够不着管理口是正常的，不算错误 —
          if (!silent && !quiet) setErr(String(e && e.message ? e.message : e))
          return null
        } finally {
          if (!quiet) setBusy(false)
        }
      }, [])

      /** 手机形态读的那个只读口：要设备凭据，只回答「我是谁 / 连上没有 / 最近发生了什么」。 */
      const loadRemote = useCallback(async () => {
        try {
          const res = await fetch(`/__myphone/state?t=${Date.now()}`, {
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
            signal: timeoutSignal(8000),
          })
          if (!res.ok) {
            setRemote(null)
            return res.status
          }
          setRemote(await res.json())
          return 0
        } catch {
          return -1
        }
      }, [])

      const refresh = useCallback(
        async (opts) => {
          const local = await request('', undefined, { silent: true, quiet: Boolean(opts && opts.quiet) })
          if (local) {
            setMode('local')
            return local
          }
          const status = await loadRemote()
          setMode('remote')
          if (status === 401) setErr('这台设备的凭据失效了，请在电脑上重新扫码')
          return null
        },
        [request, loadRemote],
      )

      // 轮询：弹窗开着 2 秒一次（红点、有人连进来要快），关着 6 秒一次
      // （授权提醒、完成提醒都靠轮询发现，以前 15 秒会慢半分钟，看着像"没弹"）
      useEffect(() => {
        void refresh({ quiet: true })
        const ms = open ? 2000 : 6000
        const timer = setInterval(() => {
          if (typeof document !== 'undefined' && document.hidden) return
          void refresh({ quiet: true })
        }, ms)
        return () => clearInterval(timer)
      }, [open, refresh])

      // 变更推送：桌面端订阅面板的事件流 —— 授权请求、设备连入、入口开关
      // 都是「发生即到」（这就是图1那个插件的做法：服务端 session/event → 即时推）。
      // 轮询继续留着当兜底，网络抖动或中间代理缓冲时仍然能对上。
      useEffect(() => {
        if (mode !== 'local') return undefined
        if (typeof EventSource === 'undefined') return undefined
        let es = null
        try {
          es = new EventSource(API + '/stream')
        } catch {
          return undefined
        }
        es.onmessage = (ev) => {
          try {
            const next = JSON.parse(ev.data)
            if (next && typeof next === 'object') {
              setData(next)
              setErr('')
            }
          } catch {
            /* 半包/坏包直接丢，等下一次 */
          }
        }
        es.onerror = () => {
          // 别重连轰炸：关掉，让轮询接手
          try {
            es.close()
          } catch {
            /* 忽略 */
          }
        }
        return () => {
          try {
            es.close()
          } catch {
            /* 忽略 */
          }
        }
      }, [mode])

      // 二维码只在两种情况下自动生成：①从来没生成过；②打开弹窗时那张已经失效了
      // 只要有未过期的一张，就老老实实显示它 —
      // 之后想换必须手点「换一个二维码」；弹窗一直开着放到过期也不会自己换
      const lastAutoMint = React.useRef(0)
      const openEdge = React.useRef(0)
      useEffect(() => {
        if (open) openEdge.current = Date.now()
      }, [open])
      useEffect(() => {
        if (!open || mode !== 'local' || !data) return
        // 只在「刚打开那一下」补票；开着放久了过期也不补
        if (Date.now() - openEdge.current > 5000) return
        const exp = Number(data.ticketExpiresAt || 0)
        if (data.pairUrl && exp > Date.now()) return
        if (Date.now() - lastAutoMint.current < 3000) return
        lastAutoMint.current = Date.now()
        void request('/ticket', {}, { quiet: true })
      }, [open, mode, data, request])

      // 重启 / 地址变了 
      useEffect(() => {
        if (!data) return
        const seen = loadSeen()
        let kind = null
        if (seen.startedAt && data.startedAt && data.startedAt !== seen.startedAt) kind = 'restart'
        else if (seen.url && data.tunnelUrl && data.tunnelUrl !== seen.url) kind = 'address'
        else if (seen.url && !data.tunnelUrl && data.addressChangedAt > (seen.at || 0)) kind = 'address'
        saveSeen({ startedAt: data.startedAt, url: data.tunnelUrl || '', at: Date.now() })
        if (kind) pendingGuide.current = kind
      }, [data])

      useEffect(() => {
        const onActive = () => {
          if (!pendingGuide.current) return
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          const kind = pendingGuide.current
          pendingGuide.current = null
          showBubble(
            {
              kind: 'guide',
              lines:
                kind === 'address'
                  ? ['入口地址变了', '手机重新扫一次就行 · 不用重新信任']
                  : ['DSH 刚重启过', '点一下，用手机扫最新的码'],
            },
            4600,
          )
          if (soundRef.current.bubble) audio.byLevel(1)
        }
        // 鼠标动、按键、点一下都算「人在」。浏览器标签在后台时不算
        window.addEventListener('pointermove', onActive, { passive: true })
        window.addEventListener('keydown', onActive)
        window.addEventListener('pointerdown', onActive)
        return () => {
          window.removeEventListener('pointermove', onActive)
          window.removeEventListener('keydown', onActive)
          window.removeEventListener('pointerdown', onActive)
        }
      }, [showBubble])

      // 有人刚连进来 
      // 只在未读数变多时弹，避免每次轮询都弹
      const seenUnread = React.useRef(undefined)
      useEffect(() => {
        const u = (data && data.unread) || 0
        const prev = seenUnread.current
        seenUnread.current = u
        if (prev === undefined) return // 首次加载不算「有新消息
        if (u > prev) {
          // 常驻：新人连进来这种「刚刚发生了」得要人点一下才收，5 秒自动消失会错过
          showBubble({ kind: 'notice', sticky: true, card: bubbleCard() }, 0)
          if (soundRef.current.bubble) audio.byLevel(0)
        }
      }, [data && data.unread, showBubble])

      // 手机那边跑完一轮：弹一条 5 秒的气泡报信（点开弹窗才看详情）
      const seenTurn = React.useRef(undefined)
      useEffect(() => {
        const list = (data && data.turns) || []
        const last = list.length ? list[list.length - 1] : null
        const prev = seenTurn.current
        seenTurn.current = last ? last.seq : 0
        if (prev === undefined) return // 首次加载不算
        if (!last || last.seq <= prev) return
        showBubble({ kind: 'turn', card: { tag: '回复完成', main: last.text } }, 5000)
        if (soundRef.current.bubble) audio.notice()
      }, [data && data.turns, showBubble])

      // 会话在等授权：弹气泡 + 五响提示音（只提示，点开也不代答）
      const seenApproval = React.useRef(undefined)
      useEffect(() => {
        const list = (data && data.approvals) || []
        const last = list.length ? list[list.length - 1] : null
        const prev = seenApproval.current
        seenApproval.current = last ? last.seq : 0
        if (prev === undefined) return // 首次加载不算
        if (!last || last.seq <= prev) return
        const shown = String(last.name || last.text || '会话')
        showBubble(
          {
            kind: 'approval',
            seq: last.seq,
            sticky: true,
            card: {
              tag: '等授权',
              tagColor: '#C88A00',
              // P0 气泡本身是入口：点一下直接开弹窗并滚到「消息」
              clickable: true,
              main: {
                parts: [
                  { t: `【${shown}】`, c: '#C88A00' },
                  { t: '正在请求授权...' },
                ],
              },
              sign: '点一下看详情 · 在 DSH 里批准或拒绝',
            },
          },
          0, // 常驻：不自动消失
        )
        if (soundRef.current.bubble) audio.byLevel(0)
      }, [data && data.approvals, showBubble])

      // 授权气泡的收尾：①人在 DSH 窗口里点了任何地方 ②这条授权已经有结果了（被允许/拒绝/撤销）
      // ③被后来的消息顶掉（顶掉由 showBubble 自身完成）。
      useEffect(() => {
        if (!bubble || !bubble.sticky) return undefined
        const dismiss = () => setBubble(null)
        // 用捕获阶段，避免被别的组件 stopPropagation 吞掉
        window.addEventListener('pointerdown', dismiss, true)
        window.addEventListener('keydown', dismiss, true)
        return () => {
          window.removeEventListener('pointerdown', dismiss, true)
          window.removeEventListener('keydown', dismiss, true)
        }
      }, [bubble])

      // 从气泡跳进来时，把「消息」段滚到视野里（手机上也一样能用）
      useEffect(() => {
        if (!open || !focusMsg) return undefined
        const t = setTimeout(() => {
          const el = typeof document !== 'undefined' ? document.getElementById('dmp-msg') : null
          if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: 'smooth' })
          setFocusMsg(false)
        }, 170)
        return () => clearTimeout(t)
      }, [open, focusMsg])

      useEffect(() => {
        if (!bubble || bubble.kind !== 'approval') return
        const list = (data && data.approvals) || []
        const still = list.some((a) => a.seq === bubble.seq)
        if (!still) setBubble(null)
      }, [data && data.approvals, bubble])

      // 其它即时提醒：等你回答 / 这一轮出错 / 正在整理上下文 / 切了计划模式。
      // 「等你回答」和「整理上下文」是常驻（事情没完之前一直挂着），其余 6 秒自己消失。
      const seenAlert = React.useRef(undefined)
      useEffect(() => {
        const list = Array.isArray(data && data.alerts) ? data.alerts : []
        const last = list.length ? list[list.length - 1] : null
        const prev = seenAlert.current
        seenAlert.current = last ? last.seq : 0
        if (prev === undefined) return // 首次加载不算
        if (!last || last.seq <= prev) return
        if (bubble && bubble.kind === 'approval') return // 授权气泡优先，别被后来的顶掉
        const stick = last.sticky === true
        showBubble({ kind: 'alert', seq: last.seq, sticky: stick, lines: [String(last.text || '')] }, stick ? 0 : 6000)
        if (soundRef.current.bubble) audio.byLevel(Number(last.level) || 1)
      }, [data && data.alerts, showBubble, bubble])

      useEffect(() => {
        if (!bubble || bubble.kind !== 'alert') return
        const list = Array.isArray(data && data.alerts) ? data.alerts : []
        if (!list.some((a) => a.seq === bubble.seq)) setBubble(null)
      }, [data && data.alerts, bubble])

      const copy = useCallback(async (text, tag) => {
        if (!text) return
        try {
          await navigator.clipboard.writeText(text)
        } catch {
          // 非安全上下文或没授权：用老办法兜一次。
          // 注意 iOS Safari 上 textarea 不 focus 的话 select() + execCommand 会静默失败，
          // 以前不看返回值，于是手机上点了「复制」显示「已复制」、粘出来却是空的。
          const ta = document.createElement('textarea')
          ta.value = text
          ta.setAttribute('readonly', '')
          ta.style.position = 'fixed'
          ta.style.top = '0'
          ta.style.left = '0'
          ta.style.opacity = '0'
          document.body.appendChild(ta)
          ta.focus()
          ta.select()
          let ok = false
          try {
            ok = document.execCommand('copy')
          } catch {
            ok = false
          }
          ta.remove()
          if (!ok) {
            setCopied('')
            setErr('这台手机不让自动复制，请长按选中链接手动复制')
            return
          }
        }
        setCopied(tag)
        setTimeout(() => setCopied(''), 1600)
      }, [])

      // 气泡文案随「有没有人刚连进来」变化：走「信笺」结构 ——
      // tag（小标签）/ meta（信头右侧的时间）/ main（正文）/ sign（落款，右对齐）
      // 有
      const bubbleCard = () => {
        // 知道是谁连进来的就把名字带上（备注优先，服务端已拼成「IS（iPhone）」），
        // 只写「有 1 台设备刚连进来」等于没说 —— 人还得再点开高级页去对。
        const list = (data && data.notices) || []
        const last = list[list.length - 1]
        if (last && last.label) {
          return {
            tag: '新连接',
            meta: clockOf(last.at),
            main: `${last.label}刚连进来`,
            sign: '高级页·已配对设备里可断开',
          }
        }
        const appr = (data && data.approvals) || []
        if (appr.length > 1) {
          const first = appr[appr.length - 1]
          return {
            tag: '等授权',
            meta: `${appr.length} 条`,
            main: first.text,
            sign: `还有 ${appr.length - 1} 条 · 点开消息看`,
          }
        }
        const u = (data && data.unread) || 0
        if (u > 0) {
          return { tag: '新连接', meta: `${u} 台`, main: `有 ${u} 台设备刚连进来`, sign: '高级页·已配对设备里可断开' }
        }
        return { tag: '手机连接', main: '点一下 · 手机扫码连 DSH' }
      }

      // ── 声音：WebAudio 合成的「
      // 一个音 = 基频（triangle
      // 浏览器要求「先有用户交互」才能出声：第一次交互时 resume 一次，之后就一直能响；
      // 拿不到权限就静默失败（不弹错误、不影响功能）
      // 音效引擎必须是单例。以前它写在组件函数体里：每秒的 setNow tick 都会重渲染，
      // 于是每次都 new 一个 AudioContext（老的不关，Chrome 六个就上限、之后永久静音），
      // 新建的全是 suspended（这一声被 resume 分支吞掉），音色设置也被重置回卡林巴。
      // 音频单例：键上做能力校验。旧模块版本留在 globalThis 上的实例没有 setVolume/setTimbre，
      // 直接复用就会表现为「音量条拖了没反应、0% 也照样出声」，所以检查不过就重建一个。
      // v1.6.0：音效引擎搬去 src/audio.js（纯 DOM 也能用）。
      // 这里只留惰性代理：卡片里的滑块/试听照样能调；脚本没加载就静默空转。
      const audio = new Proxy(
        {},
        {
          get(_t, key) {
            const real = globalThis.__dshMyPhoneAudio
            const fn = real && real[key]
            return typeof fn === 'function' ? fn.bind(real) : () => {}
          },
        },
      )

      // 拖动：按下记起点和当前位置，移动超过 4px 才算拖；松手吸到最近的一条边（上下左右都行）
      // 没拖动就是「点一
      const onDown = (e) => {
        // 上一次松手还在「静默窗」里 —— 用户又按下来了，说明是在连点，取消待开
        if (clickTimer.current) {
          clearTimeout(clickTimer.current)
          clickTimer.current = null
        }
        const rect = e.currentTarget.getBoundingClientRect()
        drag.current = {
          id: e.pointerId,
          px: e.clientX,
          py: e.clientY,
          ox: rect.left,
          oy: rect.top,
          moved: false,
          longPress: false,
        }
        if (hoverTimer.current) clearTimeout(hoverTimer.current)
        if (soundRef.current.button) audio.press()
        hoverTimer.current = setTimeout(() => {
          if (!drag.current || drag.current.moved) return
          drag.current.longPress = true
          showBubble({ kind: 'hover', card: bubbleCard() }, 3600)
        }, LONG_PRESS_MS)
        e.currentTarget.setPointerCapture?.(e.pointerId)
      }
      const onMove = (e) => {
        const d = drag.current
        if (!d || d.id !== e.pointerId) return
        const dx = e.clientX - d.px
        const dy = e.clientY - d.py
        if (!d.moved && Math.hypot(dx, dy) < 4) return
        if (!d.moved) {
          d.moved = true
          if (hoverTimer.current) clearTimeout(hoverTimer.current)
          setBubble(null)
        }
        d.p = clampXy({ x: d.ox + dx, y: d.oy + dy })
        setDragPos(d.p)
      }
      const onUp = (e) => {
        const d = drag.current
        drag.current = null
        if (soundRef.current.button) audio.release()
        if (hoverTimer.current) clearTimeout(hoverTimer.current)
        if (!d || d.id !== e.pointerId) return
        if (!d.moved) {
          setDragPos(null)
          // v1.2.0：去掉了双击回位（用户实测误触为主，且和「点一下开弹窗」抢手势）
          // 长按出过气泡的那一次不再开弹窗，否则「看说明」就变成「被迫打开
          if (!d.longPress) {
            // 已经开着的时候，点一下就是「关」，不用等静默窗，否则像卡了半秒
            if (openRef.current) {
              setOpen(false)
              return
            }
            // 开弹窗要等松手后安静够 CLICK_SETTLE_MS：连点只算一次，且不会开
            if (clickTimer.current) clearTimeout(clickTimer.current)
            const cx0 = d.ox + FAB_W / 2
            const cy0 = d.oy + FAB_H / 2
            clickTimer.current = setTimeout(() => {
              clickTimer.current = null
              // 弹窗从浮球那一点放大到屏幕中央：记下浮球相对屏幕中心的位置
              setPopFrom({
                dx: cx0 - viewSize().w / 2,
                dy: cy0 - viewSize().h / 2,
              })
              setOpen(true)
            }, CLICK_SETTLE_MS)
          }
          return
        }
        const p = (d && d.p) || clampXy({ x: d.ox, y: d.oy })
        const viewport = viewSize()
        const vw = viewport.w || 1
        const vh = viewport.h || 1
        const halfW = FAB_W / 2
        const halfH = FAB_H / 2
        const cx = p.x + halfW
        const cy = p.y + halfH
        // 存「球心占窗口的百分比」：窗口缩小时按比例跟着走，相对位置不变
        const next = { xp: cx / vw, yp: cy / vh }
        // 离边很
        const snap = 28
        // 离四条边各多远（用未旋转时的半宽/半高先估），最近的一条且够近就贴上去
        const cand = [
          ['left', cx, halfW],
          ['right', vw - cx, halfW],
          ['top', cy, halfH],
          ['bottom', vh - cy, halfH],
        ].sort((m, n) => m[1] - n[1] || (m[0] === 'bottom' || m[0] === 'top' ? -1 : 1))
        const edge = cand[0][1] <= cand[0][2] + snap ? cand[0][0] : null
        // 贴边时用「转过去以后的外接盒子」算贴死的百分比，否则一转就会顶出窗口/离开墙
        const box = boxFor(edge)
        if (edge === 'left') next.xp = (box.w / 2 + FAB_EDGE) / vw
        else if (edge === 'right') next.xp = 1 - (box.w / 2 + FAB_EDGE) / vw
        if (edge === 'top') next.yp = (box.h / 2 + FAB_EDGE) / vh
        else if (edge === 'bottom') next.yp = 1 - (box.h / 2 + FAB_EDGE) / vh
        // 另一个轴别被转出去的盒子顶出窗口
        const minY = box.h / 2 + FAB_EDGE
        const maxY = vh - minY
        next.yp = Math.min(Math.max(minY / vh, next.yp), maxY / vh)
        const minX = box.w / 2 + FAB_EDGE
        const maxX = vw - minX
        next.xp = Math.min(Math.max(minX / vw, next.xp), maxX / vw)
        next.edge = edge
        setAnchor(next)
        saveRemember(next)
        saveAnchor(next)
        setDragPos(null)
      }
      const resetAnchor = () => {
        setAnchor(DEFAULT_ANCHOR)
        saveAnchor(DEFAULT_ANCHOR)
        setDragPos(null)
      }

      const pairUrl = (data && (data.pairUrl || data.url)) || ''
      // 扫码走哪条地址：外网开 → tunnel（https），外网关 → lan（IP）；pending = 外网开着但隧道还没起来
      const entryMode = (data && data.entryMode) || (pairUrl ? 'tunnel' : 'off')
      // 界面上的版本号：跟 package.json 对得上，就说明加载的不是缓存里的旧模块
      const pluginVersion = (data && data.version) || ''
      const left = data && data.ticketExpiresAt ? Math.max(0, Math.round((data.ticketExpiresAt - now) / 1000)) : 0
      const devices = arr(data && data.deviceList)
      const notices = arr(data && data.notices)
      // 红点 = 待处理总数（授权 + 新设备），打开弹窗即清零；不再只看「未读连接」
      const unread = Number((data && data.pendingCount) ?? (data && data.unread) ?? notices.length)
      const events = arr(data && data.events).slice(-8).reverse()
      // 会话在等授权：只显示，不提供任何按钮（批准必须在电脑上完成）
      const approvals = arr(data && data.approvals)
      // v1.2.0：服务端已把消息分成三段（待处理 / 最近动态 / 技术日志）
      const feed = (data && data.feed) || null
      const feedPending = arr(feed && feed.pending)
      const feedHuman = arr(feed && feed.human)
      // 技术日志：优先用服务端给的「已剔除人类事件」清单，避免和上面重复
      const techRows = arr(feed && feed.techRaw).length ? arr(feed && feed.techRaw) : arr(data && data.events)
      const alerts = arr(data && data.alerts)

      const tabBtn = (key, text, badge) =>
        h(
          'button',
          {
            type: 'button',
            onClick: () => setTab(key),
            style: {
              font: 'inherit',
              fontSize: 13.5,
              fontWeight: tab === key ? 700 : 500,
              color: tab === key ? '#0d2436' : '#5f7b93',
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${tab === key ? '#0f7d99' : 'transparent'}`,
              cursor: 'pointer',
              padding: '10px 2px',
              marginRight: 20,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            },
          },
          text,
          badge
            ? h('span', {
                style: {
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  background: '#e6382b',
                  display: 'inline-block',
                },
              })
            : null,
        )

      // 二维码过期就整块变灰并盖一个戳 —
      const qrExpired = !pairUrl || left <= 0
      const connectPane = h(
        'div',
        null,
        h(
          'div',
          { style: { position: 'relative', display: 'flex', justifyContent: 'center', margin: '2px 0 14px' } },
          data && data.qrSvg
            ? h('div', {
                style: {
                  background: '#ffffff',
                  border: '1px solid #e3f0f5',
                  borderRadius: 18,
                  padding: 10,
                  lineHeight: 0,
                  filter: qrExpired ? 'grayscale(1) blur(.4px)' : 'none',
                  opacity: qrExpired ? 0.3 : 1,
                  transition: 'opacity .18s ease, filter .18s ease',
                },
                dangerouslySetInnerHTML: { __html: data.qrSvg },
              })
            : h(
                'div',
                {
                  style: {
                    width: 208,
                    height: 208,
                    borderRadius: 18,
                    border: '1px dashed #d7e6ee',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#5f7b93',
                    fontSize: 13,
                  },
                },
                busy ? '正在生成二维码…' : '点下面的按钮生成二维码',
              ),
          qrExpired && pairUrl
            ? h(
                'div',
                {
                  style: {
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                  },
                },
                h(
                  'span',
                  {
                    style: {
                      transform: 'rotate(-9deg)',
                      border: '3px solid #e06c00',
                      color: '#e06c00',
                      borderRadius: 10,
                      padding: '4px 14px',
                      fontSize: 17,
                      fontWeight: 900,
                      letterSpacing: 3,
                      background: 'rgba(255,255,255,.86)',
                    },
                  },
                  '已失效',
                ),
              )
            : null,
        ),
        h(
          'p',
          { style: { margin: '0 0 4px', fontSize: 16.5, fontWeight: 800, textAlign: 'center', color: '#0d2436' } },
          '相机或者浏览器扫码连接',
        ),
        h(
          'p',
          {
            style: {
              margin: 0,
              fontSize: 13.5,
              fontWeight: 400,
              color: '#22354a',
              textAlign: 'center',
              lineHeight: 1.6,
            },
          },
          '扫码连接 DeepSeek Harness 桌面版',
        ),
        // 公共 WiFi 会把 http 页面劫持跳走（用户实际遇到过），这句话必须在二维码下
        h(
          'p',
          {
            style: {
              margin: '8px 0 0',
              padding: '7px 10px',
              borderRadius: 10,
              background: '#fff4d6',
              border: '1px solid #f6dfa8',
              fontSize: 12,
              fontWeight: 600,
              lineHeight: 1.55,
              color: '#8a6100',
              textAlign: 'center',
            },
          },
          '公共 WiFi 可能会跳转其他网站、出现各种情况，请用流量连接',
        ),
        pairUrl
          ? h(
              'div',
              {
                style: {
                  marginTop: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: '#f3fafd',
                  border: '1px solid #e3f0f5',
                  borderRadius: 12,
                  padding: '5px 5px 5px 12px',
                },
              },
              h('span', { style: monoLink, title: pairUrl }, pairUrl),
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => copy(pairUrl, 'link'),
                  title: '复制链接',
                  style: { ...smallBtn, fontSize: 11.5, padding: '4px 9px' },
                },
                copied === 'link' ? '已复制' : '复制',
              ),
            )
          : null,
        h(
          'div',
          { style: { display: 'flex', justifyContent: 'center', marginTop: 14 } },
          h(
            'button',
            {
              type: 'button',
              disabled: busy,
              onClick: () => request('/ticket', {}),
              style: {
                width: '100%',
                maxWidth: 268,
                padding: '12px 18px',
                borderRadius: 13,
                font: 'inherit',
                fontSize: 14.5,
                fontWeight: 800,
                letterSpacing: 0.3,
                cursor: 'pointer',
                border: '1px solid transparent',
                background: pairUrl && !qrExpired ? '#eef8fb' : '#0f7d99',
                color: pairUrl && !qrExpired ? '#0f7d99' : '#ffffff',
                boxShadow: pairUrl && !qrExpired ? 'none' : '0 6px 16px rgba(15,125,153,.30)',
                opacity: busy ? 0.6 : 1,
              },
            },
            busy ? '正在生成…' : pairUrl ? '换一个二维码' : '生成二维码',
          ),
        ),
        h(
          'p',
          { style: { ...paneHint, marginTop: 9, textAlign: 'center' } },
          !pairUrl
            ? entryMode === 'pending'
              ? '外网入口正在准备（隧道启动中），等几秒再点一次'
              : entryMode === 'off'
                ? '两个入口都关着 —— 先在「高级」里打开一个'
                : '点上面的按钮生成二维码'
            : qrExpired
              ? '已失效 —— 点上面的按钮换一个'

              : `${Math.floor(left / 60)}:${pad2(left % 60)} 后失效，到点需要手动再点一次`,
        ),
        h(
          'div',
          { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 10 } },
          h(
            'button',
            {
              type: 'button',
              onClick: () => {
                resetAnchor()
                setOpen(false)
              },
              // 纯文字链：不要背景、不要边框，靠右下角待着
              onMouseEnter: (e) => {
                e.currentTarget.style.color = '#0f7d99'
              },
              onMouseLeave: (e) => {
                e.currentTarget.style.color = '#7d93a8'
              },
              style: {
                font: 'inherit',
                fontSize: 11.5,
                color: '#7d93a8',
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              },
            },
            '回到图标默认位置',
          ),
        ),
      )

      const sectionTitle = (text, extra, info) =>
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12, marginTop: 12, borderTop: '1px solid #e6f2f7' } },
          // info.big：音效这种「整块功能」的标题要压得住，用主标题字号与字重；其余分区用小灰字
          h(
            'p',
            {
              style: {
                ...paneTitle,
                ...(info && info.big
                  ? { fontSize: 16, fontWeight: 800, color: '#0d2436', letterSpacing: 0, lineHeight: '19px', margin: 0 }
                  : { fontSize: 12.5, color: '#7d93a8', letterSpacing: 0.4, lineHeight: '15px', margin: 0 }),
              },
            },
            text,
          ),
          info ? infoDot(info.key, info.text) : null,
          h('span', { style: { flex: 1 } }),
          extra || null,
        )

      // 地址就摆在对应开关下面，能直接复制；不再额外解释「地址会变」这类话
      const addrRow = (url, tag) =>
        url
          ? h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  margin: '0 0 8px',
                  background: '#f3fafd',
                  border: '1px solid #e3f0f5',
                  borderRadius: 10,
                  padding: '4px 5px 4px 10px',
                },
              },
              h('span', { style: { ...monoLink, flex: 1, minWidth: 0 }, title: url }, url),
              // 二维码只走一条：外网开着走 https，关着走 IP —— 标出来免得用户分不清
              (entryMode === 'tunnel' && tag === 'tun') || (entryMode === 'lan' && tag === 'lan')
                ? h(
                    'span',
                    {
                      style: {
                        fontSize: 10,
                        fontWeight: 800,
                        color: '#0a5f75',
                        background: '#dff3f9',
                        borderRadius: 6,
                        padding: '1px 5px',
                        whiteSpace: 'nowrap',
                      },
                    },
                    '扫码走这条',
                  )
                : null,
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => copy(url, tag),
                  title: '复制地址',
                  style: { ...smallBtn, fontSize: 12, padding: '3px 8px' },
                },
                copied === tag ? '已复制' : '复制',
              ),
            )
          : null

      // 「！」：一张透
      // 鼠标放
      // 内联 SVG：宿主的 CSP 不允许 data: 图片，用 <img> 会渲染成一个灰方块
      const InfoIcon = () =>
        h(
          'svg',
          { viewBox: '0 0 24 24', width: 15, height: 15, 'aria-hidden': 'true', focusable: 'false' },
          h('circle', { cx: 12, cy: 12, r: 9.5, fill: 'none', stroke: '#0f7d99', strokeWidth: 1.9 }),
          h('circle', { cx: 12, cy: 7.6, r: 1.45, fill: '#0f7d99' }),
          h('rect', { x: 11.1, y: 10.4, width: 1.85, height: 6.9, rx: 0.92, fill: '#0f7d99' }),
        )

      const showTip = (e, key, text) => {
        const r = e.currentTarget.getBoundingClientRect()
        setTip({ key, text, x: r.left + r.width / 2, y: r.bottom + 9 })
      }
      const hideTip = (key) => setTip((t) => (t && t.key === key ? null : t))
      const infoDot = (key, text) =>
        h(
          'button',
          {
            type: 'button',
            className: 'dmp-info',
            'aria-label': '说明',
            onClick: (e) => {
              e.stopPropagation()
              if (tip && tip.key === key) hideTip(key)
              else showTip(e, key, text)
            },
            onMouseEnter: (e) => showTip(e, key, text),
            onMouseLeave: () => hideTip(key),
            onFocus: (e) => showTip(e, key, text),
            onBlur: () => hideTip(key),
            onContextMenu: (e) => e.preventDefault(),
          },
          InfoIcon(),
        )

      const toggleRow = (title, hint, on, key, info) =>
        h(
          'div',
          { style: { padding: '8px 0' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 12 } },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                h('p', { style: paneTitle }, title),
                info ? infoDot(key, info) : null,
              ),
              h('p', { style: paneHint }, hint),
            ),
            h(
              'button',
              {
                type: 'button',
                disabled: busy,
                onClick: () => request('/toggle', { key }),
                style: {
                  minWidth: 82,
                  padding: '6px 12px',
                  borderRadius: 9,
                  font: 'inherit',
                  fontSize: 13.5,
                  cursor: 'pointer',
                  border: '1px solid transparent',
                  // 两个开关都是绿的：它们本身不是危险动作，风险写在下面的橙字
                  background: on ? '#0d7c8c' : '#e6f2f7',
                  color: on ? '#ffffff' : '#3c5670',
                  fontWeight: on ? 700 : 500,
                },
              },
              on ? '已开启' : '已关闭',
            ),
          ),
        )

      // 提示卡：点一下（或点右边「知道了」）就收起。收起 = 已读，高级 tab 的红点一起消失
      const dismissNotices = () => {
        setData((d) => (d ? { ...d, notices: [], unread: 0 } : d))
        request('/read', {}).catch(() => {})
      }
      const noticeCard = (n) =>
        h(
          'div',
          {
            key: n.seq,
            role: 'button',
            tabIndex: 0,
            // 不放原生 title：鼠标停留会弹系统小黄条，用户明确不喜欢；
            // 右边那颗「知道了 ›」已经说明这里能点。
            'aria-label': '收起这条提示',
            onClick: dismissNotices,
            onKeyDown: (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                dismissNotices()
              }
            },
            style: {
              marginTop: 8,
              padding: '10px 12px',
              borderRadius: 12,
              background: '#fff8f1',
              border: '1px solid #f6dcbd',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              cursor: 'pointer',
            },
          },
          h(
            'div',
            { style: { flex: '1 1 auto', minWidth: 0 } },
            h(
              'p',
              { style: { margin: 0, fontSize: 13, color: '#7c4a12', fontWeight: 700 } },
              `「${n.label}」刚连进来 · ${clockOf(n.at)}`,
            ),
            h(
              'p',
              { style: { margin: '3px 0 0', fontSize: 12, color: '#b06d12', lineHeight: 1.5 } },
              '票据在手就能进，所以这是「已经连上了」。认不出就到下面设备列表里删掉它。',
            ),
          ),
          h(
            'span',
            {
              style: {
                flex: '0 0 auto',
                marginTop: 1,
                borderRadius: 999,
                padding: '3px 10px',
                fontSize: 12,
                fontWeight: 800,
                color: '#0a5f75',
                background: '#fff',
                border: '1px solid #cfe6ee',
                whiteSpace: 'nowrap',
              },
            },
            '知道了 ›',
          ),
        )

      // 备注：手机浏览器都自称「Android 设备」，靠人自己起名才分得清（刘先生 / 我的 iPhone…）
      const saveNote = async (id) => {
        await request('/device', { id, note: noteText })
        setNoteFor(null)
      }

      // ── 消息中心的三段渲染 ────────────────────────────────────────────
      // 通用小行：左边时间，中间文字，右边可选按钮。限高 + 内部滑动，别把弹窗撑长。
      // v1.2.2 优先级三档：P0 琥珀（要你决定）/ P1 橙（留意）/ P2 蓝绿（记录）
      // 只用颜色不够（色弱分不出），所以 P0 带锁、P1 带感叹号
      const LEVEL_C = ['#C88A00', '#E06C00', '#0b7f8c']
      const levelIcon = (lv) =>
        lv === 0
          ? h(
              'svg',
              { width: 11, height: 11, viewBox: '0 0 24 24', style: { flex: '0 0 auto', marginTop: 5 } },
              h('path', {
                d: 'M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3z',
                fill: LEVEL_C[0],
              }),
            )
          : lv === 1
            ? h(
                'span',
                { style: { flex: '0 0 auto', marginTop: 1, fontSize: 12, fontWeight: 900, color: LEVEL_C[1] } },
                '!',
              )
            : null
      const msgRow = (key, level, at, text, right) =>
        h(
          'div',
          {
            key,
            style: {
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '5px 0 5px 8px',
              borderBottom: '1px solid #f1f7fa',
              // 左侧 3px 色条：扫一眼就知道哪条要处理（P2 不画）
              borderLeft: level < 2 ? `3px solid ${LEVEL_C[level]}` : '3px solid transparent',
              marginLeft: -8,
            },
          },
          levelIcon(level),
          h(
            'div',
            { style: { flex: '1 1 auto', minWidth: 0 } },
            h('p', { style: { margin: 0, fontSize: 12.5, color: '#33405c', lineHeight: 1.5, wordBreak: 'break-word' } }, text),
            at
              ? h('p', { style: { margin: '1px 0 0', fontSize: 11, color: '#8a97ad' } }, clockOf(at))
              : null,
          ),
          right || null,
        )

      // v1.2.2：「知道了」两条通路 —— 电脑走面板接口，手机走公网口的 ack（设备凭据）
      // 手机也能点，是因为手机上本来就能操作 DSH 权限，标已读不算越权。
      const ackItem = async (field, seq) => {
        const body = field === 'notice' ? { notice: seq } : { ack: seq }
        try {
          await request('/ack', body)
          return true
        } catch {
          try {
            const r = await fetch('/__myphone/ack', {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-myphone-phone': '1' },
              body: JSON.stringify(body),
              credentials: 'include',
            })
            if (r.ok) {
              refresh()
              return true
            }
          } catch {
            /* 两条都不通就静默：下次轮询会把状态纠正回来 */
          }
          return false
        }
      }

      const msgBox = (rows) =>
        h(
          'div',
          {
            style: {
              maxHeight: 158,
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              background: '#fbfeff',
              border: '1px solid #e6f2f7',
              borderRadius: 10,
              padding: '2px 9px',
            },
          },
          rows,
        )

      // 第一段：要你判断的。点「知道了」才算处理完（手机端也一样）
      const feedPendingBlock = () => {
        if (!feedPending.length) return null
        return h(
          'div',
          { style: { margin: '2px 0 8px' } },
          h(
            'p',
            { style: { margin: '0 0 4px', fontSize: 12, fontWeight: 800, color: '#e06c00' } },
            `待处理 · ${feedPending.length} 条`,
          ),
          msgBox([
            ...feedPending
              .slice(0, 3)
              .map((a) =>
                msgRow(
                  a.id,
                  a.level,
                  a.at,
                  a.text,
                  h(
                    'button',
                    {
                      type: 'button',
                      onClick: () => ackItem('ack', a.seq),
                      style: { ...smallBtn, color: '#0f7d99', borderColor: '#bfe7f2', flex: '0 0 auto' },
                    },
                    '知道了',
                  ),
                ),
              ),
            feedPending.length > 3
              ? h(
                  'p',
                  { key: 'more', style: { margin: '4px 0 2px', fontSize: 11.5, color: '#8a97ad' } },
                  `还有 ${feedPending.length - 3} 条，处理掉上面的就会露出来`,
                )
              : null,
          ]),
        )
      }

      // 第二段：人需要知道的事（谁连进来、入口关了、地址变了）
      const feedHumanBlock = () => {
        if (!feedHuman.length) return null
        const color = (kind) => (kind === 'join' ? '#0a7a4b' : kind === 'entry' ? '#0f7d99' : '#e06c00')
        return h(
          'div',
          { style: { margin: '2px 0 8px' } },
          h('p', { style: { margin: '0 0 4px', fontSize: 12, fontWeight: 800, color: '#3c5670' } }, '最近动态'),
          msgBox(
            feedHuman.map((e) =>
              msgRow(
                e.id,
                Number.isInteger(e.level) ? e.level : 2,
                e.at,
                e.text,
                e.ackable
                  ? h(
                      'button',
                      {
                        type: 'button',
                        onClick: () => ackItem('notice', e.seq),
                        style: { ...smallBtn, color: '#0f7d99', borderColor: '#bfe7f2', flex: '0 0 auto' },
                      },
                      '知道了',
                    )
                  : null,
              ),
            ),
          ),
        )
      }
 (d) => {
        const editing = noteFor === d.id
        const name = d.note ? `${d.note}（${d.label}）` : d.label
        return h(
          'div',
          {
            key: d.id,
            style: {
              // 每条设备做成一张独立卡片：白底 + 细边框 + 左侧状态色条，
              // 一眼能分清「这是另一台设备」，也不至于像表格那样挤在一起。
              //
              // 注意：这里四个边必须分开写（borderTop/Right/Bottom/Left），不能写成
              // `border: 1px solid X` + `borderLeft: 3px solid Y` —— React 只更新变化过的
              // 属性，`border` 简写一改就会重置四边，而 `borderLeft` 的字符串没变、不会重设，
              // 结果就是「编辑完备注后左侧色条凭空消失」。
              padding: '10px 11px',
              marginTop: 8,
              borderTop: `1px solid ${editing ? '#7fd3e0' : '#d7e8f0'}`,
              borderRight: `1px solid ${editing ? '#7fd3e0' : '#d7e8f0'}`,
              borderBottom: `1px solid ${editing ? '#7fd3e0' : '#d7e8f0'}`,
              borderLeft: `3px solid ${d.trusted ? '#19a7b8' : '#f0796b'}`,
              borderRadius: 12,
              background: d.trusted ? '#fbfeff' : '#fffaf9',
              boxShadow: editing
                ? '0 0 0 3px rgba(31,184,208,.12)'
                : '0 1px 2px rgba(12,52,72,.05)',
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h(
                'p',
                {
                  style: {
                    margin: 0,
                    fontSize: 14,
                    fontWeight: 600,
                    color: '#0d2436',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                },
                name,
                h(
                  'span',
                  {
                    style: {
                      marginLeft: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: 999,
                      background: d.trusted ? '#e8f6fa' : '#fff1ef',
                      color: d.trusted ? '#0d7c8c' : '#e02020',
                    },
                  },
                  d.trusted ? '已信任' : '未信任',
                ),
              ),
              h(
                'p',
                { style: { margin: '3px 0 0', fontSize: 12, color: '#7d93a8' } },
                `最近使用 ${clockOf(d.lastSeen)} · ${String(d.id).slice(0, 8)}`,
              ),
            ),
            h(
              'button',
              {
                type: 'button',
                disabled: busy,
                onClick: () => {
                  setNoteFor(editing ? null : d.id)
                  setNoteText(d.note || '')
                },
                style: smallBtn,
              },
              editing ? '收起' : '备注',
            ),
            h(
              'button',
              {
                type: 'button',
                disabled: busy,
                onClick: () => request('/device', { id: d.id, trusted: !d.trusted }),
                style: smallBtn,
              },
              d.trusted ? '断开' : '信任',
            ),
            h(
              'button',
              {
                type: 'button',
                disabled: busy,
                onClick: () => {
                  // 删除 = 撤销信任 + 移除，误点代价是对方得重新扫一次，所以问一
                  const who = d.note ? `${d.note}（${d.label}）` : d.label
                  if (window.confirm(`删除「${who}」？\n\n这台设备会立刻失去访问权，再用需要重新扫码。`)) {
                    void request('/device', { id: d.id, remove: true })
                  }
                },
                style: { ...smallBtn, color: '#e02020', borderColor: '#f6d5d0' },
              },
              '删除',
            ),
          ),
          editing
            ? h(
                'div',
                { style: { display: 'flex', gap: 6, marginTop: 8 } },
                h('input', {
                  value: noteText,
                  maxLength: 24,
                  placeholder: '比如：嘉然今天吃什么',
                  autoFocus: true,
                  onChange: (e) => setNoteText(e.target.value),
                  onKeyDown: (e) => {
                    if (e.key === 'Enter') saveNote(d.id)
                    if (e.key === 'Escape') {
                      e.stopPropagation() // 不然会冒泡到全局 Esc，把整个弹窗关掉
                      setNoteFor(null)
                    }
                  },
                  style: {
                    flex: 1,
                    minWidth: 0,
                    font: 'inherit',
                    fontSize: 13,
                    padding: '6px 9px',
                    borderRadius: 9,
                    border: '1px solid #dbe9f0',
                    outline: 'none',
                    color: '#0d2436',
                    background: '#fbfeff',
                  },
                }),
                h(
                  'button',
                  {
                    type: 'button',
                    disabled: busy,
                    onClick: () => saveNote(d.id),
                    style: { ...smallBtn, background: '#0f7d99', color: '#ffffff', borderColor: 'transparent' },
                  },
                  '保存',
                ),
              )
            : null,
        )
      }

      // 「自动关闭」按通道各留一份：局域网闲了关局域网，外网闲了关外网，互不牵连
      // 位置放在对应通道的地址上面一行（用户要求：紧贴它管的那条地址）
      const autoOffRow = (key, minutes) =>
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '2px 0 6px' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 } },
            h('span', { style: { margin: 0, fontSize: 12.5, color: '#5f7b93' } }, '自动关闭'),
            infoDot(`autooff-${key}`, '到点没人用就自动关掉这条入口，手机那头会掉线（电脑这边随时点开关就能立刻再开）。'),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 3, background: '#f1f9fc', borderRadius: 9, padding: 2 } },
            [0, 15, 30, 60, 120].map((m) => {
              const active = Number(minutes || 0) === m
              return h(
                'button',
                {
                  key: m,
                  type: 'button',
                  disabled: busy,
                  title: m ? `${m} 分钟没动静就自己关掉这条入口` : '一直开着，不自动关',
                  onClick: () => request('/autooff', { key, minutes: m }),
                  style: {
                    font: 'inherit',
                    fontSize: 12,
                    padding: '3px 7px',
                    borderRadius: 7,
                    cursor: 'pointer',
                    border: 'none',
                    background: active ? '#ffffff' : 'transparent',
                    color: active ? '#0d2436' : '#5f7b93',
                    fontWeight: active ? 700 : 500,
                    boxShadow: active ? '0 1px 3px rgba(10,43,64,.14)' : 'none',
                  },
                },
                m ? `${m}分` : '关',
              )
            }),
          ),
        )

      // 三个音效开关排一行：按钮自己就是标签，开=实心青、关=白底
      const soundChips = () => {
        const items = [
          ['hover', '滑入滑出音'],
          ['button', '点击音'],
          ['bubble', '气泡提示音'],
        ]
        return h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' } },
          items.map(([key, label]) =>
            h(
              'button',
              {
                key,
                type: 'button',
                onClick: () => {
                  const next = !sound[key]
                  setSoundKey(key, next)
                  // 打开时立刻试听一次，省得不知道有没有生效
                  if (next) {
                    // 试听一次：滑动和点击都是一对音，连着放才听得出来
                    if (key === 'bubble') {
                      audio.notice()
                    } else if (key === 'button') {
                      audio.press()
                      setTimeout(() => audio.release(), 140)
                    } else {
                      audio.enter()
                      setTimeout(() => audio.leave(), 170)
                    }
                  }
                },
                style: {
                  flex: 1,
                  padding: '5px 6px',
                  borderRadius: 999,
                  font: 'inherit',
                  fontSize: 11.5,
                  lineHeight: 1.45,
                  cursor: 'pointer',
                  // 浅色系：开 = 浅青底 + 深青字（跟弹窗同一套），关 = 白底灰字
                  border: `1px solid ${sound[key] ? '#7fcfe0' : '#dbe7f0'}`,
                  background: sound[key] ? '#e6f7fa' : '#ffffff',
                  color: sound[key] ? '#0a5f75' : '#4a637c',
                  fontWeight: sound[key] ? 700 : 500,
                  whiteSpace: 'nowrap',
                  transition: 'background .16s ease, border-color .16s ease, color .16s ease',
                },
              },
              `${label} ${sound[key] ? '开' : '关'}`,
            ),
          ),
        )
      }

      // 音色 + 音量：一行放「音色 [下拉] 音量 [音量条] 50%」
      // 音色决定「什么声音」，音量条决定「多大声」（总线增益 = 百分比 × 0.03，50% → 1.5）
      const timbreRow = () => {
        const cur = TIMBRES.find((t) => t.id === sound.timbre) || TIMBRES[0]
        const volPct = Math.max(0, Math.min(100, Number(sound.volume) || 0))
        return h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' } },
          // 顺序：「音量 [滑块] 百分比 · 音色 [下拉]」
          // 两个标签都用 paneTitle —— 跟「外网访问」那一行的标题同款
          h('p', { style: { ...paneTitle, flex: '0 0 auto', fontSize: 12.5, fontWeight: 600, color: '#7d93a8', margin: 0 } }, '音量'),
          h('input', {
            type: 'range',
            min: 0,
            max: 100,
            step: 5,
            value: volPct,
            'aria-label': '音效音量',
            title: `音量 ${volPct}%`,
            onChange: (e) => setSoundKey('volume', Number(e.target.value)),
            // 松手试听一次：拖的时候不响，免得糊成一片
            onPointerUp: () => audio.preview(sound.timbre),
            onKeyUp: () => audio.preview(sound.timbre),
            style: { flex: 1, minWidth: 56, height: 16, accentColor: '#0d7c8c', cursor: 'pointer', margin: 0 },
          }),
          h(
            'span',
            { style: { ...paneHint, flex: '0 0 auto', minWidth: 32, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } },
            `${volPct}%`,
          ),
          h('p', { style: { ...paneTitle, flex: '0 0 auto', fontSize: 12.5, fontWeight: 600, color: '#7d93a8', margin: 0 } }, '音色'),
          h(
            'span',
            { className: 'dmp-selwrap', ref: selRef },
            h(
              'button',
              {
                type: 'button',
                className: 'dmp-selbtn',
                'aria-haspopup': 'menu',
                'aria-expanded': selOpen ? 'true' : 'false',
                onClick: () => setSelOpen((v) => !v),
              },
              cur.label,
              h('span', { style: { marginLeft: 4, opacity: 0.65, fontSize: 9 } }, '▼'),
            ),
            h(
              'div',
              { className: selOpen ? 'dmp-menu on' : 'dmp-menu' },
              h(
                'div',
                { className: 'dmp-menu-card', role: 'menu' },
                TIMBRES.map((t) =>
                  h(
                    'button',
                    {
                      key: t.id,
                      type: 'button',
                      role: 'menuitem',
                      className: t.id === sound.timbre ? 'dmp-item on' : 'dmp-item',
                      onClick: () => {
                        setSoundKey('timbre', t.id)
                        audio.preview(t.id)
                        setSelOpen(false)
                      },
                    },
                    t.label,
                  ),
                ),
              ),
            ),
          ),
        )
      }

      const advancedPane = h(
        'div',
        null,
        sectionTitle('这台电脑的入口'),
        toggleRow(
          '局域网访问',
          '同一个 Wi-Fi 下可用，不经任何第三方',
          Boolean(data && data.lanEnabled),
          'lan',
          '局域网地址是 http 明文：只在自己家 Wi-Fi 下用。用手机流量 / 公司网络时请扫外网那个 https 的 —— http 在移动网络上可能被运营商插广告或直接跳转到别的网站。',
        ),
        addrRow(data && data.lanUrl, 'lan'),
        toggleRow(
          '外网访问',
          '走 Cloudflare 隧道，出门在外也能时时连回',
          Boolean(data && data.tunnelEnabled),
          'tunnel',
          '外网地址是 https（证书由 Cloudflare 签发），每次重启 DSH 都会换一个新域名，旧域名会提示「地址已经过期」。',
        ),
        autoOffRow('tunnel', data && data.tunnelAutoOffMinutes),
        addrRow(data && data.tunnelUrl, 'tun'),
        h(
          'p',
          { style: warnStrong },
          '为了安全，链接不要随便发送给别人使用。',
        ),
        sectionTitle(
          '已配对设备',
          h(
            'span',
            { style: { fontSize: 12, color: '#7d93a8' } },
            `${devices.length}/${(data && data.maxDevices) || 8}`,
          ),
          {
            key: 'devices',
            text: '「断开」= 这台手机立刻进不来，记录还在，下次扫码就能重新连上；\n「删除」= 连记录一起清掉，等于一台新设备。',
          },
        ),
        notices.map(noticeCard),
        devices.length ? null : h('p', { style: paneHint }, '还没有设备连进来过。'),
        devices.length
          ? h(
              'div',
              {
                style: {
                  marginTop: 2,
                  maxHeight: 214,
                  overflowY: 'auto',
                  WebkitOverflowScrolling: 'touch',
                  paddingRight: 2,
                  paddingBottom: 2,
                },
              },
              devices.map(deviceRow),
            )
          : null,
        devices.length
          ? h(
              'div',
              { style: { display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' } },
              h(
                'button',
                {
                  type: 'button',
                  disabled: busy,
                  onClick: () => {
                    if (window.confirm(`断开全部 ${devices.length} 台设备并删掉记录？\n\n它们会全部掉线，以后每台都要重新扫码。`)) {
                      void request('/device', { removeAll: true })
                    }
                  },
                  style: { ...smallBtn, color: '#e02020', borderColor: '#f6d5d0' },
                },
                '全部断开',
              ),
            )
          : null,
        // 其它提醒（等你回答 / 出错 / 整理上下文 / 计划模式）：点 ✕ 收掉
        alerts.length
          ? h(
              'div',
              { key: 'alerts' },
              sectionTitle(
                '提醒',
                h(
                  'span',
                  {
                    style: {
                      borderRadius: 999,
                      padding: '0 7px',
                      fontSize: 11.5,
                      fontWeight: 800,
                      background: '#eaf6f9',
                      color: '#0a6d84',
                      border: '1px solid #bfe3ec',
                    },
                  },
                  String(alerts.length),
                ),
              ),
              alerts
                .slice()
                .reverse()
                .map((a) =>
                  h(
                    'div',
                    {
                      key: a.seq,
                      // 点一下这条＝「我看到了」，从列表里收掉（不再自动消失，用户要求）
                      onClick: () => request('/approval', { seq: a.seq }),
                      title: '点一下收掉这条提醒',
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '3px 0',
                        fontSize: 13,
                        cursor: 'pointer',
                        borderRadius: 6,
                      },
                    },
                    h('span', { style: { flex: '1 1 auto', minWidth: 0, wordBreak: 'break-word' } }, String(a.text || '')),
                    h(
                      'button',
                      {
                        type: 'button',
                        onClick: () => void request('/alert', { seq: a.seq }),
                        style: { ...smallBtn, padding: '2px 8px' },
                        title: '看过了，收掉这条',
                      },
                      '✕',
                    ),
                  ),
                ),
            )
          : null,
        // 免打扰（v1.3.0）：只压气泡，不影响消息记录
        sectionTitle('免打扰', null, {
          key: 'quiet',
          big: true,
          text:
            '静音或免打扰时段内不弹气泡，但消息照样记在下面的「消息」里，不会丢。\n' +
            '一键静音只管这次；免打扰时段每天都会生效。',
        }),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', flexWrap: 'wrap' } },
          h(
            'button',
            {
              type: 'button',
              style: { ...smallBtn, padding: '5px 10px' },
              onClick: () => void request('/quiet', { mutedUntil: Date.now() + 30 * 60_000 }),
            },
            '静音 30 分钟',
          ),
          h(
            'button',
            {
              type: 'button',
              style: { ...smallBtn, padding: '5px 10px' },
              onClick: () => void request('/quiet', { mutedUntil: 0 }),
            },
            '取消静音',
          ),
          h(
            'span',
            { style: { fontSize: 12, color: '#7d93a8' } },
            Number(data && data.mutedUntil) > Date.now()
              ? `已静音到 ${pad2(new Date(data.mutedUntil).getHours())}:${pad2(new Date(data.mutedUntil).getMinutes())}`
              : '现在会正常响',
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' } },
          h('span', { style: { fontSize: 12.5, color: '#33506a', flex: '0 0 auto' } }, '每日免打扰'),
          h('input', {
            type: 'time',
            defaultValue: String((data && data.quietStart) || ''),
            onChange: (e) => void request('/quiet', { quietStart: e.target.value }),
            style: { ...timeInputStyle },
          }),
          h('span', { style: { fontSize: 12, color: '#7d93a8' } }, '→'),
          h('input', {
            type: 'time',
            defaultValue: String((data && data.quietEnd) || ''),
            onChange: (e) => void request('/quiet', { quietEnd: e.target.value }),
            style: { ...timeInputStyle },
          }),
          h('span', { style: { fontSize: 11.5, color: '#8a97ad' } }, '留空 = 不启用'),
        ),
        // 音效管理：滑入滑出音默认关（鼠标扫来扫去太吵），点击音和气泡音默认开
        // 「！」放在「音效」后面：说明只跟提示音有关，与连接无关
        sectionTitle('音效', null, {
          key: 'sound',
          big: true,
          text:
            '只是本机的提示音，不影响连接。\n' +
            '浏览器要求「先点过页面」才允许出声，所以第一次点完之后才会响。\n' +
            '音色选「什么声音」，音量条调「多大声」（默认 100%）。',
        }),
        soundChips(),
        timbreRow(),
        // ── 消息中心（v1.2.0）────────────────────────────────────────────
        // 三段式：待处理（要人判断）/ 最近动态（人需要知道）/ 技术日志（机器噪音，默认折叠）
        // 全部紧凑 + 限高 + 内部滑动，别把一个模块撑满整页
        h('div', { key: 'msg-anchor', id: 'dmp-msg', style: { height: 1 } }),
        sectionTitle('消息', null, {
          key: 'feed',
          big: true,
          text:
            '琥珀色带锁的 = 等你决定；橙色带感叹号的 = 值得留意；蓝绿色的 = 日常记录。\n' +
            '「待处理」点了「知道了」才算收掉；手机上也能点，但授权本身要回 DSH 里处理。',
        }),
        feedPendingBlock(),
        feedHumanBlock(),
        // 排查日志放最下面：平时不用看，出问题才翻
        sectionTitle(
          '技术日志',
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h(
              'button',
              {
                type: 'button',
                onClick: () => setLogOpen((v) => !v),
                style: { ...smallBtn, color: logOpen ? '#3c5670' : '#0f7d99', borderColor: logOpen ? '#e6f2f7' : '#bfe7f2' },
              },
              logOpen ? '收起' : `展开${events.length ? `（${events.length}）` : ''}`,
            ),
            h(
              'button',
              {
                type: 'button',
                disabled: busy,
                onClick: () => request('/clear', {}),
                style: smallBtn,
              },
              '清空',
            ),
            h(
              'button',
              {
                type: 'button',
                onClick: () =>
                  copy(
                    JSON.stringify(
                      {
                        at: new Date().toISOString(),
                        lan: data && data.lanEnabled,
                        lanAutoOffMinutes: data && data.lanAutoOffMinutes,
                        lanPort: data && data.lanPort,
                        tunnel: data && data.tunnelEnabled,
                        tunnelAutoOffMinutes: data && data.tunnelAutoOffMinutes,
                        publicPort: data && data.publicPort,
                        tunnelUrl: data && data.tunnelUrl,
                        deviceCount: devices.length,
                        devices,
                        events,
                      },
                      null,
                      2,
                    ),
                    'diag',
                  ),
                style: smallBtn,
              },
              copied === 'diag' ? '已复制' : '复制日志',
            ),
          ),
          {
            key: 'logs',
            text: '「清空」把下面这些记录和 pair.log / error.log 一起清掉（各留一份 .1 备份）。\n「复制日志」把当前状态 + 记录复制成一段文字，发给我排错就行。',
          },
        ),
        logOpen
          ? h(
              'div',
              null,
              h(
                'p',
                { style: { ...paneHint, margin: '2px 0 0' } },
                `管理口 127.0.0.1:${(data && data.lanPort) || '—'} · 入口口 :${(data && data.publicPort) || '—'}`,
              ),
              pluginVersion
                ? h(
                    'p',
                    { style: { ...paneHint, margin: '6px 0 0', fontSize: 10.5, color: '#9aa8bb' } },
                    `DSH My Phone v${pluginVersion}（跟 package.json 对得上就说明界面是最新的；对不上就是缓存了旧模块，Ctrl+R 刷新一下）`,
                  )
                : null,
              // 手机上看不到球时，这一行就是判据：没挂载 = 插槽没生效；挂载了 = 画上去但被遮住
              h(
                'p',
                {
                  style: {
                    ...paneHint,
                    margin: '4px 0 0',
                    fontSize: 10.5,
                    color: FAB_PROBE.mountedAt ? '#0a7a4b' : '#e02020',
                  },
                },
                FAB_PROBE.mountedAt
                  ? `悬浮球：已挂载（${clockOf(FAB_PROBE.mountedAt)}）${FAB_PROBE.rect ? ` · ${FAB_PROBE.rect}` : ''}`
                  : `悬浮球：未挂载（插槽 ${FAB_PROBE.slot}）—— 请把这行截图发我`,
              ),
              techRows.length
                ? h(
                    'div',
                    {
                      style: {
                        marginTop: 6,
                        maxHeight: 168,
                        overflowY: 'auto',
                        WebkitOverflowScrolling: 'touch',
                        background: '#fbfeff',
                        border: '1px solid #e6f2f7',
                        borderRadius: 10,
                        padding: '6px 9px',
                      },
                    },
                    techRows.map((e, i) =>
                      h(
                        'div',
                        {
                          key: `${e.at}-${i}`,
                          style: { display: 'flex', gap: 8, padding: '3px 0', fontSize: 12.5, lineHeight: 1.5 },
                        },
                        h('span', { style: { color: '#7d93a8', flex: '0 0 auto' } }, clockOf(e.at)),
                        h(
                          'span',
                          {
                            style: {
                              color:
                                e.kind === 'error'
                                  ? '#e02020'
                                  : e.kind === 'upstream' || e.kind === 'tunnel' || e.kind === 'autooff'
                                    ? '#e06c00'
                                    : '#3c5670',
                              wordBreak: 'break-word',
                            },
                          },
                          e.text,
                        ),
                      ),
                    ),
                  )
                : h('p', { style: { ...paneHint, marginTop: 6 } }, '还没有记录。'),
            )
          : null,
      )

      // ---- 手机形态的两页 ----------------------------------------------------
      // 手机上能看到的只有：连上没有、这台设备是什么、电脑端有几台、最近发生了什么
      // 开关、换码、撤销别的设备都
      const rDevice = (remote && remote.device) || null
      const rEvents = ((remote && remote.events) || []).slice().reverse()
      const rFeed = (remote && remote.feed) || {}
      const rFeedPending = rFeed.pending || []
      const rFeedHuman = rFeed.human || []
      const entry = typeof window !== 'undefined' ? window.location.origin : ''
      const wide = isWide()
      // 入口开关状态：电脑端看 data，手机端 data 恒为 null，只能看 /__myphone/state 的 remote（v1.3.1 修 TDZ：
      // 以前这行写在 remoteConnect 之后，渲染时命中「Cannot access 'entryOpen' before initialization」→ 整棵树被错误边界换掉
      const entryOpen = Boolean(
        (data && (data.lanEnabled || data.tunnelEnabled)) ||
          (remote && (remote.lanEnabled || remote.tunnelEnabled)),
      )


      const remoteConnect = h(
        'div',
        null,
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '14px 16px',
              borderRadius: 16,
              background: rDevice ? '#eaf6fa' : '#fff3f1',
              border: `1px solid ${rDevice ? '#bfe4ec' : '#f3c3bc'}`,
            },
          },
          h('span', {
            style: { width: 10, height: 10, borderRadius: 999, flex: '0 0 auto', background: rDevice ? '#0d7c8c' : '#e02020' },
          }),
          h(
            'div',
            { style: { minWidth: 0 } },
            h(
              'p',
              { style: { margin: 0, fontSize: 16, fontWeight: 800, color: rDevice ? '#0d7c8c' : '#e02020' } },
              rDevice ? '已连接' : '没连上',
            ),
            h(
              'p',
              { style: { margin: '2px 0 0', fontSize: 13, color: '#3c5670', wordBreak: 'break-all' } },
              rDevice ? `${rDevice.label} · 这台手机` : '这台设备的凭据失效了，回电脑上重新扫码',
            ),
          ),
        ),
        h(
          'p',
          { style: { ...paneHint, marginTop: 12 } },
          rDevice
            ? '这台手机已经是那台电脑的一部分了，凭据在有效期内不用再扫。要断开就去那台电脑上的「已配对设备」里断开它'
            : '在电脑上点右下角那个图标，用手机相机扫它显示出来的二维码。',
        ),
        rDevice && !entryOpen
          ? h(
              'p',
              { style: { ...warnStrong, marginTop: 10 } },
              '注意：电脑上两个入口都关着（可能是空闲自动关闭了），请在电脑上打开「高级」重新开启，否则刷新就进不来了。',
            )
          : null,
        h(
          'div',
          { style: { marginTop: 14, borderTop: '1px solid #e6f2f7', paddingTop: 10 } },
          h('p', { style: paneTitle }, '入口地址'),
          h(
            'div',
            {
              style: {
                marginTop: 6,
                background: '#f3fafd',
                border: '1px solid #e3f0f5',
                borderRadius: 12,
                padding: '9px 11px',
                fontFamily: 'ui-monospace, Consolas, monospace',
                fontSize: 12.5,
                color: '#3c5670',
                wordBreak: 'break-all',
              },
            },
            entry || '—',
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 8, marginTop: 10 } },
            h('button', { type: 'button', onClick: () => copy(entry, 'entry'), style: actionBtn }, copied === 'entry' ? '已复制' : '复制地址'),
          ),
        ),
        h(
          'div',
          { style: { marginTop: 12, borderTop: '1px solid #e6f2f7', paddingTop: 10 } },
          h('p', { style: paneTitle }, '看不太清？'),
          h('p', { style: paneHint }, '手机屏幕窄，可以把画面放大成一整块桌面宽度，或者试着锁横屏。'),
          h(
            'div',
            { style: { display: 'flex', gap: 8, marginTop: 10 } },
            h('button', { type: 'button', onClick: () => setWide(!wide), style: actionBtn }, wide ? '恢复手机宽度' : '放大成桌面宽度'),
            h(
              'button',
              {
                type: 'button',
                onClick: async () => {
                  const msg = await goLandscape()
                  if (msg) setErr(msg)
                  else setErr('')
                },
                style: { ...actionBtn, borderColor: 'transparent', background: '#0f7d99', color: '#fff', fontWeight: 700 },
              },
              '全屏横屏',
            ),
          ),
          wide ? h('p', { style: { ...paneHint, marginTop: 8 } }, '现在是桌面宽度（1280），需要左右滑动看全。') : null,
        ),
      )

      const remoteAdvanced = h(
        'div',
        null,
        h(
          'div',
          { style: { paddingTop: 2 } },
          h('p', { style: paneTitle }, '这台设备'),
          h(
            'p',
            { style: paneHint },
            rDevice ? `记为「${rDevice.label}」· 最近使用 ${clockOf(rDevice.lastSeen)}` : '还没有有效凭据',
          ),
          rDevice
            ? h(
                'p',
                { style: { ...paneHint, marginTop: 4 } },
                `电脑端现在共 ${(remote && remote.devices) || 1} 台设备（含这台）；开关和管理只能在那台电脑上改。`,
              )
            : null,
        ),
        h(
          'div',
          { style: { marginTop: 12, borderTop: '1px solid #e6f2f7', paddingTop: 10 } },
          h('p', { style: paneTitle }, `需要你处理 · ${rFeedPending.length} 条`),
          h(
            'p',
            { style: paneHint },
            rFeedPending.length
              ? '点「知道了」只表示你看到了；授权本身要回 DSH 里处理。'
              : '现在没有等你决定的事。',
          ),
          rFeedPending.length
            ? msgBox(
                rFeedPending.map((a) =>
                  msgRow(
                    a.id,
                    Number.isInteger(a.level) ? a.level : 0,
                    a.at,
                    a.text,
                    h(
                      'button',
                      {
                        type: 'button',
                        onClick: () => ackItem('ack', a.seq),
                        style: { ...smallBtn, color: '#0f7d99', borderColor: '#bfe7f2', flex: '0 0 auto' },
                      },
                      '知道了',
                    ),
                  ),
                ),
              )
            : null,
          rFeedHuman.length
            ? h(
                'div',
                { style: { marginTop: 8 } },
                h('p', { style: { ...paneHint, color: '#5b6b85' } }, '最近动态'),
                msgBox(
                  rFeedHuman.map((e) =>
                    msgRow(
                      e.id,
                      Number.isInteger(e.level) ? e.level : 2,
                      e.at,
                      e.text,
                      e.ackable
                        ? h(
                            'button',
                            {
                              type: 'button',
                              onClick: () => ackItem('notice', e.seq),
                              style: { ...smallBtn, color: '#0f7d99', borderColor: '#bfe7f2', flex: '0 0 auto' },
                            },
                            '知道了',
                          )
                        : null,
                    ),
                  ),
                ),
              )
            : null,
        ),
        h(
          'div',
          { style: { marginTop: 12, borderTop: '1px solid #e6f2f7', paddingTop: 10 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('p', { style: { ...paneTitle, flex: 1 } }, '排查'),
            h(
              'button',
              {
                type: 'button',
                onClick: () =>
                  copy(
                    JSON.stringify({ at: new Date().toISOString(), at_entry: entry, device: rDevice, events: rEvents }, null, 2),
                    'diag',
                  ),
                style: smallBtn,
              },
              copied === 'diag' ? '已复制' : '复制日志',
            ),
          ),
          h('p', { style: paneHint }, '排查只读：手机端不能开关入口，也不能断开别的设备。'),
          rEvents.length
            ? h(
                'div',
                { style: { marginTop: 8, maxHeight: 160, overflow: 'auto', WebkitOverflowScrolling: 'touch' } },
                rEvents.map((e, i) =>
                  h(
                    'div',
                    { key: `${e.at}-${i}`, style: { display: 'flex', gap: 8, padding: '3px 0', fontSize: 12.5, lineHeight: 1.5 } },
                    h('span', { style: { color: '#7d93a8', flex: '0 0 auto' } }, clockOf(e.at)),
                    h(
                      'span',
                      {
                        style: {
                          color: e.kind === 'error' ? '#e02020' : e.kind === 'upstream' ? '#e06c00' : '#3c5670',
                          wordBreak: 'break-word',
                        },
                      },
                      e.text,
                    ),
                  ),
                ),
              )
            : h('p', { style: { ...paneHint, marginTop: 6 } }, '还没有记录。'),
        ),
      )

      const modal = h(
        'div',
        {
          onClick: () => {
            if (!PANEL_STICKY) setOpen(false)
          },
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: FAB_Z_MODAL,
            background: 'rgba(8,26,38,.42)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          },
        },
        h(
          'div',
          {
            ref: modalRef,
            className: 'dmp-modal',
            onClick: (e) => e.stopPropagation(),
            style: {
              width: 428,
              maxWidth: '100%',
              maxHeight: '86vh',
              // 头部（标题 + 两个 tab）固定，只让下面的内容滚：以前整块 overflow:auto，
              // 一滚到底就把「连接 / 高级」划走了，想切页还得先滚回顶部。
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              background: '#ffffff',
              color: '#0d2436',
              borderRadius: 22,
              padding: '18px 20px 14px',
              boxShadow: '0 24px 70px rgba(6,24,36,.34)',
              ...(popFrom ? { '--dpx': `${popFrom.dx}px`, '--dpy': `${popFrom.dy}px` } : null),
            },
          },
          h(
            'div',
            { style: { flex: '0 0 auto' } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
              h('p', { style: { margin: 0, fontSize: 16.5, fontWeight: 800 } }, mode === 'remote' ? '这台手机·DSH My Phone' : '手机连到这台电脑'),
              h(
                'button',
                {
                  type: 'button',
                  'aria-label': '关闭',
                  onClick: () => setOpen(false),
                  style: {
                    border: 'none',
                    background: 'transparent',
                    color: '#7d93a8',
                    fontSize: 20,
                    lineHeight: 1,
                    cursor: 'pointer',
                    padding: '2px 4px',
                  },
                },
                '×',
              ),
            ),
            h(
              'div',
              { style: { display: 'flex', borderBottom: '1px solid #e6f2f7', margin: '6px 0 12px' } },
              tabBtn('connect', '连接'),
              tabBtn('advanced', '高级', mode === 'local' && unread > 0),
            ),
          ),
          h(
            'div',
            {
              className: 'dmp-pane',
              style: {
                flex: '1 1 auto',
                minHeight: 0,
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch',
                margin: '0 -6px 0 -4px',
                padding: '0 12px 2px 4px',
              },
            },
            mode === 'remote' ? (tab === 'connect' ? remoteConnect : remoteAdvanced) : tab === 'connect' ? connectPane : advancedPane,
            err ? h('p', { style: { color: '#e02020', fontSize: 13, margin: '12px 0 0' } }, `出错：${err}`) : null,
          ),
        ),
      )

      // 窗口尺寸变了就重算一次（百
      const vp = vpSize
      const fabPoint = dragPos
        ? { x: dragPos.x + FAB_W / 2, y: dragPos.y + FAB_H / 2 }
        : posOf(anchor, vp.w, vp.h)
      const wrapStyle = dragPos
        ? { position: 'fixed', zIndex: FAB_Z, width: FAB_W, height: FAB_H, left: dragPos.x, top: dragPos.y }
        : anchorStyle(anchor, vp.w, vp.h)
      // 贴着哪条边（null = 没贴边，比如正在拖）：决定整块图转多少度、外接盒子多大
      const fabEdge = dragPos ? null : edgeOf(anchor, vp.w, vp.h)
      const fabBox = boxFor(fabEdge)

      // 球下面那行字：没设备连着就一直挂着「
      // 只剩图标（用户要的「连上以后胶囊也消失」）。红点、气泡不受影响
      // 手机上（mode==='remote'）本来就已经在这台电脑里了，那行「
      const trustedCount = ((data && data.deviceList) || []).filter((d) => d.trusted).length
      // 只在「确定自己是电脑端」时才挂那行字：手机上（remote）不该出现，
      // 状态还没判明（unknown）时也不画，免得先闪一下再消失。
      // 用户要求：球下面那行「连接 DSH」去掉（只留图标，需要说明时看悬停气泡），
      // 而且盒子高度不再包含这一行，贴底边才贴得死。
      const showLabel = false && mode === 'local' && trustedCount === 0
      const fabLabel = !data
        ? '连接 DSH'
        : data.lanEnabled || data.tunnelEnabled
          ? '连接 DSH'
          : '入口已关'
      const fabLabelColor = data && !(data.lanEnabled || data.tunnelEnabled) ? '#5b6b84' : '#22354a'

      // 气泡朝上还是朝下、靠左还是靠右，全看球现在在窗口的哪一
      const bubbleAbove = fabPoint.y > FAB_H + 140
      const bubbleLeft = fabPoint.x < vp.w / 2
      // ── 气泡：信笺排版（用户选定 A 案）
      //    tag（小标签：10px 灰、字距拉开） / meta（信头右侧时间，等宽数字）
      //    main（正文：14px/700 墨色、左对齐） / sign（落款：11px 灰、右对齐、前置破折号）
      const bubbleCardData = bubble && bubble.card ? bubble.card : null
      const renderBubbleMain = (main) =>
        main && typeof main === 'object' && Array.isArray(main.parts)
          ? main.parts.map((p, j) =>
              h('span', { key: j, style: p.c ? { color: p.c, fontWeight: 900 } : null }, p.t),
            )
          : main
      const bubbleBox = bubbleCardData
        ? h(
            'div',
            {
              className: 'dmp-bubble',
              style: {
                position: 'absolute',
                [bubbleAbove ? 'bottom' : 'top']: FAB_H + 6,
                [bubbleLeft ? 'left' : 'right']: 0,
                width: 232,
                padding: '12px 16px 13px',
                borderRadius: 14,
                // 白底 + 鲸鱼那种青边；正文用墨色，浅青字在 10px 上根本读不清
                background: '#ffffff',
                border: '1px solid rgba(64,208,208,.55)',
                boxShadow: '0 14px 34px rgba(6,24,36,.24)',
                pointerEvents: bubbleCardData && bubbleCardData.clickable ? 'auto' : 'none',
                cursor: bubbleCardData && bubbleCardData.clickable ? 'pointer' : 'default',
                textAlign: 'left',
              },
              onClick: () => {
                if (!bubbleCardData || !bubbleCardData.clickable) return
                setFocusMsg(true)
                setTab('advanced')
                setOpen(true)
                setBubble(null)
              },
            },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
              h(
                'span',
                {
                  style: {
                    fontSize: 10.5,
                    letterSpacing: '0.08em',
                    fontWeight: 700,
                    color: (bubbleCardData && bubbleCardData.tagColor) || '#0b7f8c',
                  },
                },
                bubbleCardData.tag,
              ),
              bubbleCardData.meta
                ? h(
                    'span',
                    {
                      style: {
                        marginLeft: 'auto',
                        fontSize: 10.5,
                        letterSpacing: '0.04em',
                        fontWeight: 600,
                        color: '#4f6076',
                        fontVariantNumeric: 'tabular-nums',
                      },
                    },
                    bubbleCardData.meta,
                  )
                : null,
            ),
            h(
              'p',
              {
                style: {
                  margin: '7px 0 0',
                  fontSize: 14,
                  fontWeight: 700,
                  lineHeight: 1.5,
                  color: '#12202f',
                  // 文案里带设备名，长度不可控：允许折行，但不能 nowrap 顶出视口
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                },
              },
              renderBubbleMain(bubbleCardData.main),
            ),
            bubbleCardData.sign
              ? h(
                  'p',
                  {
                    style: {
                      margin: '7px 0 0',
                      fontSize: 11.5,
                      fontWeight: 600,
                      lineHeight: 1.5,
                      color: '#5c6d84',
                      textAlign: 'right',
                      whiteSpace: 'pre-wrap',
                    },
                  },
                  `—— ${bubbleCardData.sign}`,
                )
              : null,
          )
        : null

      // 移入 / 移出各播一次动画：'' → 还没动过；'in' → 往右摆（并保持在微抬姿态）；'out' → 摆回来
      // 只在鼠标上触发（触摸屏不会发 mouseenter，不会干扰拖拽与长按）
      const [tileHover, setTileHover] = useState('')

      const tree = h(
        'div',
        null,
        h(
          'div',
          {
            style: wrapStyle,
            className: 'dmp-wrap' + (tileHover === 'in' ? ' hov' : ''),
            onMouseEnter: () => setTileHover('in'),
            onMouseLeave: () => setTileHover('out'),
          },
          h(
            'button',
            {
              type: 'button',
              // 原生 title 会在鼠标停留时弹一个系统小黄条（「手机扫码连接 DSH（可以拖着走）」），
              // 用户明确不要它 —— 说明交给 aria-label（读屏还能读到），视觉提示交给自己的气泡。
              'aria-label': '手机扫码连接 DSH（双击回到上次放好的位置）',
              'aria-expanded': open ? 'true' : 'false',
              // 键盘 Enter/Space 只派发 click（detail === 0），指针点击走 onUp，
              // 以前没有这个分支，纯键盘用户永远打不开弹窗。
              onClick: (e) => {
                if (e.detail !== 0) return
                setOpen(!openRef.current)
              },
              onPointerDown: onDown,
              onPointerMove: onMove,
              onPointerUp: onUp,
              onPointerCancel: onUp,
              // 手机上长按会弹系统的「
              onContextMenu: (e) => {
                e.preventDefault()
              },
              onPointerEnter: (e) => {
                if (e.pointerType && e.pointerType !== 'mouse') return
                if (soundRef.current.hover) audio.enter() // 移进去：上行两声
                if (hoverTimer.current) clearTimeout(hoverTimer.current)
                hoverTimer.current = setTimeout(() => {
                  // 还没连过任何设备时，这句提示是「怎么开始」的入口 —— 不自动消失，
                  // 点一下球就收掉（用户要求）。
                  const noDeviceYet = mode !== 'remote' && trustedCount === 0
                  showBubble({ kind: 'hover', sticky: noDeviceYet, card: bubbleCard() }, noDeviceYet ? 0 : 4200)
                }, 300)
              },
              onPointerLeave: (e) => {
                // 触屏在 pointerup 之后还会补一个 pointerleave：不挡住的话，
                // 长按 420ms 刚弹出来的说明会在松手那一瞬间被清掉。
                if (e.pointerType && e.pointerType !== 'mouse') return
                if (soundRef.current.hover) audio.leave() // 移出来：下行两声
                if (hoverTimer.current) clearTimeout(hoverTimer.current)
                setBubble(null)
              },
              style: {
                position: 'relative',
                width: fabBox.w,
                height: fabBox.h,
                padding: 0,
                border: 'none',
                background: 'transparent',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: 4,
                cursor: 'grab',
                touchAction: 'none',
                userSelect: 'none',
                WebkitUserSelect: 'none',
              },
            },
            // 旧形态：白
            // 壁纸再花也读得清，又不像整块白卡片那样压视觉
            h(
              'span',
              {
                className:
                  'dmp-tile' +
                  (tileHover === 'in' ? ' hov-in' : tileHover === 'out' ? ' hov-out' : ''),
                style: {
                  position: 'relative',
                  width: FAB_W,
                  height: FAB_H,
                  borderRadius: 10,
                  // 贴边旋转用独立的 rotate 属性，跟 transform 的放大动画互不打架
                  rotate: fabEdge ? FAB_ROT[fabEdge] + 'deg' : undefined,
                  // 透明底是定稿外观（见 FAB_TILE_ALPHA 的注释）。
                  background: FAB_TILE_ALPHA ? 'transparent' : '#ffffff',
                  border: FAB_TILE_ALPHA ? 'none' : '1px solid rgba(10,43,64,.10)',
                  boxShadow: FAB_TILE_ALPHA ? 'none' : '0 8px 22px rgba(8,38,56,.22)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                },
              },
              iconOk
                ? h('img', {
                    src: ICON_URL,
                    alt: '',
                    draggable: false,
                    onError: () => setIconOk(false),
                    style: {
                      width: FAB_W,
                      height: FAB_H,
                      objectFit: 'fill',
                      pointerEvents: 'none',
                    },
                  })
                : FAB_LOGO,
              unread > 0
                ? h('span', {
                    className: 'dmp-dot',
                    style: {
                      position: 'absolute',
                      top: -6,
                      right: -6,
                      // 红点在旋转的图块里：反向转回来，数字才不会躺倒
                      rotate: fabEdge ? -FAB_ROT[fabEdge] + 'deg' : undefined,
                      minWidth: 24,
                      height: 24,
                      padding: '0 7px',
                      borderRadius: 999,
                      background: '#e6382b',
                      color: '#fff',
                      fontSize: 13,
                      fontWeight: 800,
                      lineHeight: '24px',
                      textAlign: 'center',
                      boxShadow: '0 2px 8px rgba(209,59,48,.45)',
                    },
                  }, unread > 9 ? '9+' : String(unread))
                : null,
            ),
          ),
          showLabel
            ? h(
                'span',
                {
                  className: 'dmp-label',
                  style: {
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    // 居中交给绝对定位 + translateX(-50%)：
                    // 无论文字长短都跟上面的图标中线对齐（之
                    top: FAB_TILE + 6,
                    width: 'max-content',
                    maxWidth: FAB_W + 64,
                    padding: '2px 9px',
                    boxSizing: 'border-box',
                    borderRadius: 999,
                    background: 'rgba(255,255,255,.90)',
                    border: '1px solid rgba(10,43,64,.10)',
                    boxShadow: '0 2px 6px rgba(12,30,60,.16)',
                    fontSize: 12.5,
                    fontWeight: 700,
                    lineHeight: 1.45,
                    letterSpacing: 0,
                    textAlign: 'center',
                    color: fabLabelColor,
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                  },
                },
                fabLabel,
              )
            : null,
          bubbleBox,
        ),
        open ? modal : null,
        // 「！」的说明浮层（网页里最常
        tip
          ? h(
              'div',
              {
                className: 'dmp-tip',
                role: 'tooltip',
                style: {
                  position: 'fixed',
                  left: Math.max(8, Math.min(tip.x - 130, (window.innerWidth || 360) - 268)),
                  top: Math.max(8, Math.min(tip.y, (window.innerHeight || 640) - 92)),
                  width: 260,
                  zIndex: FAB_Z_MODAL + 10,
                  padding: '8px 11px',
                  borderRadius: 10,
                  background: '#0a2b40',
                  border: '1px solid rgba(64,208,208,.45)',
                  color: '#eaf6fb',
                  fontSize: 11.5,
                  lineHeight: 1.62,
                  whiteSpace: 'pre-line',
                  borderRadius: 12,
                  boxShadow: '0 12px 30px rgba(6,24,36,.34)',
                  pointerEvents: 'none',
                },
              },
              tip.text,
            )
          : null,
      )
      // 整个悬浮球（含弹窗）都 portal 出去：
      // 插槽容器可能有 transform / overflow，那样 position:fixed 会变成「相对容器」；
      // 而且**不能挂在 body 上** —— 实测手机上球会出现一下又消失，原因是宿主重渲染时
      // 会清掉 body 下不属于自己的子节点。所以挂到 <html> 下自己的容器里，并带自动重挂。
      const host = portalHost()
      if (createPortal && host) return createPortal(tree, host)
      return tree
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 设置页里的卡片（备用入口：悬浮按钮被挡住时还能从这儿进）
        ctx.slots.inject('settings.plugin.item', () =>
          ctx.slots.register(
            {
              name: 'settings.plugin.item',
              key: 'dsh-my-phone',
              order: 40,
            },
            MyPhonePanel,
          ),
        )
        // 悬浮按钮**只挂一次，不再走 shell.overlay 插槽**。
        // 走插槽的代价：宿主每渲染一次就把插槽子树整棵换掉，球跟着重挂 → 屏幕上「一闪一闪」；
        // 而且插槽版和我们的备用挂载会同时存在，两个球各刷各的（更闪）。
        // 现在统一用独立 React root（挂 <html> 下、pointer-events 交给球自己），
        // 看护逻辑只负责「把被移走的宿主节点放回去」，绝不重建、绝不重复挂。
        try {
          window.__dshMyPhoneMountLegacy = mountLegacyInto
        } catch {
          /* 老浏览器忽略 */
        }
        const mountFab = () => {
          if (standaloneMounted) return true
          if (typeof document === 'undefined') return false
          return Boolean(mountStandalone())
        }
        if (!mountFab()) {
          // 极少数宿主里拿不到 react-dom/client：退回插槽注册，保证至少有一个球
          try {
            // v1.6.0：悬浮球与弹窗统一由 widget.js（纯 DOM）提供，这里不再注册 React 球，
            // 避免两套 UI 各说各话。React 这份只保留「设置 → 插件」那张卡片。
            void PhoneFab
            report('slot-fallback', '独立挂载不可用 → 退回 shell.overlay 插槽')
          } catch (err) {
            report('slot-fail', (err && err.message) || 'unknown')
          }
        }
        let emptyTicks = 0
        let rescueTries = 0
        let nextRetryAt = 0
        // 纯 DOM 兜底：完全不依赖 React。手机上曾出现「挂上就闪」，本质是 React 树被异常卸掉后
        // 我们反复重挂；这里先保证「屏幕上至少一直有一颗能点的球」，再慢慢修渲染问题。
        const domFallback = () => {
          try {
            // 兜底球自己也带 .dmp-wrap，不能让它把「React 球是否在」的判断骗过去
            if (document.querySelector('.dmp-wrap:not(.dmp-fallback)')) return true
            // widget.js（宿主注入的纯 DOM 球）在时绝不插兜底：否则屏幕上会有两颗
            if (window.__dshMyPhoneWidget) return true
            const b = document.createElement('button')
            b.className = 'dmp-wrap dmp-fallback'
            b.setAttribute('aria-label', 'DSH 手机入口')
            b.style.cssText =
              'position:fixed;right:12px;bottom:12px;width:88px;height:88px;padding:0;border:0;background:transparent;z-index:2147483000;pointer-events:auto;cursor:pointer'
            const img = document.createElement('img')
            img.src = ICON_URL
            img.alt = ''
            img.draggable = false
            img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block'
            b.appendChild(img)
            standaloneHost.appendChild(b)
            report('dom-fallback', 'React 树救不回来，已插入纯 DOM 兜底球')
            return true
          } catch (err) {
            report('dom-fallback-fail', (err && err.message) || String(err))
            return false
          }
        }
        const ensureFab = () => {
          if (typeof document === 'undefined') return
          if (!standaloneMounted) {
            if (!document.querySelector('.dmp-wrap')) mountFab()
            return
          }
          if (!standaloneHost) return
          // 1) 宿主节点被移出文档 → 原样放回去（子节点还在，不重渲染，不会闪）
          if (!document.contains(standaloneHost)) {
            try {
              ;(document.documentElement || document.body).appendChild(standaloneHost)
              report('standalone-reattach', '挂载宿主被移走，已放回')
            } catch {
              /* 下一轮再试 */
            }
            return
          }
          // 2) 容器可能只是被摘走（子节点都在）——放回去就行，不重渲染也就不会闪
          if (portalEl && portalEl.id === PORTAL_ID && !document.contains(portalEl)) {
            try {
              ;(document.documentElement || document.body).appendChild(portalEl)
              report('portal-reattach', '球容器被宿主移走，已原地放回（未重渲染）')
              return
            } catch {
              /* 下一轮再试 */
            }
          }
          const live = document.querySelector('.dmp-wrap:not(.dmp-fallback)')
          if (live) {
            emptyTicks = 0
            // React 球回来了：把之前插的兜底球摘掉，屏幕上只留一颗
            const fb = document.querySelector('.dmp-fallback')
            if (fb && fb.parentNode) fb.parentNode.removeChild(fb)
            return
          }
          emptyTicks += 1
          if (emptyTicks < 2) return
          emptyTicks = 0
          const now = Date.now()
          if (now < nextRetryAt) return
          rescueTries += 1
          if (rescueTries <= 3 && standaloneRoot && typeof standaloneRoot.render === 'function') {
            try {
              standaloneRoot.render(h(FabBoundary, null, h(PhoneFab)))
              report('standalone-rerender', `第 ${rescueTries} 次重渲染`)
              if (rescueTries === 3) nextRetryAt = now + 30_000
              return
            } catch (err) {
              report('standalone-rerender-fail', (err && err.message) || String(err))
            }
          }
          // React 彻底救不回来：插纯 DOM 兜底球，之后 30 秒才再试一次 React
          domFallback()
          nextRetryAt = now + 30_000
        }
        setTimeout(ensureFab, 600)
        // 1 秒一巡：容器被宿主摘走是常态（每次重渲染都可能发生），
        // 巡检太慢用户就会看到「闪一下、然后只剩兜底球」。
        setInterval(ensureFab, 1000)
        // DOM 守护（照 dsh-whale-widget 的做法）：DSH 是 SPA，切会话列表/设置/插件市场
        // 或别的插件整体替换 body 子树时，我们的宿主节点会被顺带摘掉，而且不会自己回来。
        // 用 MutationObserver 盯着 <html> 的子树，发现节点不在文档里就**把同一个节点放回去**
        // （不重建、不重渲染，位置/状态全保留）。手机端这种重排更频繁，正是它救场。
        try {
          if (typeof MutationObserver === 'function') {
            let guardLast = 0
            const guard = new MutationObserver(() => {
              const now = Date.now()
              if (now - guardLast < 180) return
              guardLast = now
              ensureFab()
            })
            guard.observe(document.documentElement, { childList: true, subtree: true })
          }
        } catch {
          /* 拿不到 MutationObserver 就只靠上面的定时器 */
        }
      },
    }
  },
})
