import crypto from 'node:crypto'

/** No 0/O, 1/I/L — codes get read aloud and typed on phones. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const CODE_LENGTH = 6
const CODE_TTL_MS = 120_000
const TICKET_TTL_MS = 180_000
const DEVICE_TTL_MS = 180 * 24 * 3600 * 1000

const b64u = (buf) => Buffer.from(buf).toString('base64url')

function randomCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH)
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

/** Constant-time compare that does not leak length through early return shape. */
function safeEqual(a, b) {
  const ab = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  const len = Math.max(ab.length, bb.length, 1)
  const pa = Buffer.alloc(len)
  const pb = Buffer.alloc(len)
  ab.copy(pa)
  bb.copy(pb)
  return crypto.timingSafeEqual(pa, pb) && ab.length === bb.length
}

/**
 * A single-use, short-lived pairing code.
 *
 * Only one code is valid at a time and it dies the moment it is redeemed, so a
 * shoulder-surfed code is worthless after the intended device uses it.
 */
export class Pairing {
  constructor() {
    this.current = null
    this.ticket = null
  }

  issue() {
    const code = randomCode()
    this.current = { code, expiresAt: Date.now() + CODE_TTL_MS }
    return { code: formatCode(code), expiresAt: this.current.expiresAt }
  }

  peek() {
    if (!this.current || this.current.expiresAt < Date.now()) return null
    return { code: formatCode(this.current.code), expiresAt: this.current.expiresAt }
  }

  redeem(input) {
    if (!this.current) return { ok: false, reason: '没有有效的配对码' }
    if (this.current.expiresAt < Date.now()) {
      this.current = null
      return { ok: false, reason: '配对码已过期，请在电脑上重新生成' }
    }
    const typed = String(input || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase()
    if (!safeEqual(typed, this.current.code)) return { ok: false, reason: '配对码不正确' }
    this.current = null
    return { ok: true }
  }

  /**
   * 二维码里带的那串票据。
   *
   * 和 6 位码相比，它长得多（144 bit 随机），扫一次就作废，而且不需要人手输——
   * 手机上少一步输入，就少一次「码输错了以为是坏了」的来回。二维码本身泄漏
   * 也只是 3 分钟内、一次性的机会，而且还得先在电脑上把入口打开。
   */
  issueTicket() {
    const ticket = b64u(crypto.randomBytes(18))
    this.ticket = { ticket, expiresAt: Date.now() + TICKET_TTL_MS }
    return { ticket, expiresAt: this.ticket.expiresAt }
  }

  peekTicket() {
    if (!this.ticket || this.ticket.expiresAt < Date.now()) return null
    return { ticket: this.ticket.ticket, expiresAt: this.ticket.expiresAt }
  }

  redeemTicket(input) {
    if (!this.ticket) return { ok: false, reason: '这个二维码已经用过了，请在电脑上换一个' }
    if (this.ticket.expiresAt < Date.now()) {
      this.ticket = null
      return { ok: false, reason: '二维码已过期（3 分钟），请在电脑上换一个' }
    }
    if (!safeEqual(String(input || ''), this.ticket.ticket)) {
      return { ok: false, reason: '二维码票据不认识，请在电脑上重新扫一次' }
    }
    this.ticket = null
    return { ok: true }
  }

  clear() {
    this.current = null
    this.ticket = null
  }
}

export function formatCode(code) {
  return `${code.slice(0, 3)}-${code.slice(3)}`
}

/** `pk1.<deviceId>.<expiresAt>.<hmac>` — stateless, revocable by deleting the device. */
export function signDeviceToken(secret, deviceId, ttlMs = DEVICE_TTL_MS) {
  const expiresAt = Date.now() + ttlMs
  const body = `pk1.${deviceId}.${expiresAt}`
  const sig = b64u(crypto.createHmac('sha256', secret).update(body).digest()).slice(0, 43)
  return `${body}.${sig}`
}

export function verifyDeviceToken(secret, token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 4 || parts[0] !== 'pk1') return null
  const [, deviceId, expiresAt, sig] = parts
  const expires = Number(expiresAt)
  if (!Number.isSafeInteger(expires) || expires < Date.now()) return null
  const expected = b64u(
    crypto.createHmac('sha256', secret).update(`pk1.${deviceId}.${expiresAt}`).digest(),
  ).slice(0, 43)
  if (!safeEqual(sig, expected)) return null
  return deviceId
}
