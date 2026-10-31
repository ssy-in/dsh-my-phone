// DEV ONLY — mirrors what src/session.js does inside DSH, using the persistent
// signing secret directly. This exists so the plugin can be exercised without
// booting the whole harness; production code must never import this file.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const b64u = (b) =>
  Buffer.from(b).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')

export function devSession({ port = 62135 } = {}) {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const cred = path.join(home, '.credentials.yaml')
  const text = fs.readFileSync(cred, 'utf8')
  const m = text.match(
    /client-connection\/browser-session:\s*\n(?:[ \t].*\n)*?\s*secret:\s*([A-Za-z0-9_-]+)/,
  )
  if (!m) throw new Error('dev-session: 找不到 browser-session secret')
  const secret = Buffer.from(m[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
  const authority = `127.0.0.1:${port}`
  const now = Date.now()
  const body = b64u(
    Buffer.from(
      JSON.stringify({ version: 1, authority, issuedAt: now, expiresAt: now + 30 * 86400e3 }),
      'utf8',
    ),
  )
  const sig = crypto.createHmac('sha256', secret).update(body).digest()
  const name = `dsh-auth-${b64u(crypto.createHash('sha256').update(authority).digest())}`
  const cookie = `${name}=v1.${body}.${b64u(sig)}`
  const cached = { base: `http://${authority}`, authority, cookie }
  return {
    async get() {
      return cached
    },
    invalidate() {},
    peek() {
      return cached
    },
  }
}
