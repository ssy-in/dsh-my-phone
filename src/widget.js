/**
 * DSH My Phone —— 悬浮球 + 弹窗（纯 DOM）
 *
 * 为什么单独成文件：宿主每次重渲染都会换掉插槽子树，React portal 的容器也会被顺带摘走，
 * 表现就是「球闪一下、然后只剩一个兜底小球」。dsh-whale-widget 在同一台机器上证明了另一条路：
 * 由宿主 index 注入一段内联脚本，脚本自己建 `<script src="/__myphone/widget.js">`，
 * 球和面板全由这段纯 DOM 代码自己维护 —— 不经过插槽、不经过 React，宿主换 DOM 也换不掉它。
 *
 * v1.7.0 起：React 那份（client.js）已整个删除 —— 球和面板就是这里一份，没有后备、没有并存。
 */
;(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (window.__dshMyPhoneWidget) return
  window.__dshMyPhoneWidget = true

  // 尺寸：跟旧版 React 球一致（宽 135、按紧裁图标比例 512×459 得高约 121）
  // v1.6.1 临时开关：true = 用纯 DOM 球与纯 DOM 弹窗（v1.5.0 那套）；
  var TILE = 121
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
  // v1.8.19：这三个量以前只读不写声明 —— showBubble 一开跑就 `bubbleSig is not defined`，
  // 被调用方的 try/catch 吞掉，表现就是「气泡从来不弹、鼠标放上去也不弹」。
  var bubbleSig = ''
  var bubbleSide = 'left'
  var bubbleTail = null
  var bubbleSticky = false

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
  // 存在 dsh-my-phone.sound.v2：{ hover, click, bubble, volume, timbre }（旧版的 on:{join,msg,approval} 不再读）
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
  // 三个开关：滑入滑出音 / 点击音 / 气泡音，默认全开
  var SOUND_DEFAULT = { hover: true, click: true, bubble: true, volume: 100, timbre: 'bell' }

  function sound() {
    var out = {
      hover: SOUND_DEFAULT.hover,
      click: SOUND_DEFAULT.click,
      bubble: SOUND_DEFAULT.bubble,
      volume: SOUND_DEFAULT.volume,
      timbre: SOUND_DEFAULT.timbre,
    }
    try {
      var raw = window.localStorage && window.localStorage.getItem(SOUND_KEY)
      if (!raw) return out
      var j = JSON.parse(raw) || {}
      ;['hover', 'click', 'bubble'].forEach(function (k) {
        if (typeof j[k] === 'boolean') out[k] = j[k]
        // 老版本记的是 on:{approval,join,msg}，没这三个键就当「没设置过」= 开
      })
      if (typeof j.volume === 'number') out.volume = Math.max(0, Math.min(100, j.volume))
      if (TIMBRES.some(function (x) { return x[0] === j.timbre })) out.timbre = j.timbre
    } catch (e) {
      /* 读不到就用默认 */
    }
    return out
  }

  function saveSound(next) {
    try {
      window.localStorage && window.localStorage.setItem(SOUND_KEY, JSON.stringify(next))
    } catch (e) {
      /* 存不了就只在本次会话生效 */
    }
    prep()
  }

  // 每次发声前把音量和音色同步给引擎（引擎可能是刚加载的、也可能被别人改过）
  function prep() {
    var eng = window.__dshMyPhoneAudio
    if (!eng) return null
    var s = sound()
    try {
      if (typeof eng.setVolume === 'function') eng.setVolume(s.volume)
      if (typeof eng.setTimbre === 'function') eng.setTimbre(s.timbre)
    } catch (e) {
      /* 引擎状态异常就别拦着 */
    }
    return eng
  }

  function eng() {
    return window.__dshMyPhoneAudio || null
  }

  // 滑入 / 滑出：各一声短音
  function playHover(kind) {
    var s = sound()
    if (!s.hover) return
    var e = prep()
    if (!e) return
    try {
      if (kind === 'out') e.leave()
      else e.enter()
    } catch (err) {
      /* 忽略 */
    }
  }

  // 点击：按下、松手各一声短音
  function playClick(kind) {
    var s = sound()
    if (!s.click) return
    var e = prep()
    if (!e) return
    try {
      if (kind === 'up') e.release()
      else e.press()
    } catch (err) {
      /* 忽略 */
    }
  }

  // 气泡音：按优先级 P0 五声长音 / P1 三声 / P2 两声
  function playLevel(level) {
    var s = sound()
    if (!s.bubble) return
    var e = prep()
    if (!e) return
    try {
      if (level === 0) e.alert()
      else if (level === 1) e.notice()
      else e.short()
    } catch (err) {
      /* 忽略 */
    }
  }

  // 音效引擎：独立脚本，拉到就能出声；拉不到就静音跑，不拦界面
  var audioTries = 0
  function loadAudio() {
    if (window.__dshMyPhoneAudio) {
      prep()
      return
    }
    if (audioTries > 6) return
    audioTries += 1
    var old = document.getElementById('dmp-audio-js')
    if (old) old.parentNode.removeChild(old)
    var s = document.createElement('script')
    s.id = 'dmp-audio-js'
    s.src = '/__myphone/audio.js?v=2'
    s.onload = function () {
      prep()
    }
    s.onerror = function () {
      setTimeout(loadAudio, 800)
    }
    ;(document.head || document.documentElement).appendChild(s)
  }

  // 第一次真点/真按之前浏览器不许出声，先摸摸它（拿不到就等下一次）
  function unlockAudio() {
    var e = prep()
    if (!e) return
    try {
      if (typeof e.unlock === 'function') e.unlock()
    } catch (err) {
      /* 忽略 */
    }
  }

  function soundRows() {
    var s = sound()
    var out = []

    var seg = h('div', { class: 'seg' })
    ;[
      ['hover', '滑入滑出音', 2],
      ['click', '点击音', 2],
      ['bubble', '气泡音', 0],
    ].forEach(function (kv) {
      seg.appendChild(
        h('button', {
          class: s[kv[0]] ? 'on' : '',
          text: kv[1],
          onclick: function () {
            var n = sound()
            n[kv[0]] = !n[kv[0]]
            saveSound(n)
            if (n[kv[0]]) {
              if (kv[0] === 'hover') playHover('in')
              else if (kv[0] === 'click') playClick('down')
              else playLevel(kv[2])
            }
            render()
          },
        }),
      )
    })
    out.push(h('div', { style: 'padding:6px 0 8px' }, [seg]))

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
      playHover('in')
    })
    var pickEl = timbreRow(s)
    out.push(
      h('div', { class: 'row', style: 'display:flex;align-items:center;gap:8px' }, [
        h('div', { style: 'font-size:12.5px;color:#43606f;flex:0 0 auto', text: '音色' }),
        pickEl,
        h('div', { style: 'font-size:12.5px;color:#43606f;flex:0 0 auto;margin-left:4px', text: '音量' }),
        vol,
        volTxt,
      ]),
    )
    out.push(h('div', { class: 'dmp-hint', text: '只是提示音，不影响连接。第一次点过页面之后才会有声音（浏览器要求）。' }))
    return out
  }

  // 音色：自绘下拉（原生 <select> 的列表是系统画的，改不了颜色）
  // 所有「点外面收起」的下拉共用一个 document 监听器（避免每次 render 都新挂一个）
  var PICK_CLOSERS = []
  var pickBound = false
  function bindPickDoc() {
    if (pickBound) return
    pickBound = true
    document.addEventListener('pointerdown', function (ev) {
      for (var i = PICK_CLOSERS.length - 1; i >= 0; i -= 1) {
        try {
          PICK_CLOSERS[i](ev)
        } catch (e) {
          /* 单个下拉出错不影响别的 */
        }
      }
    })
  }

  function timbreRow(s) {
    // 只当「控件工厂」用：真正的排布在音效区那行里（音色 [下拉] 音量 [滑块]）

    var btn = h('button', { class: 'pick' })
    var list = h('div', { class: 'picklist' })
    var open = false
    var label = function (id) {
      for (var i = 0; i < TIMBRES.length; i += 1) if (TIMBRES[i][0] === id) return TIMBRES[i][1]
      return '卡林巴'
    }
    var paint = function () {
      var cur = sound().timbre
      btn.textContent = label(cur) + '  ▾'
      list.textContent = ''
      TIMBRES.forEach(function (kv) {
        list.appendChild(
          h('button', {
            class: 'pickopt' + (kv[0] === cur ? ' on' : ''),
            text: kv[1],
            onclick: function (ev) {
              ev.stopPropagation()
              var n = sound()
              n.timbre = kv[0]
              saveSound(n)
              open = false
              list.style.display = 'none'
              paint()
              var e = prep()
              if (e && typeof e.preview === 'function') {
                try {
                  e.preview(kv[0])
                } catch (err) {
                  /* 忽略 */
                }
              }
            },
          }),
        )
      })
      list.style.display = open ? 'block' : 'none'
      // 下拉在面板下半部分时朝上展，不然被面板底边切掉
      if (open) {
        var rb = btn.getBoundingClientRect()
        var need = 46 * TIMBRES.length + 12
        list.className = 'picklist' + (rb.bottom + need > window.innerHeight - 12 ? ' up' : '')
      } else {
        list.className = 'picklist'
      }
    }
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation()
      open = !open
      paint()
    })
    list.addEventListener('click', function (ev) {
      ev.stopPropagation()
    })
    bindPickDoc()
    PICK_CLOSERS.push(function (ev) {
      if (!open) return
      if (!btn.isConnected) return
      if (list.contains(ev.target) || btn.contains(ev.target)) return
      open = false
      paint()
    })
    paint()
    var wrap = h('div', { style: 'position:relative;flex:0 0 auto;min-width:92px' }, [btn, list])
    // 标签由外层 soundRows 提供，这里只出控件（以前两边各写一个「音色」）
    return h('div', { class: 'row', style: 'border-bottom:0;padding:0;display:flex;align-items:center;gap:0' }, [
      wrap,
    ])
  }

  // ---------- 数据 ----------
  /**
   * 快照里的 `feed` 是**对象**（`{pending, human, tech, techRaw, unread, pendingCount}`，
   * 见 `src/gate.js` 的 buildFeed），不是数组。
   *
   * v1.8.19 之前的 widget 一直按数组读它（`Array.isArray(data.feed) ? data.feed : []`），
   * 于是永远拿到空数组：气泡不弹、消息列表永远「暂时没有需要你看的消息」、
   * 红点也只剩 pendingCount 那一条路。这里统一摊平成数组，`pending` 排前面。
   */
  function feedItems() {
    if (!data) return []
    var f = data.feed
    if (Array.isArray(f)) return f // 兼容老形状（手机只读快照可能给的是数组）
    if (!f || typeof f !== 'object') return []
    var out = []
    if (Array.isArray(f.pending))
      for (var i = 0; i < f.pending.length; i++) {
        var p = f.pending[i]
        if (!p) continue
        out.push({
          id: p.id,
          seq: p.seq,
          at: p.at,
          text: p.text,
          name: p.name,
          level: p.level == null ? 0 : p.level,
          pending: true,
        })
      }
    if (Array.isArray(f.human))
      for (var j = 0; j < f.human.length; j++) {
        var it = f.human[j]
        if (!it) continue
        out.push({
          id: it.id,
          seq: it.seq,
          at: it.at,
          text: it.text,
          kind: it.kind,
          level: it.level == null ? 2 : it.level,
          pending: false,
        })
      }
    return out
  }

  function unreadCount() {
    if (!data) return 0
    if (typeof data.pendingCount === 'number' && data.pendingCount > 0) return data.pendingCount
    var feed = feedItems()
    var n = 0
    for (var i = 0; i < feed.length; i++) if (feed[i] && feed[i].pending) n += 1
    return n
  }

  function summary() {
    if (!data) return '手机连 DSH · 点一下扫码'
    var feed = feedItems()
    for (var i = 0; i < feed.length; i++) {
      var it = feed[i]
      if (it && it.pending && it.text) return it.title ? it.title + '：' + it.text : it.text
    }
    for (var j = 0; j < feed.length; j++) if (feed[j] && feed[j].text) return feed[j].text
    return '手机连 DSH · 点一下扫码'
  }

  // 气泡内容按「原来那套信笺」取：等授权 / 新连接 / 默认
  // 气泡只说「最该说的那一条」：级别数字小的优先（P0 > P1 > P2），同级取最新。
  // 标签/颜色/小字按级别与类型给，P0 琥珀、P1 橙、P2 青（与消息列表的色条一致）。
  // 原版那套文案（v1.6 的 client.js）：新连接带设备名 + 时间；多张待授权写条数；单条把会话名上色
  function bubbleCard() {
    var notices = data && Array.isArray(data.notices) ? data.notices : []
    var last = notices[notices.length - 1]
    if (last && last.label) {
      return {
        tag: '新连接',
        meta: hhmm(last.at),
        main: [{ t: last.label + '刚连进来' }],
        sign: '高级页·已配对设备里可断开',
      }
    }
    var appr = data && Array.isArray(data.approvals) ? data.approvals : []
    if (appr.length > 1) {
      var first = appr[appr.length - 1]
      return {
        tag: '等授权',
        tagColor: '#C88A00',
        meta: appr.length + ' 条',
        main: [{ t: String(first.text || '正在请求授权...') }],
        sign: '还有 ' + (appr.length - 1) + ' 条 · 点开消息看',
      }
    }
    if (appr.length === 1) {
      var one = appr[0]
      var who = String(one.name || '').trim()
      return {
        tag: '等授权',
        tagColor: '#C88A00',
        main: who
          ? [
              { t: '【' + who + '】', c: '#C88A00' },
              { t: '正在请求授权...' },
            ]
          : [{ t: String(one.text || '正在请求授权...') }],
        sign: '点一下看详情 · 在 DSH 里批准或拒绝',
      }
    }
    var u = Number((data && data.unread) || 0)
    if (u > 0) {
      return {
        tag: '新连接',
        meta: u + ' 台',
        main: [{ t: '有 ' + u + ' 台设备刚连进来' }],
        sign: '高级页·已配对设备里可断开',
      }
    }
    return { tag: '手机连接', main: [{ t: '点一下 · 手机扫码连 DSH' }] }
  }

  /**
   * 把气泡摆到球旁边（v1.8.19 补上；以前这个函数只被调用、从未实现，
   * 于是 showBubble 第一行就抛 ReferenceError，气泡永远出不来）。
   *
   * 规则：优先摆球的左侧（球默认贴右边），左边放不下就摆右侧；
   * 竖直方向跟球心对齐再夹进视口，尖角始终指向球心。
   * 面板开着时气泡藏在后面，不做特殊处理。
   */
  function placeBubble() {
    if (!bubble || !el) return
    var w = bubble.offsetWidth || 244
    var h = bubble.offsetHeight || 96
    var gap = 14
    var r = el.getBoundingClientRect()
    var cx = r.left + r.width / 2
    var cy = r.top + r.height / 2
    var vwv = vw()
    var vhv = vh()
    var left = cx - gap - w
    if (left < 8) left = cx + r.width / 2 + gap
    if (left + w > vwv - 8) left = Math.max(8, vwv - w - 8)
    var top = cy - h / 2
    top = Math.min(Math.max(8, top), Math.max(8, vhv - h - 8))
    bubble.style.left = Math.round(left) + 'px'
    bubble.style.top = Math.round(top) + 'px'
    // 尖角朝向球那一侧，纵向落在球心高度上
    var onLeft = cx > left + w / 2
    bubbleSide = onLeft ? 'left' : 'right'
    if (bubbleTail) {
      bubbleTail.style[bubbleSide === 'right' ? 'left' : 'right'] = '-5px'
      bubbleTail.style[bubbleSide === 'right' ? 'right' : 'left'] = 'auto'
      var ty = Math.round(Math.min(Math.max(16, cy - top - 4.5), Math.max(16, h - 22)))
      bubbleTail.style.top = ty + 'px'
    }
  }

  function showBubble(ms) {
    if (!bubble) return
    var card = bubbleCard()
    var sig = JSON.stringify(card)
    var already = bubble.style.opacity === '1'
    if (sig === bubbleSig && already) {
      // 内容没变、也还显示着：只校正位置，不重建 DOM，不重播动画
      placeBubble()
      return
    }
    bubbleSig = sig
    bubble.textContent = ''
    bubble.style.cssText =
      'position:fixed;z-index:2147483001;width:244px;padding:13px 17px 14px;border-radius:16px;' +
      'background:#fff;border:1px solid rgba(26,111,224,.28);box-shadow:0 16px 38px rgba(6,24,36,.22);' +
      'text-align:left;opacity:0;transform:translateY(-4px);transition:opacity .18s ease,transform .18s ease;pointer-events:none'
    // 尖角（朝球那侧）—— 放在哪个边、纵向落点都由 placeBubble() 决定
    var tail = document.createElement('span')
    tail.style.cssText =
      'position:absolute;top:22px;width:9px;height:9px;background:#fff;border:1px solid rgba(26,111,224,.28);' +
      'transform:rotate(45deg)'
    bubble.appendChild(tail)
    bubbleTail = tail
    var head = document.createElement('div')
    head.style.cssText = 'display:flex;align-items:center;gap:8px'
    var tag = document.createElement('span')
    tag.style.cssText =
      'font:800 10.5px/1.4 system-ui,sans-serif;letter-spacing:.1em;color:' + (card.tagColor || '#1a6fe0')
    tag.textContent = card.tag
    head.appendChild(tag)
    if (card.meta) {
      var metaEl = document.createElement('span')
      metaEl.style.cssText = 'margin-left:auto;font:700 10.5px/1.4 system-ui,sans-serif;color:#9aa9b8'
      metaEl.textContent = card.meta
      head.appendChild(metaEl)
    }
    bubble.appendChild(head)
    var hair = document.createElement('div')
    hair.style.cssText = 'margin:6px 0 0;height:1px;background:linear-gradient(90deg,rgba(26,111,224,.18),rgba(26,111,224,0))'
    bubble.appendChild(hair)
    var main = document.createElement('div')
    main.style.cssText = 'margin:9px 0 0;font:700 14px/1.5 system-ui,sans-serif;color:#0d2436'
    ;(card.main || []).forEach(function (part) {
      var sp = document.createElement('span')
      var piece = part && typeof part === 'object' ? part : { t: String(part == null ? '' : part) }
      if (piece.c) sp.style.color = piece.c
      sp.textContent = piece.t
      main.appendChild(sp)
    })
    bubble.appendChild(main)
    if (card.sign) {
      var sign = document.createElement('div')
      sign.style.cssText = 'margin:10px 0 0;font:400 11px/1.4 system-ui,sans-serif;color:#7d93a8;text-align:right'
      sign.textContent = '—— ' + card.sign
      bubble.appendChild(sign)
    }
    placeBubble()
    if (!already) {
      bubble.style.opacity = '1'
      bubble.style.transform = 'translateY(0)'
    }
    clearTimeout(bubbleTimer)
    if (ms !== 0) bubbleTimer = setTimeout(hideBubble, ms == null ? 4500 : ms)
  }

  // 事件驱动：快照里出现「新的」待处理或新消息时主动弹一次气泡（P0 常驻，等人在面板里点掉）
  var lastBubbleKey = ''
  function autoBubble() {
    var feed = feedItems()
    var top = null
    for (var i = 0; i < feed.length; i++) {
      if (feed[i] && feed[i].pending) {
        top = feed[i]
        break
      }
    }
    if (!top) {
      for (var j = feed.length - 1; j >= 0; j--) {
        if (feed[j] && feed[j].text) {
          top = feed[j]
          break
        }
      }
    }
    // feed 为空的情况（老版本快照、或 gate 暂时给 null）：退回用 notices / approvals
    // 判断「有没有新东西」，否则手机上、升级过程中永远等不到一次气泡。
    if (!top) {
      var nApprovals = data && Array.isArray(data.approvals) ? data.approvals.length : 0
      var nNotices = data && Array.isArray(data.notices) ? data.notices.length : 0
      if (nApprovals || nNotices) {
        var fb = bubbleCard()
        top = { seq: '', text: JSON.stringify(fb), level: nApprovals ? 0 : 2, pending: false }
      }
    }
    if (!top) return
    try {
      if (panel && panel.isOpen && panel.isOpen()) return
    } catch (e) {
      /* 忽略 */
    }
    var key = String(top.seq == null ? '' : top.seq) + '|' + String(top.text || '')
    if (key === lastBubbleKey) return
    lastBubbleKey = key
    showBubble(top.pending ? 0 : 4500)
    playLevel(top.pending ? 0 : top.level == null ? 2 : top.level)
  }

  function hideBubble() {
    if (!bubble) return
    bubbleSig = ''
    bubble.style.opacity = '0'
  }

  function refresh() {
    try {
      fetch(API, { headers: { 'x-myphone-panel': '1' }, credentials: 'same-origin' })
        .then(function (r) {
          return r && r.ok ? r.json() : null
        })
        .then(function (json) {
          if (!json) {
            // 手机上管理口够不着：公网口对这个路径回 404（不是网络错误），
            // 以前这里直接 return → 手机永远看不到「手机形态」。
            loadRemote()
            return
          }
          remote = null // 管理口又能连上了：回到本地可写模式
          data = json
          paint()
          autoBubble()
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
    // 提示音：有新消息（时间比上次新）就响；同一时刻只响一次
    try {
      var feed = feedItems()
      // 取「最新的一条」而不是 feed[0]：pending 会排在最前面，但它不一定最新
      var newest = null
      for (var k = 0; k < feed.length; k++) {
        var t = Number(feed[k] && feed[k].at) || 0
        if (!newest || t > (Number(newest.at) || 0)) newest = feed[k]
      }
      var newestAt = newest ? Number(newest.at) || 0 : 0
      var pendingNow = unreadCount()
      if (newestAt && newestAt > lastFeedAt) {
        if (lastFeedAt) playLevel(Number(newest.level) || 2)
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
    // 以前这里是每秒 textContent = summary()，纯文本覆写会让排版跳一下（隐约闪烁）。
    // 现在交给 showBubble 统一渲染，内容指纹没变就完全不动 DOM。
    if (bubble && bubble.style.opacity === '1') showBubble()
  }

  function boot() {
    loadAudio()
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
          autoBubble()
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

    el.addEventListener('pointerdown', function (ev) {
      unlockAudio()
      playClick('down')
      onDown(ev)
    })
    el.addEventListener('pointerup', function () {
      playClick('up')
    })
    el.addEventListener('pointercancel', function () {
      playClick('up')
    })
    el.addEventListener('pointerenter', function (ev) {
      if (ev.pointerType && ev.pointerType !== 'mouse') return
      playHover('in')
      el.classList.add('dmp-w-hover')
      clearTimeout(hoverTimer)
      hoverTimer = setTimeout(showBubble, 300)
    })
    el.addEventListener('pointerleave', function () {
      playHover('out')
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

    // 纯 DOM 球就位（v1.7.0：不再有 React 球要躲，这里只负责记住状态）
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
      '#dmp-panel .dmp-warn{margin:10px 0 2px;padding:9px 11px;border-radius:10px;background:#fff8e8;border:1px solid #f3e0b0;color:#b45309;font:700 12.5px/1.5 system-ui}',
      '#dmp-panel .dmp-info{width:22px;height:22px;margin:9px 0 0 auto;padding:0;border-radius:50%;border:1px solid #cfe3ee;background:#f6fbfd;color:#3a7f95;font:800 12px/20px system-ui;cursor:pointer}',
      '#dmp-panel .dmp-info.on{background:#0b7f8c;border-color:#0b7f8c;color:#fff}',
      '#dmp-panel .dmp-infocard{margin:10px 0 2px;padding:10px 12px;border-radius:10px;background:#f2fbfe;border:1px solid #d3ecf4}',
      '#dmp-panel .dmp-infotitle{font:800 12.5px/1.5 system-ui;color:#0d2436;margin-bottom:4px}',
      '#dmp-panel .dmp-inforow{font:400 11.5px/1.62 system-ui;color:#3a587f;margin-top:3px}',
      '#dmp-panel .dmp-body{padding:14px 16px 18px;overflow:auto;flex:1 1 auto}',
      '#dmp-panel h4{margin:16px 0 8px;font-size:12.5px;font-weight:800;letter-spacing:.4px;color:#4a6478;text-transform:none}',
      '#dmp-panel h4:first-child{margin-top:2px}',
      '#dmp-panel .dmp-hint{margin:6px 0 0;font-size:12px;color:#5f7688;line-height:1.6}',
      '#dmp-panel .dmp-lead{margin:16px 0 0;font-size:15px;font-weight:800;color:var(--ink);letter-spacing:.01em}',
      '#dmp-panel .dmp-sub{margin:5px 0 0;font-size:12.5px;color:var(--ink3)}',
      '#dmp-panel .dmp-qr{margin:16px auto 0;width:214px;height:214px;background:#fff;border:1px solid #dbeaf1;border-radius:16px;',
      '  display:flex;align-items:center;justify-content:center;padding:9px;position:relative}',
      '#dmp-panel .dmp-qr svg{width:100%;height:100%;display:block}',
      '#dmp-panel .dmp-qr.dead{filter:grayscale(1) opacity(.42)}',
      '#dmp-panel .dmp-dead{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;',
      '  font:800 15px/1 inherit;color:#c0271b;background:rgba(255,255,255,.72);border-radius:16px;letter-spacing:2px}',
      '#dmp-panel .dmp-empty{color:#7b8fa1;font-size:12.5px;text-align:center;padding:56px 10px}',
      '#dmp-panel .dmp-ttl{margin:10px 0 0;text-align:center;font:700 12.5px/1.5 ui-monospace,Menlo,monospace;color:#0a7a4b}',
      '#dmp-panel .dmp-ttl.dead{color:#c0271b}',
      '#dmp-panel .dmp-link{display:flex;gap:8px;align-items:center;margin-top:12px;background:#eef5f9;border:1px solid #dceaf1;border-radius:11px;padding:8px 10px}',
      '#dmp-panel .dmp-link code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
      '  font:11.5px/1.5 ui-monospace,Menlo,monospace;color:#26485c}',
      '#dmp-panel button.mini{border:1px solid #cfe4ec;background:#fff;color:#0a5f75;font:700 11.5px/1 inherit;padding:6px 9px;border-radius:8px;cursor:pointer}',
      '#dmp-panel button.mini:hover{background:#eaf7fb}',
      '#dmp-panel button.primary:not(.btn){display:block;width:100%;margin:14px auto 0;max-width:268px;border:0;cursor:pointer;',
      '  background:linear-gradient(145deg,#2a86a3,#0a5f75);color:#fff;font:800 14.5px/1 inherit;padding:13px 18px;border-radius:13px;',
      '  box-shadow:0 8px 20px rgba(10,95,117,.28)}',
      '#dmp-panel button.primary:not(.btn):disabled{opacity:.6;cursor:default}',
      '#dmp-panel button.ghost{border:0;background:transparent;color:#5f7688;font:700 12px/1 inherit;cursor:pointer;padding:8px}',
      '#dmp-panel button.ghost:hover{color:#0a5f75}',
      '#dmp-panel .dmp-center{text-align:center}',
      '#dmp-panel .row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #eaf2f6}',
      '#dmp-panel .row:last-child{border-bottom:0}',
      '#dmp-panel .seg{display:flex;gap:6px;flex-wrap:wrap}',
      '#dmp-panel .seg button{border:1px solid #cfe3ee;background:#f6fbfd;color:#4b6b7d;font:600 12px/1 system-ui;padding:8px 10px;border-radius:9px;cursor:pointer}',
      '#dmp-panel .seg button.on{background:#0b7f8c;border-color:#0b7f8c;color:#fff}',
      '#dmp-panel .seg.sm{gap:5px}',
      '#dmp-panel .seg.sm button{padding:6px 8px;font-size:11.5px}',
      '#dmp-panel .dmp-q{position:relative;display:inline-flex;align-items:center;justify-content:center;width:11px;height:11px;padding:0;border-radius:50%;border:0;background:linear-gradient(145deg,#7fd9e6,#2aa7bb);color:#fff;cursor:help;user-select:none;box-shadow:0 1px 2px rgba(11,127,140,.32);flex:0 0 auto;vertical-align:middle}',
      '#dmp-panel .dmp-q svg{width:7px;height:7px;display:block;pointer-events:none}',
      '#dmp-panel .dmp-q::before{content:"";position:absolute;inset:-9px;border-radius:50%}',
      '#dmp-panel .dmp-q:hover{filter:brightness(1.08)}',
      // ---- v1.8.0 视觉提升（统一 token，覆盖上面的旧值） ----
      '#dmp-panel{--ink:#0d2436;--ink2:#43606f;--ink3:#7d93a8;--line:#e3eef4;--line2:#eef6fa;--brand:#1a6fe0;--brand2:#0e8fa8;--soft:#f5f9ff}',
      '#dmp-panel .dmp-card{border-radius:22px;box-shadow:0 30px 80px rgba(6,24,36,.34);animation:dmp-pop .22s cubic-bezier(.22,1.2,.36,1)}',
      '@keyframes dmp-pop{from{opacity:0;transform:translateY(10px) scale(.975)}to{opacity:1;transform:none}}',
      '#dmp-panel .dmp-title{font:800 15px/1.3 system-ui;color:var(--ink);letter-spacing:.01em}',
      '#dmp-panel .dmp-tabs{gap:4px;border-bottom:1px solid var(--line2)}',
      '#dmp-panel .dmp-tab{position:relative;transition:color .16s ease,background .16s ease}',
      '#dmp-panel .dmp-tab:hover{color:#20455a}',
      '#dmp-panel .dmp-tab.on::after{content:"";position:absolute;left:12px;right:12px;bottom:-1px;height:2px;border-radius:2px;background:var(--brand)}',
      '#dmp-panel h4{margin:20px 0 6px;font:800 11.5px/1 system-ui;color:var(--ink3);letter-spacing:.1em;text-transform:uppercase;display:flex;align-items:center;gap:5px}',
      '#dmp-panel h4 .dmp-q{align-self:center;margin:0}',
      '#dmp-panel h4::before{content:"";width:3px;height:11px;border-radius:2px;background:linear-gradient(180deg,var(--brand2),var(--brand));flex:0 0 auto}',
      '#dmp-panel h4:first-child{margin-top:8px}',
      '#dmp-panel .dmp-lead{font:800 16.5px/1.35 system-ui;color:var(--ink);letter-spacing:.01em}',
      '#dmp-panel .dmp-sub{margin-top:2px;color:var(--ink3)}',
      '#dmp-panel .dmp-body{padding-bottom:6px}',
      '#dmp-panel .row{border-bottom-color:var(--line2);transition:background .14s ease}',
      '#dmp-panel .name{font:600 13px/1.4 system-ui;color:var(--ink)}',
      '#dmp-panel .meta{font:400 11.5px/1.5 system-ui;color:var(--ink3)}',
      '#dmp-panel button{transition:transform .12s ease,box-shadow .18s ease,background .16s ease,border-color .16s ease}',
      '#dmp-panel button:active{transform:scale(.97)}',
      '#dmp-panel .primary:not(.btn),#dmp-panel .btn.big{background:linear-gradient(145deg,#1f7bf0,#1358c8);border:0;color:#fff;font:800 14px/1.2 system-ui;padding:12px 16px;border-radius:12px;box-shadow:0 12px 24px rgba(26,111,224,.28)}',
      '#dmp-panel .primary:not(.btn):hover,#dmp-panel .btn.big:hover{box-shadow:0 14px 28px rgba(11,127,140,.34);transform:translateY(-1px)}',
      '#dmp-panel .mini,#dmp-panel .btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:30px;padding:0 12px;border-radius:9px;border:1px solid var(--line);background:#fff;color:var(--ink2);font:700 12px/1 system-ui;cursor:pointer;transition:background .15s ease,border-color .15s ease,color .15s ease,box-shadow .15s ease}',
      '#dmp-panel .btn:hover,#dmp-panel .mini:hover{border-color:#c9e2ef;background:#f7fbfd}',
      '#dmp-panel .btn.primary{background:linear-gradient(145deg,#1f7bf0,#1358c8);border-color:transparent;color:#fff;box-shadow:0 6px 14px rgba(26,111,224,.24)}',
      '#dmp-panel .btn.warn{border-color:#f2cf9a;background:#fff9f0;color:#b45309}',
      '#dmp-panel .btn.warn:hover{background:#fff4e3}',
      '#dmp-panel .btn.danger{border-color:#f0c3bd;background:#fff7f6;color:#c0271b}',
      '#dmp-panel .btn.danger:hover{background:#ffefed}',
      '#dmp-panel .btn.ghost{border-color:transparent;background:transparent;color:var(--ink3)}',
      '#dmp-panel .dmp-input{flex:1;min-width:0;height:30px;padding:0 10px;border-radius:9px;border:1px solid #dcebf2;background:#fff;font:12.5px/1 system-ui;color:var(--ink);outline:none}',
      '#dmp-panel .dmp-input:focus{border-color:var(--brand);box-shadow:0 0 0 3px rgba(26,111,224,.12)}',
      '#dmp-panel .dmp-input::placeholder{color:#a8bccb}',
      '#dmp-panel .mini:hover{background:var(--soft);border-color:#bfe4ee}',
      '#dmp-panel .pill{border-radius:999px;font:700 11.5px/1 system-ui}',
      '#dmp-panel .dmp-link{border:1px solid var(--line);background:var(--soft);border-radius:10px;padding:8px 10px}',
      '#dmp-panel .dmp-link code{font:12px/1.5 ui-monospace,Menlo,monospace;color:var(--ink2);font-variant-numeric:tabular-nums}',
      '#dmp-panel .dmp-ttl{font-variant-numeric:tabular-nums;letter-spacing:.02em}',
      '#dmp-panel .dmp-qr{border-radius:14px;box-shadow:0 10px 24px rgba(6,24,36,.10);border:1px solid var(--line)}',
      '#dmp-panel .dmp-hint{color:var(--ink3)}',
      '#dmp-panel *::-webkit-scrollbar{width:8px;height:8px}',
      '#dmp-panel *::-webkit-scrollbar-thumb{background:#d6e6ee;border-radius:999px}',
      '#dmp-panel *::-webkit-scrollbar-thumb:hover{background:#bcdfea}',
      '#dmp-panel *::-webkit-scrollbar-track{background:transparent}',
      '#dmp-w-dot{animation:dmp-pulse 1.8s ease-in-out infinite}',
      '@keyframes dmp-pulse{0%,100%{box-shadow:0 0 0 0 rgba(224,48,48,.55)}50%{box-shadow:0 0 0 6px rgba(224,48,48,0)}}',
      '#dmp-panel input[type=range]{-webkit-appearance:none;appearance:none;height:18px;background:transparent;cursor:pointer}',
      '#dmp-panel input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:999px;background:linear-gradient(90deg,#40d0d0,#0b7f8c)}',
      '#dmp-panel input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;margin-top:-5px;border-radius:50%;background:#fff;border:2px solid #0b7f8c;box-shadow:0 2px 6px rgba(6,40,50,.25)}',
      '#dmp-panel input[type=range]::-moz-range-track{height:4px;border-radius:999px;background:#cfe9ef}',
      '#dmp-panel input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#fff;border:2px solid #0b7f8c}',
      '#dmp-w-img{transform-origin:50% 100%;transition:transform .34s cubic-bezier(.34,1.56,.64,1),box-shadow .34s ease}',
      '#dsh-my-phone-widget:hover .dmp-w-img{transform:scale(1.24) translateY(0);box-shadow:0 26px 52px rgba(8,38,56,.38)}',
      '#dsh-my-phone-widget:active .dmp-w-img{transform:scale(.9)}',
      '#dsh-my-phone-widget{overflow:visible!important}',
      '#dsh-my-phone-widget .dmp-w-img{backface-visibility:hidden}',
      '#dmp-panel .feed{display:flex;flex-direction:column;gap:6px}',
      '#dmp-panel .feed .it{position:relative;padding:8px 10px 8px 12px;border-radius:10px;background:#fbfdfe;border:1px solid var(--line2);transition:background .14s ease}',
      '#dmp-panel .feed .it:hover{background:#f6fbfd}',
      '#dmp-panel .feed .it::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:0 3px 3px 0;background:#cfe3ee}',
      '#dmp-panel .feed .it.p1::before{background:#e06c00}',
      '#dmp-panel .feed .it.p0::before{background:#c88a00}',
      '#dmp-panel .feed .it.p0{background:#fffdf6;border-color:#f2e6c4}',
      '#dmp-panel .feed .it.p1{background:#fff9f3;border-color:#f6ddc6}',
      '#dmp-panel .feed .it .tx{font:600 12.5px/1.5 system-ui;color:var(--ink)}',
      '#dmp-panel .feed .it .tm{font:400 11px/1.5 system-ui;color:var(--ink3);font-variant-numeric:tabular-nums}',
      '#dmp-panel .feed .it .mini{margin-top:6px}',
      '#dmp-panel .dmp-infotip{position:fixed;z-index:2147483647;display:none;width:214px;padding:10px 12px;border-radius:12px;background:#fff;color:var(--ink);border:1px solid #dfeaf1;font:400 11.5px/1.6 system-ui;box-shadow:0 14px 30px rgba(6,24,36,.16);pointer-events:none}',
      '#dmp-panel .dmp-infotip::before{content:"";position:absolute;left:-4px;top:12px;width:7px;height:7px;background:#fff;border-left:1px solid #dfeaf1;border-bottom:1px solid #dfeaf1;transform:rotate(45deg)}',
      '#dmp-panel .pick{width:100%;text-align:left;border:1px solid #cfe4ec;border-radius:8px;padding:7px 9px;background:#fff;color:#0d2130;font:12.5px/1.4 system-ui;cursor:pointer}',
      '#dmp-panel .pick:hover{border-color:#8fd3e2}',
      '#dmp-panel .picklist{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:9;background:#fff;border:1px solid #cfe4ec;border-radius:10px;box-shadow:0 12px 28px rgba(8,38,56,.18);padding:4px;display:none}',
      '#dmp-panel .pickopt{display:block;width:100%;text-align:left;border:0;background:transparent;color:#0d2130;font:12.5px/1.4 system-ui;padding:7px 9px;border-radius:7px;cursor:pointer}',
      '#dmp-panel .pickopt:hover{background:#f1f9fc}',
      '#dmp-panel .pickopt.on{background:#e4f6fa;color:#0a5f75;font-weight:700}',
      '#dmp-panel .picklist.up{top:auto;bottom:calc(100% + 4px)}',
      '#dmp-panel .row .grow{flex:1;min-width:0}',
      '#dmp-panel .row .name{font-size:13px;font-weight:700;color:#0d2130;word-break:break-all}',
      '#dmp-panel .row .meta{font-size:11.5px;color:#6b8394;margin-top:2px}',
      '#dmp-panel .pill{display:inline-flex;align-items:center;justify-content:center;height:30px;padding:0 13px;border:1px solid transparent;cursor:pointer;border-radius:9px;font:800 12px/1 system-ui;transition:background .15s ease,color .15s ease,box-shadow .15s ease,transform .1s ease}',
      '#dmp-panel .pill:active{transform:scale(.97)}',
      '#dmp-panel .pill.on{background:#0a7a4b;color:#fff;box-shadow:0 6px 14px rgba(10,122,75,.22)}',
      '#dmp-panel .pill.off{background:#eef4f8;color:#43606f;border-color:#dceaf1}',
      '#dmp-panel .pill.off:hover{background:#e6eff6}',
      '#dmp-panel .pill.hot{background:#c0271b;color:#fff;box-shadow:0 6px 14px rgba(192,39,27,.22)}',
      '#dmp-panel .seg{display:flex;gap:5px;flex-wrap:wrap}',
      '#dmp-panel .seg button{display:inline-flex;align-items:center;justify-content:center;height:30px;min-width:44px;border:1px solid #d8e7ee;background:#fff;color:#43606f;font:700 12px/1 system-ui;padding:0 11px;border-radius:9px;cursor:pointer;transition:background .14s ease,border-color .14s ease,color .14s ease,transform .1s ease}',
      '#dmp-panel .seg button:active{transform:scale(.97)}',
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
      hideBubble()
      hideInfo()
      root.style.display = 'flex'
      tab = 'connect'
      qrAutoAt = 0
      render()
      // 打开时如果手里那张已经过期（或压根没有），自动补一张；页面开着期间不再自动轮换
      try {
        var exp = data && data.ticketExpiresAt ? Number(data.ticketExpiresAt) : 0
        if (!exp || exp <= Date.now()) post('ticket', {})
      } catch (e) {
        /* 忽略 */
      }
      refresh()
      clearInterval(ticker)
      ticker = setInterval(tickTtl, 1000)
      document.addEventListener('keydown', onKey)
      window.addEventListener('dsh-my-phone:closepanel', close)
    }

    // 每秒只需要更新「m:ss 后失效」这一行 —— 以前是整块 render() 重建 DOM，
    // 为了几个数字把整个面板拆了重搭，纯浪费。
    function tickTtl() {
      if (typeof document !== 'undefined' && document.hidden) return
      if (!body) return
      var el = body.querySelector('.dmp-ttl')
      if (!el) return
      var exp = data && data.ticketExpiresAt ? Number(data.ticketExpiresAt) : 0
      var left = exp > 0 ? exp - Date.now() : 0
      if (left <= 0) {
        // 到点了才需要整块重画（把二维码变灰 + 文案换成「已失效」）
        if (String(el.className || '').indexOf('dead') < 0) render()
        return
      }
      var mm = Math.floor(left / 60000)
      var ss = Math.floor((left % 60000) / 1000)
      var txt = mm + ':' + (ss < 10 ? '0' + ss : ss) + ' 后失效 · 过期后手动换一张'
      if (el.textContent !== txt) el.textContent = txt
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

    // 二维码块：有票就画 svg，没票给占位；过期盖「已失效」
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
              class: 'btn',
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
      out.push(qrBlock())
      out.push(h('p', { class: 'dmp-lead dmp-center', text: '相机或者浏览器扫码连接' }))
      out.push(h('p', { class: 'dmp-sub dmp-center', text: '扫码连接 DeepSeek Harness 桌面版' }))
      var left = data && data.ticketExpiresAt ? Math.max(0, data.ticketExpiresAt - Date.now()) : 0
      // v1.8.5：不再自动换票 —— 过期就让它显示「已失效」，只等人手动点按钮
      if (left > 0) {
        var mm = Math.floor(left / 60000)
        var ss = Math.floor((left % 60000) / 1000)
        out.push(
          h('p', {
            class: 'dmp-ttl',
            text: mm + ':' + (ss < 10 ? '0' + ss : ss) + ' 后失效 · 过期后手动换一张',
          }),
        )
      } else if (data && data.qrSvg) {
        out.push(h('p', { class: 'dmp-ttl dead', text: '二维码已失效 —— 点下面的按钮换一个' }))
      } else if (!(data && data.qrSvg)) {
        out.push(h('p', { class: 'dmp-hint dmp-center', text: '点下面的按钮生成一张' }))
      }
      if (data && data.pairUrl) {
        var link = h('div', { class: 'dmp-link' }, [
          h('code', { text: data.pairUrl }),
          h('button', {
            class: 'btn',
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
        h('button', { class: 'pill ' + (on ? 'on' : 'off'), text: on ? '已开启' : '已关闭', onclick: onToggle }),
      ])
    }

    function segRow(label, hint, key, current, choices) {
      var seg = h('div', { class: 'seg sm', style: 'flex:0 0 auto' })
      choices.forEach(function (m) {
        seg.appendChild(
          h('button', {
            class: current === m ? 'on' : '',
            text: m === 0 ? '不关' : m + ' 分',
            onclick: function () {
              post('autooff', { key: key, minutes: m })
            },
          }),
        )
      })
      // 用户要求：标题一行、按钮独占一排、说明放最下面（挤成两栏时说明被压成窄条折成一堆）
      return h('div', { style: 'padding:2px 0 10px;border-bottom:1px solid #eaf2f6' }, [
        h('div', { class: 'name', style: 'margin-bottom:6px', text: label }),
        seg,
        h('div', { class: 'meta', style: 'margin-top:6px;line-height:1.55', text: hint }),
      ])
    }

    // 带「！」的区块标题：鼠标放上去在图标旁边弹一条小气泡说明
    function h4i(title, tip) {
      var row = h('h4', { style: 'display:flex;align-items:center;gap:6px' })
      row.appendChild(document.createTextNode(title))
      var icon = h('span', { class: 'dmp-q', title: '' })
      icon.innerHTML =
        '<svg viewBox="0 0 12 12" aria-hidden="true">' +
        '<rect x="4.6" y="2" width="2.8" height="5.1" rx="1.4" fill="#fff"/>' +
        '<circle cx="6" cy="9.4" r="1.5" fill="#fff"/>' +
        '</svg>'
      icon.addEventListener('pointerenter', function () {
        showInfo(tip, icon)
      })
      icon.addEventListener('pointerleave', function () {
        hideInfo()
      })
      row.appendChild(icon)
      return row
    }

    var infoEl = null
    var qrAutoAt = 0
    var qrMinting = false
    function showInfo(text, anchor) {
      if (!infoEl) {
        infoEl = h('div', { class: 'dmp-infotip' })
        root.appendChild(infoEl)
      }
      infoEl.textContent = text
      infoEl.style.display = 'block'
      var r = anchor.getBoundingClientRect()
      var w = 214
      var left = Math.min(Math.max(8, r.right + 10), Math.max(8, window.innerWidth - w - 10))
      var top = Math.min(Math.max(8, r.top - 2), Math.max(8, window.innerHeight - infoEl.offsetHeight - 12))
      if (top + 90 > window.innerHeight) top = Math.max(8, r.top - 8 - infoEl.offsetHeight)
      infoEl.style.left = left + 'px'
      infoEl.style.top = top + 'px'
    }
    function hideInfo() {
      if (infoEl) infoEl.style.display = 'none'
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
          h('div', { class: 'grow', style: 'flex:1;min-width:0' }, [
            h('div', {
              class: 'name',
              style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis',
              text: name,
            }),
            h('div', { class: 'meta', text: (d.trusted ? '已信任' : '未信任') + (d.lastSeen ? ' · 最近 ' + hhmm(d.lastSeen) : '') }),
          ]),
        ])
        // 按钮组必须先建（原来声明在 if 分支后面，备注一进编辑态就 ReferenceError → 整页被清空）
        var actions = h('div', { style: 'display:flex;align-items:center;gap:6px;flex:0 0 auto' })
        row.appendChild(actions)
        if (editId === d.id) {
          // 编辑态：名字占一行，输入框 + 保存/取消 另起一行占满宽度
          actions.style.display = 'none'
          var input = h('input', {
            value: editText,
            maxlength: '24',
            placeholder: '比如：嘉然今天吃什么',
            class: 'dmp-input',
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
          input.style.flex = '1 1 auto'
          input.style.minWidth = '0'
          out.push(row)
          out.push(
            h('div', { style: 'display:flex;align-items:center;gap:6px;margin:-2px 0 10px' }, [
              input,
              h('button', {
                class: 'btn primary',
                text: '保存',
                onclick: function () {
                  post('device', { id: d.id, note: editText })
                  editId = null
                },
              }),
              h('button', {
                class: 'btn ghost',
                text: '取消',
                onclick: function () {
                  editId = null
                  render()
                },
              }),
            ]),
          )
          return
        }
        actions.appendChild(
          h('button', {
            class: 'btn',
            text: '备注',
            onclick: function () {
              editId = d.id
              editText = d.note || ''
              render()
            },
          }),
        )
        actions.appendChild(
          h('button', {
            class: 'btn ' + (d.trusted ? 'warn' : 'primary'),
            text: d.trusted ? '断开' : '信任',
            onclick: function () {
              post('device', { id: d.id, trusted: !d.trusted })
            },
          }),
        )
        var armed = delArm.id === d.id && Date.now() - delArm.at < 4000
        actions.appendChild(
          h('button', {
            class: 'btn danger',
            text: armed ? '再点一次' : '删除',
            style: armed ? 'background:#ffe2dd;border-color:#e8a49b' : '',
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
      // data.feed 是对象（pending/human/tech），这里用摊平后的列表 —— 见 feedItems()
      var feed = feedItems()
      var out = []
      if (!feed.length) {
        out.push(
          h('div', {
            class: 'dmp-hint',
            text: '暂时没有需要你看的消息。',
            style:
              'margin:2px 0 4px;padding:14px 12px;text-align:center;border:1px dashed #d9e8f0;border-radius:10px;background:#fbfdfe',
          }),
        )
      }
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
              class: 'btn',
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
      // 「会话名 正在用 工具」这类技术动态：用户要求加回来显示，但**不弹气泡、不响音、不进红点**。
      // 所以它们只留在 feed.tech 里（不进 feedItems()），这里单独列一小块。
      var techList = data && data.feed && Array.isArray(data.feed.tech) ? data.feed.tech : []
      if (techList.length) {
        out.push(h('div', { class: 'dmp-hint', style: 'margin:8px 0 2px', text: '技术动态（只记录，不弹气泡）' }))
        var techWrap = h('div', { class: 'feed' })
        techList.slice(0, 4).forEach(function (t) {
          techWrap.appendChild(
            h('div', { class: 'it' }, [
              h('div', { class: 'tx', text: t.text || '' }),
              h('div', { class: 'tm', text: hhmm(t.at) + (Number(t.count) > 1 ? ' · ' + t.count + ' 次' : '') }),
            ]),
          )
        })
        out.push(techWrap)
      }
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
          class: 'btn ghost',
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
            class: 'btn',
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
            class: 'btn warn',
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
      return advancedPaneBody()
    }

    function advancedPaneBody() {
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
      out.push(
        h('div', {
          class: 'dmp-warn',
          text: '⚠ 不要把链接随便发给外人 —— 3 分钟内谁拿到都能点「信任」进来',
        }),
      )
      out.push(h4i('入口', '局域网只在同一个 Wi-Fi 里能用；外网走 Cloudflare 中继，在外面也能连回来。两个都关 = 手机进不来。'))
      function addrLine(urlValue) {
        if (!urlValue) return h('div', { class: 'dmp-hint', style: 'padding:0 0 10px', text: '地址还没起来，稍等一秒' })
        return h('div', { class: 'dmp-link', style: 'margin:0 0 10px' }, [
          h('code', { text: urlValue }),
          h('button', {
            class: 'btn',
            text: '复制',
            onclick: function () {
              copyText(urlValue)
            },
          }),
        ])
      }
      out.push(
        switchRow('局域网访问', lan ? '同一 Wi-Fi 下可用，不经第三方' : '关着（默认只用外网，一个码到处都能用）', lan, function () {
          post('toggle', { key: 'lan' })
        }),
      )
      out.push(addrLine(lan ? String((data && data.lanUrl) || '') : ''))
      out.push(
        switchRow('外网访问', tun ? '经 Cloudflare 中继，开着就能从外面连回来' : '关着（出门在外就连不上）', tun, function () {
          post('toggle', { key: 'tunnel' })
        }),
      )
      out.push(
        segRow(
          '外网自动关闭',
          '外网入口空闲到时间就自动收掉（外面的设备会掉线，回来点一下「外网访问」就重开）',
          'tunnel',
          Number(data && data.tunnelAutoOffMinutes) || 0,
          [0, 30, 60, 90, 120],
        ),
      )
      out.push(h4i('消息', '新设备连入、会话等你授权、失败 / 重试、上下文到 80/90/95% 都会在这里留一条，点「知道了」清掉。'))
      feedRows().forEach(function (n) {
        out.push(n)
      })
      out.push(h4i('已配对设备', '每台设备能单独信任 / 断开 / 删除，也能加备注。上限 8 台，满了要先删一台。'))
      deviceRows().forEach(function (n) {
        out.push(n)
      })
      out.push(h4i('音效', '只是提示音，不影响连接：滑入滑出、按下松手各一声短音；气泡音按优先级 P0 五声 / P1 三声 / P2 两声。'))
      soundRows().forEach(function (n) {
        out.push(n)
      })
      // 免打扰 / 一键静音整块已去掉（用户 2026-10-30：静音功能直接去掉）
      logRows().forEach(function (n) {
        out.push(n)
      })
      return out
    }

    function render() {
      // 同一帧里被多次调用（点击 → post → SSE 帧）只真正画一次；
      // 画面字段没变就跳过，避免每 6 秒整棵重建 DOM（按钮点下去像卡住）
      if (renderQueued) return
      renderQueued = true
      var run = function () {
        renderQueued = false
        try {
          var sig = fingerprint()
          if (sig && sig === lastPaintSig) return
          lastPaintSig = sig
          var nodes = tab === 'connect' ? connectPane() : advancedPane()
          // 新内容准备完毕才动旧 DOM：算的时候抛异常也不会把页面清成空白
          renderTabs()
          body.textContent = ''
          nodes.forEach(function (n) {
            if (n) body.appendChild(n)
          })
        } catch (e) {
          /* 渲染失败不要连累宿主 */
        }
      }
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
      else setTimeout(run, 0)
    }
    var renderQueued = false
    var lastPaintSig = ''

    // 只挑「会影响画面」的字段做指纹
    function fingerprint() {
      try {
        var d = data || {}
        return JSON.stringify([
          d.lanEnabled,
          d.tunnelEnabled,
          d.tunnelUrl,
          d.lanUrl,
          d.pairUrl,
          d.ticketExpiresAt,
          d.tunnelAutoOffMinutes,
          d.mutedUntil,
          d.unread,
          (d.deviceList || []).map(function (x) {
            return [x.id, x.note, x.trusted, x.lastSeen].join('|')
          }),
          (d.feed || {}).pendingCount,
          (d.events || []).length,
          tab,
          editId,
          logOpen,
          infoOpen,
          sound(),
        ])
      } catch (e) {
        return ''
      }
    }

    // 面板内统一接线：任何按钮/分段/下拉都给声音（用委托，不用逐个绑）
    function hitTarget(ev) {
      var n = ev.target
      while (n && n !== root) {
        var tag = (n.tagName || '').toLowerCase()
        if (tag === 'button' || tag === 'input' || (n.className || '').indexOf('dmp-tab') >= 0) return n
        n = n.parentNode
      }
      return null
    }
    // 面板内**不出滑动音**：面板每秒重渲染会换掉节点，任何基于节点的判断都会反复触发，
    // 索性整块去掉（用户 2026-10-29 反馈「还是会一直响」）。球的滑入滑出音保留，点击音保留。
    var HOVER_IN_PANEL = false
    root.addEventListener('pointerover', function (ev) {
      if (!HOVER_IN_PANEL) return
      if (ev.pointerType && ev.pointerType !== 'mouse') return
    })
    // 点一下立刻给反馈：先写「…」并变淡，真实数据回来时整块会重新渲染
    root.addEventListener('click', function (ev) {
      var n = ev.target
      while (n && n !== root && (n.tagName || '').toLowerCase() !== 'button') n = n.parentNode
      if (!n || n === root || n.disabled) return
      var cls = String(n.className || '')
      if (cls.indexOf('btn') < 0 && cls.indexOf('pill') < 0 && cls.indexOf('mini') < 0) return
      if (cls.indexOf('on') >= 0 || cls.indexOf('off') >= 0) return
      n.dataset.busy = '1'
      if (!n.dataset.label) n.dataset.label = n.textContent || ''
      n.textContent = '…'
      n.style.opacity = '0.72'
      setTimeout(function () {
        if (!n.dataset.busy) return
        n.dataset.busy = ''
        n.textContent = n.dataset.label || ''
        n.style.opacity = ''
      }, 2500)
    })
    root.addEventListener('pointerdown', function (ev) {
      unlockAudio()
      if (hitTarget(ev)) playClick('down')
    })
    root.addEventListener('pointerup', function (ev) {
      if (hitTarget(ev)) playClick('up')
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



  // ---------- 常驻看护 ----------
  function ensure() {
    try {
      if (!document.documentElement) return
      if (!el || !document.contains(el)) mount()
    } catch (e) {
      /* 极端情况下不要抛到宿主 */
    }
  }

  ensure()
  boot()
  setInterval(ensure, 1200)
})()
