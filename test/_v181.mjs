import fs from 'node:fs'
const log = []
let w = fs.readFileSync('src/widget.js', 'utf8')
const rep = (a, b, tag) => {
  if (!w.includes(a)) {
    log.push('MISS:' + tag)
    return
  }
  w = w.replace(a, b)
  log.push(tag)
}

/* 1. 连接页：把 qrBlock() 补回来（v1.7.3 打补丁时被误删，导致连接页整块空白） */
rep(
  `    function connectPane() {`,
  `    // 二维码块：有票就画 svg，没票给占位；过期盖「已失效」
    function qrBlock() {
      var svg = data && data.qrSvg ? String(data.qrSvg) : ''
      var left = data && data.ticketExpiresAt ? data.ticketExpiresAt - Date.now() : 0
      var dead = !svg || left <= 0
      var box = h('div', { class: 'dmp-qr' + (dead && svg ? ' dead' : '') })
      if (svg) box.innerHTML = svg
      else box.appendChild(h('div', { class: 'dmp-empty', text: '还没有二维码\n点下面的按钮生成' }))
      if (svg && left <= 0) box.appendChild(h('div', { class: 'dmp-dead', text: '已失效' }))
      return box
    }

    function connectPane() {`,
  'qrBlock-back',
)

/* 2. 开关按钮不写「· 关 / · 开」后缀 */
rep(
  `        h('button', { class: 'pill ' + (on ? 'on' : 'off'), text: on ? '已开启 · 关' : '关着 · 开', onclick: onToggle }),`,
  `        h('button', { class: 'pill ' + (on ? 'on' : 'off'), text: on ? '已开启' : '关着', onclick: onToggle }),`,
  'toggle-text',
)

/* 3. 音色下拉改成「只返回控件」，好和音量并到一行 */
rep(
  `    var wrap = h('div', { style: 'position:relative;flex:1;min-width:0' }, [btn, list])
    return h('div', { class: 'row' }, [`,
  `    var wrap = h('div', { style: 'position:relative;flex:0 0 auto;min-width:92px' }, [btn, list])
    return h('div', { class: 'row', style: 'border-bottom:0;padding:0;display:flex;align-items:center;gap:0' }, [`,
  'timbre-control',
)

/* 音色行只剩控件本身 */
rep(
  `  function timbreRow(s) {`,
  `  function timbreRow(s) {
    // 只当「控件工厂」用：真正的排布在音效区那行里（音色 [下拉] 音量 [滑块]）
`,
  'timbre-factory',
)

/* 4. 音效区：音色与音量并成一行 */
rep(
  `    out.push(
      h('div', { class: 'row' }, [
        h('div', { style: 'font-size:12.5px;color:#43606f;width:34px', text: '音量' }),
        vol,
        volTxt,
      ]),
    )

    out.push(timbreRow(s))`,
  `    var pickEl = timbreRow(s)
    out.push(
      h('div', { class: 'row', style: 'display:flex;align-items:center;gap:8px' }, [
        h('div', { style: 'font-size:12.5px;color:#43606f;flex:0 0 auto', text: '音色' }),
        pickEl,
        h('div', { style: 'font-size:12.5px;color:#43606f;flex:0 0 auto;margin-left:4px', text: '音量' }),
        vol,
        volTxt,
      ]),
    )`,
  'merge-row',
)

fs.writeFileSync('src/widget.js', w)

/* 5. audio.js：补上 TIMBRES / SOUND_KEY（原来这两个是未定义变量，setTimbre 直接抛错被吞 → 换音色没反应） */
let a = fs.readFileSync('src/audio.js', 'utf8')
const anchor = `  window.__dshMyPhoneAudio = (() => {`
if (!a.includes('const TIMBRES =')) {
  a = a.replace(
    anchor,
    `  // 音色清单：只用来做合法性校验（真正的发声分支在 voice() 里）
  const TIMBRES = ['bell', 'kalimba', 'marimba', 'water', 'pop', 'piano', 'violin'].map((id) => ({ id }))
  // 与 widget.js 共用同一个存档键，换音色/音量后引擎能立刻读到
  const SOUND_KEY = 'dsh-my-phone.sound.v2'

  window.__dshMyPhoneAudio = (() => {`,
  )
  log.push('audio-consts')
} else log.push('MISS:audio-consts')
fs.writeFileSync('src/audio.js', a)

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
pkg.version = '1.8.1'
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')
let r = fs.readFileSync('README.md', 'utf8')
const row =
  '| v1.8.1 | 修三处：①**连接页整块空白**（`qrBlock()` 在 v1.7.3 打补丁时被误删 → `ReferenceError` 让整页渲染中断），已补回；②开关按钮不再写「· 开 / · 关」后缀，只显示「已开启 / 关着」；③音效区改成**一行**：`音色 [下拉] 音量 [滑块] 100%`；④**换音色没反应**的真因：`src/audio.js` 里 `TIMBRES`、`SOUND_KEY` 两个变量从来没定义，`setTimbre()` 直接抛 `ReferenceError` 被 `prep()` 的 try/catch 吞掉 → 已补上定义。音量映射不变：100% = 2.0 增益，0 = 真静音 |\n'
if (!r.includes('v1.8.1')) r = r.replace('| v1.8.0 |', row + '| v1.8.0 |')
fs.writeFileSync('README.md', r)
console.log(log.join(', '))
