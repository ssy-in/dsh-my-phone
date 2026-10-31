/**
 * 会话「模式」四个旋钮的中文翻译。
 *
 * 宿主把模式拆成四条独立的会话事件（都走 `ctx.on('session/event')`）：
 *   permission/preset { preset }   sandbox/mode { mode }
 *   approval/policy   { policy }   plan/mode    { active: boolean }
 * 另外 `model/selection` 是换模型，也归到同一个气泡通道里。
 *
 * 抽成独立模块只为一件事：能单测。枚举值来自宿主 schema，写错了这里一眼能看出来。
 */

export const MODE_KNOBS = {
  'permission/preset': {
    key: '权限',
    map: {
      auto: '自动判断',
      custom: '自定义',
      readonly: '只读',
      read_only: '只读',
      full: '完全放开',
      yolo: '完全放开',
    },
  },
  'sandbox/mode': {
    key: '沙箱',
    map: {
      'read-only': '只读',
      'workspace-write': '只写工作区',
      'danger-full-access': '完全放开',
    },
  },
  'approval/policy': {
    key: '审批',
    map: {
      ask: '每次都问',
      always: '每次都问',
      auto: '自动批准',
      'auto-approve': '自动批准',
      never: '从不询问',
      manual: '手动',
    },
  },
  'plan/mode': { key: '计划', map: { true: '开启', false: '关闭' } },
}

/** 把英文枚举翻成人话；不认识的枚举原样返回（不吞信息），空值返回「未知」。 */
export function labelOf(spec, raw) {
  const v = String(raw === undefined || raw === null ? '' : raw).trim().toLowerCase()
  if (spec && spec.map && Object.prototype.hasOwnProperty.call(spec.map, v)) return spec.map[v]
  return v || '未知'
}

/**
 * 一个会话事件 → `{ key, label }`；不是模式事件就返回 null。
 * 事件字段名各家不一样（preset / mode / policy / active），这里按事件类型取。
 */
export function describeMode(event) {
  if (!event || !event.type) return null
  const spec = MODE_KNOBS[event.type]
  // v1.8.29：宿主事件是 { seq, type, data }，业务字段在 event.data 里。
  // 原来直接读 event.preset / event.provider —— 永远是 undefined，模式切换一次都没提醒过。
  const d = event.data || event
  const pick = (k) => (d[k] !== undefined ? d[k] : event[k])
  if (!spec) {
    if (event.type !== 'model/selection') return null
    const provider = String(pick('provider') || '')
    const model = String(pick('model') || '')
    if (!provider && !model) return null
    return { key: '模型', label: [provider, model].filter(Boolean).join(' / ') }
  }
  const raw = pick('preset') ?? pick('mode') ?? pick('policy') ?? pick('active')
  const shown = typeof raw === 'boolean' ? String(raw) : raw
  return { key: spec.key, label: labelOf(spec, shown) }
}
