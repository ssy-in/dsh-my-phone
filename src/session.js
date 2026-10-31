import http from 'node:http'

/**
 * Holds the *official* DSH browser session used for every proxied request.
 *
 * This is the whole point of the design: the plugin never reads
 * `.credentials.yaml` and never forges a cookie. It asks the host's own
 * Connection service for a tokenised URL (`ctx.connection.authenticatedUrl`),
 * performs the token exchange against loopback exactly like a browser would,
 * and keeps the resulting Set-Cookie in memory.
 *
 * If DSH changes its cookie format, this file keeps working — the host mints it.
 */
export function createSession({ ctx }) {
  let cached = null
  let inflight = null

  function endpoint() {
    const port = ctx?.webServer?.port
    const protocol = ctx?.webServer?.protocol ?? 'http:'
    if (!port) throw new Error('dsh-my-phone: ctx.webServer.port 不可用')
    return { base: `${protocol}//127.0.0.1:${port}`, authority: `127.0.0.1:${port}` }
  }

  function authenticatedUrl(base) {
    const connection = ctx?.connection
    if (!connection || typeof connection.authenticatedUrl !== 'function') {
      throw new Error(
        'dsh-my-phone: 当前 DSH 版本没有 ctx.connection.authenticatedUrl；本插件拒绝退回到读取密钥文件的方式。',
      )
    }
    return connection.authenticatedUrl(`${base}/`)
  }

  function exchange(url) {
    return new Promise((resolve, reject) => {
      const req = http.get(url, { headers: { 'user-agent': 'dsh-my-phone/0.1' } }, (res) => {
        res.resume()
        const raw = res.headers['set-cookie']
        const list = Array.isArray(raw) ? raw : raw ? [raw] : []
        const cookie = list.find((c) => c.startsWith('dsh-auth-'))
        if (!cookie) {
          reject(new Error(`dsh-my-phone: 令牌交换未返回 dsh-auth cookie（HTTP ${res.statusCode}）`))
          return
        }
        resolve(cookie.split(';')[0])
      })
      req.on('error', reject)
      req.setTimeout(10_000, () => req.destroy(new Error('dsh-my-phone: 令牌交换超时')))
    })
  }

  return {
    async get() {
      if (cached) return cached
      if (inflight) return inflight
      inflight = (async () => {
        const { base, authority } = endpoint()
        const cookie = await exchange(authenticatedUrl(base))
        cached = { base, authority, cookie }
        return cached
      })().finally(() => {
        inflight = null
      })
      return inflight
    },
    invalidate() {
      cached = null
    },
    /** Synchronous view of the cached session, for upgrade fast-paths. */
    peek() {
      return cached
    },
    get cachedAuthority() {
      return cached?.authority ?? null
    },
  }
}
