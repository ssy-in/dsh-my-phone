// 模式事件翻译的单测：node test/modes-test.js
import assert from 'node:assert/strict'
import { describeMode, labelOf, MODE_KNOBS } from '../src/modes.js'

let pass = 0
let fail = 0
function check(name, fn) {
  try {
    fn()
    pass += 1
    console.log(`✓ ${name}`)
  } catch (e) {
    fail += 1
    console.log(`✗ ${name} — ${e.message}`)
  }
}

check('权限预设 auto → 自动判断', () => {
  assert.deepEqual(describeMode({ type: 'permission/preset', preset: 'auto' }), { key: '权限', label: '自动判断' })
})

check('权限预设自定义', () => {
  assert.equal(describeMode({ type: 'permission/preset', preset: 'custom' }).label, '自定义')
})

check('沙箱 read-only → 只读', () => {
  assert.deepEqual(describeMode({ type: 'sandbox/mode', mode: 'read-only' }), { key: '沙箱', label: '只读' })
})

check('沙箱 danger-full-access → 完全放开', () => {
  assert.equal(describeMode({ type: 'sandbox/mode', mode: 'danger-full-access' }).label, '完全放开')
})

check('审批 ask → 每次都问', () => {
  assert.deepEqual(describeMode({ type: 'approval/policy', policy: 'ask' }), { key: '审批', label: '每次都问' })
})

check('计划模式 true/false', () => {
  assert.equal(describeMode({ type: 'plan/mode', active: true }).label, '开启')
  assert.equal(describeMode({ type: 'plan/mode', active: false }).label, '关闭')
})

check('换模型拼接 provider/model', () => {
  assert.deepEqual(describeMode({ type: 'model/selection', provider: 'deepseek', model: 'v4' }), {
    key: '模型',
    label: 'deepseek / v4',
  })
})

check('模型事件没有字段 → 不发通知', () => {
  assert.equal(describeMode({ type: 'model/selection' }), null)
})

check('不认识的枚举原样透出，不吞信息', () => {
  assert.equal(describeMode({ type: 'permission/preset', preset: 'weird-value' }).label, 'weird-value')
})

check('空值 → 未知', () => {
  assert.equal(describeMode({ type: 'sandbox/mode' }).label, '未知')
})

check('非模式事件 → null', () => {
  assert.equal(describeMode({ type: 'turn/end' }), null)
  assert.equal(describeMode(null), null)
  assert.equal(describeMode({}), null)
})

check('四个旋钮都在表里', () => {
  for (const k of ['permission/preset', 'sandbox/mode', 'approval/policy', 'plan/mode']) {
    assert.ok(MODE_KNOBS[k], `${k} 缺失`)
  }
})

check('labelOf 大小写不敏感', () => {
  assert.equal(labelOf(MODE_KNOBS['sandbox/mode'], 'READ-ONLY'), '只读')
})

console.log(`\n${pass}/${pass + fail} 通过`)
if (fail > 0) process.exitCode = 1
