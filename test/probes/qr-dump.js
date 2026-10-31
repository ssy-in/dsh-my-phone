// 把本地 QR 编码器的矩阵导出来，交给 tools/qr_oracle.py 用官方 qrcode 包逐格对比
import fs from 'node:fs'
import { encode } from '../src/qr.js'

const cases = [
  { text: 'https://abc-def-ghi.trycloudflare.com', version: 3 },
  { text: 'http://192.168.1.107:8081', version: 2 },
  { text: 'http://192.168.1.107:8081/__myphone/pair?k=8XK2QA', version: 4 },
  { text: '手机入口 dsh-my-phone 远程访问', version: 3 },
  { text: 'https://' + 'a'.repeat(90) + '.trycloudflare.com', version: 8 },
]

const out = []
for (const c of cases) {
  for (let mask = 0; mask < 8; mask++) {
    const r = encode(c.text, { version: c.version, mask })
    out.push({
      text: c.text,
      version: r.version,
      mask: r.mask,
      rows: r.modules.map((row) => row.map((v) => (v ? 1 : 0)).join('')),
    })
  }
  const auto = encode(c.text, { version: c.version })
  out.push({
    text: c.text,
    version: auto.version,
    mask: auto.mask,
    auto: true,
    rows: auto.modules.map((row) => row.map((v) => (v ? 1 : 0)).join('')),
  })
}

fs.writeFileSync(new URL('./qr-dump.json', import.meta.url), JSON.stringify(out, null, 0))
console.log('wrote', out.length, 'matrices')
