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
  // v1.8.32：手机端球缩小 40%（用户：「手机端logo小40%」）。
  // 判定放在最前面，TILE 一改，位置锚点 / 拖拽边界 / 贴边旋转都会跟着走。
  var IS_MOBILE = (function () {
    try {
      if (/Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(String(navigator.userAgent || ''))) return true
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true
    } catch (e) {
      /* 取不到就当桌面 */
    }
    return false
  })()
  var TILE = IS_MOBILE ? 73 : 121
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
  // v1.8.32：面板重画钩子。顶层函数（如 soundRows）不能直接引用 createPanel() 内的 render()，
  // 由 createPanel() 在初始化时把 _requestRender 指过去。
  var _requestRender = function () {}
  function requestRender() {
    try {
      _requestRender()
    } catch (e) {
      /* 面板还没建起来就忽略 */
    }
  }
  var data = null
  var remote = null // 手机上拿到的是只读快照（/__myphone/state）
  var remoteMode = false // v1.8.27：确认这端只能走只读快照，别再每轮先撞一次 404
  var remoteSince = 0 // 进入只读模式的时刻（用来每分钟回探一次管理口）
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
  // v1.8.22 气泡队列：用户要求「所有消息都弹窗和音效」，而气泡一次只能显示一张，
  // 所以新消息先入队，pumpBubble() 一张一张放，两条之间至少隔 BUBBLE_GAP 毫秒。
  // 去重（v1.8.25 改）：一个 key 只要**还挂在候选列表里**就永远不再播。
  // 原来按「45 秒后忘掉」来做，可消息本身还留在列表里（human 保留最近 40 条），
  // 时间一到它就被当成新消息再弹一遍 —— 这就是「隔一会儿又弹之前弹过的气泡」。
  var bubbleQueue = []
  var bubbleBusy = false
  var bubblePumpTimer = 0
// 释放 bubbleBusy 的定时器单独一个变量：原来它和 bubblePumpTimer 共用，
// pumpBubble() 一开始的 clearTimeout 会把「释放」也清掉 → busy 永远为 true，队列卡死。
var bubbleBusyTimer = 0
  var BUBBLE_GAP = 1400
  var playedKeys = {}
  var bubbleSeeded = false
  // v1.8.21：消息卡的 NEW 标记。记住「上一次打开高级页的时间」，比它新的卡片才带 NEW。
  // 存在 localStorage 里，刷新页面也不会重现已读的 NEW。
  var FEED_SEEN_KEY = 'dsh-my-phone.feedSeen.v1'
  var feedSeen = 0
  try {
    var _seen = window.localStorage && window.localStorage.getItem(FEED_SEEN_KEY)
    if (_seen) feedSeen = Number(_seen) || 0
  } catch (e) {
    /* 存储坏了就当没读过 */
  }
  function markFeedSeen() {
    feedSeen = Date.now()
    try {
      window.localStorage && window.localStorage.setItem(FEED_SEEN_KEY, String(feedSeen))
    } catch (e) {
      /* 存不了就只在本次会话生效 */
    }
    // 告诉服务端「这些通知已读」，红点随之清零
    // v1.8.29：手机上 post('read') 走的是 /__myphone/panel/read —— 那头只认回环地址，
    // 手机必然 404，所以「NEW 和红点」在手机上永远消不掉。远端模式改走公网口的 /__myphone/ack。
    if (remoteMode) {
      try {
        fetch('/__myphone/ack', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-myphone-phone': '1' },
          credentials: 'same-origin',
          body: JSON.stringify({ read: true }),
        })
          .then(function (r) {
            return r && r.ok ? r.json() : null
          })
          .then(function (json) {
            if (json && remote) {
              remote.unread = Number(json.unread) || 0
              remote.pendingCount = Number(json.pendingCount) || 0
              paint()
              if (panel && panel.isOpen()) panel.render()
            }
          })
          .catch(function () {
            /* 标不上就先本地记着 */
          })
      } catch (e) {
        /* 忽略 */
      }
      return
    }
    post('read', {})
  }

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
    if (!e) {
      // 引擎还没到（首次加载慢、或网络抖了一下）：顺手催一次，这一声先静音，下一声就有了
      loadAudio()
      return
    }
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
  var audioTryAt = 0
  function loadAudio() {
    if (window.__dshMyPhoneAudio) {
      prep()
      return
    }
    // v1.8.39：以前试 6 次就永久放弃 —— 那之后再也不会出声，看起来正好就是
    // 「有时候响有时候不响」。现在改成按时间限流（5 秒内最多试一次），只要引擎还缺就一直有补上的机会。
    var nowT = Date.now()
    if (nowT - audioTryAt < 5000) return
    audioTryAt = nowT
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

  // v1.8.39：以前只有在悬浮球和面板上按下（pointerdown）才解锁音频。
  // 结果就是「刚开机没点过球的时候，气泡全哑；点过之后才响」—— 用户感知成「有时候响有时候不响」。
  // 现在在整个文档上兜一次（捕获阶段），点页面任何地方、按任意键、从后台切回来，都能把音频解锁。
  var audioUnlockBound = false
  function bindAudioUnlock() {
    if (audioUnlockBound) return
    audioUnlockBound = true
    var once = function () {
      unlockAudio()
      if (window.__dshMyPhoneAudio) {
        try {
          document.removeEventListener('pointerdown', once, true)
          document.removeEventListener('keydown', once, true)
          document.removeEventListener('touchstart', once, true)
        } catch (err) {
          /* 忽略 */
        }
      }
    }
    try {
      document.addEventListener('pointerdown', once, true)
      document.addEventListener('keydown', once, true)
      document.addEventListener('touchstart', once, true)
      // 手机端从后台切回来时音频上下文可能被挂起，顺手再解一次
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) unlockAudio()
      })
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
            // v1.8.32：soundRows() 在顶层作用域，createPanel() 里的 render() 在这儿看不见 ——
            // 原来直接调 render() 会 ReferenceError（桌面端点开关也一样炸）。改走模块级钩子。
            requestRender()
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
    // v1.8.29：手机端 data 为 null，快照在 remote 里；原来这里直接 return []，
    // 手机上的「消息/日志」页只能画 remote.events 那 8 条原始日志（无标签、无 NEW）。
    var src = data || remote
    if (!src) return []
    var f = src.feed
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
          // gate 的 pending 不带 kind（它就是授权），补上让气泡标签认得出
          kind: 'approval',
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
    // v1.8.38：用户要求「简单点，把所有没看的 P0/P1 都记上」。
    // 以前只看服务端的 pendingCount（= 等授权张数），P0/P1 的普通消息
    // （失败、重试、模型不可用、跑得有点久……）响完就没人记得了。
    // 现在统一按「级别 ≤ P1 且发生在上次看过之后」来数：
    //   - pending（等授权）永远算，它要人真去 DSH 里点，不能因为看过就消失；
    //   - 其余按 feedSeen（打开「消息/日志」页时写的时间戳）判断，
    //     所以 P2 不进红点，P0/P1 点开过就清。
    var feed = feedItems()
    var n = 0
    for (var i = 0; i < feed.length; i++) {
      var it = feed[i]
      if (!it) continue
      if (it.pending) {
        n += 1
        continue
      }
      var lv = Number(it.level)
      if (lv !== 0 && lv !== 1) continue
      if ((Number(it.at) || 0) > feedSeen) n += 1
    }
    return n
  }

  function summary() {
    // v1.8.30：手机端 data 为 null，快照在 remote
    if (!data && !remote) return '手机连 DSH · 点一下扫码'
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
  // v1.8.23：顺序改成「等授权 > 新连接」。原来先查 notices —— 只要还有一条**未读**
  // 的连接通知（比如手机连进来后一直没打开面板点掉它）就直接返回「新连接」，
  // 正排队等授权的会话被彻底盖住：用户截图里明明在等老大授权，气泡却写
  // 「isis（iPhone）刚连进来」。未读通知会一直挂着，而授权是眼下真的在等人的事，
  // 所以授权必须排在最前面，且标签与文案必须说清「在等授权」。
  // v1.8.38：把「正文开头的【会话名】」拆出来单独上色。
  // 用户问过「为什么会有两个会话名字」—— 根因是 gate 的文案自带【名字】，
  // 前端又无条件补了一个。现在两边统一走这里：名字只会出现一次，
  // 而且【】里那一段永远跟着级别配色（P0 金 / P1 红 / P2 灰）。
  function nameSpans(body, who, color) {
    var out = []
    var text = String(body || '')
    var lead = text.match(/^【([^】]*)】\s*/)
    if (lead) {
      out.push({ t: '【' + lead[1] + '】', c: color })
      var rest = text.slice(lead[0].length)
      if (rest) out.push({ t: rest })
      return out
    }
    if (who) out.push({ t: '【' + who + '】', c: color })
    if (text) out.push({ t: text })
    return out
  }

  function bubbleCard() {
    // v1.8.30：手机端 data 为 null（快照在 remote），原来这里直接读 data →
    // 手机上永远走不到授权分支，只剩最底下那句「点一下 · 手机扫码连 DSH」。
    var base = data || remote
    var appr = base && Array.isArray(base.approvals) ? base.approvals : []
    if (appr.length > 1) {
      var first = appr[appr.length - 1]
      return {
        tag: '等授权',
        tagColor: '#B8790A',
        meta: appr.length + ' 条',
        main: [{ t: String(first.text || '正在请求授权...') }],
        sign: '还有 ' + (appr.length - 1) + ' 条 · 点开消息看',
      }
    }
    if (appr.length === 1) {
      var one = appr[0]
      var who = String(one.name || '').trim()
      var body = String(one.text || '正在请求授权...')
      // v1.8.38：统一走 nameSpans —— 名字只念一遍，且【】内那段上色
      return {
        tag: '等授权',
        tagColor: '#B8790A',
        main: nameSpans(body, who, '#B8790A'),
        sign: '点一下看详情 · 在 DSH 里批准或拒绝',
      }
    }
    // 授权都排完了，才轮到「有人连进来」这种纯通知（只报还没点掉的）
    var notices = base && Array.isArray(base.notices) ? base.notices : []
    var last = notices[notices.length - 1]
    if (last && last.label) {
      return {
        tag: '新连接',
        tagColor: '#1a6fe0',
        meta: hhmm(last.at),
        main: [{ t: last.label + '刚连进来' }],
        sign: '高级页·已配对设备里可断开',
      }
    }
    var u = Number((base && base.unread) || 0)
    if (u > 0) {
      return {
        tag: '新连接',
        tagColor: '#1a6fe0',
        meta: u + ' 台',
        main: [{ t: '有 ' + u + ' 台设备刚连进来' }],
        sign: '高级页·已配对设备里可断开',
      }
    }
    return { tag: '手机连接', main: [{ t: '点一下 · 手机扫码连 DSH' }] }
  }

  // 气泡标签按**事件种类**给，别只按级别给（v1.8.23）。
  // 原来一律按 level 推标签：level 0 → 「要你决定」，于是「某台手机刚连进来」
  // （gate 里首次连入也是 level 0）这种纯通知被写成「要你决定」，
  // 而会话名在等授权反倒可能被写成「新消息」—— 标签和事件对不上，
  // 用户一眼看过去就以为「你在让我决定什么？」。这里改成先认 kind，
  // 认不出才退回级别文案。
  var KIND_TAG = {
    join: '新连接',
    tunnel: '外网通道',
    autooff: '入口自动关闭',
    entry: '入口变更',
    turnfail: '这一轮失败',
    // v1.8.40：`turnstop` = 这一轮被你（或宿主）中止了。跟「失败」分开，
    // 而且只进技术动态、不弹气泡。
    turnstop: '已停止',
    // retry 现在只有一种含义了：「xx 的一次尝试没成功，正在重试」。
    // 原来同一个 kind 底下还有「重试后已恢复正常」，那种「其实没事了」的消息
    // 弹出来只会让人白紧张一次，已经不再产生（v1.8.24），标签也就可以说清。
    retry: '正在重试',
    model: '模型不可用',
    longrun: '跑得有点久',
    ctx: '上下文用量',
    turnok: '一轮完成',
    approval: '等授权',
    question: '等你回答',
    compaction: '整理上下文',
    error: '出错了',
    mode: '模式切换',
    plan: '会话切换',
    session: '新会话',
    device: '设备变动',
    tool: '正在用工具',
    client: '界面自检',
    pair: '配对',
    upstream: '上游不通',
  }

  // 日志里也用它把 kind 翻成人话（排查日志原来直接印 `tool` / `approval`
  // 这种英文单词，跟旁边那句中文描述对不上，看着像两条不同的东西）
  function kindLabel(kind) {
    var k = String(kind || '')
    return Object.prototype.hasOwnProperty.call(KIND_TAG, k) ? KIND_TAG[k] : k || '事件'
  }

  // 这些事件**只进消息列表和日志，不弹气泡、不响音**（v1.8.24）。
  // `tool` 是「会话名 正在用 Read」这种，一个回合里能来十几条 ——
  // 全弹的话手机隔一分钟震一次，真正的「等你授权」反而被淹掉。
  // 排查的时候照样查得到（「消息/日志」页的技术动态里全都在）。
  // v1.8.40：`turnstop`（这一轮被停止了）也只记日志 —— 你自己按的停止，
  // 再弹一句告诉你「停了」纯属噪音。
  var NO_BUBBLE_KIND = { tool: true, turnstop: true }
  function bubbleSilent(kind) {
    return Object.prototype.hasOwnProperty.call(NO_BUBBLE_KIND, String(kind || ''))
  }

  // 把一条消息渲染成气泡卡片（v1.8.22：气泡不再只报「最该说的那一条」，
  // 而是每条消息各自弹一次；标签按事件种类给，颜色按级别给）
  function cardFor(it) {
    var lv = Number(it && it.level)
    if (lv !== 0 && lv !== 1) lv = 2
    var kind = String((it && it.kind) || '')
    var known = Object.prototype.hasOwnProperty.call(KIND_TAG, kind) ? KIND_TAG[kind] : ''
    var tag = it && it.pending
      ? '等授权'
      : known || (lv === 0 ? '要你决定' : lv === 1 ? '值得留意' : it && it.tech ? '技术动态' : '新消息')
    // v1.8.38：与消息卡的三级配色对齐（P0 金 / P1 红 / P2 灰）
    var color = lv === 0 ? '#B8790A' : lv === 1 ? '#CF3B2B' : '#7A8B98'
    // v1.8.38：改成「拆一次、只念一遍」—— 统一交给 nameSpans
    var who = String((it && it.name) || '').trim()
    var body = String((it && it.text) || '')
    var main = nameSpans(body, who, color)
    return {
      tag: tag,
      tagColor: color,
      meta: hhmm(it && it.at),
      main: main,
      sign: it && it.pending ? '点开消息看详情 · 在 DSH 里批准或拒绝' : '点球打开「消息/日志」页',
    }
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
    // v1.8.28：左边这种用「球的左边缘」算，不能用球心 ——
    // 以前写 cx - gap - w，那是把气泡右边缘放到球心上，整个压住球的一半
    // （右边那支写的是 r.left + r.width + gap，本来就是按边缘算的，所以只有左边出问题）。
    var left = r.left - gap - w
    if (left < 8) left = r.left + r.width + gap
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

  function showBubble(ms, card) {
    if (!bubble) return
    if (!card) card = bubbleCard()
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
      'position:fixed;z-index:2147483001;width:244px;padding:12px 16px 13px;border-radius:16px;' +
      'background:#fff;border:1px solid rgba(26,111,224,.20);box-shadow:0 8px 22px rgba(6,24,36,.14);' +
      'text-align:left;opacity:0;transform:translateY(-2px);transition:opacity .16s ease,transform .16s ease;pointer-events:none'
    // 尖角（朝球那侧）—— 放在哪个边、纵向落点都由 placeBubble() 决定
    var tail = document.createElement('span')
    tail.style.cssText =
      'position:absolute;top:22px;width:9px;height:9px;background:#fff;border:1px solid rgba(26,111,224,.20);' +
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

  // 事件驱动：快照里出现「新的」消息时主动弹气泡（v1.8.22 起所有消息都弹：
  // 人类消息、待授权、技术动态除外的高频事件；排队一条一条来）。
  // 去重（v1.8.25）：一条消息只要播过，就永不再播 —— 见 autoBubble()。
  var lastBubbleKey = ''
  // 最后一张气泡对应的是哪条消息：鼠标放上去时重画它，而不是退回兜底文案
  var lastShownIt = null

  // 把当前快照里所有「够格弹」的消息按时间正序摊出来
  function bubbleCandidates() {
    // 技术类事件的级别：出问题了才给 P1（橙），其余一律 P2（青）。
    var TECH_LEVEL = { error: 1, upstream: 1 }
    var out = []
    var list = feedItems()
    list = list.slice().sort(function (a, b) {
      return (Number(a && a.at) || 0) - (Number(b && b.at) || 0)
    })
    for (var i = 0; i < list.length; i++) {
      var it = list[i]
      if (!it || !it.text) continue
      // 「xx 正在用 Read」这类频率太高，不弹气泡（只留在消息/日志页里）
      if (bubbleSilent(it.kind)) continue
      out.push({
        key: 'f|' + String(it.seq == null ? '' : it.seq) + '|' + String(it.text),
        at: it.at,
        kind: it.kind,
        level: it.level == null ? 2 : it.level,
        pending: Boolean(it.pending),
        name: it.name,
        text: it.text,
      })
    }
    // v1.8.30：这里原来写死 data，手机端 data 为 null → 技术动态一条都进不了气泡队列
    var src = data || remote
    var tech = src && src.feed && Array.isArray(src.feed.tech) ? src.feed.tech : []
    for (var j = 0; j < tech.length; j++) {
      var t = tech[j]
      if (!t || !t.text) continue
      if (bubbleSilent(t.kind)) continue
      out.push({
        key: 't|' + String(t.kind || '') + '|' + String(t.text),
        at: t.at,
        kind: t.kind,
        // v1.8.35：技术类事件以前一律按 P2（蓝色「新消息」）算 —— 于是「出错了」
        // 「上游不通」这种真出问题的也弹成最不紧急的蓝色。这里按种类给真实级别：
        // 出错/上游不通算 P1（橙色），其余技术动态仍是 P2。
        level: TECH_LEVEL[t.kind] == null ? 2 : TECH_LEVEL[t.kind],
        pending: false,
        tech: true,
        text: t.text,
      })
    }
    // 兜底：feed 还没准备好（老存档、gate 抽风、只读快照）时，
    // 用 approvals / notices 顶上，免得一条路走死、永远等不到一次气泡
    if (!out.length) {
      var base = data || remote
      var appr = base && Array.isArray(base.approvals) ? base.approvals : []
      for (var k = 0; k < appr.length; k++) {
        var a = appr[k]
        if (!a) continue
        out.push({
          key: 'a|' + String(a.seq == null ? '' : a.seq) + '|' + String(a.text || ''),
          at: a.at,
          kind: 'approval',
          level: 0,
          pending: true,
          name: a.name,
          text: String(a.text || '正在请求授权...'),
        })
      }
      var nts = base && Array.isArray(base.notices) ? base.notices : []
      for (var m = 0; m < nts.length; m++) {
        var n = nts[m]
        if (!n || !n.label) continue
        out.push({
          key: 'n|' + String(n.at == null ? '' : n.at) + '|' + String(n.label),
          at: n.at,
          kind: 'join',
          level: 2,
          pending: false,
          text: n.label + '刚连进来',
        })
      }
    }
    return out
  }

  // 忘掉「已经不在候选列表里」的 key（这条消息已经被挤出列表了，留着没意义）。
  // 关键：**不再按时间忘**。以前 180 秒一到就删，可消息还挂在列表里，
  // 下一轮 autoBubble() 就把它当成新消息再弹一遍。
  function forgetOldKeys(live) {
    var kept = 0
    for (var k in playedKeys) {
      if (!Object.prototype.hasOwnProperty.call(playedKeys, k)) continue
      if (!live || !live[k]) {
        delete playedKeys[k]
        continue
      }
      kept += 1
    }
    // 兜底：真到了几百条（正常最多 40 条 human + 若干 tech），清掉最老的一半
    if (kept > 400) {
      var all = []
      for (var k2 in playedKeys) {
        if (Object.prototype.hasOwnProperty.call(playedKeys, k2)) all.push([k2, Number(playedKeys[k2] || 0)])
      }
      all.sort(function (a, b) {
        return a[1] - b[1]
      })
      for (var d = 0; d < all.length / 2; d++) delete playedKeys[all[d][0]]
    }
  }

  // 一张一张放：气泡同时只能显示一条，排队显示，两条之间留间隔
  function pumpBubble() {
    clearTimeout(bubblePumpTimer)
    if (bubbleBusy) return
    if (!bubbleQueue.length) return
    try {
      if (panel && panel.isOpen && panel.isOpen()) {
        // 面板开着时把气泡压住（看完面板再挨个放）
        bubblePumpTimer = setTimeout(pumpBubble, 1500)
        return
      }
    } catch (e) {
      /* 忽略 */
    }
    var it = bubbleQueue.shift()
    bubbleBusy = true
    // v1.8.35：只有**真的放出来**的才记成已播。以前在 autoBubble() 里一入队就
    // 记成已播，可队列超过 3 条时会把早的先砍掉 —— 被砍掉的那几条永远弹不出来，
    // 用户看到的效果就是「有的消息该弹却没弹」。
    playedKeys[it.key] = Date.now()
    // v1.8.36：所有会响声音的气泡都自动消失，只是按等级给不同的停留时长：
    //   P0（等授权 / 在等你回答）10 秒、P1（值得留意）6 秒、P2（一般消息）3 秒。
    // 以前 P0 是「常驻，必须手点一下才收起」，用户要求不再需要手点。
    var lv = it.level == null ? 2 : Number(it.level)
    if (!(lv >= 0) || lv > 2) lv = 2
    var holdMs = lv <= 0 ? 10000 : lv === 1 ? 6000 : 3000
    lastShownIt = it
    showBubble(holdMs, cardFor(it))
    // v1.8.39：声音已经在消息入队时响过了（见 autoBubble），这里不再重复。
    bubbleBusyTimer = setTimeout(function () {
      bubbleBusy = false
      if (bubbleQueue.length) hideBubble()
      pumpBubble()
    }, holdMs + BUBBLE_GAP)
  }

  function autoBubble() {
    var now = Date.now()
    var cands = bubbleCandidates()
    // 先算出「现在还挂在列表里」的 key，只有不在里面的才允许被忘掉
    var live = {}
    for (var n = 0; n < cands.length; n++) live[cands[n].key] = true
    forgetOldKeys(live)
    if (!bubbleSeeded) {
      // 第一次拿到快照：历史消息不回放（否则一开页就被几十条淹掉），
      // 只把「等你决定」的那些摆出来。其余全记成已播。
      bubbleSeeded = true
      for (var i = 0; i < cands.length; i++) {
        playedKeys[cands[i].key] = now
        if (cands[i].pending) bubbleQueue.push(cands[i])
      }
      if (bubbleQueue.length) {
        // 首次进页面时如果已经压着授权，响一次提神；历史消息一声不响，免得一开页就被淹
        playLevel(bubbleQueue[0].level == null ? 2 : Number(bubbleQueue[0].level))
        pumpBubble()
      }
      return
    }
    var fresh = []
    for (var j = 0; j < cands.length; j++) {
      var c = cands[j]
      // 播过就跳过 —— 只要这条消息还在列表里，就绝不会再弹第二次。
      // （以前这里写的是「45 秒内不重复」，可列表里的旧消息过了 45 秒
      // 又会被当成新的，于是隔一阵就重弹一遍「已经弹过的」气泡。）
      if (Number(playedKeys[c.key] || 0)) continue
      fresh.push(c)
    }
    if (!fresh.length) return
    // 已经排着的不重复入队
    var inQueue = {}
    for (var q = 0; q < bubbleQueue.length; q++) inQueue[bubbleQueue[q].key] = true
    var chimeN = 0
    for (var m = 0; m < fresh.length; m++) {
      if (inQueue[fresh[m].key]) continue
      bubbleQueue.push(fresh[m])
      // v1.8.39：声音跟着「消息」走，不跟着「气泡」走 —— 只有「真的新入队」的这一条才响，
      // 所以同一条消息不会因为反复收到快照而重复响。以前声音是在 pumpBubble() 里播的，
      // 可面板开着时气泡会被压住排队，那段时间就一声不响；队列溢出被摘掉的几条也永远不响。
      // 用户感知就是「有时候响有时候不响」。一批最多响 3 声，免得补一屏历史时叮叮叮炸响。
      if (chimeN < 3) {
        chimeN += 1
        playLevel(fresh[m].level == null ? 2 : Number(fresh[m].level))
      }
    }
    // 一次涌进来太多（比如手机刚连上补了一屏历史）时不能全排 —— 最多留 8 条。
    // v1.8.35：以前是 `slice(-3)` 直接截断，被截掉的那几条**没有记成已播**，
    // 下一轮又被当成新消息塞回来，于是队列永远在溢出、老是那几条在轮，别的永远轮不到。
    // 现在超出部分按「最老的先放弃」逐条摘掉并记成已播：既不无限刷屏，也不会互相饿死。
    if (bubbleQueue.length > 8) {
      var dropN = bubbleQueue.length - 8
      for (var dq = 0; dq < dropN; dq++) {
        var gone = bubbleQueue.shift()
        if (gone) playedKeys[gone.key] = now
      }
    }
    pumpBubble()
  }

  function hideBubble() {
    if (!bubble) return
    bubbleSig = ''
    bubble.style.opacity = '0'
  }

  function refresh() {
    // v1.8.27：记住「这台机器只能拿只读快照」。
    // 手机上 /__myphone/panel 必然 404（管理口只给回环地址），原来每 6 秒都要先吃一次
    // 404、再转去 /__myphone/state —— 白跑一趟。这里一旦确认是远端模式，就直接打 state，
    // 每轮少一次往返。哪次面板口又能连上了（桌面端），自动切回来。
    if (remoteMode) {
      // 一分钟探一次管理口：桌面端万一刚才只是偶发失败，别让它永远卡在只读模式
      if (Date.now() - remoteSince < 60_000) {
        loadRemote()
        return
      }
      remoteMode = false
    }
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
          remoteMode = false
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
          // 拿到只读快照 = 这端就是手机：下一轮直接打这儿，不再先去撞管理口的 404
          if (!remoteMode) remoteSince = Date.now()
          remoteMode = true
          // v1.8.29：只读快照也要刷红点。原来只 render 面板，悬浮球上的点
          // 永远停在上一次本地快照的数字上（手机端根本收不到本地快照）。
          paint()
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
    // v1.8.32：手机端「logo 比连上桌面还早」的修法 —— 球一开始透明，等第一帧快照
    // （本地 data 或手机只读 remote）到了再显形。启动时 boot() 里有 2.5 秒兜底，
    // 万一快照一直拿不到（凭据失效等），球照样会亮，不会让人连「重新扫码」都点不到。
    revealBall()
    // 提示音改由气泡队列统一负责（pumpBubble 里播）：一条消息 = 一次气泡 + 一次音，
    // 这样才不会「paint 响一遍、队列又响一遍」重复。这里不再播。
    if (dot) {
      var n = unreadCount()
      if (n > 0) {
        dot.style.display = 'block'
      } else {
        dot.style.display = 'none'
      }
    }
    // 以前这里是每秒 textContent = summary()，纯文本覆写会让排版跳一下（隐约闪烁）。
    // v1.8.22 起气泡内容由队列决定（每条消息各自一张卡），这里只校正位置，
    // 绝不能用 bubbleCard() 重画 —— 否则排队中的消息会被兜底文案顶掉。
    if (bubble && bubble.style.opacity === '1') placeBubble()
  }

  function boot() {
    loadAudio()
    bindAudioUnlock()
    refresh()
    // v1.8.32：球默认透明，等第一帧快照到了再显形；2.5 秒兜底（快照拿不到也要能点开面板重新扫码）
    setTimeout(revealBall, 2500)
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
    // v1.8.36：红点缩小、不带数字，只要「有未读」就亮一颗会呼吸的小点
    // （原来的 17px 胶囊里塞数字，一动就一大一小，比球本身还抢眼）。
    dot.style.cssText = [
      'position:absolute',
      'top:-2px',
      'right:-2px',
      'width:9px',
      'height:9px',
      'border-radius:999px',
      'background:#e6382b',
      'display:none',
      'box-shadow:0 0 0 2px rgba(255,255,255,.92)',
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
      hoverTimer = setTimeout(function () {
        // 有「最后一条消息」就重画它，否则才用兜底文案（v1.8.22）
        if (lastShownIt) showBubble(8000, cardFor(lastShownIt))
        else showBubble()
      }, 300)
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
    // v1.8.32：先透明待命 —— 等第一帧快照（paint() 里的 revealBall）到了才显形，
    // 这样「手机端 logo 比连上桌面还早出现」就没了：没连上之前它不亮相。
    el.style.opacity = '0'
    applyPos()
  }

  // 球从透明淡入。只做一次；boot() 里 2.5 秒兜底调用，避免快照永远拿不到时球不出现。
  var revealed = false
  function revealBall() {
    if (revealed || !el) return
    revealed = true
    try {
      el.style.opacity = '1'
    } catch (e) {
      /* 忽略 */
    }
  }

  function ensureCss() {
    if (document.getElementById('dmp-w-css')) return
    var st = document.createElement('style')
    st.id = 'dmp-w-css'
    st.textContent = [
      '#dsh-my-phone-widget{transition:transform .34s cubic-bezier(.34,1.56,.64,1),filter .18s ease,opacity .3s ease}',
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
      // v1.8.25：三个页签平分整行（flex:1），不再按文字长短各占一块、右边留空
      '#dmp-panel .dmp-tabs{display:flex;gap:0;padding:10px 16px 0;background:#fff}',
      '#dmp-panel .dmp-tab{flex:1 1 0;min-width:0;border:0;background:transparent;color:#5c7284;font:600 13.5px/1 inherit;padding:9px 4px;border-radius:10px;cursor:pointer;text-align:center}',
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
      '#dmp-panel .dmp-qr{margin:0;width:214px;height:214px;background:#fff;border:1px solid #dbeaf1;border-radius:16px;',
      '  display:flex;align-items:center;justify-content:center;padding:9px;position:relative}',
      '#dmp-panel .dmp-qr svg{width:100%;height:100%;display:block}',
      '#dmp-panel .dmp-qr.dead{filter:grayscale(1) opacity(.42)}',
      '#dmp-panel .dmp-dead{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;',
      '  font:800 15px/1 inherit;color:#c0271b;background:rgba(255,255,255,.72);border-radius:16px;letter-spacing:2px}',
      '#dmp-panel .dmp-empty{color:#7b8fa1;font-size:12.5px;text-align:center;padding:56px 10px}',
      '#dmp-panel .dmp-ttl{margin:8px 0 0;max-width:252px;text-align:center;font:700 12px/1.5 ui-monospace,Menlo,monospace;color:#0a7a4b;font-variant-numeric:tabular-nums}',
      '#dmp-panel .dmp-ttl.dead{color:#c0271b}',
      '#dmp-panel .dmp-qrnote{margin:5px 0 0;text-align:center;font:600 11.5px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:#5a7484}',
      '#dmp-panel .dmp-qrsw{margin:12px auto 0;width:100%;display:flex;justify-content:center}',
      '#dmp-panel .dmp-qrsw.switchable{cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '#dmp-panel .dmp-qrcard{display:flex;flex-direction:column;align-items:center;animation:dmpQrIn .22s ease}',
      '#dmp-panel .dmp-qrcard .dmp-qr{position:relative}',
      '@keyframes dmpQrIn{from{opacity:0;transform:translateX(10px) scale(.985)}to{opacity:1;transform:none}}',
      // v1.8.34：切换条做成分段页签的样子 —— 选中的实心填色、白字，一眼看出现在看的是哪张
      '#dmp-panel .dmp-sidesw{display:flex;justify-content:center;margin:2px 0 0}',
      '#dmp-panel .seg.side{display:flex;gap:0;width:100%;max-width:270px;padding:3px;border:1px solid #cfe3ee;border-radius:12px;background:#f1f8fb}',
      '#dmp-panel .seg.side button{flex:1;height:32px;min-width:0;border:0;border-radius:9px;background:transparent;color:#5a7484;font:700 12.5px/1 system-ui;padding:0 6px}',
      '#dmp-panel .seg.side button.on{background:#0b7f8c;color:#fff;box-shadow:0 2px 8px rgba(11,127,140,.35)}',
      '#dmp-panel .seg.side button:active{transform:scale(.98)}',
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
      // v1.8.28：红点缩小，动效改成「若隐若现」——原来是戳出去的阴影圈（像在闪），
      // 现在改成整颗球自己的透明度轻微呼吸，安静很多。
      // v1.8.36：红点不再带数字，改成「一会大一会小」的缓慢脉冲（1.6s 一轮，
      // 幅度压得很小 0.86↔1.18），安静但有生命感，不抢球的位置。
      '#dmp-w-dot{animation:dmp-breathe 2.6s ease-in-out infinite,dmp-dotpulse 1.6s ease-in-out infinite}',
      '@keyframes dmp-breathe{0%,100%{opacity:1}50%{opacity:.72}}',
      '@keyframes dmp-dotpulse{0%,100%{transform:scale(.86)}50%{transform:scale(1.18)}}',
      '@media (prefers-reduced-motion: reduce){#dmp-w-dot{animation:none}}',
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
      // 消息卡（信笺格式）：左上角级别徽标（NEW 才显示）、中间文案、右下角时间。
      // 三级都上色；容器最多摊开四五张卡，再多就出滚动条。
      '#dmp-panel .feed{display:flex;flex-direction:column;gap:8px;max-height:322px;overflow-y:auto;overscroll-behavior:contain;padding:2px 4px 2px 2px;margin:2px 0 0}',
      '#dmp-panel .feed .it{position:relative;padding:9px 12px 8px 15px;border-radius:12px;background:#fbfdfe;border:1px solid #dceaf2;transition:background .14s ease}',
      // v1.8.22：把旧的左侧 3px 色条加回来。旧版写的是 left:0;top:8px;bottom:8px，卡片有 12px 圆角时
      // 色条会从圆角外面露出来 —— 看着像「错位」。现在让色条内缩进圆角里、上下各留 9px，两端都圆。
      '#dmp-panel .feed .it::before{content:"";position:absolute;left:0;top:9px;bottom:9px;width:3px;border-radius:0 3px 3px 0;background:#cfe3ee}',
      '#dmp-panel .feed .it.p0::before{background:#b8790a}',
      '#dmp-panel .feed .it.p1::before{background:#cf3b2b}',
      '#dmp-panel .feed .it.p2::before{background:#8a9aa6}',
      '#dmp-panel .feed .it .top{display:flex;align-items:center;gap:6px;min-height:16px;line-height:1}',
      // v1.8.26：左上角的事件标签就是一列带色的小标题，不要胶囊背景（用户要求）
      '#dmp-panel .feed .it .tag{display:inline-block;height:auto;padding:0;border-radius:0;background:none;font:800 11px/1.2 system-ui;letter-spacing:.02em;color:#1a6fe0}',
      '#dmp-panel .feed .it .tag.t0{color:#9d6600}',
      '#dmp-panel .feed .it .tag.t1{color:#b8301f}',
      '#dmp-panel .feed .it .tag.t2{color:#6b7c8a}',
      '#dmp-panel .feed .it .new{display:inline-flex;align-items:center;height:15px;padding:0 6px;border-radius:999px;font:800 9px/1 system-ui;letter-spacing:.1em;color:#fff;background:#8a9aa6}',
      '#dmp-panel .feed .it .tx{margin:5px 0 0;font:600 12.5px/1.5 system-ui;color:var(--ink);word-break:break-word}',
      '#dmp-panel .feed .it .tm{margin:4px 0 0;text-align:right;font:400 10.5px/1.4 ui-monospace,Menlo,monospace;color:var(--ink3);font-variant-numeric:tabular-nums}',
      // v1.8.38：三级配色重新拉开 —— 原来 P0 金 #c88a00 / P1 橙 #e06c00 只差一口气，
      // 一眼分不出哪个更要紧。现在 P0 金、P1 红、P2 灰（普通消息不该抢注意力）。
      '#dmp-panel .feed .it.p0{background:#fff9ec;border-color:#ecd092}',
      '#dmp-panel .feed .it.p0 .new{background:#b8790a}',
      '#dmp-panel .feed .it.p1{background:#fff5f2;border-color:#f3c6bc}',
      '#dmp-panel .feed .it.p1 .new{background:#cf3b2b}',
      '#dmp-panel .feed .it.p2{background:#f6f8fa;border-color:#e1e7ec}',
      '#dmp-panel .feed .it.p2 .new{background:#8a9aa6}',
      // 技术动态：只记录、不弹气泡，做成一行一条的浅色小字
      '#dmp-panel .dmp-tech{display:flex;flex-direction:column;gap:5px;margin:2px 0 0}',
      '#dmp-panel .dmp-tech .titem{display:flex;align-items:baseline;gap:8px;padding:6px 10px;border-radius:9px;background:#f7fafc;border:1px solid #e6eff5}',
      '#dmp-panel .dmp-tech .ttext{flex:1;min-width:0;font:500 11.5px/1.45 system-ui;color:#4a6478;word-break:break-word}',
      '#dmp-panel .dmp-tech .ttime{flex:0 0 auto;font:400 10px/1.4 ui-monospace,Menlo,monospace;color:#8fa5b5}',
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
    // v1.8.33：「连接」页的两张二维码卡片，哪一张在前。'' = 自动（有局域网就用局域网）
    var qrSide = ''
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
      // v1.8.29：关面板也要落「已读」。用户的正常路径是「点开 → 进消息/日志 → 看完点 × 关掉」，
      // 全程没离开读页，所以原来那条「离开读页才 markFeedSeen」的规则一次都没触发过 ——
      // 这就是「NEW 和红点消不掉」的直接原因。
      if (tab === 'feed' || tab === 'advanced') markFeedSeen()
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

    // 每秒只需要更新卡片下面那行「m:ss 后失效」—— 以前是整块 render() 重建 DOM，
    // 为了几个数字把整个面板拆了重搭，纯浪费。
    function tickTtl() {
      if (typeof document !== 'undefined' && document.hidden) return
      if (!body) return
      var els = body.querySelectorAll ? body.querySelectorAll('.dmp-ttl') : []
      if (!els || !els.length) return
      var left = ttlLeft()
      if (left <= 0) {
        // 到点了才需要整块重画（把二维码变灰 + 文案换成「已失效」）
        for (var i = 0; i < els.length; i += 1) {
          if (String(els[i].className || '').indexOf('dead') < 0) {
            render()
            return
          }
        }
        return
      }
      var txt = leftText(left)
      for (var j = 0; j < els.length; j += 1) {
        if (els[j].textContent !== txt) els[j].textContent = txt
      }
    }

    function tabBtn(key, label) {
      return h('button', {
        class: 'dmp-tab' + (tab === key ? ' on' : ''),
        text: label,
        onclick: function () {
          var wasReadTab = tab === 'feed' || tab === 'advanced'
          var isReadTab = key === 'feed' || key === 'advanced'
          tab = key
          // v1.8.22：改在**离开**消息页时落「已读」。这样刚点进来还能看见哪些卡是新的，
          // 走开再回来 NEW 才消失（红点一并清掉）。
          if (wasReadTab && !isReadTab) markFeedSeen()
          render()
        },
      })
    }

    function renderTabs() {
      tabsBar.textContent = ''
      // v1.8.25：三个页签把一整行占满（各占 1/3），「连接」放正中间 ——
      // 它是最常点的那个，居中比靠左更好按；打开面板默认就落在「连接」。
      tabsBar.appendChild(tabBtn('feed', '消息/日志'))
      tabsBar.appendChild(tabBtn('connect', '连接'))
      tabsBar.appendChild(tabBtn('advanced', '高级'))
    }

    // ---- v1.8.34：「连接」页两张二维码卡片（局域网 / 外出）--------------------
    // 局域网 / 外出共用同一张一次性票据，只是 base 不同（服务端一次给两张 SVG）。
    //  · 只开了一个连接就只出一张（不出切换条）；两个都关 → 提示去高级页开
    //  · 默认给局域网（快），出门才切外出
    //  · 倒计时单独一行贴在码下面，适用条件单独一行 —— 不再挤成一大截绿字
    //  · 复制前先回读一次快照：票过期就先换一张，绝不把旧地址塞进剪贴板
    function qrSides() {
      var out = []
      if (data && data.lanEnabled) out.push('lan')
      if (data && data.tunnelEnabled) out.push('tun')
      return out
    }
    function curSide() {
      var list = qrSides()
      if (qrSide && list.indexOf(qrSide) >= 0) return qrSide
      return list[0] || ''
    }
    function qrSvgOf(side) {
      if (side === 'lan') return data && data.qrSvgLan ? String(data.qrSvgLan) : ''
      return data && data.qrSvg ? String(data.qrSvg) : ''
    }
    function pairUrlOf(side) {
      if (side === 'lan') return data && data.lanPairUrl ? String(data.lanPairUrl) : ''
      return data && data.pairUrl ? String(data.pairUrl) : ''
    }
    // 适用条件（短句），放在标题下面一行
    function sideNote(side) {
      if (side === 'lan') return '只有手机和电脑在同一个网络才能连接'
      return '任何时间都能连接（速度低于局域网）'
    }
    // 倒计时单独成行：m:ss 后失效
    function leftText(left) {
      var mm = Math.floor(left / 60000)
      var ss = Math.floor((left % 60000) / 1000)
      return mm + ':' + (ss < 10 ? '0' + ss : ss) + ' 后失效'
    }
    function ttlLeft() {
      return data && data.ticketExpiresAt ? Math.max(0, data.ticketExpiresAt - Date.now()) : 0
    }
    // 「复制」不照抄屏幕上那串旧地址：先回读一次快照，票还在就复制最新地址，
    // 票过期就先换一张再复制（点它的人要的是「现在能用的」）。
    function copyFreshPair(side, btn) {
      var old = btn ? String(btn.textContent || '复制') : ''
      function say(t) {
        if (!btn) return
        btn.textContent = t
        setTimeout(function () {
          try {
            btn.textContent = old
          } catch (e) {
            /* 忽略 */
          }
        }, 1400)
      }
      if (btn) btn.disabled = true
      fetch(API, { headers: { 'x-myphone-panel': '1' }, credentials: 'same-origin' })
        .then(function (r) {
          return r && r.ok ? r.json() : null
        })
        .then(function (json) {
          if (json) {
            data = json
            var exp = Number(json.ticketExpiresAt || 0)
            var u = side === 'lan' ? json.lanPairUrl || json.lanUrl : json.pairUrl
            if (exp > Date.now() && u) {
              copyText(String(u))
              if (btn) btn.disabled = false
              say('已复制')
              if (panel) panel.render()
              return
            }
          }
          post('ticket', {}, function (nj) {
            var u2 = nj ? (side === 'lan' ? nj.lanPairUrl || nj.lanUrl : nj.pairUrl) : ''
            if (u2) copyText(String(u2))
            if (btn) btn.disabled = false
            say(u2 ? '已换新并复制' : '换票失败')
          })
        })
        .catch(function () {
          if (btn) btn.disabled = false
          say('复制失败')
        })
    }
    // 一张卡：二维码 + 倒计时。过期就变灰并盖「已失效」
    function qrCard(side) {
      var svg = qrSvgOf(side)
      var left = ttlLeft()
      var dead = !svg || left <= 0
      var box = h('div', { class: 'dmp-qr' + (dead && svg ? ' dead' : '') })
      if (svg) box.innerHTML = svg
      else {
        box.appendChild(
          h('div', {
            class: 'dmp-empty',
            text: side === 'lan' ? '局域网二维码还没起来\n先确认「局域网访问」是开着的' : '还没有二维码\n点下面的按钮生成',
          }),
        )
      }
      if (svg && left <= 0) box.appendChild(h('div', { class: 'dmp-dead', text: '已失效' }))
      var cap = h('p', {
        class: 'dmp-ttl' + (left <= 0 ? ' dead' : ''),
        'data-side': side,
        text: left > 0 ? leftText(left) : '已失效 · 点下面换一张',
      })
      return h('div', { class: 'dmp-qrcard ' + side }, [box, cap])
    }
    // 卡片切换：点一下卡片 / 点上面的切换条都能换
    function switchSide() {
      var list = qrSides()
      if (list.length < 2) return
      var cur = curSide()
      qrSide = list[(list.indexOf(cur) + 1) % list.length]
      render()
    }
    // 切换条做成「两个页签」的样子：选中的实心填色，一眼看出现在看的是哪张
    function sideSwitch() {
      var list = qrSides()
      if (list.length < 2) return null
      var cur = curSide()
      var seg = h('div', { class: 'seg side' })
      ;[
        ['lan', '局域网连接'],
        ['tun', '外出连接'],
      ].forEach(function (kv) {
        if (list.indexOf(kv[0]) < 0) return
        seg.appendChild(
          h('button', {
            class: cur === kv[0] ? 'on' : '',
            text: kv[1],
            onclick: function (ev) {
              try {
                ev.stopPropagation()
              } catch (e) {
                /* 忽略 */
              }
              if (curSide() === kv[0]) return
              qrSide = kv[0]
              render()
            },
          }),
        )
      })
      return seg
    }
    // 两个连接都关着：不给一张假码，直接把人送去高级页开
    function noneOpenPane() {
      return [
        h('p', { class: 'dmp-lead dmp-center', text: '两个连接都关着，手机进不来' }),
        h('p', { class: 'dmp-hint dmp-center', text: '「局域网访问」和「外网访问」至少开一个，才会生成二维码。' }),
        h('button', {
          class: 'primary',
          text: '去高级页打开',
          onclick: function () {
            tab = 'advanced'
            render()
          },
        }),
      ]
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

      if (!qrSides().length) return noneOpenPane()

      var side = curSide()
      var sw = sideSwitch()
      if (sw) out.push(h('div', { class: 'dmp-sidesw' }, [sw]))
      // 卡片区：整块可点，点了就切到另一张（只有一张时不可点）
      out.push(
        h(
          'div',
          {
            class: 'dmp-qrsw' + (sw ? ' switchable' : ''),
            onclick: function () {
              switchSide()
            },
          },
          [qrCard(side)],
        ),
      )
      out.push(h('p', { class: 'dmp-lead dmp-center', text: '相机或浏览器扫码连接 DSH 桌面版' }))
      out.push(h('p', { class: 'dmp-qrnote dmp-center', text: sideNote(side) }))
      var left = ttlLeft()
      var onlyUrl = pairUrlOf(side)
      if (onlyUrl) {
        out.push(
          h('div', { class: 'dmp-link' }, [
            h('code', { text: onlyUrl }),
            h('button', {
              class: 'btn',
              text: '复制',
              onclick: function (ev) {
                copyFreshPair(side, ev.currentTarget)
              },
            }),
          ]),
        )
      }
      if (!(data && data.ticketExpiresAt)) {
        out.push(h('p', { class: 'dmp-hint dmp-center', text: '点下面的按钮生成一张' }))
      }
      var hasTicket = Boolean(qrSvgOf(side) && left > 0)
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

    // 一行开关，行尾可以带一个「！」说明图标（v1.8.25：入口那块的两句说明
    // 从大标题上挪到这里，贴着手边更好看到）
    function switchRow(label, sub, on, onToggle) {
      var head = h('div', { class: 'name', text: label })
      return h('div', { class: 'row' }, [
        h('div', { class: 'grow' }, [head, sub ? h('div', { class: 'meta', text: sub }) : null]),
        h('button', { class: 'pill ' + (on ? 'on' : 'off'), text: on ? '已开启' : '已关闭', onclick: onToggle }),
      ])
    }

    // 同 switchRow，但标题后面跟一个「！」说明
    function switchRowI(label, sub, tip, on, onToggle) {
      var head = h('div', { class: 'name', style: 'display:flex;align-items:center;gap:5px', text: label })
      if (tip) head.appendChild(qIcon(tip))
      return h('div', { class: 'row' }, [
        h('div', { class: 'grow' }, [head, sub ? h('div', { class: 'meta', text: sub }) : null]),
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

    // 「！」小圆标：鼠标放上去在旁边弹一条说明（同一个东西 h4i() 和开关行都用）
    function qIcon(tip) {
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
      return icon
    }

    // 带「！」的区块标题：鼠标放上去在图标旁边弹一条小气泡说明
    function h4i(title, tip) {
      var row = h('h4', { style: 'display:flex;align-items:center;gap:6px' })
      row.appendChild(document.createTextNode(title))
      if (tip) row.appendChild(qIcon(tip))
      return row
    }

    // 没有说明的区块标题（v1.8.25：入口这条整块说明挪到两个开关行上去了）
    function h4p(title) {
      return h('h4', { style: 'display:flex;align-items:center;gap:6px', text: title })
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
    // v1.8.31：「删除所有设备凭证」的二次确认计时（4 秒内再点才生效）
    var delAllArm = 0

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
      // 时间倒序（最新的在最上面）；没有 at 的老数据排最后
      feed = feed.slice().sort(function (a, b) {
        return (Number(b && b.at) || 0) - (Number(a && a.at) || 0)
      })
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
      // 超过四五条左右就滚动（.feed 的 max-height 卡在 5 张卡的高度）
      var wrap = h('div', { class: 'feed' })
      feed.forEach(function (it) {
        var lv = Number(it.level)
        if (lv !== 0 && lv !== 1) lv = 2
        var kids = []
        // v1.8.25：事件标签从右下角搬到左上角，当信笺的 title（用户说「这个是每条
        // 消息都有的，都有的就放左上角当 title」）；NEW 徽标紧跟在 title 后面。
        var top = []
        top.push(h('span', { class: 'tag t' + lv, text: kindLabel(it.kind) }))
        if (Number(it.at) > feedSeen) top.push(h('span', { class: 'new', text: 'NEW' }))
        kids.push(h('div', { class: 'top' }, top))
        kids.push(h('div', { class: 'tx', text: it.text || '' }))
        // 右下角只留时间（类型已经在左上角了，不重复说两遍）
        kids.push(h('div', { class: 'tm', text: hhmm(it.at) }))
        wrap.appendChild(h('div', { class: 'it p' + lv }, kids))
      })
      if (feed.length) out.push(wrap)
      return out
    }

    // 技术动态：「会话名 正在用 工具」、401 扫描、上游 503 这类。
    // v1.8.24：「正在用工具」这种高频事件不再弹气泡（只在这儿列着），
    // 其余技术动态仍然弹；都不进红点（红点只算要人判断的）。
    function techRows() {
      // v1.8.29：手机端快照在 remote 里，data 为 null —— 这里也要认 remote
      var src = data || remote
      var techList = src && src.feed && Array.isArray(src.feed.tech) ? src.feed.tech : []
      if (!techList.length) return []
      var out = [
        h('div', {
          class: 'dmp-hint',
          style: 'margin:10px 0 4px',
          text: '技术动态（「正在用工具」这类高频的不弹气泡、不响音，这儿都记着；其余会弹。都不进红点 —— 红点只算要人判断的）',
        }),
      ]
      var wrap = h('div', { class: 'dmp-tech' })
      techList.slice(0, 12).forEach(function (t) {
        wrap.appendChild(
          h('div', { class: 'titem' }, [
            h('span', { class: 'ttext', text: t.text || '' }),
            // 时间 · 事件类型 ·（合并了几次）。类型名走 kindLabel()，跟气泡卡片里的说法一致，
            // 不会再出现「同一条动态，气泡写『正在用工具』、列表里写 tool」这种对不上的情况。
            h('span', {
              class: 'ttime',
              text: hhmm(t.at) + ' · ' + kindLabel(t.kind) + (Number(t.count) > 1 ? ' · ' + t.count + ' 次' : ''),
            }),
          ]),
        )
      })
      out.push(wrap)
      return out
    }

    function logRows() {
      // v1.8.30：手机端 data 为 null，日志在 remote.events 里
      var lsrc = data || remote
      var raw = lsrc && Array.isArray(lsrc.events) ? lsrc.events : []
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
              var list = lsrc && Array.isArray(lsrc.events) ? lsrc.events : []
              var txt = list
                .map(function (e) {
                  return hhmm(e.at) + ' ' + kindLabel(e.kind) + ' ' + (e.text || '')
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
        var box = h('div', { class: 'dmp-logbox', style: 'max-height:170px;overflow:auto;border:1px solid #e3eef4;border-radius:10px;padding:8px;background:#fff' })
        raw.slice(-40).reverse().forEach(function (e) {
          box.appendChild(h('div', { class: 'feed' }, [h('div', { class: 'tx', text: e.text || '' }), h('div', { class: 'tm', text: hhmm(e.at) + ' · ' + kindLabel(e.kind) })]))
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
        // v1.8.32：高级页不再堆消息（消息/日志 已单独一页），这里只留设置项。
        // 音效设置是手机本地偏好（localStorage），电脑端与手机端各存各的，可以直接在这里操作。
        rOut.push(h4i('音效', '只是提示音，不影响连接：滑入滑出、按下松手各一声短音；气泡音按优先级 P0 五声 / P1 三声 / P2 两声。'))
        soundRows().forEach(function (n) {
          rOut.push(n)
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
      // v1.8.25：「入口」这块的说明从大标题上的「！」挪到两个开关行后面，贴合各自管的东西
      out.push(h4p('入口'))
      // v1.8.34：这一页不再重复贴「链接 + 复制」—— 地址和复制都收进「连接」页的二维码卡片里了
      out.push(
        switchRowI(
          '局域网访问',
          lan ? '同一 Wi-Fi 下可用，不经第三方' : '关着（只走外网，一个码到处都能用）',
          '局域网只在同一个 Wi-Fi 里能用，不经第三方服务器。',
          lan,
          function () {
            post('toggle', { key: 'lan' })
          },
        ),
      )
      out.push(
        switchRowI(
          '外网访问',
          tun ? '经 Cloudflare 中继，开着就能从外面连回来' : '关着（出门在外就连不上）',
          '外网走 Cloudflare 中继，在外面也能连回来。两个都关 = 手机进不来。',
          tun,
          function () {
            post('toggle', { key: 'tunnel' })
          },
        ),
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
      out.push(h4i('已配对设备', '每台设备能单独信任 / 断开 / 删除，也能加备注。上限 8 台，满了要先删一台。'))
      deviceRows().forEach(function (n) {
        out.push(n)
      })
      // v1.8.31：一键清掉所有设备凭证（用户要求）。放在设备列表正下方 ——
      // 手机上想「把别人踢干净」时不用一台一台点。
      var devCount = data && Array.isArray(data.deviceList) ? data.deviceList.length : 0
      if (devCount) {
        var allArmed = Date.now() - delAllArm < 4000
        out.push(
          h('div', { style: 'display:flex;justify-content:flex-end;margin:-2px 0 10px' }, [
            h('button', {
              class: 'btn ' + (allArmed ? 'danger' : 'ghost'),
              text: allArmed ? '确认清除全部（' + devCount + ' 台）' : '删除所有设备凭证',
              style: allArmed ? 'background:#ffe2dd;border-color:#e8a49b' : '',
              onclick: function () {
                if (!allArmed) {
                  delAllArm = Date.now()
                  render()
                  return
                }
                delAllArm = 0
                post('device', { removeAll: true })
              },
            }),
          ]),
        )
      }
      out.push(h4i('音效', '只是提示音，不影响连接：滑入滑出、按下松手各一声短音；气泡音按优先级 P0 五声 / P1 三声 / P2 两声。'))
      soundRows().forEach(function (n) {
        out.push(n)
      })
      // 免打扰 / 一键静音整块已去掉（用户 2026-10-30：静音功能直接去掉）
      // v1.8.22：消息 / 排查日志 / 技术动态三块整体搬到第三个 tab「消息/日志」，
      // 高级页只留入口、设备、音效这些设置项。
      // v1.8.25：末尾那条「消息与日志」的空标题也去掉（用户：高级里消息与日志去掉）——
      // 页签上已经写着「消息/日志」了，设置页留一行指路反而占地方。
      return out
    }

    // 第三个 tab：消息 + 技术动态 + 排查日志（v1.8.22）
    function feedPane() {
      if (remote) {
        // v1.8.29：手机端也走同一套信笺卡片（feedItems() 现在认 remote 快照），
        // 而不是把 remote.events 那几十条原始日志糊上去 —— 那样没有标签、没有 NEW、也没有顺序。
        var rOut = []
        rOut.push(
          h4i('消息', '按时间倒序；P0 金（要你决定）/ P1 橙（值得留意）/ P2 蓝（普通）。离开这一页或关掉面板时记已读。'),
        )
        feedRows().forEach(function (n) {
          rOut.push(n)
        })
        techRows().forEach(function (n) {
          rOut.push(n)
        })
        // v1.8.32：手机端这里也补上「排查日志」（用户：消息/日志 tabs 里加上日志）
        rOut.push(h4i('排查日志', '连接、证书、隧道每一步都记着；出问题先复制这段。'))
        logRows().forEach(function (n) {
          rOut.push(n)
        })
        return rOut
      }
      var out = []
      out.push(h4i('消息', '按时间倒序；P0 金（要你决定）/ P1 橙（值得留意）/ P2 蓝（普通）。离开这一页时记已读，NEW 与红点一起消失。'))
      feedRows().forEach(function (n) {
        out.push(n)
      })
      techRows().forEach(function (n) {
        out.push(n)
      })
      out.push(h4i('排查日志', '连接、证书、隧道每一步都记着；出问题先复制这段。'))
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
          var nodes = tab === 'connect' ? connectPane() : tab === 'feed' ? feedPane() : advancedPane()
          // 新内容准备完毕才动旧 DOM：算的时候抛异常也不会把页面清成空白
          renderTabs()
          // v1.8.27：重建前记住滚动位置，重建后放回去。
          // 原来 body.textContent='' 会把里面所有滚动容器的 scrollTop 一起清零，
          // 于是「消息/日志」页往下看几条，一有新消息（或 SSE 一来）就跳回第一行。
          var keepScroll = snapshotScroll()
          body.textContent = ''
          nodes.forEach(function (n) {
            if (n) body.appendChild(n)
          })
          restoreScroll(keepScroll)
        } catch (e) {
          /* 渲染失败不要连累宿主 */
        }
      }
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
      else setTimeout(run, 0)
    }
    var renderQueued = false
    var lastPaintSig = ''
    // v1.8.32：把面板的 render 挂到模块级钩子，供顶层的 soundRows() 回调使用
    _requestRender = render

    // v1.8.27：滚动位置的保存/恢复。
    // 面板每次重画都是「清空 body → 重新 append」，新节点的 scrollTop 天然是 0，
    // 所以往下翻着看消息时，只要来一条新消息（或 SSE 推一帧）就跳回第一行。
    // 这里按「容器 + 序号」把位置记下来，重画完放回去。
    var SCROLL_SEL = '.feed, .dmp-logbox'
    function scrollBoxes() {
      var list = []
      if (!body) return list
      // body 自己是「高级页 / 消息页」的整体滚动容器
      list.push(body)
      var inner = body.querySelectorAll ? body.querySelectorAll(SCROLL_SEL) : []
      for (var i = 0; i < inner.length; i++) list.push(inner[i])
      return list
    }
    function snapshotScroll() {
      try {
        return scrollBoxes().map(function (n) {
          return Number(n.scrollTop) || 0
        })
      } catch (e) {
        return []
      }
    }
    function restoreScroll(saved) {
      if (!saved || !saved.length) return
      try {
        var boxes = scrollBoxes()
        for (var i = 0; i < boxes.length && i < saved.length; i++) {
          if (saved[i]) boxes[i].scrollTop = saved[i]
        }
      } catch (e) {
        /* 老浏览器设不上就算了，不影响内容 */
      }
    }

    // 只挑「会影响画面」的字段做指纹
    function fingerprint() {
      try {
        // v1.8.29：手机端 data 为 null、快照在 remote 里 —— 原来这里固定取 data，
        // 手机端每一帧的指纹都是同一串「全 undefined」，指纹永远不变 →
        // 面板内容变了也不重画（「消息/日志」页看着像卡住）。
        var d = data || remote || {}
        return JSON.stringify([
          d.lanEnabled,
          d.tunnelEnabled,
          d.tunnelUrl,
          d.lanUrl,
          d.pairUrl,
          // v1.8.33：局域网那张码和当前展示的是哪张，也进指纹
          d.lanPairUrl,
          d.lanAvailable,
          qrSide,
          d.ticketExpiresAt,
          d.tunnelAutoOffMinutes,
          d.mutedUntil,
          d.unread,
          // v1.8.26：lastSeen 精确到分钟再进指纹。
          // 手机自己每访问一次（含全部静态资源）服务端就刷新 lastSeen，精确值进指纹 = 每几秒指纹变一次
          // → render() 整块重建面板 DOM，看起来就是「一直在重载」。界面上显示的是 hhmm()，分钟粒度足够。
          (d.deviceList || []).map(function (x) {
            return [x.id, x.note, x.trusted, Math.floor(Number(x.lastSeen || 0) / 60000)].join('|')
          }),
          (d.feed || {}).pendingCount,
          // NEW 徽标跟着「上次读消息页的时间」走，这个变了必须重画
          feedSeen,
          (d.feed || {}).unread,
          // 「消息/日志」页的内容指纹：最新一条消息的时间 + 技术动态条数
          ((d.feed || {}).human || []).length,
          ((d.feed || {}).human || [])[0] && ((d.feed || {}).human || [])[0].at,
          ((d.feed || {}).tech || []).length,
          ((d.feed || {}).tech || [])[0] && ((d.feed || {}).tech || [])[0].at,
          (d.feed || {}).techCount,
          (d.feed || {}).techRaw && (d.feed.techRaw || [])[0] && d.feed.techRaw[0].at,
          // v1.8.26：只比长度不够 —— events 到上限 40 条后长度不再变，
          // 「排查日志」里最新那一条就永远刷不出来。带上最新一条的序号与时间。
          (d.events || []).length,
          ((d.events || [])[(d.events || []).length - 1] || {}).seq,
          ((d.events || [])[(d.events || []).length - 1] || {}).at,
          tab,
          editId,
          logOpen,
          // v1.8.31：「删除所有设备凭证」按一下会进二次确认态，这个状态必须进指纹，
          // 否则指纹没变 → render() 直接 return，按钮点上去一点反应都没有。
          delAllArm,
          // v1.8.26 修：这一行原来写的是 `infoOpen`，而这个变量在整个文件里从未声明过 →
          // fingerprint() 每次都抛 ReferenceError，被下面的 catch 吞掉后返回 ''，
          // 空串让 `sig === lastPaintSig` 永远不成立 → 每次轮询都整块重建面板 DOM。
          // 这就是「每过几秒一直在重载」的真正原因。
          sound(),
        ])
      } catch (e) {
        // 指纹算不出来时返回 ''（= 每次都重画，画面不会错，但会白费力气）。
        // 一定要把异常打出来：v1.8.26 前这里静默吞掉了一个 ReferenceError，
        // 结果就是面板每几秒整块重建，查了很久才找到。
        try {
          if (!window.__dmpFpWarned) {
            window.__dmpFpWarned = true
            console.warn('[dsh-my-phone] fingerprint() 抛异常，已退回「每帧重画」：', e)
          }
        } catch (_) {}
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
