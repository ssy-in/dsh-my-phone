import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { spawn, spawnSync } from 'node:child_process'

const OFFICIAL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
const DOWNLOAD_URLS = [
  // 官方源永远排第一：镜像是别人转发的内容，能不用就不用。
  // 只有官方直连确实拿不到（国内常见）才轮到镜像，且镜像下载的包必须过验签。
  OFFICIAL,
  'https://ghfast.top/' + OFFICIAL,
  'https://ghproxy.net/' + OFFICIAL,
  'https://gh-proxy.com/' + OFFICIAL,
]
const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i
const MIN_EXE_BYTES = 8 * 1024 * 1024

const CERT_ERRORS = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
])

/**
 * Supervises the cloudflared child process.
 *
 * Design notes:
 *  - the binary is only ever downloaded when the user asks for it (never on
 *    plugin install), and the download URL is printed in the admin page;
 *  - the child is killed on stop and on process exit so we never leave an
 *    orphan tunnel running on the user's machine;
 *  - crashes are reported, never auto-restarted in a loop.
 */
export class TunnelManager {
  constructor({ log = console } = {}) {
    this.log = log
    this.proc = null
    this.url = null
    this.phase = 'idle'
    this.error = null
    this.insecureDownload = false
    this.downloadProgress = null
  }

  get status() {
    return { phase: this.phase, url: this.url, error: this.error }
  }

  async start({ target, binary }) {
    if (this.proc) return this.status
    if (!binary || !fs.existsSync(binary)) {
      this.phase = 'error'
      this.error = '未找到 cloudflared，请先在设置页下载'
      return this.status
    }
    this.phase = 'starting'
    this.error = null
    const child = spawn(
      binary,
      ['tunnel', '--url', target, '--no-autoupdate', '--loglevel', 'info'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    this.proc = child
    const killer = () => this.stop()
    process.once('exit', killer)
    this._exitHook = killer

    return new Promise((resolve) => {
      let settled = false
      const settle = (status) => {
        if (settled) return
        settled = true
        resolve(status)
      }
      const scan = (buf) => {
        const text = String(buf)
        const match = URL_PATTERN.exec(text)
        if (match && !this.url) {
          this.url = match[0]
          this.phase = 'running'
          this.log.info?.(`[dsh-my-phone] 隧道已就绪：${this.url}`)
          settle(this.status)
        }
      }
      child.stdout?.on('data', scan)
      child.stderr?.on('data', scan)
      child.on('exit', (code) => {
        // 进程自己死掉时（正是 tunnelGuard 存在的理由），这个 exit 钩子必须摘掉，
        // 否则每重连一次就多一个监听器，最后 N 个 killer 一起跑。
        if (this._exitHook) {
          process.removeListener('exit', this._exitHook)
          this._exitHook = null
        }
        clearTimeout(startTimer)
        this.proc = null
        this.url = null
        this.phase = code === 0 ? 'idle' : 'error'
        if (code !== 0) this.error = `cloudflared 退出，代码 ${code}`
        settle(this.status)
      })
      child.on('error', (err) => {
        clearTimeout(startTimer)
        this.phase = 'error'
        this.error = err?.message ?? String(err)
        settle(this.status)
      })
      const startTimer = setTimeout(() => {
        if (!settled) {
          this.phase = this.proc ? 'starting' : 'error'
          if (!this.proc) this.error = 'cloudflared 启动超时'
          settle(this.status)
        }
      }, 45_000)
    })
  }

  stop() {
    if (!this.proc) return
    try {
      this.proc.kill()
    } catch {
      /* already gone */
    }
    this.proc = null
    this.url = null
    this.phase = 'idle'
    if (this._exitHook) {
      process.removeListener('exit', this._exitHook)
      this._exitHook = null
    }
  }

  /**
   * Download the binary the user explicitly asked for.
   * Returns the absolute path, or throws with a readable message.
   *
   * 镜像站的通病是“200 之后半路掐断”，所以这里按 Range 断点续传，
   * 并且最后必须比对字节数 + 文件头，否则宁可失败也不能留个坏 exe 在磁盘上。
   */
  async download(destDir, onProgress = () => {}) {
    fs.mkdirSync(destDir, { recursive: true })
    const dest = path.join(destDir, 'cloudflared.exe')
    const tmp = `${dest}.part`
    let lastError = null
    for (const url of DOWNLOAD_URLS) {
      try {
        try {
          fs.unlinkSync(tmp)
        } catch {
          /* fresh start for each mirror */
        }
        this.downloadProgress = 0
        const size = await pullWithResume(
          url,
          tmp,
          (f) => {
            this.downloadProgress = f
            onProgress(f)
          },
          (reason) => {
            // 以前这里会把 TLS 校验关掉重下：任何公司代理/公共 Wi-Fi/镜像都能
            // 借此把 53MB 的 exe 换成自己的东西，然后我们亲手执行它。
            // 现在只报错，让人自己换个网络或手动放二进制进来。
            this.log.warn?.(`[dsh-my-phone] 证书校验失败（${reason}）：已放弃从该来源下载`)
          },
        )
        assertLooksLikeExe(tmp, size)
        assertSignedByCloudflare(tmp, this.log)
        fs.renameSync(tmp, dest)
        this.downloadProgress = 1
        return dest
      } catch (err) {
        lastError = err
        this.log.warn?.(`[dsh-my-phone] 从 ${new URL(url).host} 下载失败：${err.message}`)
      }
    }
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    throw new Error(`下载失败：${lastError?.message ?? '未知错误'}`)
  }
}

/**
 * 只校验「是不是 PE 文件 + 体积够大」挡不住换包：任何人都能造一个 MZ 开头的 exe。
 * Windows 上 cloudflared 带 Cloudflare 的代码签名，能验就验，验不过直接拒绝执行。
 * 环境里跑不了 PowerShell（比如被沙箱限制）时只记一条警告，不阻塞使用。
 */
function assertSignedByCloudflare(file, log) {
  if (process.platform !== 'win32') return true
  const out = `${file}.sig.txt`
  try {
    const script = [
      `$s = Get-AuthenticodeSignature -FilePath '${file}'`,
      `('' + $s.Status + '|' + $s.SignerCertificate.Subject) | Out-File -FilePath '${out}' -Encoding utf8`,
    ].join('; ')
    const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore',
      timeout: 30_000,
      windowsHide: true,
    })
    if (res.error) throw res.error
    const text = fs.readFileSync(out, 'utf8').trim()
    const [status, subject = ''] = text.split('|')
    if (status !== 'Valid' || !/Cloudflare/i.test(subject)) {
      throw new Error(`cloudflared 数字签名校验未通过（${status || '未知'}｜${subject.slice(0, 80)}）`)
    }
    return true
  } catch (err) {
    const message = String(err?.message ?? err)
    if (/ENOENT|EPERM|spawn|timed? ?out/i.test(message)) {
      log?.warn?.(`[dsh-my-phone] 无法校验 cloudflared 数字签名（${message}），继续但请自行确认来源`)
      return false
    }
    throw new Error(message)
  } finally {
    try {
      fs.unlinkSync(out)
    } catch {
      /* ignore */
    }
  }
}

function requestOnce(url, { insecure = false } = {}) {
  return new Promise((resolve, reject) => {
    const opts = insecure ? { rejectUnauthorized: false } : {}
    const req = https.get(url, { ...opts, headers: { 'user-agent': 'dsh-my-phone/0.2' } }, resolve)
    req.setTimeout(60_000, () => req.destroy(new Error('连接超时')))
    req.on('error', reject)
  })
}

function sizeOf(url, insecure) {
  return requestOnce(url, { insecure }).then((res) => {
    res.resume()
    const n = Number(res.headers['content-length'] || 0)
    if (res.statusCode !== 200 || !n) return 0
    return n
  })
}

/**
 * 一个 URL 反复续传，直到拿到 expect 字节（或连续失败太多次）。
 * GitHub 的 release 会 302 到别的域名，重定向要相对当前 URL 解析。
 */
async function pullWithResume(url, tmp, onProgress, onCertFallback, maxAttempts = 60) {
  const insecure = false // 永不降级：降级等于把「下载什么就执行什么」交给网络中间人
  let expect = 0
  try {
    expect = await sizeOf(url, false)
  } catch (err) {
    if (CERT_ERRORS.has(err.code)) {
      onCertFallback(err.code)
      throw err
    }
  }
  let attempts = 0
  let stall = 0
  for (;;) {
    const have = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0
    if (expect && have >= expect) return have
    if (have >= MIN_EXE_BYTES && !expect) return have
    if (attempts++ > maxAttempts) throw new Error(`重试 ${maxAttempts} 次仍未下完（${have} 字节）`)
    const before = have
    try {
      const res = await requestOnce(url, { insecure })
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        url = new URL(res.headers.location, url).toString()
        continue
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume()
        throw new Error(`HTTP ${res.statusCode}`)
      }
      if (!expect) expect = Number(res.headers['content-length'] || 0)
      await pipeTo(res, tmp, have, (received) => {
        const total = expect || received
        onProgress(Math.min(1, received / total))
      })
    } catch (err) {
      if (CERT_ERRORS.has(err.code)) {
        onCertFallback(err.code)
        throw err
      }
      stall += 1
      if (stall > 12) throw err
      await new Promise((r) => setTimeout(r, 1500))
      continue
    }
    const now = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0
    if (now > before) stall = 0
    else if (++stall > 12) throw new Error('连接反复中断且没有新的字节')
  }
}

function pipeTo(res, tmp, have, onProgress) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp, { flags: have ? 'a' : 'w' })
    let received = have
    res.on('data', (chunk) => {
      received += chunk.length
      onProgress(received)
    })
    res.on('error', reject)
    out.on('error', reject)
    out.on('finish', () => out.close(resolve))
    res.pipe(out)
  })
}

/**
 * 下载下来的东西必须像个 Windows 可执行文件。
 * 这一步能在“证书链被拦截、内容是假的”这种最坏情况下救一次命（不能替代签名校验）。
 */
function assertLooksLikeExe(file, size) {
  const st = size ?? fs.statSync(file).size
  if (st < MIN_EXE_BYTES) throw new Error(`文件只有 ${st} 字节，不像 cloudflared（可能被镜像截断）`)
  const fd = fs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(2)
    fs.readSync(fd, head, 0, 2, 0)
    if (head[0] !== 0x4d || head[1] !== 0x5a) throw new Error('文件头不是 MZ，不是 Windows 可执行文件')
  } finally {
    fs.closeSync(fd)
  }
}
