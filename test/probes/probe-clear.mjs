// 排查 → 清空：点完之后下面那份列表必须真的空掉。
// 用法：node test/probe-clear.mjs <adminPort> <publicPort> <hostPort>
import http from 'node:http'

const [adminPort, publicPort, hostPort] = process.argv.slice(2).map(Number)

function req(port, options = {}, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, ...options }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }),
      )
    })
    r.on('error', reject)
    if (body) r.write(body)
    r.end()
  })
}

const out = []
const check = (ok, text) => {
  out.push(`${ok ? '✓' : '✗'} ${text}`)
  if (!ok) process.exitCode = 1
}
const panel = (path, method = 'GET', body) =>
  req(hostPort, {
    method,
    path: `/__myphone/panel${path}`,
    headers: { 'x-myphone-panel': '1', 'content-type': 'application/json' },
  }, body)
const json = (res) => {
  try {
    return JSON.parse(res.body)
  } catch {
    return null
  }
}

// 1. 制造几条事件：匿名访问入口 → pair 事件
await req(publicPort, { method: 'GET', path: '/' })
await req(publicPort, { method: 'GET', path: '/some/page' })
const before = json(await panel(''))
check(Boolean(before && before.events.length), `清空前有事件 ${before ? before.events.length : '?'} 条`)

// 2. 点「清空」
const cleared = json(await panel('/clear', 'POST', '{}'))
check(Boolean(cleared && cleared.events.length === 0), `清空后立刻为 0（实际 ${cleared ? cleared.events.length : '?'}）`)

// 3. 再读一次，确实是空的（不是只清了一次响应）
const again = json(await panel(''))
check(Boolean(again && again.events.length === 0), `再读一次还是 0（实际 ${again ? again.events.length : '?'}）`)

// 4. 清空要把磁盘日志也清掉，但先留一份 .1 备份
const fs = await import('node:fs')
const path = await import('node:path')
const home = process.env.DSH_HOME || ''
const dir = home ? path.join(home, '.dsh-my-phone') : ''
if (dir) {
  const pairLog = path.join(dir, 'pair.log')
  const backup = `${pairLog}.1`
  const size = fs.existsSync(pairLog) ? fs.statSync(pairLog).size : -1
  const backSize = fs.existsSync(backup) ? fs.statSync(backup).size : -1
  check(size === 0, `pair.log 已被清空（${size}B）`)
  check(backSize > 0, `pair.log.1 备份在（${backSize}B）`)
} else {
  out.push('· 跳过磁盘日志检查（没有 DSH_HOME）')
}

console.log(out.join('\n'))
