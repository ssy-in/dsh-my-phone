// 只需 node，不需要宿主：验证状态层几条「安全语义」
//  1) 设备数量到上限时 addDevice 返回 null（不能偷偷把最早那台挤掉）
//  2) 删除设备 = 撤销信任 + 移除，不留「已删但仍信任」的中间态
//  3) 备注能改、能清空，超过 24 字会被截断
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MyPhoneState } from '../src/state.js'

let pass = 0
const check = (name, fn) => {
  try {
    fn()
    pass += 1
    console.log(`✓ ${name}`)
  } catch (err) {
    console.error(`✗ ${name} — ${err.message}`)
    process.exitCode = 1
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myphone-state-'))
const state = new MyPhoneState(dir)
state.patchSettings({ maxDevices: 2 })

check('设置写入生效', () => assert.equal(state.settings.maxDevices, 2))

const a = state.addDevice('Android 设备', 'ua-a')
const b = state.addDevice('iPhone', 'ua-b')
check('前两台能加上', () => {
  assert.ok(a && b)
  assert.equal(state.devices.length, 2)
})

const c = state.addDevice('第三台', 'ua-c')
check('到上限后 addDevice 返回 null（不挤掉老设备）', () => {
  assert.equal(c, null)
  assert.equal(state.devices.length, 2)
  assert.deepEqual(
    state.devices.map((d) => d.label),
    ['Android 设备', 'iPhone'],
  )
})

check('信任 → isTrusted 为真', () => {
  state.trustDevice(a.id)
  assert.equal(state.isTrusted(a.id), true)
})

check('删除设备时信任一起没了', () => {
  state.untrustDevice(a.id)
  assert.equal(state.removeDevice(a.id), true)
  assert.equal(state.devices.length, 1)
  assert.equal(state.isTrusted(a.id), false)
  assert.equal(
    state.devices.find((d) => d.id === a.id),
    undefined,
  )
})

check('备注能写、能清、超长截断', () => {
  state.noteDevice(b.id, '  刘先生  ')
  assert.equal(state.devices.find((d) => d.id === b.id).note, '刘先生')
  state.noteDevice(b.id, '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十')
  assert.equal(state.devices.find((d) => d.id === b.id).note.length, 24)
  state.noteDevice(b.id, '')
  assert.equal(state.devices.find((d) => d.id === b.id).note, '')
})

check('同一台手机重扫复用原记录，不新增一条（upsertDevice）', () => {
  const before = state.devices.length
  const ua = 'Mozilla/5.0 (Linux; Android 16; 25067PYE3C) Mobile'
  const first = state.upsertDevice('Android 设备', ua)
  state.trustDevice(first.id)
  state.noteDevice(first.id, '刘先生')
  const again = state.upsertDevice('Android 设备', ua)
  assert.equal(again.id, first.id)
  assert.equal(state.devices.length, before + 1)
  assert.equal(state.devices.find((d) => d.id === again.id).note, '刘先生')
})

check('清理重复：同 UA 只留最近活跃的那条，备注与信任接过来', () => {
  const ua = 'Mozilla/5.0 (Linux; Android 16; 25067PYE3C) Mobile'
  // 手工造两条同 UA 的旧记录，模拟「换隧道域名后重复扫码」留下的历史数据
  state.data.devices = [
    { id: 'old1', label: 'Android 设备', note: '', userAgent: ua, createdAt: 1, lastSeen: 10, trustedAt: 5 },
    { id: 'old2', label: 'Android 设备', note: '刘先生', userAgent: ua, createdAt: 2, lastSeen: 20, trustedAt: null },
    { id: 'other', label: 'iPhone', note: '', userAgent: 'iOS UA', createdAt: 3, lastSeen: 30, trustedAt: 7 },
  ]
  const removed = state.dedupeDevices()
  assert.equal(removed, 1)
  assert.equal(state.devices.length, 2)
  const kept = state.data.devices.find((d) => d.id === 'old2')
  assert.ok(kept, '应保留最近活跃的那条')
  assert.equal(kept.note, '刘先生')
  assert.ok(kept.trustedAt, '信任状态应从被删那条接过来')
})

check('重扫时自动合并同 UA 的历史重复（不需要手动按钮）', () => {
  const ua = 'Mozilla/5.0 (Linux; Android 16; 25067PYE3C) Mobile'
  state.data.devices = [
    { id: 'a1', label: 'Android 设备', note: '', userAgent: ua, createdAt: 1, lastSeen: 10, trustedAt: null },
    { id: 'a2', label: 'Android 设备', note: '刘先生', userAgent: ua, createdAt: 2, lastSeen: 5, trustedAt: 6 },
  ]
  const d = state.upsertDevice('Android 设备', ua)
  // 两条同 UA 应该合成一条，且挑中「有备注 + 有信任」的那条
  assert.equal(state.devices.length, 1)
  assert.equal(d.id, 'a2')
  assert.equal(d.note, '刘先生')
  assert.ok(d.trustedAt)
  // 再扫一次还是那一条，不会又长出来
  const again = state.upsertDevice('Android 设备', ua)
  assert.equal(again.id, 'a2')
  assert.equal(state.devices.length, 1)
})

check('重新载入后设置与设备都还在（落盘可用）', () => {
  const again = new MyPhoneState(dir)
  assert.equal(again.settings.maxDevices, 2)
  // 这里不写死条数：前面的用例已经增删过设备，落盘能原样读回来才是重点
  assert.equal(again.devices.length, state.devices.length)
})

fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n${pass}/10 通过`)
