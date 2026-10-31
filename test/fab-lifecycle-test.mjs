// 悬浮球生命周期的「结构断言」。
// 这个 bug 反复过三次（球闪一下就没了 / 只剩右下角小 logo），每次都是同一类错误：
// 拿 document.getElementById 去找一个可能已经被宿主移出文档的容器。
// 这个测试不做 DOM 运行时，只把「不能退回旧写法」钉死在源码上。
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
let pass = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    pass += 1
    console.log(`✓ ${name}`)
  } else {
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`)
    process.exitCode = 1
  }
}

check('保留容器引用（脱离文档后仍能找回同一个节点）', /let portalEl = null/.test(src))
check(
  'portalHost 优先用引用、而不是只靠 getElementById',
  /portalEl && portalEl\.id === PORTAL_ID \? portalEl : document\.getElementById\(PORTAL_ID\)/.test(src),
)
check('新建容器时把引用记下来', /portalEl = el\n\s+parent\.appendChild\(el\)/.test(src))
check(
  '巡检时把被摘走的容器原地放回（不重渲染）',
  /appendChild\(portalEl\)/.test(src) && /portal-reattach/.test(src),
)
check(
  '判断 React 球是否在，排除兜底球',
  /\.dmp-wrap:not\(\.dmp-fallback\)/.test(src),
)
check('React 球回来后摘掉兜底球', /querySelector\('\.dmp-fallback'\)/.test(src))
check(
  '巡检间隔不超过 1.5 秒',
  (() => {
    const m = src.match(/setInterval\(ensureFab, (\d+)\)/)
    return m ? Number(m[1]) <= 1500 : false
  })(),
)

console.log(`\n${pass}/7 通过`)
