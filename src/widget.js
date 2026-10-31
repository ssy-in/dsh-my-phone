/**
 * DSH My Phone —— 悬浮球 + 弹窗（纯 DOM）
 *
 * 为什么单独成文件：宿主每次重渲染都会换掉插槽子树，React portal 的容器也会被顺带摘走，
 * 表现就是「球闪一下、然后只剩一个兜底小球」。dsh-whale-widget 在同一台机器上证明了另一条路：
 * 由宿主 index 注入一段内联脚本，脚本自己建 `<script src="/__myphone/widget.js">`，
 * 球和面板全由这段纯 DOM 代码自己维护 —— 不经过插槽、不经过 React，宿主换 DOM 也换不掉它。
 *
 * v1.5.0 起：弹窗也搬到这里。React 那份（client.js）保留作为后备，球被点开时仍会派发
 * `dsh-my-phone:open`；若 React 面板先接管（window.__dshMyPhoneOpened === true），这边就不重复开。
 */
;(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (window.__dshMyPhoneWidget) return
  window.__dshMyPhoneWidget = true

  // 尺寸：跟旧版 React 球一致（宽 135、按紧裁图标比例 512×459 得高约 121）
  // v1.6.1 临时开关：true = 用纯 DOM 球与纯 DOM 弹窗（v1.5.0 那套）；
  // false = 交回 React 那套（用户说的「原来的界面」）。
  // 现在用户要把旧界面调出来做逐项对照，所以默认 false。改回 true 只需动这一行。
  var USE_DOM_UI = true

  var TILE = 135
  var RATIO = 459 / 512
  var W = TILE
  var H = Math.round(TILE * RATIO)
  var KEY = 'dsh-my-phone.widget.v2'
  var ICON = '/__myphone/icon-fab.png?v=3'
  var API = '/__myphone/panel'
  var ROT = { bottom: 0, right: -90, top: 180, left: 90 }
  // 默认位置（用户指定）：右上角、往下让出一个图标的高度，右侧吸住。
  // 用视口比例存，所以窗口缩放后还是那个相对位置。
  function defaultAnchor() {
    return {
      xp: 1 - W / 2 / Math.max(1, vw()),
      yp: (H * 1.5) / Math.max(1, vh()),
      edge: 'right',
    }
  }

  var state = null
  var data = null
  var remote = null // 手机上拿到的是只读快照（/__myphone/state）
  var lastFeedAt = 0
  var lastPending = 0
  var el = null
  var dot = null
  var bubble = null
  var dragging = null
  var suppressClick = false
  var hoverTimer = 0
  var bubbleTimer = 0
  var panel = null

  // ---------- 位置 ----------
  function load() {
    state = defaultAnchor()
    try {
      var raw = window.localStorage && window.localStorage.getItem(KEY)
      if (!raw) return
      var p = JSON.parse(raw)
      if (p && isFinite(p.xp) && isFinite(p.yp)) {
        state = { xp: Number(p.xp), yp: Number(p.yp), edge: String(p.edge || DEFAULT.edge) }
      }
    } catch (e) {
      /* 存储坏了就用默认位 */
    }
  }

  function save() {
    try {
      window.localStorage && window.localStorage.setItem(KEY, JSON.stringify(state))
    } catch (e) {
      /* 存不了就只在本次会话生效 */
    }
  }

  function vw() {
    return window.innerWidth || document.documentElement.clientWidth || 1024
  }
  function vh() {
    return window.innerHeight || document.documentElement.clientHeight || 768
  }
  function clamp01(n) {
    return Math.min(1, Math.max(0, n))
  }
  // 位置语义：球心占窗口宽高的比例（缩放窗口后位置按比例保持，不会跑出屏幕）
  function applyPos() {
    if (!el) return
    var x = clamp01(state.xp) * vw() - W / 2
    var y = clamp01(state.yp) * vh() - H / 2
    x = Math.min(Math.max(0, x), Math.max(0, vw() - W))
    y = Math.min(Math.max(0, y), Math.max(0, vh() - H))
    el.style.left = Math.round(x) + 'px'
    el.style.top = Math.round(y) + 'px'
    el.style.rotate = (ROT[state.edge] || 0) + 'deg'
    if (dot) dot.style.rotate = -(ROT[state.edge] || 0) + 'deg'
  }

    // ---------- 音效设置 ----------
  // 键沿用旧版：dsh-my-phone.sound.v2 = { on:{join,msg,approval}, volume, timbre }
  var SOUND_KEY = 'dsh-my-phone.sound.v2'
  var TIMBRES = [
    ['bell', '风铃'],
    ['kalimba', '卡林巴'],
    ['marimba', '马林巴'],
    ['water', '水滴'],
    ['pop', '气泡'],
    ['piano', '钢琴'],
    ['violin', '小提琴'],
  ]
  function sound() {
    var def = { on: { join: true, msg: true, approval: true }, volume: 100, timbre: 'bell' }
    try {
      var raw = window.localStorage && window.localStorage.getItem(SOUND_KEY)
      if (!raw) return def
      var j = JSON.parse(raw) || {}
      return {
        on: Object.assign(def.on, j.on || {}),
        volume: typeof j.volume === 'number' ? j.volume : def.volume,
        timbre: TIMBRES.some(function (x) {
          return x[0] === j.timbre
        })
          ? j.timbre
          : def.timbre,
      }
    } catch (e) {
      return def
    }
  }
  function saveSound(next) {
    try {
      window.localStorage && window.localStorage.setItem(SOUND_KEY, JSON.stringify(next))
    } catch (e) {
      /* 存不了就只在本次会话生效 */
    }
    var eng = window.__dshMyPhoneAudio
    if (eng) {
      try {
        eng.setVolume(next.volume)
        eng.setTimbre(next.timbre)
      } catch (e) {
        /* 引擎没准备好就算了 */
      }
    }
  }
  function playLevel(level) {
    var eng = window.__dshMyPhoneAudio
    if (!eng) return
    var s = sound()
    var ok = level === 0 ? s.on.approval : level === 1 ? s.on.join : s.on.msg
    if (!ok) return
    try {
      eng.setVolume(s.volume)
      eng.setTimbre(s.timbre)
      if (level === 0) eng.alert()
      else if (level === 2) eng.short()
      else eng.notice()
    } catch (e) {
      /* 忽略 */
    }
  }

  function soundRows() {
    var s = sound()
    var out = []
    var seg = h('div', { class: 'seg' })
    ;[
      ['approval', '等待授权'],
      ['join', '有人连入'],
      ['msg', '新消息'],
    ].forEach(function (kv) {
      seg.appendChild(
        h('button', {
          class: s.on[kv[0]] ? 'on' : '',
          text: (s.on[kv[0]] ? '🔔 ' : '🔇 ') + kv[1],
          onclick: function () {
            var n = sound()
            n.on[kv[0]] = !n.on[kv[0]]
            saveSound(n)
            if (n.on[kv[0]]) playLevel(kv[0] === 'approval' ? 0 : kv[0] === 'join' ? 1 : 2)
            render()
          },
        }),
      )
    })
    out.push(h('div', { style: 'padding:6px 0 10px' }, [seg]))

    var vol = h('input', { type: 'range', min: '0', max: '100', value: String(s.volume), style: 'flex:1;min-width:0' })
    var volTxt = h('span', {
      style: 'width:44px;text-align:right;font:700 12px/1 ui-monospace,Menlo,monospace;color:#0a5f75',
      text: s.volume + '%',
    })
    vol.addEventListener('input', function (ev) {
      volTxt.textContent = ev.target.value + '%'
      var n = sound()
      n.volume = Number(ev.target.value)
      saveSound(n)
    })
    vol.addEventListener('change', function () {
      playLevel(2)
    })
    out.push(
      h('div', { class: 'row' }, [
        h('div', { style: 'font-size:12.5px;color:#43606f;width:34px', text: '音量' }),
        vol,
        volTxt,
      ]),
    )

    var sel = h('select', {
      style: 'flex:1;min-width:0;border:1px solid #cfe4ec;border-radius:8px;padding:6px 8px;font:12.5px/1.4 inherit;color:#0d2130;background:#fff',
    })
    TIMBRES.forEach(function (kv) {
      var op = document.createElement('option')
      op.value = kv[0]
      op.textContent = kv[1]
      if (kv[0] === s.timbre) op.selected = true
      sel.appendChild(op)
    })
    sel.addEventListener('change', function (ev) {
      var n = sound()
      n.timbre = ev.target.value
      saveSound(n)
      var eng = window.__dshMyPhoneAudio
      if (eng) {
        try {
          eng.setTimbre(n.timbre)
          eng.preview(n.timbre)
        } catch (e) {
          /* 忽略 */
        }
      }
    })
    out.push(
      h('div', { class: 'row' }, [
        h('div', { style: 'font-size:12.5px;color:#43606f;width:34px', text: '音色' }),
        sel,
      ]),
    )
    out.push(
      h('div', { class: 'dmp-hint', text: '只是提示音，不影响连接。第一次点过页面之后才会有声音（浏览器要求）。' }),
    )
    return out
  }

  // ---------- 数据 ----------
  function unreadCount() {
    if (!data) return 0
    if (typeof data.pendingCount === 'number' && data.pendingCount > 0) return data.pendingCount
    var feed = Array.isArray(data.feed) ? data.feed : []
    var n = 0
    for (var i = 0; i < feed.length; i++) if (feed[i] && feed[i].pending) n += 1
    return n
  }

  function summary() {
    if (!data) return '手机连 DSH · 点一下扫码'
    var feed = Array.isArray(data.feed) ? data.feed : []
    for (var i = 0; i < feed.length; i++) {
      var it = feed[i]
      if (it && it.pending && it.text) return it.title ? it.title + '：' + it.text : it.text
    }
    for (var j = 0; j < feed.length; j++) if (feed[j] && feed[j].text) return feed[j].text
    return '手机连 DSH · 点一下扫码'
  }

  function showBubble() {
    if (!bubble) return
    // 跟旧版一样分三层：青字标题 / 墨字正文 / 灰字小提示
    var txt = summary()
    var isDefault = txt === '手机连 DSH · 点一下扫码'
    bubble.textContent = ''
    var t = document.createElement('div')
    t.className = 't'
    t.textContent = isDefault ? '手机连 DSH' : '最新消息'
    var b = document.createElement('div')
    b.className = 'b'
    b.textContent = isDefault ? '点一下扫码或复制链接' : txt
    var s = document.createElement('div')
    s.className = 's'
    s.textContent = isDefault ? '扫码后手机点一次「信任这台电脑」' : '点一下打开面板看全部'
    bubble.appendChild(t)
    bubble.appendChild(b)
    bubble.appendChild(s)
    bubble.style.opacity = '1'
    bubble.style.transform = 'translateY(0)'
    clearTimeout(bubbleTimer)
    bubbleTimer = setTimeout(hideBubble, 4500)
  }

  function hideBubble() {
    if (!bubble) return
    bubble.style.opacity = '0'
  }

  function refresh() {
    try {
      fetch(API, { headers: { 'x-myphone-panel': '1' }, credentials: 'same-origin' })
        .then(function (r) {
          return r && r.ok ? r.json() : null
        })
        .then(function (json) {
          if (!json) return
          remote = null // 管理口又能连上了：回到本地可写模式
          data = json
          paint()
          if (panel && panel.isOpen()) panel.render()
        })
        .catch(function () {
          loadRemote()
        })
    } catch (e) {
      /* 老浏览器没有 fetch 就算了，球照样能点 */
    }
  }

  // 手机上管理口（127.0.0.1）够不着：退到只读快照，至少能看「连没连上 / 共几台 / 消息」
  function loadRemote() {
    try {
      fetch('/__myphone/state', { credentials: 'same-origin' })
        .then(function (r) {
          return r && r.ok ? r.json() : null
        })
        .then(function (json) {
          if (!json || !json.device) return
          remote = json
          data = null
          if (panel && panel.isOpen()) panel.render()
        })
        .catch(function () {
          /* 连只读口都拿不到：多半是凭据失效，面板会提示重新扫码 */
        })
    } catch (e) {
      /* 忽略 */
    }
  }

  function paint() {
    // 提示音：有新消息（更靠前的一条）就响；同一时刻只响一次
    try {
      var feed = data && Array.isArray(data.feed) ? data.feed : []
      var newestAt = feed.length ? Number(feed[0].at) || 0 : 0
      var pendingNow = unreadCount()
      if (newestAt && newestAt > lastFeedAt) {
        if (lastFeedAt) playLevel(Number(feed[0].level) || 2)
      } else if (pendingNow > lastPending && lastPending >= 0) {
        playLevel(0)
      }
      lastFeedAt = newestAt || lastFeedAt
      lastPending = pendingNow
    } catch (e) {
      /* 响不了不影响功能 */
    }
    if (dot) {
      var n = unreadCount()
      if (n > 0) {
        dot.style.display = 'flex'
        dot.textContent = n > 99 ? '99+' : String(n)
      } else {
        dot.style.display = 'none'
      }
    }
    if (bubble && bubble.style.opacity === '1') bubble.textContent = summary()
  }

  function boot() {
    refresh()
    // 推送：SSE 到了就用它，断了退回 6 秒一次轮询
    try {
      var es = new EventSource(API + '/stream')
      es.onmessage = function (ev) {
        try {
          var json = JSON.parse(ev.data)
          if (!json) return
          data = json
          paint()
          if (panel && panel.isOpen()) panel.render()
        } catch (e) {
          /* 帧坏了就算了，等下一帧 */
        }
      }
      es.onerror = function () {
        try {
          es.close()
        } catch (e) {
          /* 忽略 */
        }
      }
    } catch (e) {
      /* 没有 EventSource：靠轮询 */
    }
    setInterval(function () {
      if (document.hidden) return
      refresh()
    }, 6000)
  }

  // ---------- 开合 ----------
  function openPanel() {
    window.__dshMyPhoneOpened = false
    // 先让 React 版试一次：它挂着就它开（后备路径，等用户验证完可以删）
    try {
      window.dispatchEvent(new CustomEvent('dsh-my-phone:open'))
    } catch (e) {
      /* 老浏览器没有 CustomEvent */
    }
    if (typeof window.__dshMyPhoneOpen === 'function') {
      try {
        window.__dshMyPhoneOpen()
      } catch (e) {
        /* 忽略 */
      }
    }
    // React 立刻接走了：这次就交给它，避免两套面板叠在一起
    if (window.__dshMyPhoneOpened) return
    if (!panel) panel = createPanel()
    panel.open()
  }

  // 只开 DOM 面板：不碰 React（React 那套在这个宿主里会被清掉，专门留给对比截图用）
  function openPanelDomOnly() {
    if (!panel) panel = createPanel()
    panel.open()
  }

  // ---------- 球 ----------
  function onDown(ev) {
    if (ev.button !== undefined && ev.button !== 0) return
    dragging = { x0: ev.clientX, y0: ev.clientY, moved: 0 }
    suppressClick = false
    try {
      el.setPointerCapture && el.setPointerCapture(ev.pointerId)
    } catch (e) {
      /* 不支持指针捕获 */
    }
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
  }

  function onMove(ev) {
    if (!dragging || !el) return
    var dx = ev.clientX - dragging.x0
    var dy = ev.clientY - dragging.y0
    dragging.moved = Math.max(dragging.moved, Math.abs(dx) + Math.abs(dy))
    if (dragging.moved < 4) return
    suppressClick = true
    var x = Math.min(Math.max(0, ev.clientX - W / 2), Math.max(0, vw() - W))
    var y = Math.min(Math.max(0, ev.clientY - H / 2), Math.max(0, vh() - H))
    el.style.left = Math.round(x) + 'px'
    el.style.top = Math.round(y) + 'px'
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onUp, true)
    if (!dragging || !el) return
    var wasDrag = suppressClick
    var rect = el.getBoundingClientRect()
    var cx = rect.left + rect.width / 2
    var cy = rect.top + rect.height / 2
    if (wasDrag) {
      // 松手吸附到最近的一条边（贴边后图片底边朝墙）
      // 用「矩形边到视口边」的距离：拖动过程被 clamp 住，贴到边时距离正好 0；
      // 以前用球心算、阈值 40，而球心离边最少也有半个球宽，所以永远吸不上边。
      var dist = [
        { edge: 'left', v: rect.left },
        { edge: 'right', v: vw() - rect.right },
        { edge: 'top', v: rect.top },
        { edge: 'bottom', v: vh() - rect.bottom },
      ].sort(function (a, b) {
        return a.v - b.v
      })
      var edge = dist[0].v <= 14 ? dist[0].edge : state.edge
      state.edge = edge
      state.xp = clamp01(cx / vw())
      state.yp = clamp01(cy / vh())
      if (edge === 'left') state.xp = W / 2 / vw()
      if (edge === 'right') state.xp = 1 - W / 2 / vw()
      if (edge === 'top') state.yp = H / 2 / vh()
      if (edge === 'bottom') state.yp = 1 - H / 2 / vh()
      save()
      applyPos()
    }
    dragging = null
  }

  function resetPos() {
    state = defaultAnchor()
    save()
    applyPos()
  }

  function mount() {
    if (el && document.contains(el)) return
    load()
    el = document.createElement('div')
    el.id = 'dsh-my-phone-widget'
    el.setAttribute('role', 'button')
    el.setAttribute('tabindex', '0')
    el.setAttribute('aria-label', '手机扫码连接 DSH')
    el.style.cssText = [
      'position:fixed',
      'z-index:2147483646',
      'width:' + W + 'px',
      'height:' + H + 'px',
      'cursor:grab',
      'touch-action:none',
      'user-select:none',
      '-webkit-user-select:none',
      'pointer-events:auto',
      'transition:filter .18s ease',
      'will-change:left,top',
    ].join(';')

    ensureCss()

    var img = document.createElement('img')
    img.className = 'dmp-w-img'
    img.src = ICON
    img.alt = ''
    img.draggable = false
    img.style.cssText = 'width:100%;height:100%;object-fit:fill;pointer-events:none;display:block'
    el.appendChild(img)

    dot = document.createElement('span')
    dot.className = 'dmp-w-dot'
    dot.style.cssText = [
      'position:absolute',
      'top:-4px',
      'right:-4px',
      'min-width:24px',
      'height:24px',
      'padding:0 7px',
      'border-radius:999px',
      'background:#e6382b',
      'color:#fff',
      'font:800 13px/24px system-ui,-apple-system,"PingFang SC",sans-serif',
      'text-align:center',
      'display:none',
      'box-shadow:0 2px 6px rgba(180,20,10,.35)',
      'pointer-events:none',
    ].join(';')
    el.appendChild(dot)

    // 悬停气泡（只读，展示完自己消失）
    bubble = document.createElement('div')
    bubble.className = 'dmp-w-bubble'
    bubble.style.opacity = '0'
    document.documentElement.appendChild(bubble)

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerenter', function (ev) {
      if (ev.pointerType && ev.pointerType !== 'mouse') return
      el.classList.add('dmp-w-hover')
      clearTimeout(hoverTimer)
      hoverTimer = setTimeout(showBubble, 300)
    })
    el.addEventListener('pointerleave', function () {
      el.classList.remove('dmp-w-hover')
      clearTimeout(hoverTimer)
      if (bubble && bubble.style.opacity === '1') hideBubble()
    })
    el.addEventListener('click', function () {
      if (suppressClick) {
        suppressClick = false
        return
      }
      openPanelDomOnly()
    })
    el.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault()
        openPanelDomOnly()
      }
    })
    window.addEventListener('resize', applyPos)

    // 音效引擎由独立脚本提供（src/audio.js）：先拉它，拉到就能出声，拉不到就静音跑
    try {
      if (!document.getElementById('dmp-audio-js')) {
        var ajs = document.createElement('script')
        ajs.id = 'dmp-audio-js'
        ajs.src = '/__myphone/audio.js'
        ajs.async = true
        document.documentElement.appendChild(ajs)
      }
    } catch (e) {
      /* 拉不到就算了，不影响功能 */
    }

    // 纯 DOM 球就位后，让 React 那颗球让位（client.js 的 .dmp-widget-on .dmp-wrap{display:none}）
    try {
      document.documentElement.classList.add('dmp-widget-on')
    } catch (e) {
      /* 加不上就两球共存，不影响功能 */
    }

    document.documentElement.appendChild(el)
    applyPos()
  }

  function ensureCss() {
    if (document.getElementById('dmp-w-css')) return
    var st = document.createElement('style')
    st.id = 'dmp-w-css'
    st.textContent = [
      '#dsh-my-phone-widget{transition:transform .34s cubic-bezier(.34,1.56,.64,1),filter .18s ease}',
      '#dsh-my-phone-widget.dmp-w-hover{transform:translateY(-8px) scale(1.06);filter:drop-shadow(0 14px 24px rgba(8,38,56,.34))}',
      '#dsh-my-phone-widget:active{transform:scale(.93);transition-duration:.12s}',
      '.dmp-w-bubble{position:fixed;z-index:2147483647;width:232px;padding:12px 16px 13px;border-radius:14px;',
      '  background:#ffffff;border:1px solid rgba(64,208,208,.55);box-shadow:0 14px 34px rgba(6,24,36,.24);',
      '  color:#12384a;font:12px/1.6 system-ui,-apple-system,"PingFang SC",sans-serif;text-align:left;',
      '  word-break:break-word;pointer-events:none;opacity:0;transform:translateY(6px);',
      '  transition:opacity .2s ease,transform .2s ease}',
      '.dmp-w-bubble .t{font-size:12.5px;font-weight:800;color:#0a5f75;margin-bottom:2px}',
      '.dmp-w-bubble .b{font-size:11.5px;color:#1d4257}',
      '.dmp-w-bubble .s{margin-top:6px;font-size:10.5px;color:#7b93a3}',
      '@media (prefers-reduced-motion: reduce){#dsh-my-phone-widget{transition:none}#dsh-my-phone-widget.dmp-w-hover{transform:none}}',
      // ---- 面板 ----
      '#dmp-panel{position:fixed;inset:0;z-index:2147483647;display:flex}',
      '#dmp-panel .dmp-back{position:absolute;inset:0;background:rgba(8,18,30,.42);backdrop-filter:blur(2px)}',
      '#dmp-panel .dmp-card{position:relative;margin:auto;width:min(430px,calc(100vw - 28px));max-height:calc(100vh - 48px);',
      '  display:flex;flex-direction:column;background:#f7fbfd;color:#0d2130;border-radius:20px;overflow:hidden;',
      '  box-shadow:0 26px 70px rgba(6,20,32,.38);font:13.5px/1.6 system-ui,-apple-system,"PingFang SC",sans-serif}',
      '#dmp-panel .dmp-head{display:flex;align-items:center;gap:10px;padding:14px 16px 10px;background:#fff;border-bottom:1px solid #e3eef4}',
      '#dmp-panel .dmp-head img{width:30px;height:27px;object-fit:contain}',
      '#dmp-panel .dmp-title{flex:1;font-size:15.5px;font-weight:800;letter-spacing:.2px}',
      '#dmp-panel .dmp-x{border:0;background:#eef5f9;color:#4a5f70;width:28px;height:28px;border-radius:999px;cursor:pointer;font-size:15px;line-height:1}',
      '#dmp-panel .dmp-x:hover{background:#e0eef5}',
      '#dmp-panel .dmp-tabs{display:flex;gap:6px;padding:10px 16px 0;background:#fff}',
      '#dmp-panel .dmp-tab{border:0;background:transparent;color:#5c7284;font:600 13.5px/1 inherit;padding:9px 12px;border-radius:10px;cursor:pointer}',
      '#dmp-panel .dmp-tab.on{background:#e4f6fa;color:#0a5f75}',
      '#dmp-panel .dmp-body{padding:14px 16px 18px;overflow:auto;flex:1 1 auto}',
      '#dmp-panel h4{margin:16px 0 8px;font-size:12.5px;font-weight:800;letter-spacing:.4px;color:#4a6478;text-transform:none}',
      '#dmp-panel h4:first-child{margin-top:2px}',
      '#dmp-panel .dmp-hint{margin:6px 0 0;font-size:12px;color:#5f7688;line-height:1.6}',
      '#dmp-panel .dmp-lead{margin:0;font-size:14.5px;font-weight:800;color:#0a5f75}',
      '#dmp-panel .dmp-sub{margin:3px 0 0;font-size:12.5px;color:#5f7688}',
      '#dmp-panel .dmp-qr{margin:12px auto 0;width:214px;height:214px;background:#fff;border:1px solid #dbeaf1;border-radius:16px;',
      '  display:flex;align-items:center;justify-content:center;padding:9px;position:relative}',
      '#dmp-panel .dmp-qr svg{width:100%;height:100%;display:block}',
      '#dmp-panel .dmp-qr.dead{filter:grayscale(1) opacity(.42)}',
      '#dmp-panel .dmp-dead{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;',
      '  font:800 15px/1 inherit;color:#c0271b;background:rgba(255,255,255,.72);border-radius:16px;letter-spacing:2px}',
      '#dmp-panel .dmp-empty{color:#7b8fa1;font-size:12.5px;text-align:center;padding:56px 10px}',
      '#dmp-panel .dmp-ttl{margin:8px 0 0;text-align:center;font:700 12.5px/1.5 ui-monospace,Menlo,monospace;color:#0a7a4b}',
      '#dmp-panel .dmp-ttl.dead{color:#c0271b}',
      '#dmp-panel .dmp-link{display:flex;gap:8px;align-items:center;margin-top:12px;background:#eef5f9;border:1px solid #dceaf1;border-radius:11px;padding:8px 10px}',
      '#dmp-panel .dmp-link code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
      '  font:11.5px/1.5 ui-monospace,Menlo,monospace;color:#26485c}',
      '#dmp-panel button.mini{border:1px solid #cfe4ec;background:#fff;color:#0a5f75;font:700 11.5px/1 inherit;padding:6px 9px;border-radius:8px;cursor:pointer}',
      '#dmp-panel button.mini:hover{background:#eaf7fb}',
      '#dmp-panel button.primary{display:block;width:100%;margin:14px auto 0;max-width:268px;border:0;cursor:pointer;',
      '  background:linear-gradient(145deg,#2a86a3,#0a5f75);color:#fff;font:800 14.5px/1 inherit;padding:13px 18px;border-radius:13px;',
      '  box-shadow:0 8px 20px rgba(10,95,117,.28)}',
      '#dmp-panel button.primary:disabled{opacity:.6;cursor:default}',
      '#dmp-panel button.ghost{border:0;background:transparent;color:#5f7688;font:700 12px/1 inherit;cursor:pointer;padding:8px}',
      '#dmp-panel button.ghost:hover{color:#0a5f75}',
      '#dmp-panel .dmp-center{text-align:center}',
      '#dmp-panel .row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #eaf2f6}',
      '#dmp-panel .row:last-child{border-bottom:0}',
      '#dmp-panel .row .grow{flex:1;min-width:0}',
      '#dmp-panel .row .name{font-size:13px;font-weight:700;color:#0d2130;word-break:break-all}',
      '#dmp-panel .row .meta{font-size:11.5px;color:#6b8394;margin-top:2px}',
      '#dmp-panel .pill{border:0;cursor:pointer;border-radius:999px;font:700 11.5px/1 inherit;padding:7px 11px}',
      '#dmp-panel .pill.on{background:#0a7a4b;color:#fff}',
      '#dmp-panel .pill.off{background:#e6eef3;color:#4a6478}',
      '#dmp-panel .pill.hot{background:#c0271b;color:#fff}',
      '#dmp-panel .seg{display:flex;gap:4px;flex-wrap:wrap}',
      '#dmp-panel .seg button{border:1px solid #d8e7ee;background:#fff;color:#43606f;font:700 11.5px/1 inherit;padding:6px 9px;border-radius:8px;cursor:pointer}',
      '#dmp-panel .seg button.on{background:#e4f6fa;border-color:#a8d9e5;color:#0a5f75}',
      '#dmp-panel .feed{border-left:3px solid #cfdde6;padding-left:10px;margin:4px 0 0}',
      '#dmp-panel .feed .it{padding:6px 0}',
      '#dmp-panel .feed .it.p0{border-left:3px solid #c88a00;margin-left:-13px;padding-left:10px}',
      '#dmp-panel .feed .it.p1{border-left:3px solid #e06c00;margin-left:-13px;padding-left:10px}',
      '#dmp-panel .feed .tx{font-size:12.5px;color:#12303f;word-break:break-word}',
      '#dmp-panel .feed .tm{font:11px/1.4 ui-monospace,Menlo,monospace;color:#7b8fa1;margin-top:2px}',
      '#dmp-panel .foot{padding:10px 16px;background:#fff;border-top:1px solid #e3eef4;font-size:11px;color:#7b8fa1;text-align:center}',
    ].join('\n')
    document.documentElement.appendChild(st)
  }

  // ---------- 面板 ----------
  function h(tag, props, kids) {
    var n = document.createElement(tag)
    if (props)
      Object.keys(props).forEach(function (k) {
        if (k === 'class') n.className = props[k]
        else if (k === 'text') n.textContent = props[k]
        else if (k === 'html') n.innerHTML = props[k]
        else if (k === 'style') n.style.cssText = props[k]
        else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2).toLowerCase(), props[k])
        else if (props[k] !== undefined && props[k] !== null) n.setAttribute(k, props[k])
      })
    ;(kids || []).forEach(function (c) {
      if (!c) return
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
    })
    return n
  }

  function post(action, body, done) {
    try {
      fetch(API + '/' + action, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-myphone-panel': '1' },
        credentials: 'same-origin',
        body: JSON.stringify(body || {}),
      })
        .then(function (r) {
          return r && r.ok ? r.json() : null
        })
        .then(function (json) {
          if (json) {
            data = json
            paint()
            if (panel) panel.render()
          }
          if (done) done(json)
        })
        .catch(function (e) {
          if (done) done(null, e)
        })
    } catch (e) {
      if (done) done(null, e)
    }
  }

  function hhmm(at) {
    if (!at) return ''
    var d = new Date(at)
    var p2 = function (n) {
      return n < 10 ? '0' + n : String(n)
    }
    return p2(d.getHours()) + ':' + p2(d.getMinutes())
  }

  function createPanel() {
    ensureCss()
    var tab = 'connect'
    var logOpen = false
    var ticker = 0
    var root = h('div', { id: 'dmp-panel' })
    root.style.display = 'none'
    var back = h('div', { class: 'dmp-back', onclick: close })
    var body = h('div', { class: 'dmp-body' })
    var tabsBar = h('div', { class: 'dmp-tabs' })
    var card = h('div', { class: 'dmp-card' }, [
      h('div', { class: 'dmp-head' }, [
        h('img', { src: ICON, alt: '' }),
        h('div', { class: 'dmp-title', text: '手机连到这台电脑' }),
        h('button', { class: 'dmp-x', text: '×', title: '关闭', onclick: close }),
      ]),
      tabsBar,
      body,
      h('div', { class: 'foot', text: 'DSH My Phone · 管理口只在本机可用' }),
    ])
    root.appendChild(back)
    root.appendChild(card)
    document.documentElement.appendChild(root)

    function close() {
      root.style.display = 'none'
      clearInterval(ticker)
      ticker = 0
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('dsh-my-phone:closepanel', close)
    }
    function onKey(ev) {
      if (ev.key === 'Escape') close()
    }
    function open() {
      root.style.display = 'flex'
      render()
      refresh()
      clearInterval(ticker)
      ticker = setInterval(render, 1000)
      document.addEventListener('keydown', onKey)
      window.addEventListener('dsh-my-phone:closepanel', close)
    }

    function tabBtn(key, label) {
      return h('button', {
        class: 'dmp-tab' + (tab === key ? ' on' : ''),
        text: label,
        onclick: function () {
          tab = key
          render()
        },
      })
    }

    function renderTabs() {
      tabsBar.textContent = ''
      tabsBar.appendChild(tabBtn('connect', '连接'))
      tabsBar.appendChild(tabBtn('advanced', '高级'))
    }

    function qrBlock() {
      var svg = data && data.qrSvg ? String(data.qrSvg) : ''
      var left = data && data.ticketExpiresAt ? data.ticketExpiresAt - Date.now() : 0
      var dead = !svg || left <= 0
      var box = h('div', { class: 'dmp-qr' + (dead && svg ? ' dead' : '') })
      if (svg) box.innerHTML = svg
      else box.appendChild(h('div', { class: 'dmp-empty', text: '还没有二维码\n点下面的按钮生成' }))
      if (svg && left <= 0) box.appendChild(h('div', { class: 'dmp-dead', text: '已失效' }))
      return box
    }

    function connectPane() {
      var out = []
      if (remote) {
        var d = remote.device || {}
        out.push(h('p', { class: 'dmp-lead', text: '这台手机已连上这台电脑' }))
        out.push(
          h('p', {
            class: 'dmp-sub',
            text: (d.note ? d.note + '（' + d.label + '）' : d.label || '设备') + (d.trusted ? ' · 已信任' : ' · 未信任'),
          }),
        )
        out.push(h('div', { class: 'dmp-hint', text: '手机上是只读视图：开关、配对都在电脑上的悬浮球里操作。' }))
        out.push(
          h('div', { class: 'dmp-link' }, [
            h('code', { text: String(location.href) }),
            h('button', {
              class: 'mini',
              text: '复制',
              onclick: function () {
                copyText(String(location.href))
              },
            }),
          ]),
        )
        out.push(
          h('button', {
            class: 'primary',
            text: '继续使用 DSH',
            onclick: function () {
              close()
            },
          }),
        )
        return out
      }
      out.push(h('p', { class: 'dmp-lead', text: '相机或者浏览器扫码连接' }))
      out.push(h('p', { class: 'dmp-sub', text: '扫码连接 DeepSeek Harness 桌面版' }))
      out.push(qrBlock())
      var left = data && data.ticketExpiresAt ? Math.max(0, data.ticketExpiresAt - Date.now()) : 0
      if (left > 0) {
        var mm = Math.floor(left / 60000)
        var ss = Math.floor((left % 60000) / 1000)
        out.push(h('p', { class: 'dmp-ttl', text: mm + ':' + (ss < 10 ? '0' + ss : ss) + ' 后失效，到点需要手动再点一次' }))
      } else if (data && data.qrSvg) {
        out.push(h('p', { class: 'dmp-ttl dead', text: '已失效 —— 点下面的按钮换一个' }))
      } else {
        out.push(h('p', { class: 'dmp-hint dmp-center', text: '二维码不会自动生成，点下面的按钮才有' }))
      }
      if (data && data.pairUrl) {
        var link = h('div', { class: 'dmp-link' }, [
          h('code', { text: data.pairUrl }),
          h('button', {
            class: 'mini',
            text: '复制',
            onclick: function () {
              copyText(data.pairUrl)
            },
          }),
        ])
        out.push(link)
      }
      var hasTicket = Boolean(data && data.qrSvg && left > 0)
      out.push(
        h('button', {
          class: 'primary',
          text: hasTicket ? '换一个二维码' : '生成二维码',
          onclick: function (ev) {
            var b = ev.currentTarget
            b.disabled = true
            b.textContent = '正在生成…'
            post('ticket', {}, function () {
              b.disabled = false
            })
          },
        }),
      )
      out.push(
        h('div', { class: 'dmp-center' }, [
          h('button', {
            class: 'ghost',
            text: '默认位置',
            onclick: function () {
              resetPos()
              close()
            },
          }),
        ]),
      )
      return out
    }

    function switchRow(label, sub, on, onToggle) {
      return h('div', { class: 'row' }, [
        h('div', { class: 'grow' }, [h('div', { class: 'name', text: label }), h('div', { class: 'meta', text: sub })]),
        h('button', { class: 'pill ' + (on ? 'on' : 'off'), text: on ? '已开启 · 关' : '关着 · 开', onclick: onToggle }),
      ])
    }

    function segRow(label, key, current, choices) {
      var seg = h('div', { class: 'seg' })
      choices.forEach(function (m) {
        seg.appendChild(
          h('button', {
            class: current === m ? 'on' : '',
            text: m === 0 ? '不自动关' : m + ' 分钟',
            onclick: function () {
              post('autooff', { key: key, minutes: m })
            },
          }),
        )
      })
      return h('div', { style: 'padding:8px 0;border-bottom:1px solid #eaf2f6' }, [
        h('div', { style: 'margin-bottom:7px;font-size:12.5px;font-weight:700;color:#26485c', text: label }),
        seg,
      ])
    }



    // Electron 里 window.prompt / confirm 是被禁的（调用会直接抛错），所以备注用行内输入、
    // 删除用「再点一次」确认，全部自己画。
    var editId = null
    var editText = ''
    var delArm = { id: '', at: 0 }

    function deviceRows() {
      var list = data && Array.isArray(data.deviceList) ? data.deviceList : []
      var out = []
      if (!list.length) out.push(h('div', { class: 'dmp-hint', text: '还没有设备连进来。' }))
      list.forEach(function (d) {
        var name = (d.note ? d.note + '（' + d.label + '）' : d.label) || '设备'
        var row = h('div', { class: 'row' }, [
          h('div', { class: 'grow' }, [
            h('div', { class: 'name', text: name }),
            h('div', { class: 'meta', text: (d.trusted ? '已信任' : '未信任') + (d.lastSeen ? ' · 最近 ' + hhmm(d.lastSeen) : '') }),
          ]),
        ])
        if (editId === d.id) {
          var input = h('input', {
            value: editText,
            maxlength: '24',
            placeholder: '比如：嘉然今天吃什么',
            style: 'flex:1;min-width:0;border:1px solid #cfe4ec;border-radius:8px;padding:6px 8px;font:12.5px/1.4 inherit;color:#0d2130',
          })
          input.addEventListener('input', function (ev) {
            editText = ev.target.value
          })
          input.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') {
              post('device', { id: d.id, note: editText })
              editId = null
            } else if (ev.key === 'Escape') {
              editId = null
              render()
            }
          })
          setTimeout(function () {
            try {
              input.focus()
            } catch (e) {
              /* 忽略 */
            }
          }, 0)
          row.appendChild(input)
          row.appendChild(
            h('button', {
              class: 'mini',
              text: '保存',
              onclick: function () {
                post('device', { id: d.id, note: editText })
                editId = null
              },
            }),
          )
          row.appendChild(
            h('button', {
              class: 'mini',
              text: '取消',
              onclick: function () {
                editId = null
                render()
              },
            }),
          )
          out.push(row)
          return
        }
        row.appendChild(
          h('button', {
            class: 'mini',
            text: '备注',
            onclick: function () {
              editId = d.id
              editText = d.note || ''
              render()
            },
          }),
        )
        row.appendChild(
          h('button', {
            class: 'mini',
            text: d.trusted ? '断开' : '信任',
            onclick: function () {
              post('device', { id: d.id, trusted: !d.trusted })
            },
          }),
        )
        var armed = delArm.id === d.id && Date.now() - delArm.at < 4000
        row.appendChild(
          h('button', {
            class: 'mini',
            text: armed ? '再点一次' : '删除',
            style: armed ? 'border-color:#f0b4ad;color:#c0271b;background:#fff3f1' : '',
            onclick: function () {
              if (!armed) {
                delArm = { id: d.id, at: Date.now() }
                render()
                return
              }
              delArm = { id: '', at: 0 }
              post('device', { id: d.id, remove: true })
            },
          }),
        )
        out.push(row)
      })
      out.push(
        h('div', { class: 'dmp-hint', text: '共 ' + list.length + ' / ' + ((data && data.maxDevices) || 8) + ' 台。断开后立刻失效，下次要重新扫码。' }),
      )
      return out
    }

    function feedRows() {
      var feed = data && Array.isArray(data.feed) ? data.feed : []
      var out = []
      if (!feed.length) out.push(h('div', { class: 'dmp-hint', text: '暂时没有需要你看的消息。' }))
      var wrap = h('div', { class: 'feed' })
      feed.slice(0, 12).forEach(function (it) {
        var lv = Number(it.level) || 2
        var line = h('div', { class: 'it ' + (lv === 0 ? 'p0' : lv === 1 ? 'p1' : '') }, [
          h('div', { class: 'tx', text: it.text || '' }),
          h('div', { class: 'tm', text: hhmm(it.at) + (it.pending ? ' · 等你处理' : '') }),
        ])
        if (it.pending) {
          line.appendChild(
            h('button', {
              class: 'mini',
              text: '知道了',
              onclick: function () {
                if (it.id && String(it.id).charAt(0) === 'a') post('ack', { ack: it.seq })
                else if (it.id && String(it.id).charAt(0) === 'j') post('ack', { notice: it.seq })
                else post('ack', { ack: it.seq })
              },
            }),
          )
        }
        wrap.appendChild(line)
      })
      out.push(wrap)
      return out
    }

    function logRows() {
      var raw = data && Array.isArray(data.events) ? data.events : []
      var out = []
      var head = h('div', { class: 'row' }, [
        h('div', { class: 'grow' }, [h('div', { class: 'name', text: '排查日志' }), h('div', { class: 'meta', text: raw.length + ' 条' })]),
      ])
      head.appendChild(
        h('button', {
          class: 'mini',
          text: logOpen ? '收起' : '展开',
          onclick: function () {
            logOpen = !logOpen
            render()
          },
        }),
      )
      if (logOpen) {
        head.appendChild(
          h('button', {
            class: 'mini',
            text: '复制日志',
            onclick: function () {
              var list = data && Array.isArray(data.events) ? data.events : []
              var txt = list
                .map(function (e) {
                  return hhmm(e.at) + ' ' + (e.kind || '') + ' ' + (e.text || '')
                })
                .join('\n')
              copyText(txt || '（还没有日志）')
            },
          }),
        )
        head.appendChild(
          h('button', {
            class: 'mini',
            text: '清空',
            onclick: function () {
              post('clear', {})
            },
          }),
        )
      }
      out.push(head)
      if (logOpen) {
        var box = h('div', { style: 'max-height:170px;overflow:auto;border:1px solid #e3eef4;border-radius:10px;padding:8px;background:#fff' })
        raw.slice(-40).reverse().forEach(function (e) {
          box.appendChild(h('div', { class: 'feed' }, [h('div', { class: 'tx', text: e.text || '' }), h('div', { class: 'tm', text: hhmm(e.at) + ' · ' + (e.kind || '') })]))
        })
        if (!raw.length) box.appendChild(h('div', { class: 'dmp-hint', text: '暂无日志。' }))
        out.push(box)
      }
      return out
    }

    function advancedPane() {
      if (remote) {
        var rOut = []
        var dev = remote.device || {}
        rOut.push(h('h4', { text: '这台设备' }))
        rOut.push(
          h('div', { class: 'row' }, [
            h('div', { class: 'grow' }, [
              h('div', { class: 'name', text: (dev.note ? dev.note + '（' + dev.label + '）' : dev.label) || '设备' }),
              h('div', { class: 'meta', text: (dev.trusted ? '已信任' : '未信任') + (dev.lastSeen ? ' · 最近 ' + hhmm(dev.lastSeen) : '') }),
            ]),
          ]),
        )
        rOut.push(h('div', { class: 'dmp-hint', text: '这台电脑上一共 ' + (remote.devices || 0) + ' 台设备连着。' }))
        rOut.push(h('h4', { text: '消息' }))
        var evs = Array.isArray(remote.events) ? remote.events.slice(-8).reverse() : []
        if (!evs.length) rOut.push(h('div', { class: 'dmp-hint', text: '暂时没有新消息。' }))
        evs.forEach(function (e) {
          rOut.push(
            h('div', { class: 'feed' }, [
              h('div', { class: 'tx', text: e.text || '' }),
              h('div', { class: 'tm', text: hhmm(e.at) + ' · ' + (e.kind || '') }),
            ]),
          )
        })
        return rOut
      }
      var s = (data && data.settings) || {}
      var lan = Boolean(data && data.lanEnabled)
      var tun = Boolean(data && data.tunnelEnabled)
      var out = []
      out.push(h('h4', { text: '旧界面（截图用）' }))
      out.push(
        h('div', { class: 'row' }, [
          h('div', { class: 'grow' }, [h('div', { class: 'meta', text: '打开 React 版弹窗做对比截图' })]),
          h('button', {
            class: 'mini',
            text: '打开',
            onclick: function (ev) {
              var host = null
              try {
                host = ev && ev.currentTarget && ev.currentTarget.parentNode && ev.currentTarget.parentNode.parentNode
              } catch (e) {
                host = null
              }
              var box = document.createElement('div')
              box.setAttribute('data-legacy', '1')
              box.style.cssText = 'position:relative;width:0;height:0'
              if (host) host.appendChild(box)
              var ok = false
              try {
                ok = typeof window.__dshMyPhoneMountLegacy === 'function' && window.__dshMyPhoneMountLegacy(box)
              } catch (e) {
                ok = false
              }
              if (!ok) {
                try {
                  window.dispatchEvent(new CustomEvent('dsh-my-phone:open'))
                } catch (e) {
                  /* 忽略 */
                }
              }
            },
          }),
        ]),
      )
      out.push(h('h4', { text: '入口' }))
      out.push(
        switchRow('局域网访问', lan ? '同一 Wi-Fi 下可用，不经第三方' : '关着（默认只用外网，一个码到处都能用）', lan, function () {
          post('toggle', { key: 'lan' })
        }),
      )
      out.push(
        switchRow('外网访问', tun ? '经 Cloudflare 中继，开着就能从外面连回来' : '关着（出门在外就连不上）', tun, function () {
          post('toggle', { key: 'tunnel' })
        }),
      )
      out.push(h('h4', { text: '自动关闭入口' }))
      out.push(segRow('外网通道', 'tunnel', Number(data && data.tunnelAutoOffMinutes) || 0, [0, 15, 30, 60, 120]))
      out.push(segRow('局域网通道', 'lan', Number(data && data.lanAutoOffMinutes) || 0, [0, 15, 30, 60, 120]))
      out.push(h('h4', { text: '消息' }))
      feedRows().forEach(function (n) {
        out.push(n)
      })
      out.push(h('h4', { text: '已配对设备' }))
      deviceRows().forEach(function (n) {
        out.push(n)
      })
      out.push(h('h4', { text: '音效' }))
      soundRows().forEach(function (n) {
        out.push(n)
      })
      out.push(h('h4', { text: '免打扰' }))
      out.push(
        h('div', { class: 'row' }, [
          h('div', { class: 'grow' }, [h('div', { class: 'name', text: '一键静音 30 分钟' }), h('div', { class: 'meta', text: data && data.muted ? '正在静音中' : '只影响提示音，不影响连接' })]),
          h('button', {
            class: 'pill ' + (data && data.muted ? 'on' : 'off'),
            text: data && data.muted ? '已静音' : '静音',
            onclick: function () {
              post('quiet', { mutedUntil: data && data.muted ? 0 : Date.now() + 30 * 60000 })
            },
          }),
        ]),
      )
      logRows().forEach(function (n) {
        out.push(n)
      })
      return out
    }

    function render() {
      renderTabs()
      body.textContent = ''
      var nodes = tab === 'connect' ? connectPane() : advancedPane()
      nodes.forEach(function (n) {
        if (n) body.appendChild(n)
      })
    }

    window.addEventListener('dsh-my-phone:open', function () {
      open()
    })

    return {
      open: open,
      close: close,
      render: render,
      isOpen: function () {
        return root.style.display !== 'none'
      },
    }
  }

  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
        return
      }
    } catch (e) {
      /* 降级 */
    }
    try {
      var ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;opacity:0'
      document.documentElement.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    } catch (e) {
      /* 复制不了就算了 */
    }
  }


// ---------- 纯色测试按钮（v1.6.5：把每一步都报到服务端，点不动也能查） ----------
  function probeReport(stage, detail) {
    try {
      var body = JSON.stringify({
        stage: String(stage || '').slice(0, 24),
        detail: String(detail || '').slice(0, 150),
        w: window.innerWidth,
        h: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
      })
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/__myphone/client-report', new Blob([body], { type: 'application/json' }))
      } else {
        void fetch('/__myphone/client-report', { method: 'POST', body: body, headers: { 'content-type': 'application/json' } })
      }
    } catch (e) {
      /* 信标失败无所谓 */
    }
  }

  function mountProbe() {
    try {
      var d = document.getElementById('dmp-probe')
      if (d && document.contains(d)) return
      d = document.createElement('button')
      d.id = 'dmp-probe'
      d.type = 'button'
      d.textContent = '测试按钮 · 点我开面板'
      d.style.cssText = [
        'position:fixed', 'left:50%', 'top:10px', 'transform:translateX(-50%)',
        'z-index:2147483647', 'background:#e11d48', 'color:#fff', 'border:0',
        'border-radius:10px', 'padding:12px 18px', 'font:700 14px/1.2 system-ui,sans-serif',
        'box-shadow:0 6px 18px rgba(225,29,72,.45)', 'cursor:pointer', 'max-width:86vw',
      ].join(';')

      var fired = false
      var go = function (how) {
        if (fired) return
        fired = true
        d.style.background = '#1f6feb'
        d.textContent = '收到' + how + '…正在开'
        probeReport('probe-down', how)
        setTimeout(function () {
          try {
            openPanelDomOnly()
            d.style.background = '#0a7a4b'
            d.textContent = '已点开 · ' + new Date().toLocaleTimeString()
            probeReport('probe-open-ok', 'panel=' + Boolean(panel))
          } catch (e) {
            var msg = (e && (e.message || String(e))) || '未知错误'
            d.style.background = '#7f1d1d'
            d.textContent = '报错：' + msg
            probeReport('probe-open-err', msg)
          }
        }, 40)
      }

      d.addEventListener('pointerdown', function (ev) { try { ev.stopPropagation() } catch (e) {} go('按下') }, true)
      d.addEventListener('click', function (ev) { try { ev.stopPropagation() } catch (e) {} go('点击') }, true)
      d.addEventListener('touchend', function (ev) { try { ev.stopPropagation() } catch (e) {} go('触摸') }, true)
      ;(document.body || document.documentElement).appendChild(d)

      // 全页监听：确认点击事件到底有没有送到页面（用户点不动时靠这条查）
      if (!window.__dmpProbeDoc) {
        window.__dmpProbeDoc = true
        window.addEventListener(
          'pointerdown',
          function (ev) {
            var tgt = ev.target || {}
            probeReport('probe-doc-down', (tgt.id || tgt.tagName || '?') + ' @' + Math.round(ev.clientX) + ',' + Math.round(ev.clientY))
          },
          true,
        )
      }
    } catch (e) {
      /* 不要抛到宿主 */
    }
  }

  mountProbe()

  // ---------- 常驻看护 ----------
  function ensure() {
    try {
      if (!document.documentElement) return
      if (!el || !document.contains(el)) mount()
      mountProbe()
    } catch (e) {
      /* 极端情况下不要抛到宿主 */
    }
  }

  function placeBubble() {
    if (!bubble || !el || bubble.style.opacity !== '1') return
    var r = el.getBoundingClientRect()
    var left = Math.min(Math.max(8, r.left - 120), Math.max(8, vw() - 268))
    bubble.style.left = left + 'px'
    bubble.style.top = Math.round(Math.min(Math.max(8, r.top + H / 2 - 18), vh() - 70)) + 'px'
  }
  setInterval(placeBubble, 400)

  if (!USE_DOM_UI) return // 暂停纯 DOM UI：这次先让 React 那套界面出场

  ensure()
  boot()
  setInterval(ensure, 1200)
})()
