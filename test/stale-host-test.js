// 「旧隧道域名」守门测试：不需要真 DSH 上游，只验证入口在识别到过期域名时
// 给的是人话（「这个地址已经过期了」），而不是让浏览器转半天再报 502 / 不是私密连接。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { MyPhoneState } from '../src/state.js'
import { createGate } from '../src/gate.js'

const PORT = 18391
const LIVE = 'live-demo.trycloudflare.com'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myphone-stale-'))
const state = new MyPhoneState(dir)
state.patchSettings({ lanPort: 18390, publicPort: PORT, lanEnabled: true, tunnelEnabled: true })

const log = { info() {}, warn() {}, error() {} }
const gate = createGate({
  state,
  session: {
    async get() {
      throw new Error('测试里不该走到上游')
    },
  },
  log,
  // 当前「真实」的隧道地址：域名换成别的就该判过期
  getAddresses: () => [`https://${LIVE}/`, 'http://192.168.1.107:18391/'],
  getStatus: () => ({ tunnel: { phase: 'running', url: `https://${LIVE}/` } }),
  logFile: path.join(dir, 'pair.log'),
})

function fetch1(host, pathname = '/') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: pathname, headers: { host } }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

let pass = 0
const check = async (name, fn) => {
  try {
    await fn()
    pass += 1
    console.log(`✓ ${name}`)
  } catch (err) {
    console.error(`✗ ${name} — ${err.message}`)
    process.exitCode = 1
  }
}

await gate.startPublic(PORT)

await check('旧隧道域名 → 410 + 「这个地址已经过期了」', async () => {
  const r = await fetch1('old-dead-beef.trycloudflare.com')
  assert.equal(r.status, 410)
  assert.ok(r.body.includes('这个地址已经过期了'), '缺少过期提示')
  assert.ok(r.body.includes(LIVE), '应该告诉用户现在的地址')
  assert.ok(!r.body.includes('dsh web authentication required'), '不该把浏览器导向上游')
})

await check('当前隧道域名 → 不是过期页（正常走扫码页 401）', async () => {
  const r = await fetch1(LIVE)
  assert.equal(r.status, 401)
  assert.ok(r.body.includes('用手机扫电脑上的码'), '应该是扫码页')
})

await check('局域网地址不受影响 → 仍是扫码页 401', async () => {
  const r = await fetch1('192.168.1.107:18391')
  assert.equal(r.status, 401)
  assert.ok(r.body.includes('用手机扫电脑上的码'))
})

await check('取码接口在旧域名上也被拦下', async () => {
  const r = await fetch1('old-dead-beef.trycloudflare.com', '/__myphone/pair?t=whatever')
  assert.equal(r.status, 410)
  assert.ok(r.body.includes('这个地址已经过期了'))
})

await check('拒绝记录写进 pair.log', () => {
  const text = fs.readFileSync(path.join(dir, 'pair.log'), 'utf8')
  assert.ok(text.includes('旧隧道域名'), 'pair.log 应该记一笔')
})

await gate.close()
fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n${pass}/5 通过`)
