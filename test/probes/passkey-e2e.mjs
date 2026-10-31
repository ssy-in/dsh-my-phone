// 长期凭据端到端：cookie 被清掉后，手机靠 localStorage 里那把钥匙自己认回来
// 用法：node test/passkey-e2e.mjs <adminPort> <entryPort> [stateFile]
const { readFileSync } = await import('node:fs')
const adminPort = Number(process.argv[2] || 18080)
const entryPort = Number(process.argv[3] || 18081)

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) {
    pass += 1
    console.log(`✓ ${name}${extra ? ` — ${extra}` : ''}`)
  } else {
    fail += 1
    console.log(`✗ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

const req = async (port, { method = 'GET', path = '/', headers = {}, body } = {}) => {
  const init = { method, headers: { ...headers }, redirect: 'manual' }
  if (body !== undefined) init.body = body
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init)
  const text = await res.text().catch(() => '')
  return { status: res.status, headers: res.headers, text }
}

const admin = { 'x-myphone-admin': '1', 'content-type': 'application/json' }

// 1. 电脑端出票
const tk = await req(adminPort, { method: 'POST', path: '/__myphone/api/ticket', headers: admin, body: '{}' })
const { ticket } = JSON.parse(tk.text || '{}')
check('电脑端出票', Boolean(ticket), `HTTP ${tk.status}`)

// 2. 手机扫码 → 信任页
const trust = await req(entryPort, { path: `/__myphone/pair?t=${encodeURIComponent(ticket)}` })
check('扫码进来是「信任」页', trust.status === 200 && trust.text.includes('信任这台电脑'), `HTTP ${trust.status}`)

// 3. 点「信任」→ 303，且回跳地址里带长期凭据 _k=
const post = await req(entryPort, {
  method: 'POST',
  path: '/__myphone/pair',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: `t=${encodeURIComponent(ticket)}`,
})
const location = post.headers.get('location') || ''
const cookie = post.headers.get('set-cookie') || ''
const key = (location.match(/[?#&]_k=([^&]+)/) || [])[1] || ''
check('点信任后 303', post.status === 303, `HTTP ${post.status}`)
check('回跳地址带长期凭据 _k=', Boolean(key), location)
check('同时下发了设备 cookie', cookie.includes('myphone_dev='), cookie.slice(0, 40))

// 4. 模拟「cookie 被浏览器清掉」：只带那把钥匙来 POST
const relogin = await req(entryPort, {
  method: 'POST',
  path: '/__myphone/pair',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: `lt=${encodeURIComponent(key)}`,
})
const fresh = relogin.headers.get('set-cookie') || ''
check('凭钥匙免确认登入 303', relogin.status === 303, `HTTP ${relogin.status}`)
check('补发了新 cookie', fresh.includes('myphone_dev='), fresh.slice(0, 40))

// 5. 拿着补发的 cookie 直接进 DSH
const devCookie = fresh.split(';')[0]
const inside = await req(entryPort, { path: '/', headers: { cookie: devCookie } })
check('带新 cookie 进到真 DSH', inside.status === 200 && /DeepSeek Harness/.test(inside.text), `HTTP ${inside.status} ${inside.text.length}B`)

// 6. 电脑端删掉这台设备 → 钥匙立刻作废
// 面板接口挂在宿主 web 服务上（要 dsh-auth cookie），这里直接读宿主写出的状态文件更省事
const stateFile = process.argv[4] || ''
let list = []
if (stateFile) {
  try {
    const raw = JSON.parse(readFileSync(stateFile, 'utf8'))
    list = (raw.devices || []).map((d) => ({
      id: d.id,
      addedAt: d.createdAt,
      remembered: Array.isArray(d.passKeys) && d.passKeys.length > 0,
    }))
  } catch (err) {
    console.log(`（读状态文件失败：${err.message}）`)
  }
}
const newest = list.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))[0]
check('设备记录里存下了长期凭据', Boolean(newest && newest.remembered), JSON.stringify(newest && newest.id))
if (newest) {
  await req(adminPort, {
    method: 'POST',
    path: '/__myphone/api/remove',
    headers: admin,
    body: JSON.stringify({ id: newest.id }),
  })
  const again = await req(entryPort, {
    method: 'POST',
    path: '/__myphone/pair',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `lt=${encodeURIComponent(key)}`,
  })
  check('删设备后钥匙作废（401 扫码页）', again.status === 401 && again.text.includes('扫'), `HTTP ${again.status}`)
  const afterCookie = await req(entryPort, { path: '/', headers: { cookie: devCookie } })
  check('删设备后旧 cookie 也进不去', afterCookie.status !== 200, `HTTP ${afterCookie.status}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
