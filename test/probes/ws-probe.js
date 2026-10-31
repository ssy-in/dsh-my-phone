// 用裸 socket 打一次 WebSocket 握手，看插件→DSH 这条 upgrade 链路到底发生什么
import net from 'node:net'
import crypto from 'node:crypto'

const ADMIN = 'http://127.0.0.1:18080'
const PUB = 'http://127.0.0.1:18081'
const PUB_HOST = '127.0.0.1'
const PUB_PORT = 18081

async function pair() {
  const r1 = await fetch(ADMIN + '/__myphone/api/pair', {
    method: 'POST',
    headers: { 'x-myphone-admin': '1', 'content-type': 'application/json' },
    body: '{}',
  })
  const { code } = await r1.json()
  const r2 = await fetch(PUB + '/__myphone/pair', {
    method: 'POST',
    body: new URLSearchParams({ code }),
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Mozilla/5.0 (iPhone)' },
    redirect: 'manual',
  })
  return (r2.headers.getSetCookie ? r2.headers.getSetCookie() : []).map((c) => c.split(';')[0]).join('; ')
}

function handshake({ cookie, path = '/' }) {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(16).toString('base64')
    const sock = net.connect(PUB_PORT, PUB_HOST)
    let buf = ''
    const done = (label) => {
      try {
        sock.destroy()
      } catch {}
      resolve(label)
    }
    sock.setTimeout(6000, () => done('TIMEOUT(6s)'))
    sock.on('connect', () => {
      const lines = [
        `GET ${path} HTTP/1.1`,
        `Host: ${PUB_HOST}:${PUB_PORT}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        cookie ? `Cookie: ${cookie}` : null,
      ].filter(Boolean)
      sock.write(lines.join('\r\n') + '\r\n\r\n')
    })
    sock.on('data', (d) => {
      buf += d.toString('latin1')
      if (buf.includes('\r\n\r\n')) {
        const status = buf.split('\r\n')[0]
        done(status)
      }
    })
    sock.on('close', () => done(buf ? buf.split('\r\n')[0] : 'CLOSED(no data)'))
    sock.on('error', (e) => done('ERR ' + e.code))
  })
}

;(async () => {
  const cookie = await pair()
  console.log('无凭据 :', await handshake({ cookie: '' }))
  console.log('有凭据 :', await handshake({ cookie }))
})().catch((e) => console.log('FAIL', e.message))
