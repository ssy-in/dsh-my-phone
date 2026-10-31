import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MyPhoneState } from './state.js'
import { createGate } from './gate.js'
import { createSession } from './session.js'
import { TunnelManager } from './tunnel.js'
import { registerPanel } from './panel.js'
import { describeMode } from './modes.js'

export const name = 'dsh-my-phone'
/**
 * 两个服务都必须写进 inject。
 *
 * `webServer` 用来拿端口、挂路由；`connection` 是官方的鉴权入口
 * （`ctx.connection.authenticatedUrl`）。
 *
 * 血的教训：cordis 的规则是「没在 inject 里声明过的服务，读 `ctx.xxx` 会直接抛
 * `cannot get property "xxx" without inject`」。之前为了规避「apply 不执行」
 * 把 connection 从 inject 里去掉，结果配对能成功、但每个代理请求都 503 —— 就是这个。
 */

const log = {
  info: (...args) => console.log(...args),
  error: (...args) => console.error(...args),
}

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

/** 只取主机名，事件里没必要写全 URL。 */
function hostOf(url) {
  try {
    return new URL(String(url)).host
  } catch {
    return String(url || '').slice(0, 60)
  }
}

/**
 * 加载痕迹：模块被 import 时写一行，apply 跑起来时再写一行。
 * 出问题时看 `.dsh-my-phone/boot.log` 就能分清「宿主根本没用这个包」和
 * 「包加载了但 apply 没被调用」（后者通常是 inject 的服务没就位）。
 */
function markBoot(stage) {
  try {
    const dir = path.join(dshHome(), '.dsh-my-phone')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(
      path.join(dir, 'boot.log'),
      `${new Date().toISOString()} ${stage} pid=${process.pid} node=${process.versions.node}\n`,
    )
  } catch {
    /* 诊断失败不影响插件本身 */
  }
}

markBoot('imported')

/**
 * 挑一个手机真的能连上的地址。
 * 虚拟网卡（Hamachi/Radmin/VPN）经常排在前面，所以按「像不像家里 Wi-Fi」排序。
 */
function lanAddress() {
  const candidates = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family !== 'IPv4' || ni.internal) continue
      const ip = ni.address
      if (ip.startsWith('169.254.')) continue // 自动私有地址，连不通
      let score = 4
      if (ip.startsWith('192.168.')) score = 0
      else if (ip.startsWith('10.')) score = 1
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) score = 2
      candidates.push({ ip, score })
    }
  }
  candidates.sort((a, b) => a.score - b.score)
  return candidates[0]?.ip ?? '127.0.0.1'
}

function applyBody(ctx) {
  markBoot('applied')
  const state = new MyPhoneState(path.join(dshHome(), '.dsh-my-phone'))
  const session = createSession({ ctx })
  const tunnel = new TunnelManager({ log })

  let gate
  const addresses = () => {
    const out = []
    const s = state.settings
    // 外网地址排前面：手机在不在同一个 Wi-Fi 都能用，扫码就不用先想「我现在在哪」
    if (s.tunnelEnabled && tunnel.url) out.push(`${tunnel.url}/`)
    if (s.lanEnabled && gate?.publicPort) out.push(`http://${lanAddress()}:${gate.publicPort}/`)
    if (!out.length && gate?.publicPort) out.push(`http://${lanAddress()}:${gate.publicPort}/`)
    return out
  }

  /**
   * 二维码用哪条地址（用户定的规则，写死在这儿，免得以后又漂）：
   *   外网开关开着  → 固定给 https 隧道地址（手机在不在同一个 Wi-Fi 都能扫得动）；
   *   外网开关关着  → 给局域网 IP 地址。
   * 外网开着但隧道还没起来时返回空串 —— 前端会说「入口还在准备」，绝不悄悄换成 IP，
   * 否则用户以为配好了，拿出去却连不上。
   */
  const qrBase = () => {
    const s = state.settings
    if (s.tunnelEnabled) return tunnel.url ? `${String(tunnel.url).replace(/\/$/, '')}/` : ''
    return gate?.publicPort ? `http://${lanAddress()}:${gate.publicPort}/` : ''
  }

  // 会话 id → 标题：授权请求来的那一刻会话常常还没名字，
  // 这里随 session/event 一直刷新，快照时再查一次，才能显示「自己的会话名」。
  const liveSessionTitles = new Map()
  gate = createGate({
    state,
    session,
    log,
    getAddresses: addresses,
    getQrBase: qrBase,
    getStatus: () => ({ tunnel: tunnel.status }),
    logFile: path.join(dshHome(), '.dsh-my-phone', 'pair.log'),
    resolveTitle: (sid) => liveSessionTitles.get(String(sid || '')) || '',
  })

  let downloading = null
  /**
   * cloudflared 只在真的需要外网通道时才准备，而且整个过程有日志、有失败原因。
   * 下载慢（五十多 MB）但不阻塞启动：先让局域网能用，隧道好了再把地址换上去。
   */
  async function ensureCloudflared() {
    const current = state.settings.cloudflaredPath
    if (current && fs.existsSync(current)) return current
    if (downloading) return downloading
    const dir = path.join(dshHome(), '.dsh-my-phone')
    downloading = (async () => {
      try {
        log.info('[dsh-my-phone] 正在准备 cloudflared（首次约 53MB，只下一次）…')
        let lastTick = -1
        const dest = await tunnel.download(dir, (p) => {
          const pct = Math.round(p * 100)
          if (pct >= lastTick + 20) {
            lastTick = pct
            log.info(`[dsh-my-phone] cloudflared 下载 ${pct}%`)
          }
        })
        state.patchSettings({ cloudflaredPath: dest })
        log.info(`[dsh-my-phone] cloudflared 就绪：${dest}`)
        return dest
      } catch (err) {
        log.error(`[dsh-my-phone] cloudflared 下载失败：${err?.message ?? err}`)
        return ''
      } finally {
        downloading = null
      }
    })()
    return downloading
  }

  let syncing = false
  let syncPending = false
  /**
   * 单飞 + 补跑：面板每 5 秒轮询、用户连点开关、空闲收口三者很容易撞在一起。
   * 以前撞上时后一次直接 return —— 设置已经落盘，监听器却没跟着动，
   * 于是出现「设置是关的、入口还开着」。现在把这次请求记成 pending，跑完再来一轮。
   */
  async function sync() {
    if (syncing) {
      syncPending = true
      return
    }
    syncing = true
    try {
      const s = state.settings
      // 管理口和入口口绝不能是同一个端口号：Windows 允许 127.0.0.1:8081 和 0.0.0.0:8081 同时监听，
      // 但回环流量永远先命中最具体的那个 —— cloudflared 转 127.0.0.1:8081 会打到「管理口」上，
      // 那边没有 /__myphone/pair，于是扫码直接 404。
      let wantPublic = Number(s.publicPort) || 8081
      if (wantPublic === Number(s.lanPort)) wantPublic += 1
      await gate.startAdmin(s.lanPort)
      if (s.lanEnabled || s.tunnelEnabled) await gate.startPublic(wantPublic)
      else await gate.stopPublic()
      // 兜底：万一两边回退到了同一个号，把入口口再往后挪一格
      if (gate.publicPort && gate.adminPort && gate.publicPort === gate.adminPort) {
        await gate.stopPublic()
        await gate.startPublic(gate.adminPort + 1)
      }

      // 端口被占用时 gate 会自动往后找：把真实端口写回去，二维码和地址才是对的
      if (gate.adminPort !== s.lanPort || (gate.publicPort ?? s.publicPort) !== s.publicPort) {
        state.patchSettings({
          lanPort: gate.adminPort ?? s.lanPort,
          publicPort: gate.publicPort ?? s.publicPort,
        })
      }

      if (s.tunnelEnabled && gate.publicPort) {
        const binary = await ensureCloudflared()
        if (binary) {
          const before = state.settings.lastTunnelUrl || ''
          await tunnel.start({ target: `http://127.0.0.1:${gate.publicPort}`, binary })
          // 快速隧道的域名是「隧道一起就随机分配」的：重启 DSH、关掉再开外网、cloudflared 崩了重来，
          // 都会换一个新的。手机存的书签因此会失效 —— 记下上一次的地址，变了就在面板里说清楚，
          // 免得用户以为是设备被踢了。
          const now = String(tunnel.url || '').replace(/\/$/, '')
          if (now && now !== before) {
            if (before) {
              gate.noteEvent?.('tunnel', `入口地址已变更：${hostOf(before)} → ${hostOf(now)}（手机重新扫一次就行，不用重新信任）`)
            }
            state.patchSettings({ lastTunnelUrl: now })
          }
        } else {
          log.error('[dsh-my-phone] 外网通道没准备好，暂时只有局域网地址可用')
        }
      } else {
        tunnel.stop()
      }
    } catch (err) {
      log.error('[dsh-my-phone] 应用设置失败', err)
    } finally {
      syncing = false
      if (syncPending) {
        syncPending = false
        sync().catch((err) => log.error('[dsh-my-phone] 补跑设置失败', err))
      }
    }
  }
  gate.setSettingsHandler(sync)

  // 空闲自动收口：开着入口却没人用，到点就自己关掉。
  // 这比"记得手动关"可靠 —— 忘了关正是这个插件最大的风险。
  // v0.6 起两条通道分开计时：局域网闲了只关局域网，不会顺手把出门要用的隧道也关掉。
  // 一轮跑过 5 分钟还没结束 → 提醒一次（这是最接近「卡住了」的信号）
  const longRunTimer = setInterval(() => {
    try {
      const now = Date.now()
      for (const [sid, info] of runningTurns) {
        if (info.warned) continue
        if (now - info.at < 5 * 60_000) continue
        info.warned = true
        const mins = Math.round((now - info.at) / 60_000)
        gate.noteAlert?.('warn', `【${info.title}】 已经跑了 ${mins} 分钟`, { ref: `long:${sid}` })
        gate.noteEvent?.('longrun', `【${info.title}】 一轮已经跑了 ${mins} 分钟还没结束`)
      }
    } catch {
      /* 提醒失败不影响对话 */
    }
  }, 60_000)

  const watchdog = setInterval(() => {
    const s = state.settings
    const idleMs = Date.now() - gate.lastActivity
    const idleMin = Math.round(idleMs / 60_000)
    const due = []
    if (s.lanEnabled && Number(s.lanAutoOffMinutes || 0) > 0 && idleMs >= Number(s.lanAutoOffMinutes) * 60_000) {
      due.push(['lanEnabled', 'lanAutoOffMinutes', '局域网入口'])
    }
    if (s.tunnelEnabled && Number(s.tunnelAutoOffMinutes || 0) > 0 && idleMs >= Number(s.tunnelAutoOffMinutes) * 60_000) {
      due.push(['tunnelEnabled', 'tunnelAutoOffMinutes', '外网入口'])
    }
    if (!due.length) return
    log.info(`[dsh-my-phone] 空闲 ${idleMin} 分钟，自动收回：${due.map((d) => d[2]).join('、')}`)
    // 别让它变成一个谜：面板「排查日志」里能看到是谁把入口关了
    gate.noteEvent?.(
      'autooff',
      `${due.map((d) => d[2]).join('、')}空闲 ${idleMin} 分钟，已自动关闭（点「高级」可以重新打开）`,
    )
    const patch = {}
    for (const [flag] of due) patch[flag] = false
    state.patchSettings(patch)
    void sync()
  }, 30_000)
  watchdog.unref?.()

  // 外网通道看护：cloudflared 会被网络掐断、被 Cloudflare 回收、自己崩。
  // 以前断了就只是 phase 变 error，人得自己发现并手动关一下开关再开；
  // 现在后台每 10 秒看一眼，断了就退避重连（5s→10s→20s→40s→60s），
  // 连上了在排查日志里写明「已重新连上」，地址变了也会说明。
  let tunnelRetryAt = 0
  let tunnelRetryCount = 0
  let tunnelRestarting = false
  const tunnelGuard = setInterval(async () => {
    const s = state.settings
    if (!s.tunnelEnabled || !gate.publicPort) {
      tunnelRetryCount = 0
      tunnelRetryAt = 0
      return
    }
    const phase = tunnel.status.phase
    if (phase === 'running' || phase === 'starting' || tunnelRestarting) {
      tunnelRetryCount = 0
      tunnelRetryAt = 0
      return
    }
    if (Date.now() < tunnelRetryAt) return
    tunnelRestarting = true
    try {
      tunnelRetryCount += 1
      tunnelRetryAt = Date.now() + Math.min(60_000, 5_000 * 2 ** (tunnelRetryCount - 1))
      gate.noteEvent?.('tunnel', `外网通道断了（${phase}），正在第 ${tunnelRetryCount} 次重连…`)
      log.warn?.(`[dsh-my-phone] 外网通道断了（${phase}），第 ${tunnelRetryCount} 次重连`)
      await sync()
      if (tunnel.status.phase === 'running') {
        gate.noteEvent?.('tunnel', `外网通道已重新连上：${hostOf(tunnel.url)}（地址换过的话手机重新扫一次，不用重新信任）`)
        tunnelRetryCount = 0
        tunnelRetryAt = 0
      }
    } catch (err) {
      log.error('[dsh-my-phone] 外网通道重连失败', err)
    } finally {
      tunnelRestarting = false
    }
  }, 10_000)
  tunnelGuard.unref?.()

  const adminUrl = `http://127.0.0.1:${state.settings.lanPort}/__myphone/`
  log.info(`[dsh-my-phone] 设置页：${adminUrl}（仅本机可访问）`)

  // 手机那边跑完一轮 → 记一条，前端气泡报个信。
  // 宿主用 cordis 事件总线，会话事件统一挂在 session/event 上，一轮结束是 turn/end。
  const clockOf = (ms) => {
    const d = new Date(ms)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  // 会话名：宿主自己的展示逻辑是「标题 → 工作区目录名 → 会话 id」（displayTitleOf），
  // 没起标题的会话 session.title 是空的，只读 title 就会得到「某个会话」这种废话，
  // 所以这里照抄宿主那条回退链。
  const baseOf = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || ''
  // v1.2.1：**权威来源**是宿主的 `sessionTitle` 服务。
  // 它读的是「折叠后的最新标题」，对我们启动之前就起好名的会话同样有效；
  // 只监听 session/title 事件只能拿到启动之后新增的标题，于是没改过名的会话
  // 全都回退成 session.id —— 这就是用户看到的「会话名全是 sessio…」。
  const titleFromService = (session) => {
    try {
      const svc = typeof ctx.get === 'function' ? ctx.get('sessionTitle') : null
      if (!svc || typeof svc.get !== 'function' || !session) return ''
      const snap = svc.get(session)
      const ti = typeof snap === 'string' ? snap : snap && (snap.title || snap.text)
      return String(ti == null ? '' : ti).trim().slice(0, 120)
    } catch {
      return ''
    }
  }
  const sessionTitleOf = (session) => {
    const svc = titleFromService(session)
    if (svc) return svc
    const direct = String(
      (session && (session.title || session.name)) ||
        (session && session.header && session.header.title) ||
        (session && session.meta && session.meta.title) ||
        (session && session.summary && session.summary.title) ||
        (session && session.label) ||
        '',
    ).trim()
    if (direct) return direct
    const base = baseOf(session && session.cwd)
    // 目录名也不是好名字：'sessions'、'.dsh' 这类一律当没有
    if (base && !/^(sessions?|\.dsh|home|root|workspace|tmp)$/i.test(base)) return base
    return '未命名会话'
  }
  // 正在跑的轮次：turn/start 记下，turn/end 清掉；超过 5 分钟提醒一次
  const runningTurns = new Map()
  const ctxWarned = new Map() // sid -> 已经提醒到的那一档（0.8/0.9/0.95）
  const toolLoggedAt = new Map()

  const contextRatio = (session) => {
    try {
      const meter = ctx.get('tokenMeter')
      const size = session && session.requestContext && session.requestContext()?.contextWindow
      const used = meter && session && meter.measure ? meter.measure(session)?.totalTokens : 0
      if (!size || !used) return 0
      return Math.min(1, used / size)
    } catch {
      return 0
    }
  }

  const disposeTurnWatch = (() => {
    try {
      // 每个会话「现在是什么模式」，以及上一次还在动的会话是谁 ——
      // 用来在**切换会话且模式不一样**时提醒一句（用户会话多，不想自己回头翻）。
      const modeOf = new Map()
      let lastSid = ''
      const modeLabel = (m) => {
        const v = String(m || '').toLowerCase()
        if (v === 'plan') return '计划模式'
        if (v === 'agent' || v === 'normal' || v === 'default' || v === 'build') return '普通模式'
        return v ? `${v} 模式` : ''
      }
      // 模式事件的枚举翻译在 ./modes.js（可单测），这里只负责发通知。
      const modeFromSession = (s) =>
        String(
          (s && (s.mode || s.planMode)) ||
            (s && s.header && s.header.mode) ||
            (s && s.meta && s.meta.mode) ||
            '',
        )
      // 同一会话的重试提醒节流（30 秒一次就够，免得刷屏）
      const retryAt = new Map()
      const off = ctx.on('session/event', (session, event) => {
        try {
          if (!event) return
          const sid = String((session && session.id) || '')
          // v1.8.29（真 bug 修复）：宿主的事件对象是 { seq, type, data } ——
          // **所有业务字段都在 event.data 下面，不在顶层**。这里原来通读 event.xxx，
          // 于是 id / toolName / outcome / reason / active 全是 undefined：
          //   · approval/asked 的行 id 永远空串 → approval/decided 匹配不上 → 「等授权」永不消失
          //   · toolName 永远空 → 没有「正在用 Read」，授权也没有工具名
          //   · turn/end 的 reason 永远空 → 失败被当成正常完成
          //   · plan/mode 的 active 永远 undefined → 计划模式永远判成 agent
          // 统一走 ev（= event.data），取不到再退回顶层（单测里直接喂顶层字段）。
          const ev = (event && event.data) || event || {}
          const evf = (k) => (ev[k] !== undefined ? ev[k] : event[k])
          // v1.2.1：会话标题本身就是一条日志事件（session/title { title, source }），
          // 拿它的事件流比轮询服务更即时，改完名下一次提醒就是新名字
          let title = ''
          if (event.type === 'session/title') {
            const ti = String(evf('title') || '').trim()
            if (ti) title = ti.slice(0, 120)
          }
          if (!title) title = sessionTitleOf(session)
          if (sid) liveSessionTitles.set(sid, title)
          const callId = String(evf('callId') || evf('id') || '')
          // 模式记录：会话对象上带着就用它；改动由 plan/mode 事件更新
          const fromSessionMode = modeFromSession(session)
          if (sid && fromSessionMode) modeOf.set(sid, fromSessionMode)
          if (sid && event.type === 'plan/mode') {
            modeOf.set(sid, evf('active') ? 'plan' : 'agent')
          }
          if (sid && lastSid && sid !== lastSid) {
            const before = modeOf.get(lastSid) || ''
            const now2 = modeOf.get(sid) || ''
            if (before && now2 && before !== now2) {
              gate.noteAlert?.('plan', `切换到了 【${title}】，当前是${modeLabel(now2)}`, { ref: `mode:${sid}` })
              gate.noteEvent?.('plan', `会话切换：【${title}】 是 ${now2} 模式（上一个会话是 ${before}）`)
            }
          }
          if (sid) lastSid = sid
          if (event.type === 'turn/start') {
            runningTurns.set(sid, { at: Date.now(), title, warned: false })
            return
          }
          if (event.type === 'turn/end') {
            runningTurns.delete(sid)
            // v1.8.29：这一轮结束了，它之前报的「等授权」一定已经被答掉了（宿主答完才继续跑），
            // 一次清干净，否则「等授权」会越堆越多、红点归不了零。
            gate.clearApprovalsForSession?.(sid)
            const reason = evf('reason')
            const err = evf('error')
            const bad = Boolean((reason && reason.kind && reason.kind !== 'completed') || err)
            if (bad) {
              const why = String((reason && reason.kind) || err || '未知原因')
              // v1.2.3：会话失败也弹气泡（P1 橙），消息中心同样记一条 P1
              gate.noteAlert?.('warn', `【${title}】 这一轮失败了`, { ref: `turnfail:${sid}` })
              gate.noteEvent?.('turnfail', `【${title}】 这一轮失败：${why}`)
            }
            // 上下文用到 80% / 90% / 95% 时各提醒一次（压缩后会重置）
            const ratio = contextRatio(session)
            const bucket = ratio >= 0.95 ? 0.95 : ratio >= 0.9 ? 0.9 : ratio >= 0.8 ? 0.8 : 0
            const warned = ctxWarned.get(sid) || 0
            if (bucket && bucket > warned) {
              ctxWarned.set(sid, bucket)
              const pct = Math.round(ratio * 100)
              gate.noteAlert?.('warn', `【${title}】 上下文用到 ${pct}%`, { ref: `ctx:${sid}:${bucket}` })
              gate.noteEvent?.('ctx', `【${title}】 的上下文已用 ${pct}%（${Math.round(bucket * 100)}% 提醒档）`)
            }
            // v1.8.24：这里原来会记一条「重试后已恢复正常」。用户要求去掉 ——
            // 重试成功了就等于没出事，再弹一条只会让人白紧张一次（手机震了，
            // 打开一看「已恢复」）。retry 现在只表示「正在重试」这一种含义。
            // 注意不要清 retryAt：它同时是「正在重试」那条提示的 30 秒节流阀，
            // 每轮完成就清掉会让同一轮里重复提示。
            // 每轮完成都记一条（P2 最近动态），同一会话 30 秒内只记一次
            const lastOk = toolLoggedAt.get(`ok:${sid}`) || 0
            const okNow = Date.now()
            if (okNow - lastOk > 30_000) {
              toolLoggedAt.set(`ok:${sid}`, okNow)
              gate.noteEvent?.('turnok', `【${title}】 完成了一轮`)
            }
            const device = gate.lastActiveDevice?.(90_000)
            if (!device) return // 这一轮是在电脑上敲的，不打扰
            const name = device.note || device.label || '手机'
            gate.noteTurn?.(`${name} 完成了一轮 · ${clockOf(Date.now())}`)
            return
          }
          // 会话在等授权：宿主的审批服务会把 asked / decided 写进会话日志，
          // 这里直接听就行 —— 比 approval/request 瀑布钩子可靠（那条线上什么都能接）
          if (event.type === 'approval/asked') {
            const tool = String(evf('toolName') || '')
            gate.noteApproval?.(session && session.id, title, tool, evf('id'))
            gate.noteEvent?.('approval', `会话在等授权：【${title || '(无标题会话)'}】${tool ? ' · ' + tool : ''}`)
            return
          }
          if (event.type === 'approval/decided') {
            gate.decideApproval?.(evf('id'), evf('outcome'))
            return
          }
          // 「等你回答」：宿主没有 question/asked 这种事件，提问就是一次 ask_user_question 工具调用，
          // 结果回来（tool/result 同一个 callId）就等于回答完了 —— 按 callId 收掉气泡。
          if (event.type === 'tool/call') {
            const tool = String(evf('toolName') || '')
            // v1.8.19：把「会话名 正在用 工具」加回来（用户要求）。
            // v1.8.22：这类技术动态也会弹气泡 + 响一声（用户要求「所有消息都弹窗和音效」），
            // 但依旧不进红点 —— 红点只算要人判断的。同一会话 60 秒记一条，免得刷屏。
            if (tool) {
              const lastTool = toolLoggedAt.get(`tool:${sid}`) || 0
              const toolNow = Date.now()
              if (toolNow - lastTool > 60_000) {
                toolLoggedAt.set(`tool:${sid}`, toolNow)
                gate.noteEvent?.('tool', `【${title || '(无标题会话)'}】 正在用 ${tool}`)
              }
            }
            if (/ask[_-]?user|AskUserQuestion/i.test(tool)) {
              gate.noteAlert?.('question', `【${title}】 正在等你回答...`, { ref: `ask:${callId}`, sticky: true })
              gate.noteEvent?.('question', `【${title}】 在等你回答（${tool}）`)
            }
            return
          }
          if (event.type === 'tool/result') {
            if (callId) gate.clearAlertRef?.(`ask:${callId}`)
            return
          }
          // 上下文压缩：长会话会先整理再继续，这期间界面看着像卡住，给个气泡说明
          if (event.type === 'compaction/start') {
            gate.noteAlert?.('compaction', `【${title}】 正在整理上下文...`, { ref: `compact:${sid}`, sticky: true })
            gate.noteEvent?.('compaction', `【${title}】 开始整理上下文`)
            return
          }
          if (event.type === 'compaction/end' || event.type === 'compaction/summary') {
            // 压缩完上下文变短，提醒档位重置，下次再到 80% 还能提醒
            ctxWarned.delete(sid)
            gate.clearAlertRef?.(`compact:${sid}`)
            return
          }
          if (event.type === 'compaction/summary-error') {
            gate.noteAlert?.('warn', `【${title}】 上下文压缩出错`, { ref: `compact:${sid}` })
            gate.noteEvent?.('error', `【${title}】 上下文压缩出错`)
            return
          }
          // 模式变了：权限 / 沙箱 / 审批 / 计划 / 模型，任意一个动就弹一句「当前 XX 模式：yy」。
          // 故意不给 ref：给 ref 的行会被复用得同一个 seq，前端就认不出「又变了一次」而不弹气泡。
          // 连点刷新同一个旋钮时靠 noteAlert 自带的 5 秒同类合并兜住，不会刷屏。
          const mode = describeMode(event)
          if (mode) {
            gate.noteAlert?.('mode', `【${title}】 当前${mode.key}：${mode.label}`)
            gate.noteEvent?.('mode', `【${title}】 的${mode.key}改为「${mode.label}」`)
            return
          }
          if (event.type === 'session/model-unavailable') {
            gate.noteAlert?.('warn', `【${title}】 模型不可用`, { ref: `model:${sid}` })
            gate.noteEvent?.('model', `【${title}】 模型不可用`)
            return
          }
          // 一次尝试没产出（失败 / 被取消 / 流断了）就落一条 assistant/attempt，
          // 多数情况下紧接着会自动重试 —— 给它一句「正在重试」，30 秒内同一会话只提示一次
          if (event.type === 'assistant/attempt') {
            const now = Date.now()
            const last = retryAt.get(sid) || 0
            if (now - last > 30_000) {
              retryAt.set(sid, now)
              gate.noteAlert?.('warn', `【${title}】 正在重试...`, { ref: `retry:${sid}` })
              gate.noteEvent?.('retry', `【${title}】 的一次尝试没成功，正在重试`)
            }
            return
          }
          if (event.type === 'session/create') {
            gate.noteEvent?.('session', `新会话：【${title}】`)
            return
          }
        } catch {
          /* 通知失败不影响对话 */
        }
      })
      log.info('[dsh-my-phone] 会话事件监听已注册（turn/end + approval/* + 提问/压缩/权限·沙箱·审批·计划模式/模型）')
      return typeof off === 'function' ? off : () => {}
    } catch {
      return () => {}
    }
  })()

  // 宿主层错误（上游 500、连接断开之类）：会话事件里看不到，但 agent/error 一定有
  const disposeAgentError = (() => {
    try {
      const off = ctx.on('agent/error', (payload) => {
        try {
          const agent = (payload && payload.agent) || null
          const session = (agent && agent.session) || null
          const title = sessionTitleOf(session) || '某个会话'
          const msg = String((payload && payload.error && (payload.error.message || payload.error)) || '未知错误').slice(0, 120)
          gate.noteAlert?.('warn', `【${title}】 出错了`, { ref: `agenterr:${session && session.id}` })
          gate.noteEvent?.('turnfail', `【${title}】 出错：${msg}`)
        } catch {
          /* 通知失败不影响对话 */
        }
      })
      log.info('[dsh-my-phone] agent/error 监听已注册')
      return typeof off === 'function' ? off : () => {}
    } catch {
      return () => {}
    }
  })()

  // 会话在等授权 → 记一条（只提示，不代答；合并窗口在 gate 里）
  const disposeApprovalWatch = (() => {
    try {
      // 用普通函数：approval/request 是 waterfall，this 是 Scoped<Agent>，箭头函数会把它丢掉
      const off = ctx.on('approval/request', function (request, next) {
        try {
          const agent = (request && request.agent) || (this && this.agent) || null
          const session = (agent && agent.session) || (this && this.session) || null
          const title = sessionTitleOf(session)
          const tool = String((request && request.toolName) || '')
          gate.noteApproval?.(session && session.id, title, tool, request && request.id)
          // 排查日志里留痕：钩子到底有没有被触发，一眼就能看见
          gate.noteEvent?.('approval', `收到授权请求：【${title || '(无标题会话)'}】${tool ? ' · ' + tool : ''}`)
        } catch {
          /* 只是通知，出错不影响授权流程本身 */
        }
        return next()
      })
      log.info('[dsh-my-phone] 授权提醒钩子已注册（approval/request）')
      return typeof off === 'function' ? off : () => {}
    } catch (err) {
      log.error('[dsh-my-phone] 授权提醒钩子注册失败', err)
      return () => {}
    }
  })()

  // 面板接口（/__myphone/panel*、/__myphone/widget.js、/__myphone/icon*.png 等），供纯 DOM 弹窗调用
  const disposePanel = registerPanel(ctx, { state, gate, getAddresses: addresses, getQrBase: qrBase, sync })

  // 启动时自动收拾历史重复设备：老版本每扫一次就 addDevice，同型号手机会堆好几条。
  // 放在 sync() 之前做，这样第一次渲染出来的列表就是干净的（不需要用户点按钮）。
  try {
    const dup = state.dedupeDevices ? state.dedupeDevices() : 0
    if (dup > 0) {
      log.info(`[dsh-my-phone] 启动时合并了 ${dup} 条重复设备（同型号手机只留最近用过的那条）`)
      gate.noteEvent?.('device', `启动时自动合并了 ${dup} 条重复设备（同一台手机只留最近用过的那条，备注已保留）`)
    }
  } catch (err) {
    log.error('[dsh-my-phone] 清理重复设备失败', err)
  }

  void sync().catch((err) => log.error('[dsh-my-phone] 启动失败', err))

  const cleanup = () => {
    try {
      disposeTurnWatch()
      disposeApprovalWatch()
      disposeAgentError()
    } catch {
      /* 已经释放过 */
    }
    clearInterval(longRunTimer)
    clearInterval(watchdog)
    clearInterval(tunnelGuard)
    disposePanel()
    tunnel.stop()
    void gate.close()
  }
  try {
    ctx.on?.('dispose', cleanup)
  } catch {
    /* older context: rely on process exit */
  }
  try {
    ctx.effect?.(() => cleanup)
  } catch {
    /* effect unsupported */
  }
}

// 悬浮球的注入行必须在 apply() 里**立刻**注册：
// 桌面端/网页端的 index 注入表是宿主启动时一次性收集的，对象级 `export const inject` 会把
// apply 推迟到服务就绪之后，那一行就永远进不来（dsh-whale-widget 的 #152/#153 就是这个坑）。
// 所以现在：行先注册，其余逻辑放进 ctx.inject 等齐服务后再跑，语义与原来等价。
const WIDGET_ROW_TEXT =
  '(function(){try{var d=document.body||document.documentElement;if(!d)return;' +
  'if(window.__dshMyPhoneWidgetLoader)return;window.__dshMyPhoneWidgetLoader=1;' +
  'var s=document.createElement(\"script\");s.src=\"/__myphone/widget.js?v=1\";' +
  's.onerror=function(){};d.appendChild(s)}catch(e){}})()'

export function apply(ctx) {
  try {
    ctx.on('webserver/index-inject', (table) => {
      if (!Array.isArray(table)) return
      for (const row of table) {
        if (row && row.kind === 'script' && typeof row.text === 'string' && row.text.indexOf('/__myphone/widget.js') >= 0) return
      }
      table.push({ kind: 'script', placement: 'body', text: WIDGET_ROW_TEXT })
    })
  } catch (err) {
    log.warn?.(`[my-phone] 注入行注册失败：${(err && err.message) || err}`)
  }
  // ctx.inject 是本宿主的标准写法（dsh-whale-widget 也在用）；万一某个旧版本没有，
  // 就退回到「直接跑」——反正原来的对象级 inject 已经被去掉，不能再让整个插件不加载。
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer', 'connection'], (inner) => applyBody(inner))
    return
  }
  applyBody(ctx)
}
