import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const DEFAULTS = {
  version: 1,
  /** HMAC key for device tokens. Generated once, never leaves this machine. */
  pluginSecret: null,
  devices: [],
  settings: {
    /**
     * 默认打开局域网入口：这是最安全的一种模式（不经第三方中继），而且
     * 「装好就能用」比「装好还要先找开关」重要。外网隧道也默认打开，
     * 见下面 tunnelEnabled。
     */
    lanEnabled: true,
    /** Loopback admin page port. */
    lanPort: 8080,
    /** Public listener port; only bound while an entry point is enabled. */
    publicPort: 8081,
    /**
     * 外网通道也默认打开（用户要求「不冲突就默认全开」）：手机不在同一个
     * WiFi 时，只有这条路能用。真正起隧道需要 cloudflared，缺了会在后台自动
     * 下载一次（有进度、有失败原因），不会静默留下半个坏文件。
     */
    tunnelEnabled: true,
    cloudflaredPath: '',
    maxDevices: 8,
    /**
     * Minutes of no traffic after which an entry closes itself. 0 = never.
     *
     * 默认 0：用户要的是「装好就一直是开着的」。以前默认 30 分钟，
     * 结果就是他去泡杯茶回来打开插件，看到一个全关的面板（还以为是插件坏了）。
     * 想省电/想更安全的人可以自己在「高级」里设 15/30/60/120。
     *
     * v0.6 起拆成两条通道各自计时：局域网和公网谁闲谁自己关，
     * 不会因为你在家用 Wi-Fi 就把出门要用的隧道也一起关掉。
     */
    autoOffMinutes: 0,
    // v1.3.0 免打扰：一键静音到某个时刻 + 每日免打扰时段（只压气泡，消息照记）
    mutedUntil: 0,
    quietStart: '',
    quietEnd: '',
    lanAutoOffMinutes: 0,
    tunnelAutoOffMinutes: 0,
  },
}

/**
 * Durable plugin state.
 *
 * Everything lives in one JSON file under the DSH home. The file contains a
 * signing secret: it is as sensitive as a password file, so it is written with
 * 0600 on POSIX (Windows ACLs are inherited from the DSH home directory).
 */
export class MyPhoneState {
  constructor(dir) {
    this.dir = dir
    this.file = path.join(dir, 'state.json')
    this.data = DEFAULTS
    this.load()
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      this.data = {
        ...DEFAULTS,
        ...parsed,
        settings: { ...DEFAULTS.settings, ...(parsed.settings ?? {}) },
        devices: Array.isArray(parsed.devices) ? parsed.devices : [],
      }
    } catch (err) {
      // 解析失败千万不能就地覆盖：那会把 pluginSecret 轮换掉，
      // 所有已配对手机的凭据一起失效，而且原始文件再也回不来。
      // 先把坏文件改名留证据，再从 DEFAULTS 起，交给上层提示用户。
      this.loadError = err?.message ?? String(err)
      try {
        if (fs.existsSync(this.file)) {
          const bad = `${this.file}.bad-${Date.now()}`
          fs.renameSync(this.file, bad)
          this.loadError += `（原文件已备份为 ${bad}）`
        }
      } catch {
        /* 备份失败也不能让插件起不来 */
      }
      this.data = structuredClone(DEFAULTS)
      try {
        if (fs.existsSync(this.file + '.bak')) {
          const bak = JSON.parse(fs.readFileSync(this.file + '.bak', 'utf8'))
          this.data = {
            ...DEFAULTS,
            ...bak,
            settings: { ...DEFAULTS.settings, ...(bak.settings ?? {}) },
            devices: Array.isArray(bak.devices) ? bak.devices : [],
          }
        }
      } catch {
        /* 备份也坏就只能重来 */
      }
    }
    if (!this.data.pluginSecret || typeof this.data.pluginSecret !== 'string') {
      this.data.pluginSecret = crypto.randomBytes(32).toString('base64url')
      this.save()
    }
    // 一次性迁移：v1 时代的默认值是「局域网关闭」，用户装好后发现手机连不上。
    // 这里给存量 state.json 打开一次局域网入口；标记写下之后就不再动，用户关掉不会被改回来。
    if (this.data.migratedV2 !== true) {
      this.data.migratedV2 = true
      this.data.settings.lanEnabled = true
      this.save()
    }
    // 一次性迁移 v3：外网通道也默认打开。
    if (this.data.migratedV3 !== true) {
      this.data.migratedV3 = true
      this.data.settings.tunnelEnabled = true
      this.save()
    }
    // 一次性迁移 v4：「默认全开」这件事要真的成立。
    // 旧默认是「空闲 30 分钟自动收回入口」，于是用户过一会儿打开插件，两个开关都是关的，
    // 看起来就完全不像「默认全开」。这里把空闲自动关退回 0，并把两个入口打开一次。
    if (this.data.migratedV4 !== true) {
      this.data.migratedV4 = true
      this.data.settings.lanEnabled = true
      this.data.settings.tunnelEnabled = true
      this.data.settings.autoOffMinutes = 0
      this.save()
    }
    // 一次性迁移 v5：自动关闭拆成两条通道（局域网 / 外网）。
    // 存量里只有一个 autoOffMinutes，抄给两边，之后各管各的。
    if (this.data.migratedV5 !== true) {
      this.data.migratedV5 = true
      const legacy = Number(this.data.settings.autoOffMinutes || 0)
      this.data.settings.lanAutoOffMinutes = legacy
      this.data.settings.tunnelAutoOffMinutes = legacy
      this.save()
    }
    // 一次性迁移 v6：管理口和入口口撞到同一个端口（8080 被占时回退成了 8081，两处都记成 8081）。
    // 撞号时 Windows 允许两个监听共存，但回环流量会被「管理口」抢走 ——
    // cloudflared 转 127.0.0.1:8081 就打到管理口，那边没有 /__myphone/pair，扫码直接 404。
    if (this.data.migratedV6 !== true) {
      this.data.migratedV6 = true
      const lan = Number(this.data.settings.lanPort || 8080)
      if (Number(this.data.settings.publicPort || 0) === lan) {
        this.data.settings.publicPort = lan + 1
      }
      this.save()
    }
    // 一次性迁移 v7：只用外网入口。
    // 用户的用法是「家里 WiFi / 手机流量 / 公司 WiFi / 店里 WiFi 到处连」，这四个场景里只有家里能用局域网，
    // 而家里走外网也进得去 —— 局域网入口只剩「应急后路」的价值，所以默认关掉，二维码永远只指向公网 https。
    // 同时把两条通道的空闲自动关闭归零：入口被自动收回时公网地址会打不开，最容易被误判成「插件坏了」。
    if (this.data.migratedV7 !== true) {
      this.data.migratedV7 = true
      this.data.settings.lanEnabled = false
      this.data.settings.lanAutoOffMinutes = 0
      this.data.settings.tunnelAutoOffMinutes = 0
      this.data.settings.autoOffMinutes = 0
      this.save()
    }
    // v8：默认两个入口都自动开（用户要求；v7 的「只用外网」作废）
    if (this.data.migratedV8 !== true) {
      this.data.migratedV8 = true
      this.data.settings.lanEnabled = true
      this.data.settings.tunnelEnabled = true
      this.save()
    }
    return this.data
  }

  save() {
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      // 固定 .tmp 名会被两个实例互相踩；写一半崩溃还会留下半截文件。
      const tmp = `${this.file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`
      const fd = fs.openSync(tmp, 'w', 0o600)
      try {
        fs.writeFileSync(fd, JSON.stringify(this.data, null, 2))
        fs.fsyncSync(fd) // 先落盘再改名，断电也不会只剩空文件
      } finally {
        fs.closeSync(fd)
      }
      if (fs.existsSync(this.file)) {
        try {
          fs.copyFileSync(this.file, `${this.file}.bak`)
        } catch {
          /* 备份失败不阻塞主流程 */
        }
      }
      fs.renameSync(tmp, this.file)
    } catch (err) {
      // A read-only DSH home must not take the plugin down; log and continue.
      console.error('[dsh-my-phone] cannot persist state:', err?.message ?? err)
    }
  }

  get secret() {
    return Buffer.from(this.data.pluginSecret, 'base64url')
  }

  get settings() {
    return this.data.settings
  }

  patchSettings(patch) {
    this.data.settings = { ...this.data.settings, ...patch }
    this.save()
    return this.data.settings
  }

  get devices() {
    return this.data.devices
  }

  /**
   * 登记一台设备。注意 `trustedAt` 一开始是 null：光有 token 不算数，
   * 必须手机端本人点过一次「信任这台电脑」才会写时间戳。这样即使二维码被
   * 别人扫到，他没点那一脚也进不来（而且票据 3 分钟就废）。
   */
  addDevice(label, userAgent) {
    // 满了就返回 null，让人去电脑上删一台；绝不偷偷把最早配对的那台挤掉
    // （以前是 slice(-maxDevices)，等于默默把别人的手机踢下线，太阴了）
    const max = Math.max(1, Number(this.data.settings.maxDevices) || 8)
    if (this.data.devices.length >= max) return null
    const device = {
      id: crypto.randomBytes(6).toString('hex'),
      // 长期凭据（第二把钥匙）：浏览器对 cookie 的存续很不靠谱 —— iOS 无痕、
      // 应用内浏览器（QQ/夸克/微信）经常一关就没了。手机上会把这个 key 存进
      // localStorage，cookie 没了也能自己认回来，不用重扫二维码、不用再点信任。
      passKeys: [crypto.randomBytes(18).toString('base64url')],
      // 最近一次用这把钥匙登录的时间：超过 30 天没用就作废，免得一把被遗忘的
      // 钥匙在旧手机/旧浏览器里躺一辈子。
      passKeyAt: Date.now(),
      label: String(label || '未命名设备').slice(0, 48),
      // 备注由人自己填，用来区分同为「Android 设备」的几台手机
      note: '',
      userAgent: String(userAgent || '').slice(0, 180),
      createdAt: Date.now(),
      lastSeen: null,
      trustedAt: null,
      joinCount: 0,
    }
    this.data.devices = [...this.data.devices, device]
    this.save()
    return device
  }

  /**
   * 扫码登记设备：同一台手机（同 User-Agent）重复扫码就**复用原来那条**。
   *
   * 为什么必须这么做：免费隧道每次重启都换一个新域名，而浏览器的 cookie 是按
   * 域名隔离的 —— 换域名后手机必然要重扫一次。如果每次都 addDevice，设备列表
   * 就会越滚越长（实测一上午滚到 7 条），辛苦填的备注也跟着丢。
   */
  upsertDevice(label, userAgent) {
    const ua = String(userAgent || '').slice(0, 180)
    if (ua) {
      const same = this.data.devices.filter((d) => d.userAgent === ua)
      if (same.length) {
        // 老版本每扫一次就 addDevice，历史里可能已经堆了好几条同 UA 的。
        // 这里顺手合掉：优先留「有备注、有信任、最近活跃」的那条，其余删掉并把信息接过来。
        const score = (d) => (d.note ? 4 : 0) + (d.trustedAt ? 2 : 0) + (d.lastSeen || d.createdAt || 0) / 1e13
        const pick = same.slice().sort((a, b) => score(b) - score(a))[0]
        for (const d of same) {
          if (d.id === pick.id) continue
          if (!pick.note && d.note) pick.note = d.note
          if (!pick.trustedAt && d.trustedAt) pick.trustedAt = d.trustedAt
          // 合并时把各条的长期凭据收进来：老浏览器里存的那把钥匙不能因为合并就失效
          if (Array.isArray(d.passKeys) && d.passKeys.length) {
            pick.passKeys = [...new Set([...(pick.passKeys || []), ...d.passKeys])].slice(-6)
            pick.passKeyAt = Math.max(pick.passKeyAt || 0, d.passKeyAt || 0) || pick.passKeyAt
          }
        }
        this.data.devices = this.data.devices.filter((d) => d.userAgent !== ua || d.id === pick.id)
        pick.label = String(label || pick.label).slice(0, 48)
        pick.lastSeen = Date.now()
        this.save()
        return pick
      }
    }
    return this.addDevice(label, ua)
  }

  /**
   * 同一 UA 只留最近活跃的一条（插件启动时自动跑一次，不需要用户去点按钮）。
   * 合并时把备注与信任时间接过来，别把用户填的东西删掉。
   */
  dedupeDevices() {
    const keep = new Map()
    for (const d of this.data.devices) {
      const key = d.userAgent || `id:${d.id}`
      const prev = keep.get(key)
      if (!prev) {
        keep.set(key, d)
        continue
      }
      const newer = (d.lastSeen || d.createdAt || 0) >= (prev.lastSeen || prev.createdAt || 0)
      const win = newer ? d : prev
      const lose = newer ? prev : d
      if (!win.note && lose.note) win.note = lose.note
      if (!win.trustedAt && lose.trustedAt) win.trustedAt = lose.trustedAt
      if (Array.isArray(lose.passKeys) && lose.passKeys.length) {
        win.passKeys = [...new Set([...(win.passKeys || []), ...lose.passKeys])].slice(-6)
        win.passKeyAt = Math.max(win.passKeyAt || 0, lose.passKeyAt || 0) || win.passKeyAt
      }
      keep.set(key, win)
    }
    const kept = [...keep.values()]
    const removed = this.data.devices.length - kept.length
    if (removed > 0) {
      this.data.devices = kept
      this.save()
    }
    return removed
  }

  /**
   * 按长期凭据找设备。
   *
   * 用途：手机上的 cookie 被浏览器清掉（iOS 无痕 / 应用内浏览器很常见）后，
   * 手机页面带着这把钥匙来「自己认回来」，不必再扫一次二维码、再点一次信任。
   * 删掉这台设备 = 这把钥匙立刻作废。
   */
  findByPassKey(key) {
    const k = String(key || '')
    if (k.length < 16) return null
    return this.data.devices.find((d) => Array.isArray(d.passKeys) && d.passKeys.includes(k)) || null
  }

  /**
   * 长期凭据是否还在有效期内：30 天没被用过就作废。
   *
   * 理由：这把钥匙是「明文存在手机上」的长期凭据，一旦手机换了主人、或某台旧
   * 浏览器的 localStorage 一直没人清理，它会一直有效。加个闲置过期能把它自然收掉。
   */
  passKeyFresh(id, ttlMs = 30 * 24 * 60 * 60 * 1000) {
    const d = this.data.devices.find((x) => x.id === id)
    if (!d) return false
    const at = d.passKeyAt || d.createdAt || 0
    return Date.now() - at <= ttlMs
  }

  /** 用钥匙登录成功 → 记一次「还活着」，把过期计时往后推。 */
  touchPassKey(id) {
    const d = this.data.devices.find((x) => x.id === id)
    if (!d) return null
    d.passKeyAt = Date.now()
    this.save()
    return d
  }

  /** 钥匙作废（闲置过期、设备被清）：清掉所有钥匙，但设备记录本身留着。 */
  clearPassKeys(id) {
    const d = this.data.devices.find((x) => x.id === id)
    if (!d) return null
    d.passKeys = []
    this.save()
    return d
  }

  /** 设备备注：几台手机都被认成「Android 设备」时，靠这个区分（比如「刘先生」）。 */
  noteDevice(id, note) {
    const device = this.data.devices.find((d) => d.id === id)
    if (!device) return null
    device.note = String(note || '').trim().slice(0, 24)
    this.save()
    return device
  }

  /** 客户端点了「信任」→ 记为可信设备。 */
  // 连接一次 +1：区分「第一次连进来的新设备」和「老设备重连」
  bumpJoin(id) {
    const d = this.data.devices.find((x) => x.id === id)
    if (!d) return 0
    d.joinCount = (Number(d.joinCount) || 0) + 1
    this.touchDevice(id)
    this.save()
    return d.joinCount
  }
  trustDevice(id) {
    const device = this.data.devices.find((d) => d.id === id)
    if (!device) return null
    device.trustedAt = Date.now()
    this.save()
    return device
  }

  /** 电脑端撤销信任：设备还在列表里，但立刻失去访问权（token 仍在也没用）。 */
  untrustDevice(id) {
    const device = this.data.devices.find((d) => d.id === id)
    if (!device) return null
    device.trustedAt = null
    this.save()
    return device
  }

  isTrusted(id) {
    return Boolean(this.data.devices.find((d) => d.id === id)?.trustedAt)
  }

  removeDevice(id) {
    const before = this.data.devices.length
    this.data.devices = this.data.devices.filter((d) => d.id !== id)
    this.save()
    return this.data.devices.length !== before
  }

  /**
   * v1.8.31：一键清掉所有设备凭证。
   * 设备一删，之前发的 token 就签不出人来了 —— currentDevice() 里
   * `state.devices.find(...)` 找不到就返回 null，所以旧 cookie / 旧 passKey
   * 一起失效，不需要再轮换 pluginSecret（换了反而把没删干净的东西也一起作废，
   * 排查时看不出是谁还在敲门）。
   */
  removeAllDevices() {
    const n = this.data.devices.length
    if (!n) return 0
    this.data.devices = []
    this.save()
    return n
  }

  /**
   * 手机上每一个被代理的请求（含全部静态资源）都会走这里。
   * 以前每次都全量同步写盘（mkdir + write + rename），开一屏就是几百次，
   * 事件循环被拖住、Windows 上还可能被杀毒软件抢锁。
   * 现在内存里实时更新，落盘按设备节流到 60 秒一次。
   */
  touchDevice(id) {
    const device = this.data.devices.find((d) => d.id === id)
    if (!device) return null
    const now = Date.now()
    device.lastSeen = now
    this._touchDirty = this._touchDirty || new Map()
    const lastSaved = this._touchDirty.get(id) || 0
    if (now - lastSaved >= 60_000) {
      this._touchDirty.set(id, now)
      this.save()
    }
    return device
  }
}
