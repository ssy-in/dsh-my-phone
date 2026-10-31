// 悬浮球贴边几何的自测：直接从 src/client.js 里抠出这群纯函数（不依赖 DOM）跑断言。
// 目的：确认「贴哪条边 → 旋转、外接盒子、贴死百分比」三者自洽，改一个忘一个就会红。
import fs from 'node:fs'
import assert from 'node:assert'

const src = fs.readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')

const slice = (from, to) => {
  const a = src.indexOf(from)
  const b = src.indexOf(to, a)
  if (a < 0 || b < 0) throw new Error(`切不出片段：${from} … ${to}`)
  return src.slice(a, b)
}

const consts = slice('    const FAB_TILE = 135', '    const FAB_EDGE')
const helpers = slice('    const FAB_ROT =', '    function posOf(a, vw, vh)')
const defaultAnchorSrc = src.slice(src.indexOf('const DEFAULT_ANCHOR ='), src.indexOf('// 贴边朝向') > 0 ? src.indexOf('// 贴边朝向') : src.indexOf('const FAB_ROT ='))
const posOfSrc = slice('    function posOf(a, vw, vh)', '    function anchorStyle')

const code = `${consts}
const FAB_EDGE = 0
\n${helpers}\n${posOfSrc}\nreturn { FAB_W: FAB_W, FAB_H: FAB_H, edgeOf: edgeOf, boxFor: boxFor, posOf: posOf }`
const { FAB_W, FAB_H, edgeOf, boxFor, posOf } = new Function(code)()
const def = new Function(defaultAnchorSrc + '; return DEFAULT_ANCHOR')()

const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)
}

const VW = 1400
const VH = 900
const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol

// 贴死时该有的百分比（跟 onUp 里写的一致）
const flush = {
  left: { xp: FAB_H / 2 / VW, yp: 0.5 },
  right: { xp: 1 - FAB_H / 2 / VW, yp: 0.5 },
  top: { xp: 0.5, yp: FAB_H / 2 / VH },
  bottom: { xp: 0.5, yp: 1 - FAB_H / 2 / VH },
}

check('图标是紧裁后的比例（宽 > 高）', FAB_W === 135 && FAB_H === Math.round(135 * 459 / 512), `${FAB_W}x${FAB_H}`)

for (const edge of ['left', 'right', 'top', 'bottom']) {
  check(`贴${edge}边被判成 ${edge}`, edgeOf(flush[edge], VW, VH) === edge, String(edgeOf(flush[edge], VW, VH)))
  const box = boxFor(edge)
  const p = posOf(flush[edge], VW, VH)
  const side = edge === 'left' || edge === 'right'
  check(`贴${edge}边时外接盒子${side ? '宽高互换' : '保持原样'}`, side ? box.w === FAB_H && box.h === FAB_W : box.w === FAB_W && box.h === FAB_H, `${box.w}x${box.h}`)
  const left = p.x - box.w / 2
  const right = p.x + box.w / 2
  const top = p.y - box.h / 2
  const bottomY = p.y + box.h / 2
  const flushPx =
    edge === 'left' ? near(left, 0) : edge === 'right' ? near(right, VW) : edge === 'top' ? near(top, 0) : near(bottomY, VH)
  check(`贴${edge}边时外沿正好压在窗口边（0px 缝）`, flushPx, `L${left.toFixed(1)} R${right.toFixed(1)} T${top.toFixed(1)} B${bottomY.toFixed(1)}`)
}

// 不贴边（在中间）时不该旋转
check('窗口中间 → 不旋转', edgeOf({ xp: 0.5, yp: 0.5 }, VW, VH) === null)

// 默认锚点（v1.2.0 起是右上角贴右）应该被认成「贴右边」，且贴死
// 用真实的默认锚点（含 edge）
const defEdge = edgeOf(def, VW, VH)
check('默认位置存的就是贴右边（v1.2.0 改为右上）', def.edge === 'right' && defEdge === 'right', String(defEdge))
const defBox = boxFor(defEdge)
const defP = posOf(def, VW, VH)
check(
  '默认位置换算后仍在窗口内且贴死',
  near(defP.x + defBox.w / 2, VW) || near(defP.y + defBox.h / 2, VH),
  `x${defP.x.toFixed(1)} y${defP.y.toFixed(1)}`,
)

// 窗口缩放后（比如手机上 380x700）也要成立
const SW = 380
const SH = 700
const phoneFlush = { xp: 1 - FAB_H / 2 / SW, yp: 1 - FAB_H / 2 / SH }
const pe = edgeOf(phoneFlush, SW, SH)
check('手机竖屏窗口下同样判得出贴边', pe === 'right' || pe === 'bottom', String(pe))

const pass = results.filter((r) => r.ok).length
console.log(`\n${pass}/${results.length} 通过`)
process.exit(pass === results.length ? 0 : 1)
