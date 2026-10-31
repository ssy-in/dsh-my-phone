// 静态扫描：渲染路径上「先用后声明」的 const（TDZ）。
// 事故来源：`entryOpen` 被 remoteConnect 引用，声明却写在后面 →
// 渲染抛 "Cannot access 'entryOpen' before initialization" → 错误边界把整颗球换成兜底小球，
// 点一下又崩（表现成「小 logo，点了闪一下大 logo」）。node --check 只查语法，抓不到这类。
//
// 扫描器是启发式的：它分不清「引用写在箭头函数体里（调用时才求值，安全）」和
// 「渲染路径上直接求值（会炸）」，所以凡是被它点名的名字都必须在这里登记一句理由。
// 新代码如果踩到同样的坑又没登记，这条测试就会红。
import { readFileSync } from 'node:fs'

// 已知安全：引用发生在「稍后才被调用的函数体」里，渲染那一刻不会求值
const SAFE = new Map([
  ['bubbleCard', '在 bubbleCard() / 事件回调里用到 data.notices，调用时才有值'],
  ['audio', '在 useEffect / 事件回调里用 audio，渲染期不触碰'],
  ['pairUrl', '在 useEffect 的回调里用 data.pairUrl'],
  ['left', '在 useEffect 里操作 DOM 时用'],
  ['notices', '在 bubbleCard() 函数体里用'],
  ['unread', '在 useEffect 的轮询回调里用'],
  ['approvals', '在 useEffect 的回调里用'],
  ['alerts', '在 useEffect 的回调里用'],
  ['infoDot', '在 sectionTitle() 函数体里用，sectionTitle 调用时 infoDot 已初始化'],
  ['entry', '在 feedHumanBlock() 等函数体里用'],
  ['host', '在 portalHost() 函数体里用'],
])

const lines = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8').split('\n')
const start = lines.findIndex((l) => /function PhoneFab/.test(l))
if (start < 0) {
  console.error('✗ 没找到 PhoneFab')
  process.exit(1)
}
let end = lines.findIndex((l, i) => i > start && /^ {4}return \{/.test(l))
if (end < 0) end = lines.length

const decls = []
for (let i = start; i < end; i += 1) {
  const m = lines[i].match(/^ {6}const ([A-Za-z_$][\w$]*)\s*[=:]/)
  if (m) decls.push({ name: m[1], line: i + 1 })
}

const bad = []
for (const d of decls) {
  if (SAFE.has(d.name)) continue
  const re = new RegExp(`\\b${d.name.replace(/\$/g, '\\$')}\\b`)
  for (let i = start; i < d.line - 1; i += 1) {
    const src = lines[i]
    if (/^\s*(\/\/|\*|\/\*)/.test(src)) continue
    if (!re.test(src)) continue
    bad.push({ name: d.name, decl: d.line, use: i + 1, code: src.trim().slice(0, 80) })
    break
  }
}

if (bad.length) {
  console.log(`✗ 渲染路径上有 ${bad.length} 处「先用后声明」，运行时会抛 before initialization：`)
  for (const b of bad) console.log(`  ${b.name}  声明在 ${b.decl} 行，但 ${b.use} 行就用了 :: ${b.code}`)
  console.log('  如果你确认这是「稍后才调用」的安全引用，在 test/tdz-scan.mjs 的 SAFE 里登记一句理由。')
  process.exit(1)
}
console.log(`✓ 检查了 ${decls.length} 个声明（${SAFE.size} 个已登记为延迟求值），没有新问题`)
