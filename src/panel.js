// DSH My Phone — host half of the native settings card.
//
// The browser half (src/client.js) runs inside the DSH Web UI, so the routes we
// mount here live on the *host* web server: same origin, behind the same
// browser-trust fence as everything else, and switched by the same rules the
// plugin already follows (loopback only, no secrets in GET responses).
import { readFileSync, statSync } from 'node:fs'
import { toSvg } from './qr.js'

// 插件版本号：给前端显示，好一眼看出「界面跑的是不是我刚改的这版」。
const PKG_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || ''
  } catch {
    return ''
  }
})()

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const PANEL = '/__myphone/panel'
const ICON_PATH = new URL('../icon-transparent.png', import.meta.url)
const ICON96_PATH = new URL('../icon-96.png', import.meta.url)
// 悬浮球专用：按内容边界裁过的鲸尾（512x459，四边没有透明留白），
// 这样它才能真的贴住窗口边 —— 正方形那张上下各有 ~5% 透明边，看着就是「没贴紧」。
const ICON_FAB_PATH = new URL('../icon-tight.png', import.meta.url)
// 悬浮球脚本按 mtime 缓存：改完 widget.js 刷页面就生效，不用重启宿主
const WIDGET_PATH = new URL('./widget.js', import.meta.url)
let widgetCache = { text: '', mtimeMs: 0 }
/** 这次进程是什么时候起来的：前端靠它判断「DSH 重启了，该弹一次引导气泡」。 */
const STARTED_AT = Date.now()

let iconCache = null
/** 悬浮按钮的图标：和插件商店里那个是同一张图，走同源路由，避免跨域和 404。
 *  按文件 mtime+size 做 ETag 缓存：换图不用重启 DSH，浏览器拿 304 也不会吃旧图。 */
function iconBytes() {
  const st = statSync(ICON_PATH)
  const etag = `"${Math.round(st.mtimeMs).toString(36)}-${st.size.toString(36)}"`
  if (!iconCache || iconCache.etag !== etag) iconCache = { etag, buf: readFileSync(ICON_PATH) }
  return iconCache
}
let iconFabCache = null
function iconFabBytes() {
  if (!iconFabCache) iconFabCache = readFileSync(ICON_FAB_PATH)
  return iconFabCache
}

let icon96Cache = null
/** 球上只显示 40px，传 512px 的原图是白费流量。 */
function icon96Bytes() {
  if (!icon96Cache) icon96Cache = readFileSync(ICON96_PATH)
  return icon96Cache
}

const isLoopback = (req) => LOOPBACK.has(req.socket.remoteAddress || '')

function json(res, status, obj) {
  const buf = Buffer.from(JSON.stringify(obj), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': buf.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(buf)
}

async function readJson(req, limit = 4096) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('body too large')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

/**
 * Mount the panel routes on the host web server.
 * Returns a dispose function; if the host has no `webServer.register`, returns a no-op.
 */
export function registerPanel(ctx, { state, gate, getAddresses, getQrBase = null, sync }) {
  const web = ctx.webServer
  if (!web || typeof web.register !== 'function') {
    return () => {}
  }

  const snapshot = () => {
    const s = state.settings
    const addresses = getAddresses()
    // 扫码地址的规则（跟 gate.pairingUrl 一致）：外网开着固定 https，关着给 IP；
    // 外网开着但隧道还没起来时留空，界面会显示「入口还在准备」。
    const qrBase = getQrBase ? getQrBase() || '' : addresses[0] || ''
    const entryMode = s.tunnelEnabled ? (qrBase ? 'tunnel' : 'pending') : qrBase ? 'lan' : 'off'
    const url = qrBase
    // 二维码里带一次性票据：扫开之后手机上还要点一下「信任这台电脑」。
    // v0.6 起不再自动发票 —— 只有人点了「生成 / 换一个二维码」才有码，过期就停在失效状态等人点。
    const liveTicket = gate.pairing ? gate.pairing.peekTicket() : null
    const pairUrl = liveTicket ? gate.pairingUrl(liveTicket.ticket) || url : url
    let qrSvg = ''
    // 没有活票据时不要画码：以前会把「不带票据的地址」也画成二维码，
    // 手机上扫进去只会得到「二维码已失效」，看着像 bug（用户 2026-10-29 报的就是这个）
    if (liveTicket && pairUrl) {
      try {
        qrSvg = toSvg(pairUrl, { scale: 4, margin: 2, dark: '#0b1220', light: '#ffffff' }).svg
      } catch {
        qrSvg = ''
      }
    }
    return {
      lanEnabled: Boolean(s.lanEnabled),
      tunnelEnabled: Boolean(s.tunnelEnabled),
      autoOffMinutes: Number(s.autoOffMinutes || 0),
      // v0.6：局域网和外网各有一个「多久没动静就自己关」的档位
      lanAutoOffMinutes: Number(s.lanAutoOffMinutes || 0),
      tunnelAutoOffMinutes: Number(s.tunnelAutoOffMinutes || 0),
      devices: state.devices.length,
      trustedDevices: state.devices.filter((d) => d.trustedAt).length,
      maxDevices: Number(s.maxDevices || 0),
      url,
      entryMode,
      version: PKG_VERSION,
      pairUrl,
      ticketExpiresAt: liveTicket?.expiresAt ?? null,
      adminUrl: `http://127.0.0.1:${gate.adminPort || s.lanPort}/__myphone/`,
      pairing: gate.pairing?.peek() ?? null,
      tunnel: gate.getStatus?.()?.tunnel ?? null,
      // 悬浮窗「高级」页要用：设备明细 + 最近的动静（排查用）
      deviceList: state.devices.map((d) => ({
        id: d.id,
        label: d.label,
        note: d.note || '',
        addedAt: d.createdAt ?? null, // state 里字段叫 createdAt，以前读 addedAt 恒为 null
        lastSeen: d.lastSeen ?? null,
        trusted: Boolean(d.trustedAt),
        // 是否存了长期凭据（手机浏览器清掉 cookie 后能靠它自己认回来）
        remembered: Array.isArray(d.passKeys) && d.passKeys.length > 0,
      })),
      events: gate.recentEvents?.() ?? [],
      pendingCount: (gate.feed?.() ?? {}).pendingCount ?? 0,
      mutedUntil: Number(s.mutedUntil) || 0,
      quietStart: String(s.quietStart || ''),
      quietEnd: String(s.quietEnd || ''),
      muted: Boolean(gate.bubbledMuted?.()),
      feed: gate.feed?.() ?? null,
      lanPort: gate.adminPort || s.lanPort,
      publicPort: gate.publicPort || s.publicPort,
      autoOffEnabled: Number(s.autoOffMinutes || 0) > 0,
      qrSvg,
      // ---- v0.5：桌面端球上的红点/引导气泡读这些 ----------------------------
      startedAt: STARTED_AT,
      tunnelUrl: String(gate.getStatus?.()?.tunnel?.url || '').replace(/\/$/, ''),
      lanUrl: addresses.find((a) => String(a).startsWith('http://')) || '',
      addressChangedAt: gate.addressChangedAt || 0,
      unread: gate.unreadCount?.() ?? 0,
      notices: gate.pendingNotices?.() ?? [],
      turns: gate.pendingTurns?.() ?? [],
      approvals: gate.pendingApprovals?.() ?? [],
      alerts: gate.pendingAlerts?.() ?? [],
      // 允许在「高级」里选的空闲自动关闭档位
      autoOffChoices: [0, 15, 30, 60, 120],
    }
  }

  const routes = [
    {
      kind: 'exact',
      path: '/__myphone/client-report',
      // 前端自检信标（桌面端走的这条）：不登录、不含凭据，只用来回答「悬浮球为什么没出现」。
      handler: async (req, res) => {
        if (req.method === 'POST') {
          try {
            const info = await readJson(req)
            const stage = String(info.stage || '').slice(0, 24)
            const detail = String(info.detail || '').slice(0, 160)
            gate.noteEvent?.('client', `前端 stage=${stage} 视口=${info.w}x${info.h} detail=${detail}`)
          } catch {
            /* 信标失败不影响任何功能 */
          }
        }
        res.writeHead(204, { 'cache-control': 'no-store' })
        res.end()
      },
    },
    {
      // 悬浮球脚本：由宿主 index 注入的内联行自己 `<script src>` 拉取。
      // 不含任何凭据/状态，所以不做登录校验；带上 no-store 免得改完不生效。
      kind: 'exact',
      path: '/__myphone/widget.js',
      handler: (req, res) => {
        try {
          const st = statSync(WIDGET_PATH)
          if (!widgetCache.text || widgetCache.mtimeMs !== st.mtimeMs) {
            widgetCache = { text: readFileSync(WIDGET_PATH, 'utf8'), mtimeMs: st.mtimeMs }
          }
          res.writeHead(200, {'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store'})
          res.end(widgetCache.text)
        } catch (err) {
          res.writeHead(404, {'content-type': 'text/plain; charset=utf-8'})
          res.end('widget.js not found')
        }
      },
    },
    {
      kind: 'exact',
      path: PANEL,
      handler: async (req, res) => {
        if (!isLoopback(req)) return json(res, 404, { error: 'not found' })
        if (req.method === 'GET') return json(res, 200, snapshot())
        json(res, 405, { error: 'method not allowed' })
      },
    },
    {
      kind: 'exact',
      path: `${PANEL}/toggle`,
      handler: async (req, res) => {
        if (!isLoopback(req)) return json(res, 404, { error: 'not found' })
        // Same CSRF rule as the standalone admin page: a cross-site form post
        // cannot set a custom header.
        if (req.method !== 'POST' || req.headers['x-myphone-panel'] !== '1') {
          return json(res, 403, { error: 'forbidden' })
        }
        try {
          const { key } = await readJson(req)
          const settings = { ...state.settings }
          if (key === 'lan') settings.lanEnabled = !settings.lanEnabled
          else if (key === 'tunnel') settings.tunnelEnabled = !settings.tunnelEnabled
          else return json(res, 400, { error: 'unknown key' })
          state.patchSettings(settings)
          await sync()
          json(res, 200, snapshot())
        } catch (err) {
          json(res, 400, { error: String(err?.message ?? err) })
        }
      },
    },
    {
      kind: 'exact',
      path: `${PANEL}/pair`,
      handler: async (req, res) => {
        if (!isLoopback(req)) return json(res, 404, { error: 'not found' })
        if (req.method !== 'POST' || req.headers['x-myphone-panel'] !== '1') {
          return json(res, 403, { error: 'forbidden' })
        }
        try {
          gate.pairing.issue()
          json(res, 200, snapshot())
        } catch (err) {
          json(res, 400, { error: String(err?.message ?? err) })
        }
      },
    },
    {
      kind: 'exact',
      // 悬浮按钮弹层用：换一张新票（旧票立刻作废），顺手把新二维码带回去
      path: `${PANEL}/ticket`,
      handler: async (req, res) => {
        if (!isLoopback(req)) return json(res, 404, { error: 'not found' })
        if (req.method !== 'POST' || req.headers['x-myphone-panel'] !== '1') {
          return json(res, 403, { error: 'forbidden' })
        }
        try {
          gate.issueTicket()
          json(res, 200, snapshot())
        } catch (err) {
          json(res, 400, { error: String(err?.message ?? err) })
        }
      },
    },
    {
      kind: 'exact',
      // 「排查」旁边的清空按钮：内存事件环 + pair.log / error.log 一起清（各先备份 .1）
      path: `${PANEL}/clear`,
      handler: async (req, res) => {
        if (!isLoopback(req)) return json(res, 404, { error: 'not found' })
        if (req.method !== 'POST' || req.headers['x-myphone-panel'] !== '1') {
          return json(res, 403, { error: 'forbidden' })
        }
        try {
          gate.clearLogs?.() ?? gate.clearEvents?.()
          json(res, 200, snapshot())
        } catch (err) {
          json(res, 400, { error: String(err?.message ?? err) })
        }
      },
    },
    {
      kind: 'exact',
      // 提醒气泡的「看过了」：seq 指定一条，all=true 全收
      path: `${PANEL}/alert`,
      handler: async (req, res) => {
        if (!isLoopback(req)) return json(res, 404, { error: 'not found' })
        if (req.method !== 'POST' || req.headers['x-myphone-panel'] !== '1') {
          return json(res, 403, { error: 'forbidden' })
        }
        try {
          const { seq, all } = await readJson(req)
          if (all) {
            for (const a of gate.pendingAlerts?.() ?? []) gate.dismissAlert?.(a.seq)
          } else if (seq != null) {
            gate.dismissAlert?.(seq)
          }
          json(res, 200, snapshot())
        } catch (err) {
          json(res, 400, { error: String(err?.message ?? err) })
        }
      },
    },
    {
      kind: 'exact',
      // 设备信任开关（电脑这边也能改）
      path: `${PANEL}/device`,
      handler: async (req, res) => {
        if (!isLoopback(req)) return json(res, 404, { error: 'not found' })
        if (req.method !== 'POST' || req.headers['x-myphone-panel'] !== '1') {
          return json(res, 403, { error: 'forbidden' })
        }
        try {
          const { id, trusted, remove, removeAll, note } = await readJson(req)
          if (removeAll) {
            for (const d of [...state.devices]) {
              // 删除 = 先撤销信任，再把人从列表里拿掉（不留「已删但仍信任」的中间态）
              state.untrustDevice(d.id)
              state.removeDevice(d.id)
            }
            gate.noteEvent?.('device', '电脑端把已配对设备全部撤销并删除')
            return json(res, 200, snapshot())
          }
          if (remove) {
            const target = String(id || '')
            state.untrustDevice(target)
            state.removeDevice(target)
            gate.noteEvent?.('device', `电脑端删除了一台设备（${target.slice(0, 8)}）并撤销信任`)
            return json(res, 200, snapshot())
          }
          // 只改备注（不碰信任状态）
          if (typeof note === 'string') {
            const noted = state.noteDevice(String(id || ''), note)
            if (!noted) return json(res, 404, { error: '没有这台设备' })
            return json(res, 200, snapshot())
          }
          const device = trusted ? state.trustDevice(String(id || '')) : state.untrustDevice(String(id || ''))
          if (!device) return json(res, 404, { error: '没有这台设备' })
          json(res, 200, snapshot())
        } catch (err) {
          json(res, 400, { error: String(err?.message ?? err) })
        }
      },
    },
    {
      kind: 'exact',
      // 空闲自动关闭的档位（高级页的分段控件）。
      // v0.6 起带 key：'lan' 只改局域网那一条，'tunnel' 只改外网那一条；不给 key 就两条都改（老客户端兼容）。
      path: `${PANEL}/autooff`,
      handler: async (req, res) => {
        if (!isLoopback(req)) return json(res, 404, { error: 'not found' })
        if (req.method !== 'POST' || req.headers['x-myphone-panel'] !== '1') {
          return json(res, 403, { error: 'forbidden' })
        }
        try {
          const { minutes, key } = await readJson(req)
          const n = Number(minutes)
          if (![0, 15, 30, 60, 120].includes(n)) return json(res, 400, { error: 'unknown minutes' })
          if (key === 'lan') state.patchSettings({ lanAutoOffMinutes: n })
          else if (key === 'tunnel') state.patchSettings({ tunnelAutoOffMinutes: n })
          else if (key === undefined || key === null || key === '') {
            state.patchSettings({ autoOffMinutes: n, lanAutoOffMinutes: n, tunnelAutoOffMinutes: n })
          } else return json(res, 400, { error: 'unknown key' })
          await sync()
          json(res, 200, snapshot())
        } catch (err) {
          json(res, 400, { error: String(err?.message ?? err) })
        }
      },
    },
    {
      kind: 'exact',
      // 「刚才有设备连上」这条提醒被看过了 → 红点消失
      path: `${PANEL}/read`,
      handler: async (req, res) => {
        if (!isLoopback(req)) return json(res, 404, { error: 'not found' })
        if (req.method !== 'POST' || req.headers['x-myphone-panel'] !== '1') {
          return json(res, 403, { error: 'forbidden' })
        }
        try {
          gate.markNoticesRead?.()
          json(res, 200, snapshot())
        } catch (err) {
          json(res, 400, { error: String(err?.message ?? err) })
        }
      },
    },
    {
      kind: 'exact',
      // 点掉一条「等待授权」（人已经看过这条提醒了）
      // 「知道了」：授权与连接通知共用（v1.2.2 起连接通知也能单条收掉）
      // 免打扰：一键静音（mutedUntil）或每日时段（quietStart/quietEnd）
      path: `${PANEL}/quiet`,
      handler: async (req, res) => {
        if (!isLoopback(req)) return json(res, 404, { error: 'not found' })
        if (req.method !== 'POST' || req.headers['x-myphone-panel'] !== '1') {
          return json(res, 403, { error: 'forbidden' })
        }
        try {
          const body = await readJson(req)
          const patch = {}
          if (body.mutedUntil !== undefined) patch.mutedUntil = Math.max(0, Number(body.mutedUntil) || 0)
          if (body.quietStart !== undefined) patch.quietStart = /^\d{2}:\d{2}$/.test(String(body.quietStart)) ? String(body.quietStart) : ''
          if (body.quietEnd !== undefined) patch.quietEnd = /^\d{2}:\d{2}$/.test(String(body.quietEnd)) ? String(body.quietEnd) : ''
          state.patchSettings(patch)
          json(res, 200, snapshot())
        } catch (err) {
          json(res, 400, { error: String(err?.message ?? err) })
        }
      },
    },
    {
      kind: 'exact',
      path: `${PANEL}/ack`,
      handler: async (req, res) => {
        if (!isLoopback(req)) return json(res, 404, { error: 'not found' })
        if (req.method !== 'POST' || req.headers['x-myphone-panel'] !== '1') {
          return json(res, 403, { error: 'forbidden' })
        }
        try {
          const body = await readJson(req)
          if (body.ack !== undefined) gate.ackApproval?.(body.ack)
          if (body.notice !== undefined) gate.ackNotice?.(body.notice)
          json(res, 200, snapshot())
        } catch (err) {
          json(res, 400, { error: String(err?.message ?? err) })
        }
      },
    },
    {
      kind: 'exact',
      path: `${PANEL}/approval`,
      handler: async (req, res) => {
        if (!isLoopback(req)) return json(res, 404, { error: 'not found' })
        if (req.method !== 'POST' || req.headers['x-myphone-panel'] !== '1') {
          return json(res, 403, { error: 'forbidden' })
        }
        try {
          const { seq } = await readJson(req)
          gate.ackApproval?.(seq)
          json(res, 200, snapshot())
        } catch (err) {
          json(res, 400, { error: String(err?.message ?? err) })
        }
      },
    },
    {
      kind: 'exact',
      // 悬浮按钮专用：紧裁版鲸尾（无透明留白，贴边时底边就是图片底边）
      path: '/__myphone/icon-fab.png',
      handler: async (req, res) => {
        if (!isLoopback(req)) return json(res, 404, { error: 'not found' })
        try {
          const buf = iconFabBytes()
          res.writeHead(200, {
            'content-type': 'image/png',
            'content-length': buf.length,
            'cache-control': 'no-cache',
            etag: '\"' + buf.length.toString(16) + '-fab\"',
            'x-content-type-options': 'nosniff',
          })
          res.end(buf)
        } catch {
          json(res, 404, { error: 'no icon' })
        }
      },
    },
    {
      kind: 'exact',
      // 悬浮按钮的图标（同源，<img> 直接引用）
      path: '/__myphone/icon.png',
      handler: async (req, res) => {
        if (!isLoopback(req)) return json(res, 404, { error: 'not found' })
        try {
          // 换图标不应该要求重启 DSH：按 mtime+size 生成 ETag，文件变了自动换新；
          // 浏览器带着 if-none-match 来问就回 304，省流量也不吃旧图。
          const { buf, etag } = iconBytes()
          if (req.headers['if-none-match'] === etag) {
            res.writeHead(304, { etag, 'cache-control': 'no-cache' })
            res.end()
            return
          }
          res.writeHead(200, {
            'content-type': 'image/png',
            'content-length': buf.length,
            'cache-control': 'no-cache',
            etag,
            'x-content-type-options': 'nosniff',
          })
          res.end(buf)
        } catch {
          json(res, 404, { error: 'no icon' })
        }
      },
    },
    {
      kind: 'exact',
      // 变更推送（SSE）：连上这条流后，授权请求 / 设备连入 / 开关变化都是「发生即到」。
      // 只给回环地址用 —— 手机走只读口轮询，不需要也不应该拿到管理快照。
      path: PANEL + '/stream',
      handler: async (req, res) => {
        if (!isLoopback(req)) return json(res, 404, { error: 'not found' })
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        })
        let closed = false
        const send = () => {
          if (closed) return
          try {
            res.write('data: ' + JSON.stringify(snapshot()) + '\n\n')
          } catch {
            /* 连接已断，交给 close 收尾 */
          }
        }
        send()
        const off = typeof gate.onChange === 'function' ? gate.onChange(send) : null
        // 25 秒心跳：cloudflared / 中间代理对空闲连接有 100 秒上下的超时
        const ping = setInterval(() => {
          if (closed) return
          try {
            res.write(': ping\n\n')
          } catch {
            /* 忽略 */
          }
        }, 25_000)
        const done = () => {
          if (closed) return
          closed = true
          clearInterval(ping)
          if (off) off()
          try {
            res.end()
          } catch {
            /* 已经关了 */
          }
        }
        req.on('close', done)
        res.on('close', done)
        res.on('error', done)
      },
    },
    {
      kind: 'exact',
      // 96px 版本：悬浮球实际只显示 40px，别为一张图传 160KB
      path: '/__myphone/icon-96.png',
      handler: async (req, res) => {
        if (!isLoopback(req)) return json(res, 404, { error: 'not found' })
        try {
          const buf = icon96Bytes()
          res.writeHead(200, {
            'content-type': 'image/png',
            'content-length': buf.length,
            'cache-control': 'public, max-age=86400',
            'x-content-type-options': 'nosniff',
          })
          res.end(buf)
        } catch {
          json(res, 404, { error: 'no icon' })
        }
      },
    },
  ]

  const disposers = []
  for (const route of routes) {
    try {
      const dispose = web.register(route)
      if (typeof dispose === 'function') disposers.push(dispose)
    } catch (err) {
      console.error('[dsh-my-phone] 无法挂载原生设置面板路由', err?.message ?? err)
    }
  }

  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        /* already gone */
      }
    }
  }
}
