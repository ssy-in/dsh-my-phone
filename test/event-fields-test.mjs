// 事件字段名守卫：这几处读错字段名时功能是「静默失效」的 —— 不报错、只是永远不触发，
// v1.8.48 就因此误判成「宿主不派发 tool/call」。这里直接对源码做定点检查。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'src/index.js'), 'utf8')

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok) {
    pass += 1
    console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`)
  } else {
    fail += 1
    console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

// 内核 SessionEventMap：
//   'tool/call':   { turn, step, callId, name, arguments }     ← 工具名在 name
//   'tool/result': { turn, step, message, error?, meta? }       ← 调用 id 在 message.toolCallId
//   'approval/asked': { id, toolName, callId?, reason? }        ← 工具名在 toolName
const block = (start, end) => {
  const i = src.indexOf(start)
  if (i < 0) return ''
  const j = src.indexOf(end, i + start.length)
  return src.slice(i, j < 0 ? src.length : j)
}

const toolCall = block("if (event.type === 'tool/call')", "if (event.type === 'tool/result')")
const toolResult = block("if (event.type === 'tool/result')", "compaction/start")
const approval = block("event.type === 'approval/asked'", "event.type === 'approval/decided'")

check("tool/call 分支读 evf('name')（内核字段名）", /evf\('name'\)/.test(toolCall), '')
check('tool/call 分支保留 toolName 兜底', /evf\('toolName'\)/.test(toolCall), '')
check('ask_user_question 的判定还在', /ask\[\?_-\?\]\?user|ask\[\_\-\]\?user|ask_user/i.test(src), '')
check("tool/result 分支用 message.toolCallId 收气泡", /message\.toolCallId|message\s*&&\s*ev\.message\.toolCallId/.test(toolResult), '')
check("approval/asked 分支读 toolName（这个字段本来就是 toolName）", /evf\('toolName'\)/.test(approval), '')

// 反向：tool/call 分支里不要再出现「只读 toolName」这种写法
// （approval/asked 分支读 toolName 是对的，不能一起判）
const badToolOnly = /const tool = String\(evf\('toolName'\) \|\| ''\)/.test(toolCall)
check('tool/call 分支没有退回「只读 toolName」的老写法', !badToolOnly, '')

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail ? 1 : 0)
