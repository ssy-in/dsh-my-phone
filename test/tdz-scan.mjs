// 静态扫描：函数体里「先用后声明」的 const/let（TDZ）。
//
// 事故来源（v1.3.0）：`entryOpen` 被上面的渲染函数引用，`const` 声明却写在下面 →
// 渲染时抛 "Cannot access 'entryOpen' before initialization"，整个界面被错误边界换成兜底小球，
// 点一下又崩（表现为「小 logo，点了闪一下大 logo」）。`node --check` 只查语法，抓不到这类。
//
// 规则：以 `function name(` 划分函数体（按缩进判断归属），函数体内某名字的第一次出现
// 如果早于它的 const/let 声明行，就报警。已知安全的（引用写在稍后才调用的回调里）在 SAFE 登记。
import { readFileSync } from 'node:fs'

const SAFE = new Set([
  // widget.js 里大量用 var 提前声明，const 只在少数纯计算里出现；下面这些是「声明在前」的误报
  'h',
  'i',
  'k',
  'j',
])

const src = readFileSync(new URL('../src/widget.js', import.meta.url), 'utf8')
const lines = src.split('\n')

// 1. 找所有函数起点，算出每个函数体的行范围（到下一个同级或更外层的 function 前一行）
const funcs = []
lines.forEach((line, i) => {
  const m = line.match(/^(\s*)function\s+([A-Za-z_$][\w$]*)\s*\(/)
  if (m) funcs.push({ name: m[2], indent: m[1].length, start: i })
})
funcs.forEach((f, idx) => {
  let end = lines.length
  for (let n = idx + 1; n < funcs.length; n += 1) {
    if (funcs[n].indent <= f.indent) {
      end = funcs[n].start
      break
    }
  }
  f.end = end
})

// 2. 逐函数比对「使用」与「声明」的先后
const problems = []
funcs.forEach((f) => {
  const decls = new Map()
  for (let i = f.start; i < f.end; i += 1) {
    const m = lines[i].match(/^\s*(?:const|let)\s+([A-Za-z_$][\w$]*)/)
    if (m && !decls.has(m[1])) decls.set(m[1], i)
  }
  decls.forEach((declLine, name) => {
    if (SAFE.has(name)) return
    const re = new RegExp(`\\b${name}\\b`)
    for (let i = f.start; i < declLine; i += 1) {
      if (re.test(lines[i])) {
        problems.push(`${name}（${f.name} 内第 ${i + 1} 行先用，第 ${declLine + 1} 行才声明）`)
        break
      }
    }
  })
})

if (problems.length) {
  problems.forEach((p) => console.error('✗ ' + p))
  console.error(`\n✗ ${problems.length} 处可能 TDZ：把声明提到第一次使用之前，或在 SAFE 里登记理由`)
  process.exit(1)
}
console.log(`✓ 扫描了 ${funcs.length} 个函数，没有「先用后声明」的 const/let`)
