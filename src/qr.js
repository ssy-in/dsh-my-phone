// 极简 QR 编码器（字节模式 / 纠错等级 M / 版本 1–10），零依赖。
// 只为了把"手机上打开这个地址"变成一张能扫的码，不追求全规格。
//
// 规格来源：ISO/IEC 18004。表只收录 M 等级、v1–v10 —— 一段 http:// 地址
// 在 10 版（最多 213 字节）之内足够。

const EC_M = { 1: [[1, 26, 16]], 2: [[1, 44, 28]], 3: [[1, 70, 44]], 4: [[2, 50, 32]], 5: [[2, 67, 43]], 6: [[4, 43, 27]], 7: [[4, 49, 31]], 8: [[2, 60, 38], [2, 61, 39]], 9: [[3, 58, 36], [2, 59, 37]], 10: [[4, 69, 43], [1, 70, 44]] }

const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] }

// GF(256) 乘法表，本原多项式 0x11D
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
;(() => {
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
})()

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

function generatorPoly(degree) {
  let poly = [1]
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]
      next[j + 1] ^= mul(poly[j], EXP[i])
    }
    poly = next
  }
  return poly
}

function rsEncode(data, ecLen) {
  const gen = generatorPoly(ecLen)
  const buf = new Uint8Array(data.length + ecLen)
  buf.set(data)
  for (let i = 0; i < data.length; i++) {
    const coef = buf[i]
    if (coef === 0) continue
    for (let j = 0; j < gen.length; j++) buf[i + j] ^= mul(gen[j], coef)
  }
  return buf.slice(data.length)
}

const bytesOf = (text) => Array.from(new TextEncoder().encode(text))

function pickVersion(len) {
  for (let v = 1; v <= 10; v++) {
    const dataCodewords = EC_M[v].reduce((s, [n, , d]) => s + n * d, 0)
    const headerBits = 4 + (v >= 10 ? 16 : 8)
    const needBits = headerBits + len * 8
    if (needBits <= dataCodewords * 8) return v
  }
  return null
}

function buildData(bytes, version) {
  const bits = []
  const push = (value, width) => {
    for (let i = width - 1; i >= 0; i--) bits.push((value >> i) & 1)
  }
  push(0b0100, 4) // 字节模式
  push(bytes.length, version >= 10 ? 16 : 8)
  for (const b of bytes) push(b, 8)

  const totalData = EC_M[version].reduce((s, [n, , d]) => s + n * d, 0)
  const capacityBits = totalData * 8
  if (bits.length > capacityBits) throw new Error('qr: 数据超出容量')

  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0) // 终止符
  while (bits.length % 8 !== 0) bits.push(0)

  const words = []
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]
    words.push(b)
  }
  const PAD = [0xec, 0x11]
  for (let i = 0; words.length < totalData; i++) words.push(PAD[i % 2])
  return words
}

function interleave(words, version) {
  const blocks = EC_M[version]
  const dataBlocks = []
  const ecBlocks = []
  let o = 0
  for (const [count, total, dataLen] of blocks) {
    const ecLen = total - dataLen
    for (let i = 0; i < count; i++) {
      const chunk = words.slice(o, o + dataLen)
      o += dataLen
      dataBlocks.push(chunk)
      ecBlocks.push(rsEncode(chunk, ecLen))
    }
  }
  const maxData = Math.max(...dataBlocks.map((b) => b.length))
  const maxEc = Math.max(...ecBlocks.map((b) => b.length))
  const seq = []
  for (let i = 0; i < maxData; i++) for (const b of dataBlocks) if (i < b.length) seq.push(b[i])
  for (let i = 0; i < maxEc; i++) for (const b of ecBlocks) if (i < b.length) seq.push(b[i])
  return seq
}

function newMatrix(size) {
  return Array.from({ length: size }, () => new Array(size).fill(null))
}

function placeFunctionPatterns(m, version) {
  const size = m.length
  const set = (x, y, v) => {
    if (x >= 0 && y >= 0 && x < size && y < size) m[y][x] = v
  }

  // 三个定位图形 + 分隔符
  for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const x = ox + dx
        const y = oy + dy
        if (x < 0 || y < 0 || x >= size || y >= size) continue
        const inner = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6
        let v = 0
        if (inner) {
          const edge = dx === 0 || dx === 6 || dy === 0 || dy === 6
          const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4
          v = edge || core ? 1 : 0
        }
        set(x, y, v)
      }
    }
  }

  // 定时图形
  for (let i = 8; i < size - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0
    if (m[6][i] === null) m[6][i] = v
    if (m[i][6] === null) m[i][6] = v
  }

  // 校正图形
  const centers = ALIGN[version] || []
  for (const cy of centers) {
    for (const cx of centers) {
      if (
        (cx === 6 && cy === 6) ||
        (cx === 6 && cy === size - 7) ||
        (cx === size - 7 && cy === 6)
      )
        continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const v = Math.max(Math.abs(dx), Math.abs(dy)) !== 1 ? 1 : 0
          set(cx + dx, cy + dy, v)
        }
      }
    }
  }

  // 固定的暗模块
  m[size - 8][8] = 1
}

function reserveFormatAreas(m) {
  const size = m.length
  for (let i = 0; i < 9; i++) {
    if (m[8][i] === null) m[8][i] = 0
    if (m[i][8] === null) m[i][8] = 0
  }
  for (let i = 0; i < 8; i++) {
    if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = 0
    if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = 0
  }
}

function placeData(m, seq, mask) {
  const size = m.length
  let bitIndex = 0
  let upward = true
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5 // 跳过定时列
    for (let k = 0; k < size; k++) {
      const y = upward ? size - 1 - k : k
      for (const x of [right, right - 1]) {
        if (m[y][x] !== null) continue
        let bit = 0
        if (bitIndex < seq.length * 8) {
          bit = (seq[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1
        }
        bitIndex++
        m[y][x] = maskFn(mask, x, y) ? bit ^ 1 : bit
      }
    }
    upward = !upward
  }
}

function maskFn(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0
    case 1: return y % 2 === 0
    case 2: return x % 3 === 0
    case 3: return (x + y) % 3 === 0
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  }
  return false
}

const BCH_FORMAT = (() => {
  // 15bit: 5 位数据 + BCH(15,5)，生成多项式 0x537，最后异或 0x5412
  const out = []
  for (let data = 0; data < 32; data++) {
    let v = data << 10
    for (let i = 4; i >= 0; i--) {
      if (v & (1 << (i + 10))) v ^= 0x537 << i
    }
    out.push(((data << 10) | v) ^ 0x5412)
  }
  return out
})()

function placeFormat(m, mask) {
  const size = m.length
  const bits = BCH_FORMAT[(0b00 << 3) | mask] // 00 = M
  const bit = (i) => (((bits >> i) & 1) === 1 ? 1 : 0)
  // 第一份：左上角，注意 (x, y) 顺序 —— 竖着放 6 格，再横着放
  for (let i = 0; i <= 5; i++) m[i][8] = bit(i)
  m[7][8] = bit(6)
  m[8][8] = bit(7)
  m[8][7] = bit(8)
  for (let i = 9; i <= 14; i++) m[8][14 - i] = bit(i)
  // 第二份：右上 + 左下
  for (let i = 0; i <= 7; i++) m[8][size - 1 - i] = bit(i)
  for (let i = 8; i <= 14; i++) m[size - 15 + i][8] = bit(i)
  m[size - 8][8] = 1 // 永远为暗的模块
}

function placeVersion(m, version) {
  if (version < 7) return
  const size = m.length
  let v = version << 12
  for (let i = 5; i >= 0; i--) {
    if (v & (1 << (i + 12))) v ^= 0x1f25 << i
  }
  const bits = (version << 12) | v
  for (let i = 0; i < 18; i++) {
    const b = (bits >> i) & 1
    const a = Math.floor(i / 3)
    const c = i % 3
    m[size - 11 + c][a] = b
    m[a][size - 11 + c] = b
  }
}

function penalty(m) {
  const size = m.length
  let score = 0
  const lines = []
  for (let y = 0; y < size; y++) lines.push(m[y].slice())
  for (let x = 0; x < size; x++) lines.push(m.map((row) => row[x]))

  for (const line of lines) {
    let run = 1
    for (let i = 1; i < line.length; i++) {
      if (line[i] === line[i - 1]) run++
      else {
        if (run >= 5) score += 3 + (run - 5)
        run = 1
      }
    }
    if (run >= 5) score += 3 + (run - 5)
  }

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const v = m[y][x]
      if (v === m[y][x + 1] && v === m[y + 1][x] && v === m[y + 1][x + 1]) score += 3
    }
  }

  const finder = [1, 0, 1, 1, 1, 0, 1]
  for (const line of lines) {
    for (let i = 0; i + 6 < line.length; i++) {
      let ok = true
      for (let k = 0; k < 7; k++) {
        if (line[i + k] !== finder[k]) {
          ok = false
          break
        }
      }
      if (!ok) continue
      const before = line.slice(Math.max(0, i - 4), i)
      const after = line.slice(i + 7, i + 11)
      const zero = (arr) => arr.every((v) => v === 0)
      if ((before.length === 4 && zero(before)) || (after.length === 4 && zero(after))) score += 40
    }
  }

  let dark = 0
  for (const row of m) for (const v of row) if (v) dark++
  const ratio = (dark * 100) / (size * size)
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10
  return score
}

export function encode(text, opts = {}) {
  const bytes = bytesOf(text)
  const version = opts.version || pickVersion(bytes.length)
  if (!version) throw new Error('qr: 内容太长（只支持 v1–v10 / M）')
  const data = interleave(buildData(bytes, version), version)

  const build = (mask) => {
    const m = newMatrix(4 * version + 17)
    placeFunctionPatterns(m, version)
    reserveFormatAreas(m)
    placeVersion(m, version)
    placeData(m, data, mask)
    placeFormat(m, mask)
    return m
  }

  let best = null
  for (let mask = 0; mask < 8; mask++) {
    const m = build(mask)
    const s = penalty(m)
    if (!best || s < best.score) best = { m, mask, score: s }
  }
  const chosen = opts.mask === undefined ? best : { m: build(opts.mask), mask: opts.mask }
  return { version, mask: chosen.mask, size: chosen.m.length, modules: chosen.m }
}

/** 直接输出可内联的 SVG，省掉一格一格的 DOM */
export function toSvg(text, { scale = 8, margin = 4, dark = '#0b1220', light = 'transparent' } = {}) {
  const { size, modules, version, mask } = encode(text)
  const dim = (size + margin * 2) * scale
  const rects = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!modules[y][x]) continue
      rects.push(`<rect x="${(x + margin) * scale}" y="${(y + margin) * scale}" width="${scale}" height="${scale}"/>`)
    }
  }
  return {
    version,
    mask,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="${light === 'transparent' ? 'none' : light}"/><g fill="${dark}">${rects.join('')}</g></svg>`,
  }
}
