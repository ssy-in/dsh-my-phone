import http from 'node:http'
import net from 'node:net'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Pairing, signDeviceToken, verifyDeviceToken } from './pair.js'
import { adminPage, errorPage, scanPage, staleHostPage, trustPage } from './pages.js'
import { diagPage } from './diag.js'

const COOKIE = 'myphone_dev'
const ADMIN = '/__myphone/'
const API = '/__myphone/api/'
const BODY_LIMIT = 4 * 1024
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const ICON_FILE = new URL('../icon.png', import.meta.url)
const ICON96_FILE = new URL('../icon-96.png', import.meta.url)
const ICON_FAB_FILE = new URL('../icon-tight.png', import.meta.url)

/** 取异常信息的第一行：给错误页显示，不把堆栈糊到用户脸上。 */
function firstLine(err) {
  const text = String(err?.message || err || '未知错误')
  return text.split('\n')[0].slice(0, 200)
}

/**
 * 只取出 host，解析不了就返回 null。
 * 手机浏览器 POST 表单时可能发 `Origin: null`（不透明来源），直接 `new URL()`
 * 会抛 `TypeError: Invalid URL` —— 这一下就把整条配对链路打断，用户看到 500。
 */
/** 票据比较用常数时间，别让比较耗时泄露「前缀对了几个字符」。 */
function sameTicket(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8')
  const y = Buffer.from(String(b || ''), 'utf8')
  if (x.length !== y.length || x.length === 0) return false
  return crypto.timingSafeEqual(x, y)
}

/**
 * 只放行站内相对路径。
 * 老写法只挡了 '//'，但 '/\evil.com' 会被浏览器当成 '//evil.com' 跳出去。
 */
function safeNext(raw) {
  const value = String(raw || '/')
  if (!value.startsWith('/')) return '/'
  try {
    const parsed = new URL(value, 'http://placeholder')
    if (parsed.origin !== 'http://placeholder') return '/'
    const out = parsed.pathname + parsed.search
    return out.startsWith('//') || out.startsWith('/\\') ? '/' : out
  } catch {
    return '/'
  }
}

function hostOf(value) {
  try {
    return new URL(String(value)).host
  } catch {
    return null
  }
}

function parseCookies(header) {
  const out = {}
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

function readBody(req, limit = BODY_LIMIT, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    let size = 0
    let over = false
    const chunks = []
    // 慢速滴灌（一个字节一个字节喂）以前能把连接钉死在这里
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('body timeout'))
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      req.removeListener('data', onData)
      req.removeListener('end', onEnd)
      req.removeListener('error', onErr)
    }
    const onData = (chunk) => {
      size += chunk.length
      if (size > limit) {
        // 关键：只停止累积，别 destroy——socket 没了，调用方那页 413 就永远送不到手机，
        // 用户看到的是「点配对没反应」。
        over = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => {
      cleanup()
      if (over) reject(new Error('body too large'))
      else resolve(Buffer.concat(chunks).toString('utf8'))
    }
    const onErr = (err) => {
      cleanup()
      reject(err)
    }
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onErr)
  })
}

/**
 * The whole network surface of DSH My Phone lives here: one HTTP server that
 * serves the admin page, the pairing form, and the reverse proxy.
 */
export function createGate({
  state,
  session,
  log = console,
  getAddresses = () => [],
  getQrBase = null,
  getStatus = () => ({ tunnel: null }),
  // 会话名在授权发生时往往还没起好（宿主是聊了几句才自动命名），
  // 所以这里允许传一个「按会话 id 现查标题」的解析器，快照时再取一次。
  resolveTitle = null,
  logFile = '',
}) {
  const pairing = new Pairing()
  // 最近一次手机自检的结果（只放内存，重启即清）
  let lastDiag = null
  const failures = new Map()
  let onSettingsChanged = null

  /**
   * 最近 40 条动静，只放内存：面板里直接展示「刚刚发生了什么」，
   * 用户问「为什么连不上」时不用去翻文件。只存结论，不含凭据。
   */
  const events = []
  let eventSeq = 0
  let addressChangedAt = 0

  // 变更订阅：桌面端的 SSE 通道靠它做到「事件发生即刻推送」，
  // 授权请求、设备连入、入口开关都不用等下一次轮询（轮询只当兜底）。
  const watchers = new Set()
  function onChange(fn) {
    watchers.add(fn)
    return () => watchers.delete(fn)
  }
  function emitChange() {
    for (const fn of Array.from(watchers)) {
      try {
        fn()
      } catch {
        /* 订阅者自己出错不该影响网关主流程 */
      }
    }
  }

  function note(kind, text) {
    // v1.2.0：事件带自增序号，前端要能稳定认「同一条」并做合并
    eventSeq += 1
    events.push({ seq: eventSeq, at: Date.now(), kind, text: String(text).slice(0, 240) })
    if (events.length > 40) events.shift()
    // 入口地址换了：桌面端要在球上提示「地址变了，手机重新扫一次就行」
    if (kind === 'tunnel') addressChangedAt = Date.now()
    emitChange()
  }

  /**
   * 「有人连进来了」的收件箱。
   *
   * 桌面端球上的红点、弹窗顶部的「刚才有设备连上」卡片都读这个。
   * 注意语义：票据即授权，手机点「信任」当场就进来了 —— 所以这里记的是
   * **已经发生**的连接，两个按钮是「确认并收起」和「立刻踢掉」，不是事前批准。
   * 只存标签、时间、设备 id，不含任何凭据。
   */
  const notices = []
  let noticeSeq = 0
  let noticesReadAt = 0
  function noteConnect(device, ua, join = 1) {
    noticeSeq += 1
    notices.push({
      seq: noticeSeq,
      at: Date.now(),
      id: device.id,
      // 有备注就显示备注名（「IS（iPhone）」）：否则连进来两次就是两条「iPhone」，
      // 用户根本分不清是不是自己。备注在设备列表里改，这里跟着变。
      label: device.note ? `${device.note}（${device.label}）` : device.label,
      ua: String(ua || '').slice(0, 120),
      // v1.2.2：第几次连入 —— 首次算 P0，之后算 P1
      join: Number(join) || 1,
      // 逐条已读：手机上点「知道了」只收自己那条
      readAt: 0,
    })
    if (notices.length > 20) notices.shift()
    emitChange()
  }
  /**
   * 「手机那边跑完一轮了」的通知。
   * 只存文本与时间，气泡读一次就够；上限 10 条，多轮连着跑也不会堆内存。
   */
  const turns = []
  let turnSeq = 0
  function noteTurn(text) {
    const body = String(text || '').slice(0, 120)
    if (!body) return false
    turnSeq += 1
    turns.push({ seq: turnSeq, at: Date.now(), text: body })
    if (turns.length > 10) turns.shift()
    return true
  }
  const pendingTurns = () => turns.slice()

  /**
   * 「电脑上的会话在等授权」的通知。
   * 边界：插件只负责告诉你，绝不代答 —— 批准/拒绝仍然在桌面端完成。
   * 合并：同一个会话 8 秒内只留一条（count 累加），一次工具连跑十下也只弹一个气泡。
   * 时效：90 秒没动静就当它已经被处理掉了，不再出现在列表里。
   */
  const APPROVAL_MERGE_MS = 8_000
  // 0 = 不按时间淘汰：等人工处理、或者自己点掉（用户要求「不自动消失」）
  const APPROVAL_TTL_MS = 0
  const approvals = []
  let approvalSeq = 0
  const shortTitle = (title) => {
    // v1.3.0：会话 id 形如 session-xxxx，前 6 位永远是「sessio」，绝不能当名字用
    let t = String(title || '').trim()
    if (!t || /^sessio/i.test(t) || /^[0-9a-f]{6,8}$/i.test(t)) t = '未命名会话'
    // v1.1.18：从 5 字放宽到 12 字 —— 用户要「中括号里显示自己的会话名」，5 字全给截了
    return t.length > 12 ? `${t.slice(0, 12)}…` : t
  }
  const approvalHead = (title, tool) => {
    const t = String(title || '').trim()
    // 会话还没命名时，用工具名说清「在等授权的是什么」，总比一个空标题强
    return shortTitle(t || (tool ? `等批准 ${tool}` : '某个会话'))
  }
  // 文案是用户定的格式：「[会话名] 正在请求授权...」，中括号由前端上橙色
  // v1.2.1：中括号换成【】—— 视觉上更像「会话名的标签」而不是 Markdown 链接
  const approvalText = (title, count, tool) => `【${approvalHead(title, tool)}】 正在请求授权...`
  function noteApproval(sessionId, title, tool, approvalId) {
    const now = Date.now()
    const sid = String(sessionId || '')
    const name = String(tool || '')
    const last = approvals.length ? approvals[approvals.length - 1] : null
    if (last && last.sessionId === sid && now - last.at <= APPROVAL_MERGE_MS) {
      last.count += 1
      last.at = now
      if (!last.tool && name) last.tool = name
      last.name = approvalHead(last.title, last.tool)
      last.text = approvalText(last.title, last.count, last.tool)
      emitChange()
      return last
    }
    approvalSeq += 1
    const row = { seq: approvalSeq, at: now, sessionId: sid, title: String(title || ''), tool: name, count: 1, id: String(approvalId || '') }
    row.name = approvalHead(row.title, row.tool)
    row.text = approvalText(row.title, 1, row.tool)
    approvals.push(row)
    if (approvals.length > 8) approvals.shift()
    emitChange()
    return row
  }
  function pendingApprovals() {
    const now = Date.now()
    const live = typeof resolveTitle === 'function' ? resolveTitle : null
    return approvals
      .filter((a) => !a.outcome && (!APPROVAL_TTL_MS || now - a.at <= APPROVAL_TTL_MS))
      .map((a) => {
        const fresh = live && a.sessionId ? String(live(a.sessionId) || '').trim() : ''
        const title = fresh || a.title
        return { ...a, title, name: approvalHead(title, a.tool), text: approvalText(title, a.count, a.tool) }
      })
  }
  /** 点掉一条「等待授权」（人已经看过了） */
  function ackApproval(seq) {
    const i = approvals.findIndex((a) => String(a.seq) === String(seq))
    if (i < 0) return false
    approvals.splice(i, 1)
    emitChange()
    return true
  }

  /** 人类已经点过允许/拒绝了 → 这条就不该再挂在「等待授权」里 */
  function decideApproval(approvalId, outcome) {
    const id = String(approvalId || '')
    if (!id) return null
    const row = approvals.find((a) => a.id === id)
    if (!row) return null
    row.outcome = String(outcome || '')
    row.decidedAt = Date.now()
    emitChange()
    return row
  }

  /**
   * 「会话在等你回答 / 这一轮结束了 / 正在整理上下文 / 切了计划模式」这类即时提醒。
   * 与 approvals 的分工：approvals 是「挂着等你处理」，alerts 是「刚发生一件事，看一眼就好」。
   * 边界和授权一样：只提示，绝不代答 —— 回答/批准仍然在桌面端完成。
   * 合并：带 ref 的（同一轮压缩、同一个提问）反复触发只更新那一条；不带的 5 秒内同类合并。
   */
  const ALERT_TTL_MS = 120_000
  const ALERT_MERGE_MS = 5_000
  const alerts = []
  let alertSeq = 0
  // 现在是否「不要弹气泡」：一键静音（mutedUntil）或每日免打扰时段；消息中心照记
  function bubbledMuted() {
    const now = Date.now()
    const s = (state && state.settings) || {}
    if (Number(s.mutedUntil) > now) return true
    const start = String(s.quietStart || '')
    const end = String(s.quietEnd || '')
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || start === end) return false
    const d = new Date()
    const cur = d.getHours() * 60 + d.getMinutes()
    const toMin = (v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5))
    const a = toMin(start)
    const b = toMin(end)
    return a < b ? cur >= a && cur < b : cur >= a || cur < b
  }

  function noteAlert(kind, text, opts = {}) {
    // 静音 / 免打扰时段：气泡不发，但 noteEvent 那边的消息照常进来
    if (bubbledMuted()) return null
    const now = Date.now()
    const ref = String(opts.ref || '')
    const sticky = Boolean(opts.sticky)
    if (ref) {
      const old = alerts.find((a) => a.ref === ref && !a.dismissed)
      if (old) {
        old.at = now
        old.text = String(text || old.text)
        emitChange()
        return old
      }
    }
    // P1（warn = 失败/重试/模型不可用）跨会话汇总，多会话时不刷屏
    if (kind === 'warn') {
      const w = alerts.find((a) => a.kind === 'warn' && !a.dismissed && now - a.at <= 180_000)
      if (w) {
        w.count = (Number(w.count) || 1) + 1
        w.at = now
        w.text = `${w.count} 个会话出了状况（点开看）`
        emitChange()
        return w
      }
    }
    const last = alerts.length ? alerts[alerts.length - 1] : null
    if (last && !last.dismissed && !ref && last.kind === kind && now - last.at <= ALERT_MERGE_MS) {
      last.count += 1
      last.at = now
      emitChange()
      return last
    }
    alertSeq += 1
    const row = {
      seq: alertSeq,
      at: now,
      kind: String(kind || 'info'),
      text: String(text || ''),
      ref,
      sticky,
      count: 1,
      dismissed: false,
    }
    alerts.push(row)
    if (alerts.length > 12) alerts.shift()
    emitChange()
    return row
  }
  function pendingAlerts() {
    const now = Date.now()
    return alerts
      .filter((a) => !a.dismissed && now - a.at <= (a.sticky ? 10 * 60_000 : ALERT_TTL_MS))
      .map((a) => ({ seq: a.seq, at: a.at, kind: a.kind, text: a.text, sticky: a.sticky, count: a.count }))
  }
  /** 人类看过了／点掉了 */
  function dismissAlert(seq) {
    const row = alerts.find((a) => a.seq === Number(seq))
    if (!row) return false
    row.dismissed = true
    emitChange()
    return true
  }
  /** 事情自己结束了（回答完了、压缩完了）—— 按 ref 收掉 */
  function clearAlertRef(ref) {
    const key = String(ref || '')
    if (!key) return false
    let hit = false
    for (const a of alerts) {
      if (a.ref === key && !a.dismissed) {
        a.dismissed = true
        hit = true
      }
    }
    if (hit) emitChange()
    return hit
  }

  /**
   * 谁最像「刚才在用手机」的那台。
   * 手机流量一定经过本插件（桌面端不走代理），所以看 lastSeen 就能认出；
   * 没有设备在 recentMs 内活动过就返回 null —— 说明这一轮是在电脑上敲的，不该发通知。
   */
  function lastActiveDevice(recentMs = 90_000) {
    const now = Date.now()
    let best = null
    for (const d of state.devices) {
      const at = Number(d.lastSeen || 0)
      if (!at || now - at > recentMs) continue
      if (!best || at > Number(best.lastSeen || 0)) best = d
    }
    return best
  }

  const unreadNotices = () => notices.filter((n) => !n.readAt && n.at > noticesReadAt)
  // 单条已读（手机端也能点掉新设备提醒）
  function ackNotice(seq) {
    const n = notices.find((x) => x.seq === Number(seq))
    if (!n) return false
    n.readAt = Date.now()
    emitChange()
    return true
  }
  function markNoticesRead() {
    noticesReadAt = Date.now()
    emitChange()
    return true
  }
  /**
   * 电脑端「排查 → 清空」用：内存事件环 + 两个日志文件一起清。
   * 清之前把现有内容另存成 `.1`（只保留最近一份），万一刚清完又要查上一次的 500，
   * 还能把 `.1` 捞回来看——所以「清空」既清干净了，也不至于把证据一起烧了。
   */
  function clearLogs() {
    events.length = 0
    const cleared = []
    if (logFile) {
      const dir = path.dirname(logFile)
      for (const name of ['pair.log', 'error.log']) {
        const target = path.join(dir, name)
        try {
          if (fs.existsSync(target)) {
            fs.copyFileSync(target, `${target}.1`)
            fs.truncateSync(target, 0)
            cleared.push(name)
          }
        } catch {
          /* 某个日志清不了不影响另一个，内存那份已经清了 */
        }
      }
    }
    return { ok: true, cleared }
  }

  /**
   * 走 cloudflared 时所有外网请求的 remoteAddress 都是 127.0.0.1。
   * 若按 socket 地址分桶，任意一个人对配对口打 8 次垃圾请求，
   * 就能把所有隧道用户锁死 15 分钟（还能无限续期）。
   * 隧道是从本机连进来的，所以只有这段回环连接上的 X-Forwarded-For 才敢信。
   */
  const rateKey = (req) => {
    const remote = req.socket.remoteAddress || 'unknown'
    const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
    if (loopback) {
      const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      if (fwd) return `xff:${fwd}`
    }
    return remote
  }
  // 失败记录也不能无限攒：IPv6 每换一个地址就是一条新记录。
  const failureSweeper = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of failures) {
      if (!entry || (entry.until || 0) + 300_000 < now) failures.delete(key)
    }
  }, 300_000)
  failureSweeper.unref?.()
  /** 剩余可尝试次数（锁之前还能错几次），给手机端显示。 */
  function attemptsLeft(req) {
    const entry = failures.get(rateKey(req))
    if (!entry) return 8
    if (entry.until > Date.now()) return 0
    return Math.max(0, 8 - entry.count)
  }
  function isLocked(req) {
    const entry = failures.get(rateKey(req))
    return Boolean(entry && entry.until > Date.now())
  }

  /**
   * 配对事件写盘：`.dsh-my-phone/pair.log`。
   * 手机点「配对」没反应时，不用猜——看这个文件就知道请求到底有没有到、
   * 码对不对、失败原因是什么。
   */
  // 日志上限：单文件 256KB，满了滚成 .1 再重开 —— 公网口有扫描器撞，
  // 不设限的话 pair.log 会一直被写大（之前就吃过这个亏）
  const LOG_MAX_BYTES = 256 * 1024
  function appendCapped(file, text) {
    try {
      try {
        if (fs.statSync(file).size > LOG_MAX_BYTES) fs.renameSync(file, `${file}.1`)
      } catch {
        /* 文件还不存在，正常 */
      }
      fs.appendFileSync(file, text)
    } catch {
      /* 写不了就算了，绝不能因为日志把功能搞挂 */
    }
  }

  /**
   * 合并式日志：只给「外部随便就能触发的拒绝类事件」用。
   * 同一个 key 在 windowMs 内再来就只累加次数、不写盘 —— 扫描器一秒撞十次也刷不爆盘。
   */
  const throttles = new Map()
  function logMerged(key, text, windowMs = 60_000) {
    const now = Date.now()
    const rec = throttles.get(key)
    if (rec && now - rec.at < windowMs) {
      rec.skipped += 1
      return false
    }
    const skipped = rec ? rec.skipped : 0
    throttles.set(key, { at: now, skipped: 0 })
    logPair(skipped > 0 ? `${text}（这段时间另有 ${skipped} 次同类，已合并）` : text)
    return true
  }

  function logPair(text) {
    try {
      if (logFile) {
        const dir = path.dirname(logFile)
        fs.mkdirSync(dir, { recursive: true })
        appendCapped(logFile, `${new Date().toISOString()} ${text}\n`)
      }
    } catch {
      /* 写不了日志不能影响配对本身 */
    }
    log.info?.(`[dsh-my-phone] pair: ${text}`)
    note('pair', text)
  }

  /**
   * 意外异常写盘：`.dsh-my-phone/error.log`。
   * 出现 500 时用不着猜——这里躺着一整条堆栈，还带着当时访问的地址。
   */
  function logError(err, where, req) {
    const text = [
      new Date().toISOString(),
      `${where} ${req?.method || '-'} ${req?.url || '-'}`,
      `from=${req?.socket?.remoteAddress || '?'} ua=${String(req?.headers?.['user-agent'] || '').slice(0, 120)}`,
      String(err?.stack || err?.message || err),
      '',
    ].join('\n')
    try {
      if (logFile) {
        const dir = path.dirname(logFile)
        fs.mkdirSync(dir, { recursive: true })
        appendCapped(path.join(dir, 'error.log'), text + '\n')
      }
    } catch {
      /* 日志写不了也不能再抛一次 */
    }
    log.error?.(`[dsh-my-phone] ${where} 处理失败`, err)
    note('error', `${where} ${firstLine(err)}`)
  }
  function noteFailure(req) {
    const key = rateKey(req)
    const now = Date.now()
    const entry = failures.get(key) ?? { count: 0, until: 0, window: now }
    if (now - entry.window > 10 * 60_000) {
      entry.count = 0
      entry.window = now
    }
    entry.count += 1
    if (entry.count >= 8) entry.until = now + 15 * 60_000
    failures.set(key, entry)
  }
  function clearFailures(req) {
    failures.delete(rateKey(req))
  }

  function currentDevice(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE]
    if (!token) return null
    const id = verifyDeviceToken(state.secret, token)
    if (!id) return null
    const device = state.devices.find((d) => d.id === id) ?? null
    if (!device) return null
    // 签名对、设备在，但没点过「信任」→ 依然不放行
    if (!device.trustedAt) return null
    return device
  }

  // 空闲计时：任何一次带凭据的访问都会刷新它，index.js 的看门狗据此自动收口
  let lastActivity = Date.now()
  const touch = () => {
    lastActivity = Date.now()
  }

  function isLoopback(req) {
    return LOOPBACK.has(req.socket.remoteAddress || '')
  }

  /**
   * 手机扫码用的完整链接：入口地址 + 一次性票据。
   * 二维码里带的是「票」而不是只有地址，扫开之后还得本人点一下「信任」。
   */
  function pairingUrl(ticket) {
    // 规则：外网开着 → 固定 https 隧道地址；外网关着 → 局域网 IP（见 index.js 的 qrBase）。
    // 没接 getQrBase 的老调用方（单元测试）退回第一个地址。
    const base = getQrBase ? getQrBase() || '' : getAddresses()[0] || ''
    if (!base || !ticket) return ''
    return `${base.replace(/\/?$/, '/')}__myphone/pair?t=${encodeURIComponent(ticket)}`
  }

  function send(res, status, body, headers = {}) {
    const buf = Buffer.from(body, 'utf8')
    res.writeHead(status, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': buf.length,
      'cache-control': 'no-store',
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...headers,
    })
    res.end(buf)
  }

  function json(res, status, obj) {
    const buf = Buffer.from(JSON.stringify(obj), 'utf8')
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': buf.length,
      'cache-control': 'no-store',
    })
    res.end(buf)
  }

  async function handleAdmin(req, res, url) {
    if (!isLoopback(req)) {
      send(res, 403, errorPage('403', '管理页只能从这台电脑本机访问'))
      return
    }
    if (url.pathname === ADMIN || url.pathname === ADMIN.slice(0, -1)) {
      send(res, 200, adminPage({ state, pairing, status: getStatus(), addresses: getAddresses() }))
      return
    }
    if (!url.pathname.startsWith(API)) {
      send(res, 404, errorPage('404', '页面不存在'))
      return
    }

    // CSRF guard: the admin UI is same-origin and sends this header; a
    // cross-site form post cannot set custom headers.
    if (req.method !== 'POST' || req.headers['x-myphone-admin'] !== '1') {
      json(res, 403, { error: 'forbidden' })
      return true
    }
    const action = url.pathname.slice(API.length)
    try {
      if (action === 'toggle') {
        const { key } = JSON.parse(await readBody(req))
        const settings = { ...state.settings }
        if (key === 'lan') settings.lanEnabled = !settings.lanEnabled
        else if (key === 'tunnel') settings.tunnelEnabled = !settings.tunnelEnabled
        else return (json(res, 400, { error: 'unknown key' }), true)
        state.patchSettings(settings)
        await onSettingsChanged?.(settings)
        json(res, 200, { ok: true })
        return true
      }
      if (action === 'autooff') {
        // v0.6：带 key 就只改那一条通道（lan / tunnel），不带就两条一起改（兼容旧页面）
        const { minutes, key } = JSON.parse(await readBody(req))
        const n = Number(minutes)
        if (!Number.isFinite(n) || n < 0 || n > 24 * 60) return (json(res, 400, { error: 'bad minutes' }), true)
        if (key === 'lan') state.patchSettings({ lanAutoOffMinutes: n })
        else if (key === 'tunnel') state.patchSettings({ tunnelAutoOffMinutes: n })
        else if (key === undefined || key === null || key === '') {
          state.patchSettings({ autoOffMinutes: n, lanAutoOffMinutes: n, tunnelAutoOffMinutes: n })
        } else return (json(res, 400, { error: 'bad key' }), true)
        json(res, 200, { ok: true })
        return true
      }
      if (action === 'pair') {
        const { code, expiresAt } = pairing.issue()
        json(res, 200, { code, expiresAt })
        return true
      }
      if (action === 'ticket') {
        const { ticket, expiresAt } = pairing.issueTicket()
        json(res, 200, { ticket, url: pairingUrl(ticket), expiresAt })
        return true
      }
      if (action === 'trust' || action === 'untrust') {
        const { id } = JSON.parse(await readBody(req))
        const device = action === 'trust' ? state.trustDevice(String(id || '')) : state.untrustDevice(String(id || ''))
        if (!device) return (json(res, 404, { error: '没有这台设备' }), true)
        logPair(`${action === 'trust' ? '信任' : '撤销信任'} ${device.label} (${device.id})`)
        json(res, 200, { ok: true, trusted: Boolean(device.trustedAt) })
        return true
      }
      if (action === 'remove') {
        const { id } = JSON.parse(await readBody(req))
        state.removeDevice(String(id || ''))
        logPair(`移除设备 ${String(id || '')}`)
        json(res, 200, { ok: true })
        return true
      }
      json(res, 404, { error: 'unknown action' })
    } catch (err) {
      json(res, 400, { error: String(err?.message ?? err) })
    }
    return true
  }

  // 免费隧道的域名每次启动都会换一个。手机上存的书签/历史里那个旧域名，
  // 现在既不是我们的隧道、也不是任何人的 —— 浏览器会先转一圈才给个 502/1033，
  // 用户很容易看成「连接被劫持了」。所以这里提前认出来，直接给一句人话。
  function currentTunnelHost() {
    try {
      const https = getAddresses().find((u) => String(u).startsWith('https://'))
      return https ? new URL(https).host : ''
    } catch {
      return ''
    }
  }

  /** 返回 true 表示已经回过包了（调用方直接 return）。 */
  function rejectStaleHost(req, res) {
    const host = String(req.headers.host || '').toLowerCase()
    if (!host.endsWith('.trycloudflare.com')) return false
    const live = currentTunnelHost().toLowerCase()
    if (!live || host === live) return false
    logPair(`拒绝 旧隧道域名 ${host}（当前 ${live}）`)
    send(res, 410, staleHostPage({ host, current: live }))
    return true
  }

  async function handlePair(req, res) {
    const ua = String(req.headers['user-agent'] || '')
    const from = req.socket.remoteAddress || '?'
    const url = new URL(req.url || '/', 'http://placeholder')
    const ticket = String(url.searchParams.get('t') || '')
    if (rejectStaleHost(req, res)) return

    // GET：扫二维码进来，先给一个「信任这台电脑」的页面。
    // 光扫到二维码什么都拿不到 —— 必须这一下点下去，才建立设备凭据。
    if (req.method === 'GET') {
      if (!ticket) {
        // 入口没有密码可输：只认扫过码、点过信任的手机。
        send(res, 401, scanPage({ device: guessDevice(ua), host: String(req.headers.host || '') }))
        return
      }
      const live = pairing.peekTicket()
      if (!live || !live.ticket || !sameTicket(live.ticket, ticket)) {
        logMerged('bad-ticket', `拒绝 二维码已失效 from=${from} ua=${ua.slice(0, 80)}`)
        send(res, 410, errorPage('410', '这个二维码已经失效了（3 分钟有效、只能用一次）。请在电脑上重新打开入口页，扫最新那个。'))
        return
      }
      // 同一台手机（同 UA）而且之前已经点过「信任这台电脑」：直接自动接上。
      // 凭据是按域名隔离的（免费隧道每次重启就换域名 → cookie 全丢），所以每次都要
      // 重新扫一次码躲不掉；但「再点一次信任」是多余的 —— 它本来就是同一台设备。
      const knownTrusted = (state.devices || []).find((d) => d.userAgent === ua && d.trustedAt)
      if (knownTrusted) {
        const shown = knownTrusted.note ? `${knownTrusted.note}（${knownTrusted.label}）` : knownTrusted.label
        logPair(`恢复连接 ${shown} (${knownTrusted.id}) from=${from}`)
        send(res, 200, trustPage({ ticket, device: shown, relink: true }))
        return
      }
      send(res, 200, trustPage({ ticket, device: guessDevice(ua) }))
      return
    }
    if (req.method !== 'POST') {
      send(res, 405, errorPage('405', '只接受 POST'))
      return
    }
    const origin = req.headers.origin
    // Origin 解析不出来（典型：手机浏览器发的 `Origin: null`）时只记一笔、不拦。
    // 拦下来会让用户永远配不上对；而这一步只下发本机凭据，跳过它没有 CSRF 收益。
    const originHost = origin ? hostOf(origin) : null
    if (origin && originHost === null) {
      logPair(`放行 来源无法解析 origin=${String(origin).slice(0, 40)} from=${from}`)
    }
    if (originHost && originHost !== req.headers.host) {
      logPair(`拒绝 来源校验失败 from=${from} origin=${origin} host=${req.headers.host}`)
      send(res, 403, errorPage('403', '来源校验失败'))
      return
    }
    if (isLocked(req)) {
      logMerged('locked', `拒绝 已被锁定 from=${from} ua=${ua.slice(0, 80)}`)
      send(res, 429, errorPage('429', '尝试次数过多，请 15 分钟后再试'))
      return
    }
    let form
    try {
      form = new URLSearchParams(await readBody(req))
    } catch {
      send(res, 413, errorPage('413', '请求过大'))
      return
    }

    const postedTicket = String(form.get('t') || url.searchParams.get('t') || '')
    const typed = String(form.get('code') || '')
    const viaTicket = Boolean(postedTicket)

    // 长期凭据通道（第二把钥匙）。
    //
    // 为什么需要：浏览器存 cookie 很不可靠 —— iOS 无痕、QQ/夸克/微信的内置浏览器
    // 常常一关就清，于是用户每打开一次都要「扫码 → 点信任」，体验像在无限重装。
    // 现在配对成功时会把这个 passKey 交给手机页面存进 localStorage；cookie 丢了，
    // 页面带着它来 POST，这里认出来就补发 cookie、直接放行。
    const pass = String(form.get('lt') || '')
    if (pass && !viaTicket) {
      const known = state.findByPassKey ? state.findByPassKey(pass) : null
      if (known && known.trustedAt && state.passKeyFresh?.(known.id) !== false) {
        clearFailures(req)
        state.touchPassKey?.(known.id)
        state.touchDevice?.(known.id)
        const again = signDeviceToken(state.secret, known.id)
        logPair(`免确认登入 ${known.label} (${known.id}) from=${from} ua=${ua.slice(0, 60)}`)
        send(res, 303, '', {
          location: '/',
          'set-cookie': `${COOKIE}=${again}; Path=/; HttpOnly; SameSite=Lax; Max-Age=15552000`,
        })
        return
      }
      if (known && known.trustedAt) {
        // 闲置太久：钥匙作废，但设备本身留着（下次扫码还是同一台，备注不会丢）
        state.clearPassKeys?.(known.id)
        logMerged('stale-pass', `拒绝 长期凭据闲置过期 ${known.label} (${known.id}) from=${from}`)
        send(
          res,
          401,
          scanPage({
            error: '这把钥匙闲置超过 30 天，已经自动作废了（安全起见）。重新扫一次二维码就好，设备和备注都还在。',
            device: guessDevice(ua),
            host: String(req.headers.host || ''),
          }),
        )
        return
      }
      logMerged('bad-pass', `拒绝 长期凭据无效 from=${from}`)
      send(
        res,
        401,
        scanPage({
          error: '这台手机记住的凭据失效了（那台设备可能被删掉或撤销了），请重新扫一次二维码。',
          device: guessDevice(ua),
          host: String(req.headers.host || ''),
        }),
      )
      return
    }
    if (!viaTicket) {
      // 页面上早就不给输码的地方了，这条通道留着只会变成暴力破解面。
      logMerged('no-ticket', `拒绝 不带二维码票据的配对请求 from=${from}`)
      send(res, 403, errorPage('403', '这个入口只接受手机扫码，不支持手输配对码。请在电脑上点「连接」里的「生成二维码」。'))
      return
    }
    const result = pairing.redeemTicket(postedTicket)

    if (!result.ok) {
      // 已经配对过的手机又点了一次「继续进入 DSH」（或页面自动提交 + 人手点，双击那一下）：
      // 票是一次性的，第二次必然「已失效」，但人本来就是想进去 —— 直接放行，别拿错误页拦他。
      const already = currentDevice(req)
      if (already) {
        logPair(`放行 已配对设备重复点信任 ${already.label} (${already.id}) from=${from}`)
        note('pair', `${already.label} 又点了一次「进入 DSH」，已直接放行`)
        res.writeHead(303, { location: '/', 'cache-control': 'no-store' })
        res.end()
        return
      }

      noteFailure(req)
      logPair(
        `失败 ${result.reason} 方式=${viaTicket ? '二维码' : '配对码'} from=${from} ua=${ua.slice(0, 80)} 剩余=${attemptsLeft(req)}`,
      )
      send(
        res,
        401,
        scanPage({
          error: viaTicket
            ? result.reason
            : '这个入口不再接受手输的配对码，请用手机相机扫电脑上的二维码。',
          device: guessDevice(ua),
          host: String(req.headers.host || ''),
        }),
      )
      return
    }
    clearFailures(req)
    const label = guessDevice(ua)
    // 同一台手机重复扫码（换隧道域名后很正常）复用原记录，不新增一台
    const device = state.upsertDevice ? state.upsertDevice(label, ua) : state.addDevice(label, ua)
    if (!device) {
      // 上限是硬限制：满了就明说，让用户去电脑上删一台，而不是偷偷挤掉别的设备
      logPair(`拒绝 设备已连满 ${state.devices.length}/${state.settings.maxDevices} from=${from}`)
      note('pair', `有一台设备想连进来，但已经连满 ${state.settings.maxDevices} 台了`)
      send(
        res,
        403,
        trustPage({
          error: `这台电脑已经连满 ${state.settings.maxDevices} 台设备了 —— 请在电脑上打开「高级」删掉一台不用的，再扫一次码。`,
          device: label,
        }),
      )
      return
    }
    state.trustDevice(device.id) // 用户刚在「信任这台电脑」页面上按了按钮
    // v1.2.2：记下这是第几次连入 —— 首次连入按 P0 提醒，重连只留 P1 记录
    const join = Number(state.bumpJoin?.(device.id)) || 1
    noteConnect({ ...device, note: device.note }, ua, join)
    const token = signDeviceToken(state.secret, device.id)
    logPair(`成功 ${label} (${device.id}) 方式=${viaTicket ? '二维码' : '配对码'} from=${from} ua=${ua.slice(0, 80)} 设备数=${state.devices.length}`)
    const next = safeNext(form.get('next'))
    // 把长期凭据捎给手机页面（插件的前端会立刻存进 localStorage 并从地址栏抹掉）
    const passKey = Array.isArray(device.passKeys) ? device.passKeys[device.passKeys.length - 1] : ''
    let location = next
    if (passKey) {
      // 放进 fragment（/#_k=…）而不是查询串：fragment 不进 Referer、不进服务器日志，
      // 浏览器历史和书签也大多不会把它当成要保留的地址。插件前端读到就立刻抹掉。
      const dest = new URL(next || '/', 'http://placeholder')
      location = `${dest.pathname}${dest.search}#_k=${passKey}`
    }
    send(res, 303, '', {
      location,
      'set-cookie': `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=15552000`,
    })
  }

  /**
   * 手机端弹窗用的只读接口。
   *
   * 手机是从入口口（隧道 / 局域网 IP）进来的，本来就拿不到绑 127.0.0.1 的管理 API，
   * 以前手机点悬浮球就是一片「入口还没打开 / 出错 404 / 按钮全关」。
   * 这里开一个**最小面**的只读口：只认这台设备的凭据，只回答
   * 「我是谁、连上没有、电脑端有几台设备、最近发生了什么」，不含开关、不含别人的凭据。
   */
  async function handleState(req, res) {
    if (rejectStaleHost(req, res)) return
    const device = currentDevice(req)
    if (!device) {
      json(res, 401, { ok: false, error: '这台设备没有有效凭据，请重新扫码' })
      return
    }
    touch()
    state.touchDevice(device.id)
    json(res, 200, {
      ok: true,
      device: {
        id: device.id,
        label: device.label,
        trusted: Boolean(device.trustedAt),
        // 以前这里写的是 addedAt（state 里叫 createdAt），手机上永远是「—」，顺手修掉
        addedAt: device.createdAt || null,
        lastSeen: device.lastSeen || null,
      },
      devices: state.devices.length,
      maxDevices: Number(state.settings.maxDevices) || 8,
      lanEnabled: Boolean(state.settings.lanEnabled),
      tunnelEnabled: Boolean(state.settings.tunnelEnabled),
      // v1.2.2：手机端也要能看消息中心（待处理 / 动态 / 技术日志），点「知道了」走 /__myphone/ack
      feed: buildFeed(),
      lanPort: adminPort,
      publicPort,
      tunnelUrl: (() => {
        try {
          const http = getAddresses().find((u) => String(u).startsWith('https://'))
          return http ? String(http).replace(/\/$/, '') : ''
        } catch {
          return ''
        }
      })(),
      events: events.slice(-8),
      // 手机端也只看得到「在等授权」，点不了（批准必须在电脑上）
      approvals: pendingApprovals(),
    alerts: pendingAlerts(),
    })
  }

  async function handleProxy(req, res) {
    if (rejectStaleHost(req, res)) return
    const device = currentDevice(req)
    if (!device) {
      const raw = parseCookies(req.headers.cookie)[COOKIE]
      const knownId = raw ? verifyDeviceToken(state.secret, raw) : null
      const known = knownId ? state.devices.find((d) => d.id === knownId) : null
      if (known && !known.trustedAt) {
        logPair(`未信任设备被拒 from=${req.socket.remoteAddress || '?'} device=${known.id}`)
        send(
          res,
          403,
          errorPage('403', `这台设备（${known.label}）还没有被信任。请重新扫一次电脑上的二维码，在手机上点「信任这台电脑」。`),
        )
        return
      }
      logMerged('anon-401', `未带有效凭据 → 401 cookie=${raw ? '有' : '无'} from=${req.socket.remoteAddress || '?'} path=${req.url}`)
      send(
        res,
        401,
        scanPage({
          device: guessDevice(String(req.headers['user-agent'] || '')),
          host: String(req.headers.host || ''),
        }),
      )
      return
    }
    touch()
    state.touchDevice(device.id)
    await forward(req, res)
  }

  async function forward(req, res, retried = false) {
    let target
    try {
      target = await session.get()
    } catch (err) {
      const reason = String(err?.message ?? err)
      logPair(`转发失败 无法连接本机 DSH：${reason}`)
      note('upstream', `连不上本机 DSH：${reason}`)
      send(res, 503, errorPage('503', `无法连接本机 DSH：${reason}`))
      return
    }
    const { base, authority, cookie } = target
    const headers = { ...req.headers }
    headers.host = authority
    if (headers.origin) headers.origin = base
    if (headers.referer) headers.referer = String(headers.referer).replace(/^https?:\/\/[^/]+/, base)
    if (headers['sec-fetch-site'] && headers['sec-fetch-site'] !== 'none') headers['sec-fetch-site'] = 'same-origin'
    delete headers['x-forwarded-for']
    delete headers['x-forwarded-host']
    const clientCookies = String(headers.cookie || '')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith(`${COOKIE}=`) && !s.startsWith('dsh-auth-'))
    headers.cookie = [cookie, ...clientCookies].join('; ')

    const url = new URL(base)
    const upstream = http.request(
      {
        host: url.hostname,
        port: url.port || 80,
        method: req.method,
        path: req.url,
        headers,
        // 不复用 keep-alive 连接：上游空闲时会把 socket 关掉，复用一条已经死掉的
        // 连接会一直挂到超时（实测公网首屏偶发 60s 卡住，重试就正常）。
        agent: false,
      },
      (up) => {
        // The official cookie expired or the host rotated it: re-exchange once
        // for idempotent requests instead of showing the phone a login wall.
        if (up.statusCode === 401 && !retried && req.method === 'GET') {
          up.resume()
          session.invalidate()
          forward(req, res, true)
          return
        }
        const outHeaders = { ...up.headers }
        delete outHeaders['set-cookie']
        res.writeHead(up.statusCode || 502, outHeaders)
        up.pipe(res)
      },
    )
    // 上游卡住时不要陪它一起卡：超时就掐断，让下面的 error 分支重试或报 502
    // 这是 socket 空闲超时，会一直挂到响应结束。而 DSH 的 turn 是流式的：
    // 工具跑着、等你点授权（90 秒）时上游可能几十秒不吐字节，超时会把手机上的流生生截断。
    // 所以只给「连上/等首字节」计时，一旦拿到响应头就撤掉。
    upstream.setTimeout(25_000, () => upstream.destroy(new Error('上游 25 秒无响应')))
    upstream.on('response', () => upstream.setTimeout(0))
    upstream.on('error', (err) => {
      if (!res.headersSent) {
        if (!retried && req.method === 'GET') {
          forward(req, res, true)
          return
        }
        send(res, 502, errorPage('502', `上游连接失败：${err?.message ?? err}`))
      } else {
        res.destroy()
      }
    })
    // 手机切走、断网、锁屏时这几个流都会报错；不接住就是 uncaughtException。
    req.on('error', () => upstream.destroy())
    res.on('error', () => upstream.destroy())
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  }

  async function handleUpgrade(req, socket, head) {
    // 只靠 WS 活动的手机也要算「有人在用」，否则空闲看门狗会把入口收掉
    socket.on('error', () => socket.destroy())
    const device = currentDevice(req)
    if (!device) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    let target = session.peek()
    if (!target) {
      try {
        target = await session.get()
      } catch {
        target = null
      }
    }
    if (!target) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    touch()
    state.touchDevice(device.id)
    const [host, port] = target.authority.split(':')
    const up = net.connect(Number(port), host, () => {
      const headers = []
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const key = req.rawHeaders[i]
        const value = req.rawHeaders[i + 1]
        const lower = key.toLowerCase()
        if (lower === 'host') headers.push(`Host: ${target.authority}`)
        else if (lower === 'origin') headers.push(`Origin: ${target.base}`)
        else if (lower === 'cookie') headers.push(`Cookie: ${target.cookie}`)
        else headers.push(`${key}: ${value}`)
      }
      if (!headers.some((h) => h.toLowerCase().startsWith('cookie:'))) headers.push(`Cookie: ${target.cookie}`)
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n`)
      if (head?.length) up.write(head)
      up.pipe(socket)
      socket.pipe(up)
    })
    // 上游不回包时两个 socket + 两个 fd 会一直挂着，握手阶段必须带超时
    up.setTimeout(15_000, () => {
      up.destroy()
      socket.destroy()
    })
    up.on('error', () => socket.destroy())
    up.on('close', () => socket.destroy())
    socket.on('error', () => up.destroy())
    socket.on('close', () => up.destroy())
  }

  // Two listeners, deliberately separated:
  //  - adminServer binds 127.0.0.1 only, so the settings page is never
  //    reachable from the network even while the public side is open;
  //  - publicServer binds 0.0.0.0 and exists only while the user has an
  //    entry point enabled. Nothing listens publicly when everything is off.
  const adminServer = http.createServer(async (req, res) => {
    try {
      await handleAdmin(req, res, new URL(req.url || '/', 'http://placeholder'))
    } catch (err) {
      logError(err, '管理页', req)
      if (!res.headersSent) send(res, 500, errorPage('500', `内部错误：${firstLine(err)}`))
      else res.destroy()
    }
  })

  const publicServer = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://placeholder')
      if (url.pathname === '/__myphone/pair') {
        await handlePair(req, res)
        return
      }
      // 网络自检：证书/打不开这类问题只能在手机上跑探测，页面本身不读任何凭据
      if (url.pathname === '/__myphone/diag' || url.pathname === '/__myphone/diag/') {
        const list = getAddresses?.() || []
        send(
          res,
          200,
          diagPage({
            host: req.headers.host || '',
            tunnelUrl: list.find((a) => String(a).startsWith('https://')) || '',
            lanUrl: list.find((a) => String(a).startsWith('http://')) || '',
          }),
        )
        return
      }
      // 校时：手机本机时间与服务器时间对一下，差太多就是「证书未生效/已过期」的元凶
      if (url.pathname === '/__myphone/diag/time') {
        json(res, 200, { now: Date.now() })
        return
      }
      if (url.pathname === '/__myphone/diag/report' && req.method === 'POST') {
        try {
          const raw = await readBody(req, 8192, 4000)
          const info = JSON.parse(String(raw || '{}'))
          lastDiag = { at: Date.now(), data: info }
          const probes = Array.isArray(info.probes) ? info.probes : []
          const brief = probes.map((x) => `${x.label || '?'}=${x.ok ? '通' : '不通'}`).join(' ')
          const secs = Math.round(Number(info.skewMs || 0) / 1000)
          const page = String((info.env && info.env.url) || '').slice(0, 60)
          logMerged('diag', `自检 偏差=${secs}s ${brief} 页面=${page}`)
        } catch {
          /* 自检上报失败不影响任何功能 */
        }
        res.writeHead(204, { 'cache-control': 'no-store' })
        res.end()
        return
      }
      // 手机端弹窗的只读数据（要设备凭据），必须放在下面那条「/__myphone/ 一律 404」之前
      if (url.pathname === '/__myphone/state') {
        await handleState(req, res)
        return
      }
      // 手机点「知道了」：只标已读（不代答授权、不改开关），凭据 + 自定义头双条件防 CSRF
      if (url.pathname === '/__myphone/ack' && req.method === 'POST') {
        const me = currentDevice(req)
        if (!me) return json(res, 401, { ok: false, error: '这台设备没有有效凭据，请重新扫码' })
        if (req.headers['x-myphone-phone'] !== '1') return json(res, 403, { ok: false, error: 'forbidden' })
        try {
          const body = JSON.parse(String((await readBody(req, 4096, 8000)) || '{}'))
          let done = false
          if (body.ack !== undefined && body.ack !== null) done = ackApproval(body.ack) || done
          if (body.notice !== undefined && body.notice !== null) done = ackNotice(body.notice) || done
          const f = buildFeed()
          json(res, 200, { ok: done, pendingCount: f.pendingCount, unread: f.unread })
        } catch (err) {
          json(res, 400, { ok: false, error: firstLine(err) })
        }
        return
      }
      // 前端自检信标：界面走到哪一步了（模块加载 / 注册插槽 / 悬浮球挂载）报一声回来。
      // 只为了排查「手机上悬浮球不出现」这种看不见的问题，不含凭据、不需要登录，同类 60 秒合并成一行。
      if (url.pathname === '/__myphone/client-report' && req.method === 'POST') {
        try {
          const raw = await readBody(req, 2048, 4000)
          const info = JSON.parse(String(raw || '{}'))
          const stage = String(info.stage || '').slice(0, 24)
          const detail = String(info.detail || '').slice(0, 160)
          logMerged(
            `client-${stage}`,
            `前端 stage=${stage} 视口=${info.w}x${info.h} 屏=${info.dpr} detail=${detail}`,
          )
        } catch {
          /* 信标失败不影响任何功能 */
        }
        res.writeHead(204, { 'cache-control': 'no-store' })
        res.end()
        return
      }
      // 图标是公开资源：手机端悬浮球也要显示同一个新图标，不能只挂在 127.0.0.1 的管理口上
      if (
        url.pathname === '/__myphone/icon.png' ||
        url.pathname === '/__myphone/icon-96.png' ||
        url.pathname === '/__myphone/icon-fab.png'
      ) {
        const file = url.pathname.endsWith('96.png')
          ? ICON96_FILE
          : url.pathname.endsWith('fab.png')
            ? ICON_FAB_FILE
            : ICON_FILE
        try {
          const bytes = fs.readFileSync(file)
          res.writeHead(200, {
            'content-type': 'image/png',
            'content-length': bytes.length,
            'cache-control': 'public, max-age=86400',
          })
          res.end(bytes)
        } catch {
          send(res, 404, errorPage('404', '图标文件缺失'))
        }
        return
      }
      if (url.pathname.startsWith(ADMIN)) {
        send(res, 404, errorPage('404', '页面不存在'))
        return
      }
      await handleProxy(req, res)
    } catch (err) {
      logError(err, '入口', req)
      if (!res.headersSent) send(res, 500, errorPage('500', `内部错误：${firstLine(err)}`))
      else res.destroy()
    }
  })
  publicServer.on('upgrade', handleUpgrade)

  const listenOn = (srv, port, host) =>
    new Promise((resolve, reject) => {
      const onError = (err) => {
        srv.removeListener('listening', onListening)
        reject(err)
      }
      const onListening = () => {
        srv.removeListener('error', onError)
        // 常驻兜底：EMFILE、accept 失败之类的 server 级错误没有监听时，
        // Node 会把它抛成 uncaughtException，把整个 DSH 进程带走。
        srv.on('error', (err) => {
          log.error?.('[dsh-my-phone] 监听器错误：', err?.message ?? err)
          note('error', `监听器错误：${err?.message ?? err}`)
        })
        resolve(srv.address())
      }
      srv.once('error', onError)
      srv.once('listening', onListening)
      srv.listen(port, host)
    })

  /**
   * 关监听器最容易踩的坑：srv.close() 要等所有连接自己结束才回调。
   * 一个 keep-alive / 半开请求就能让回调永不触发 → sync() 的 finally 不跑 →
   * syncing 永久 true → 之后每次 sync() 都在门口直接返回，
   * 于是「入口关不掉也再打不开」，而界面还显示已关闭。
   */
  const closeServer = (srv) =>
    new Promise((resolve) => {
      if (!srv.listening) return resolve()
      let done = false
      const finish = () => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        try {
          srv.closeAllConnections?.()
        } catch {
          /* 老版本 node 没有这个方法 */
        }
        finish()
      }, 3000)
      timer.unref?.()
      try {
        srv.close(() => finish())
        srv.closeIdleConnections?.()
      } catch {
        finish()
      }
    })

  /**
   * 端口被占就往后找：用户要求「不冲突就默认全开」，那冲突时也不能一声不响地挂掉。
   * 只对 EADDRINUSE / EACCES 退让，其它错误照旧往上抛。
   */
  const listenWithFallback = async (srv, port, host) => {
    let lastError = null
    for (let i = 0; i < 12; i += 1) {
      try {
        const addr = await listenOn(srv, port + i, host)
        if (i > 0) log.info?.(`[dsh-my-phone] 端口 ${port} 被占用，已改用 ${addr.port}`)
        return addr
      } catch (err) {
        lastError = err
        if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') throw err
      }
    }
    throw lastError ?? new Error('没有可用端口')
  }

  let adminPort = null
  let publicPort = null

  /**
   * 消息中心：把三件不同性质的事分开，别混成一条流水账。
   *
   * - pending：要人判断的（等授权），点一下才算看过
   * - human：人需要知道的（有人连进来、入口自动关了、地址变了）
   * - tech：机器层面的噪音（匿名扫描 401、上游 503、异常），同类合并计数
   *
   * 之前这三样都塞在一个 events 数组里，结果「请求权限」和「扫描 401」长得一样，
   * 用户看到就问「这里怎么会有权限记录」。
   */
  // 人要看的：入口/地址类 + 会话层面的「失败 / 重试 / 模型不可用」（v1.2.3）
  const HUMAN_KINDS = new Set(['tunnel', 'autooff', 'entry', 'turnfail', 'retry', 'model', 'longrun', 'ctx', 'turnok'])
  // 其中这些是「值得留意」的 P1（橙色 + 感叹号），其余人工动态是 P2
  const WARN_KINDS = new Set(['turnfail', 'retry', 'model', 'longrun', 'ctx'])
  function buildFeed() {
    // level：0 = P0 需要你（琥珀）/ 1 = P1 留意（橙）/ 2 = P2 普通（蓝绿）
    const pending = pendingApprovals().map((a) => ({
      id: `a${a.seq}`,
      at: a.at,
      text: a.text,
      name: a.name,
      count: a.count,
      seq: a.seq,
      level: 0,
      ackable: true,
    }))
    const human = []
    for (const n of notices)
      human.push({
        id: `j${n.seq}`,
        at: n.at,
        kind: 'join',
        text: `${n.label}连进来了`,
        deviceId: n.id,
        seq: n.seq,
        // 首次连入 = 新设备（P0）；同一台再连 = 只是记录（P1）
        level: (Number(n.join) || 1) <= 1 ? 0 : 1,
        ackable: true,
      })
    for (const e of events)
      if (HUMAN_KINDS.has(e.kind))
        human.push({
          id: `e${e.seq}`,
          at: e.at,
          kind: e.kind,
          text: e.text,
          level: WARN_KINDS.has(e.kind) ? 1 : 2,
        })
    human.sort((x, y) => y.at - x.at)
    // 技术日志按 kind 合并：一次域外扫描能刷出几十条 401，逐条列没意义
    const map = new Map()
    for (const e of events) {
      if (HUMAN_KINDS.has(e.kind)) continue
      const cur = map.get(e.kind) || { kind: e.kind, count: 0, at: 0, text: '' }
      cur.count += 1
      if (e.at >= cur.at) {
        cur.at = e.at
        cur.text = e.text
      }
      map.set(e.kind, cur)
    }
    const tech = Array.from(map.values()).sort((x, y) => y.at - x.at)
    const techRaw = events
      .filter((e) => !HUMAN_KINDS.has(e.kind))
      .slice(-40)
      .reverse()
    const humanSorted = human.slice(0, 40)
    // 红点口径：待处理授权 + **还没点掉**的新设备（已收掉的连接通知不算待处理）
    const newDevices = unreadNotices().filter((n) => (Number(n.join) || 1) <= 1).length
    const pendingCount = pending.length + newDevices
    return {
      pending,
      human: humanSorted,
      tech,
      techRaw,
      techCount: techRaw.length,
      unread: unreadNotices().length,
      pendingCount,
    }
  }

  return {
    pairing,
    lastDiag: () => lastDiag,
    /** 最近一次带凭据访问的时间戳，供空闲自动收口使用 */
    get lastActivity() {
      return lastActivity
    },
    touch,
    /** 给某个票据生成扫码链接 */
    pairingUrl,
    /** 最近的配对/错误事件，给面板做「排查」用 */
    recentEvents: () => events.slice(),
    feed: () => buildFeed(),
    onChange,
    /** 别人主动记一笔事件（隧道地址变了、入口被空闲收回……） */
    noteEvent: (kind, text) => note(kind, text),
    /** 待处理的「有人连进来了」通知（红点 + 弹窗顶部卡片） */
    pendingNotices: () => unreadNotices().slice(),
    unreadCount: () => unreadNotices().length,
    markNoticesRead,
    noteTurn,
    pendingTurns,
    noteApproval,
    noteConnect,
    ackNotice,
    bubbledMuted,
    pendingApprovals,
    ackApproval,
    decideApproval,
    noteAlert,
    pendingAlerts,
    dismissAlert,
    clearAlertRef,
    lastActiveDevice,
    /** 入口地址上次变更的时间戳（0 = 没变过） */
    get addressChangedAt() {
      return addressChangedAt
    },
    /** 清空面板「排查」里的内存事件 + 两个日志文件（各备份一份 .1） */
    clearLogs,
    clearEvents: clearLogs,
    /** 立刻发一张新票（面板点开时用） */
    issueTicket: () => pairing.issueTicket(),
    getStatus,
    get adminPort() {
      return adminPort
    },
    get publicPort() {
      return publicPort
    },
    setSettingsHandler(fn) {
      onSettingsChanged = fn
    },
    async startAdmin(port) {
      if (adminPort) return adminPort
      const addr = await listenWithFallback(adminServer, port, '127.0.0.1')
      adminPort = addr.port
      return adminPort
    },
    async startPublic(port, host = '0.0.0.0') {
      if (publicPort) return publicPort
      const addr = await listenWithFallback(publicServer, port, host)
      publicPort = addr.port
      return publicPort
    },
    async stopPublic() {
      if (!publicPort) return
      await closeServer(publicServer)
      publicPort = null
    },
    async close() {
      pairing.clear()
      await closeServer(publicServer)
      await closeServer(adminServer)
      adminPort = null
      publicPort = null
    },
  }
}

function guessDevice(ua) {
  const s = String(ua)
  if (/iPhone/i.test(s)) return 'iPhone'
  if (/iPad/i.test(s)) return 'iPad'
  if (/Android/i.test(s)) return 'Android 设备'
  if (/Macintosh/i.test(s)) return 'Mac'
  if (/Windows/i.test(s)) return 'Windows 电脑'
  return '未知设备'
}
