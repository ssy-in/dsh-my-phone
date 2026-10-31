// 发布前自查：扫一遍仓库里所有文本文件，看有没有疑似密钥 / 真实隧道地址。
// 用法：node tools/secretscan.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set(['.git', 'node_modules', '.demo-state']);
const pats = [
  ['openai-like key', /sk-[A-Za-z0-9]{20,}/],
  ['assignment secret', /(api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i],
  ['private key', /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/],
  ['live tunnel url', /https:\/\/[a-z-]+\.trycloudflare\.com/],
];

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.gitignore' && e.name !== '.gitattributes') {
      if (e.isDirectory()) continue;
    }
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), acc);
    } else {
      acc.push(path.join(dir, e.name));
    }
  }
  return acc;
}

const files = walk(root).filter((p) => !/\.(png|jpg|jpeg|gif|ico|svg|woff2?|ttf)$/i.test(p));

let hits = 0;
for (const p of files) {
  let t;
  try {
    t = fs.readFileSync(p, 'utf8');
  } catch {
    continue;
  }
  for (const [name, re] of pats) {
    const m = t.match(re);
    if (m) {
      hits++;
      console.log(name, path.relative(root, p), '->', String(m[0]).slice(0, 70));
    }
  }
}
console.log(hits === 0 ? 'CLEAN: no secrets / live tunnel urls' : hits + ' hits, review each');
process.exit(hits === 0 ? 0 : 1);
