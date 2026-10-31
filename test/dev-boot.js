// 本机自测：把 gate 拉起来跑完整链路（配对 → 代理 → 402/403 分支）
// 用法：node test/dev-boot.js          （常驻，手工在浏览器里点）
//       node test/dev-boot.js --selftest（跑断言后退出）
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { MyPhoneState } from '../src/state.js'
import { createGate } from '../src/gate.js'
import { devSession } from './dev-session.js'

const SELFTEST = process.argv.includes('--selftest')
const stateDir = path.join(process.cwd(), '.dev-state')
fs.rmSync(stateDir, { recursive: true, force: true })
const state = new MyPhoneState(stateDir)
state.patchSettings({ lanEnabled: true })
const session = devSession({ port: Number(process.env.POCKET_UPSTREAM_PORT || 13998) })
const log = { info: (...a) => console.log('·', ...a), error: (...a) => console.error('✗', ...a) }

let gate
gate = createGate({
  state,
  session,
  log,
  getAddresses: () => (gate.publicPort ? [`http://127.0.0.1:${gate.publicPort}/`] : []),
  getStatus: () => ({ tunnel: null }),
})

const adminPort = await gate.startAdmin(0)
const publicPort = await gate.startPublic(0)

function req(port, { method = 'GET', path: p = '/', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
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

const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra })
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)
}

console.log(`admin:  http://127.0.0.1:${adminPort}/__myphone/`)
console.log(`public: http://127.0.0.1:${publicPort}/`)

if (!SELFTEST) {
  console.log('常驻中，Ctrl+C 退出')
} else {
  // 1. 管理页只在本机
  const admin = await req(adminPort, { path: '/__myphone/' })
  check('管理页 200 且含标题', admin.status === 200 && admin.body.includes('DSH My Phone'), `HTTP ${admin.status}`)
  check('管理页含红色高危提示', admin.body.includes('没有锁') && admin.body.includes('danger'))
  // 1b. v0.6 起不再自动发票：打开页面先看到「生成二维码」按钮，点了才有码
  check(
    '管理页默认不出码（要手动点）',
    admin.body.includes('生成二维码') && admin.body.includes('还没有二维码'),
    'no-auto-ticket',
  )
  check(
    '自动关闭只留外网通道（局域网不自动关）',
    admin.body.includes('id="autooff-tunnel"') &&
      admin.body.includes('外网入口自动关闭') &&
      !admin.body.includes('id="autooff-lan"'),
  )
  await req(adminPort, {
    method: 'POST',
    path: '/__myphone/api/ticket',
    headers: { 'content-type': 'application/json', 'x-myphone-admin': '1' },
    body: '{}',
  })
  const adminAfterTicket = await req(adminPort, { path: '/__myphone/' })
  check(
    '出票后管理页含配对二维码',
    adminAfterTicket.body.includes('qrbox') && adminAfterTicket.body.includes('<svg'),
    'qrcode',
  )

  // 2. 公共口不能看管理页
  const adminViaPublic = await req(publicPort, { path: '/__myphone/' })
  check('公共口拒绝管理页', adminViaPublic.status === 404, `HTTP ${adminViaPublic.status}`)

  // 3. 未配对 → 扫码页 401（入口没有手输密码/配对码这一页了）
  const anon = await req(publicPort, { path: '/' })
  check(
    '未配对返回扫码页',
    anon.status === 401 && anon.body.includes('用手机扫电脑上的码') && !anon.body.includes('name="code"'),
    `HTTP ${anon.status}`,
  )

  // 4. 手输 6 位码的通道已经彻底关掉（页面里也没有输码的地方了）
  const bad = await req(publicPort, {
    method: 'POST',
    path: '/__myphone/pair',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'code=ZZZ-ZZZ',
  })
  check('手输配对码被拒', bad.status === 403, `HTTP ${bad.status}`)

  // 5. 取二维码票据（现在只有这一条路）
  const pairRes = await req(adminPort, {
    method: 'POST',
    path: '/__myphone/api/ticket',
    headers: { 'content-type': 'application/json', 'x-myphone-admin': '1' },
    body: '{}',
  })
  const { ticket: firstTicket } = JSON.parse(pairRes.body)
  check('生成二维码票据', Boolean(firstTicket) && String(firstTicket).length >= 20, String(firstTicket || '').slice(0, 12))

  const trustOpen = await req(publicPort, { path: `/__myphone/pair?t=${encodeURIComponent(firstTicket)}` })
  check('扫码打开的是「信任」页', trustOpen.status === 200 && trustOpen.body.includes('信任这台电脑'), `HTTP ${trustOpen.status}`)

  // 6. 点「信任」→ 303 + cookie
  const paired = await req(publicPort, {
    method: 'POST',
    path: '/__myphone/pair',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Mozilla/5.0 (iPhone)' },
    body: `t=${encodeURIComponent(firstTicket)}`,
  })
  const cookie = (paired.headers['set-cookie'] || []).find((c) => c.startsWith('myphone_dev='))
  check('配对成功下发设备 cookie', paired.status === 303 && Boolean(cookie), `HTTP ${paired.status}`)
  check('设备已登记', state.devices.length === 1, state.devices.map((d) => d.label).join(','))

  // 6.5 手机端只读接口：没凭据不给，有凭据才给出「我是谁 + 最近事件」
  const iconPublic = await req(publicPort, { path: '/__myphone/icon.png' })
  check(
    '图标在入口口也能取到（手机端图标才对）',
    iconPublic.status === 200 && String(iconPublic.headers['content-type'] || '').includes('image/png'),
    `HTTP ${iconPublic.status}`,
  )
  const stateAnon = await req(publicPort, { path: '/__myphone/state' })
  check('只读状态口拒绝匿名', stateAnon.status === 401, `HTTP ${stateAnon.status}`)
  const stateMine = await req(publicPort, {
    path: '/__myphone/state',
    headers: { cookie: cookie.split(';')[0] },
  })
  let stateBody = null
  try {
    stateBody = JSON.parse(stateMine.body)
  } catch {
    stateBody = null
  }
  check(
    '只读状态口给手机用',
    stateMine.status === 200 && stateBody && stateBody.ok === true && Boolean(stateBody.device && stateBody.device.label),
    `HTTP ${stateMine.status}`,
  )
  // v1.2.2：手机端也能看消息、也能点掉「知道了」（只标已读，不代答授权）
  check(
    '只读状态口带消息中心',
    Boolean(stateBody && stateBody.feed && Array.isArray(stateBody.feed.pending) && Array.isArray(stateBody.feed.human)),
    'feed',
  )
  const ackAnon = await req(publicPort, {
    method: 'POST',
    path: '/__myphone/ack',
    headers: { 'content-type': 'application/json', 'x-myphone-phone': '1' },
    body: JSON.stringify({ notice: 1 }),
  })
  check('手机 ack 拒绝匿名', ackAnon.status === 401, `HTTP ${ackAnon.status}`)
  const ackNoHeader = await req(publicPort, {
    method: 'POST',
    path: '/__myphone/ack',
    headers: { 'content-type': 'application/json', cookie: cookie.split(';')[0] },
    body: JSON.stringify({ notice: 1 }),
  })
  check('手机 ack 要自定义头（防 CSRF）', ackNoHeader.status === 403, `HTTP ${ackNoHeader.status}`)

  // 7. 二维码只能用一次（重放同一张票）
  const replay = await req(publicPort, {
    method: 'POST',
    path: '/__myphone/pair',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `t=${encodeURIComponent(firstTicket)}`,
  })
  check('二维码不可重放', replay.status === 401 || replay.status === 410, `HTTP ${replay.status}`)

  // 8. 带 cookie → 走代理拿到真实 DSH 首页
  const tok = cookie.split(';')[0]
  const proxied = await req(publicPort, { path: '/', headers: { cookie: tok } })
  check(
    '带凭据代理到真实 DSH',
    proxied.status === 200 && /<html|<!doctype/i.test(proxied.body),
    `HTTP ${proxied.status}, ${proxied.body.length} bytes`,
  )

  // 9. 伪造 cookie → 拒绝
  const forged = await req(publicPort, { path: '/', headers: { cookie: 'myphone_dev=pk1.deadbeef.9999999999999.badsig' } })
  check('伪造设备 cookie 被拒', forged.status === 401, `HTTP ${forged.status}`)

  // 9b. 二维码票据（v0.3）：扫码进来的是「信任」页，点了才建立设备
  const ticketRes = await req(adminPort, {
    method: 'POST',
    path: '/__myphone/api/ticket',
    headers: { 'content-type': 'application/json', 'x-myphone-admin': '1' },
    body: '{}',
  })
  const { ticket, url: ticketUrl } = JSON.parse(ticketRes.body)
  check('生成二维码票据', Boolean(ticket) && String(ticket).length >= 20 && /t=/.test(ticketUrl || ''), `${ticketUrl}`)

  const trustHtml = await req(publicPort, { path: `/__myphone/pair?t=${encodeURIComponent(ticket)}` })
  check(
    '扫码后是「信任」页',
    trustHtml.status === 200 && trustHtml.body.includes('信任这台电脑') && trustHtml.body.includes('name="t"'),
    `HTTP ${trustHtml.status}`,
  )

  const trustPost = await req(publicPort, {
    method: 'POST',
    path: '/__myphone/pair',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Mozilla/5.0 (iPhone)' },
    body: `t=${encodeURIComponent(ticket)}`,
  })
  const ticketCookie = (trustPost.headers['set-cookie'] || []).find((c) => c.startsWith('myphone_dev='))
  const newest = state.devices[state.devices.length - 1]
  check(
    '点「信任」后下发凭据且设备被信任',
    trustPost.status === 303 && Boolean(ticketCookie) && Boolean(newest?.trustedAt),
    `HTTP ${trustPost.status}`,
  )

  const ticketReplay = await req(publicPort, { path: `/__myphone/pair?t=${encodeURIComponent(ticket)}` })
  check('二维码票据不可重放', ticketReplay.status === 410, `HTTP ${ticketReplay.status}`)

  // 9b-1b. 已经配上对的手机再点一次「进入 DSH」（连点 / 自动提交 + 手点撞一起）：
  // 票是一次性的，第二次必然失效 —— 但只要带着有效凭据，就该直接放行而不是甩错误页。
  const replayWithCookie = await req(publicPort, {
    method: 'POST',
    path: '/__myphone/pair',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'Mozilla/5.0 (iPhone)',
      cookie: ticketCookie,
    },
    body: `t=${encodeURIComponent(ticket)}`,
  })
  check(
    '已配对的手机重复点「进入 DSH」直接放行',
    replayWithCookie.status === 303 && replayWithCookie.headers.location === '/',
    `HTTP ${replayWithCookie.status}`,
  )

  const replayAnon = await req(publicPort, {
    method: 'POST',
    path: '/__myphone/pair',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Mozilla/5.0 (iPhone)' },
    body: `t=${encodeURIComponent(ticket)}`,
  })
  check('未配对的手机重复用同一张票 → 拒', replayAnon.status === 401, `HTTP ${replayAnon.status}`)

  // 9b-2. 同一台手机（同 UA）再扫一次：走「正在恢复连接」，不用再点一次信任
  const againTicket = JSON.parse(
    (
      await req(adminPort, {
        method: 'POST',
        path: '/__myphone/api/ticket',
        headers: { 'content-type': 'application/json', 'x-myphone-admin': '1' },
        body: '{}',
      })
    ).body,
  ).ticket
  const relinkGet = await req(publicPort, {
    path: `/__myphone/pair?t=${encodeURIComponent(againTicket)}`,
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone)' },
  })
  check(
    '已信任设备再扫码走「恢复连接」页',
    relinkGet.status === 200 &&
      relinkGet.body.includes('正在恢复连接') &&
      !relinkGet.body.includes('信任这台电脑？'),
    `HTTP ${relinkGet.status}`,
  )
  const relinkPost = await req(publicPort, {
    method: 'POST',
    path: '/__myphone/pair',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Mozilla/5.0 (iPhone)' },
    body: `t=${encodeURIComponent(againTicket)}`,
  })
  check(
    '恢复连接自动接上（不用再点信任）',
    relinkPost.status === 303 &&
      Boolean((relinkPost.headers['set-cookie'] || []).find((c) => c.startsWith('myphone_dev='))),
    `HTTP ${relinkPost.status}`,
  )

  // 9c. 未信任的设备一律进不去
  state.untrustDevice(newest.id)
  const untrusted = await req(publicPort, { path: '/', headers: { cookie: ticketCookie.split(';')[0] } })
  check('未信任设备被拒', untrusted.status === 403 && untrusted.body.includes('还没有被信任'), `HTTP ${untrusted.status}`)
  state.trustDevice(newest.id)


  // 10. CSRF：无自定义头的 API 调用被拒
  const csrf = await req(adminPort, {
    method: 'POST',
    path: '/__myphone/api/pair',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  check('管理 API 需要 CSRF 头', csrf.status === 403, `HTTP ${csrf.status}`)

  // 13. 自动关闭时长可设置
  const auto = await req(adminPort, {
    method: 'POST',
    path: '/__myphone/api/autooff',
    headers: { 'content-type': 'application/json', 'x-myphone-admin': '1' },
    body: JSON.stringify({ minutes: 45 }),
  })
  check('可设置空闲自动关闭分钟数', auto.status === 200 && state.settings.autoOffMinutes === 45, `HTTP ${auto.status}`)
  // v0.6：带 key 只改那一条通道，另一条不动
  await req(adminPort, {
    method: 'POST',
    path: '/__myphone/api/autooff',
    headers: { 'content-type': 'application/json', 'x-myphone-admin': '1' },
    body: JSON.stringify({ key: 'lan', minutes: 15 }),
  })
  check(
    '按通道设置自动关闭互不影响',
    state.settings.lanAutoOffMinutes === 15 && state.settings.tunnelAutoOffMinutes === 45,
    `lan=${state.settings.lanAutoOffMinutes} tunnel=${state.settings.tunnelAutoOffMinutes}`,
  )
  const badAuto = await req(adminPort, {
    method: 'POST',
    path: '/__myphone/api/autooff',
    headers: { 'content-type': 'application/json', 'x-myphone-admin': '1' },
    body: JSON.stringify({ minutes: -1 }),
  })
  check('非法自动关闭值被拒', badAuto.status === 400, `HTTP ${badAuto.status}`)

  // 9c. 网络自检页（手机排查证书/打不开用）：门面是公开的，但不读任何凭据
  const diag = await req(publicPort, { path: '/__myphone/diag' })
  check(
    '自检页可匿名打开',
    diag.status === 200 && diag.body.includes('网络自检') && diag.body.includes("/__myphone/diag/time"),
    `HTTP ${diag.status}`,
  )
  const diagTime = await req(publicPort, { path: '/__myphone/diag/time' })
  let diagNow = 0
  try {
    diagNow = JSON.parse(diagTime.body).now
  } catch {
    diagNow = 0
  }
  check('自检校时接口返回服务器时间', diagTime.status === 200 && Math.abs(Date.now() - diagNow) < 60000, `now=${diagNow}`)
  const diagReport = await req(publicPort, {
    method: 'POST',
    path: '/__myphone/diag/report',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ at: new Date().toISOString(), skewMs: 1500, probes: [{ label: '对照', ok: true }], env: {} }),
  })
  check('自检上报被接收', diagReport.status === 204, `HTTP ${diagReport.status}`)

  console.log('\n' + results.filter((r) => r.ok).length + '/' + results.length + ' 通过')
  await gate.close()
  fs.rmSync(stateDir, { recursive: true, force: true })
  process.exit(results.every((r) => r.ok) ? 0 : 1)
}
