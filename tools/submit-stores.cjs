// 一次性投稿脚本：把 dsh-my-phone 提到 4 个人气高的 DSH 插件目录
// 用法：node tools/submit-stores.cjs <token> [imsai beancookie kejixiao whyihaveyou]
const https = require('https')
const fs = require('fs')
const path = require('path')

const TOKEN = process.argv[2]
const only = process.argv.slice(3)
if (!TOKEN) {
  console.log('用法: node tools/submit-stores.cjs <token> [keys...]')
  process.exit(1)
}

const plan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'store-submission', 'stores', 'plan.json'), 'utf8'))
const targets = plan.targets.filter((t) => !only.length || only.includes(t.key))

const REQ = (method, p, body) =>
  new Promise((resolve) => {
    const payload = body === undefined ? null : JSON.stringify(body)
    const headers = {
      'user-agent': 'dsh-my-phone-submitter',
      authorization: 'Bearer ' + TOKEN,
      accept: 'application/vnd.github+json',
    }
    if (payload) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = Buffer.byteLength(payload)
    }
    const r = https.request({ host: 'api.github.com', path: p, method, headers, rejectUnauthorized: false, timeout: 40000 }, (res) => {
      let b = ''
      res.on('data', (d) => (b += d))
      res.on('end', () => {
        let json = null
        try {
          json = JSON.parse(b)
        } catch {}
        resolve({ status: res.statusCode, json, raw: b.slice(0, 400) })
      })
    })
    r.on('timeout', () => {
      r.destroy()
      resolve({ status: 0, json: null, raw: 'timeout' })
    })
    r.on('error', (e) => resolve({ status: 0, json: null, raw: e.message }))
    if (payload) r.write(payload)
    r.end()
  })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function ensureFork(upstream, me) {
  const [owner, name] = upstream.split('/')
  const check = await REQ('GET', `/repos/${me}/${name}`)
  if (check.status === 200) return { ok: true, existed: true }
  const fork = await REQ('POST', `/repos/${owner}/${name}/forks`, {})
  if (fork.status >= 400) return { ok: false, why: 'fork ' + fork.status + ' ' + fork.raw }
  for (let i = 0; i < 30; i += 1) {
    await sleep(3000)
    const c = await REQ('GET', `/repos/${me}/${name}`)
    if (c.status === 200 && c.json && (c.json.size > 0 || c.json.pushed_at)) return { ok: true, existed: false }
  }
  return { ok: false, why: 'fork 等待超时' }
}

async function ensureBranch(full, branch, sha) {
  const get = await REQ('GET', `/repos/${full}/git/ref/heads/${branch}`)
  if (get.status === 200) return { ok: true }
  const mk = await REQ('POST', `/repos/${full}/git/refs`, { ref: 'refs/heads/' + branch, sha })
  if (mk.status >= 400) return { ok: false, why: 'branch ' + mk.status + ' ' + mk.raw }
  return { ok: true }
}

async function putFile(full, branch, filePath, content, message) {
  const cur = await REQ('GET', `/repos/${full}/contents/${encodeURI(filePath)}?ref=${encodeURIComponent(branch)}`)
  const existing = cur.status === 200 && cur.json && cur.json.sha ? cur.json.sha : undefined
  const body = { message, content: Buffer.from(content, 'utf8').toString('base64'), branch }
  if (existing) body.sha = existing
  const put = await REQ('PUT', `/repos/${full}/contents/${encodeURI(filePath)}`, body)
  if (put.status >= 400) return { ok: false, why: 'put ' + filePath + ' ' + put.status + ' ' + put.raw }
  return { ok: true, sha: put.json && put.json.content && put.json.content.sha }
}

async function getFileRaw(full, branch, filePath) {
  const cur = await REQ('GET', `/repos/${full}/contents/${encodeURI(filePath)}?ref=${encodeURIComponent(branch)}`)
  if (cur.status !== 200 || !cur.json || !cur.json.content) return null
  return Buffer.from(cur.json.content, 'base64').toString('utf8')
}

async function openPr(upstream, branch, title, body, base) {
  const existing = await REQ('GET', `/repos/${upstream}/pulls?state=open&head=ssy-in:${encodeURIComponent(branch)}`)
  if (existing.status === 200 && Array.isArray(existing.json) && existing.json.length) {
    return { ok: true, url: existing.json[0].html_url, note: 'PR 已存在' }
  }
  const pr = await REQ('POST', `/repos/${upstream}/pulls`, { title, head: 'ssy-in:' + branch, base, body })
  return { ok: pr.status < 400, url: pr.json && pr.json.html_url, why: pr.status >= 400 ? 'pr ' + pr.status + ' ' + pr.raw : '' }
}

;(async () => {
  const me = (await REQ('GET', '/user')).json
  if (!me || !me.login) {
    console.log('❌ token 无效或读不到 /user')
    return
  }
  console.log('身份: ' + me.login + '   token scopes: ' + (process.env.X || '见响应头'))

  for (const t of targets) {
    console.log('\n===== ' + t.key + '  →  ' + t.upstream)
    const [owner, name] = t.upstream.split('/')

    if (t.kind === 'issue') {
      const r = await REQ('POST', `/repos/${t.upstream}/issues`, { title: t.title, body: t.body })
      console.log(r.status < 400 ? '✅ issue: ' + r.json.html_url : '❌ issue ' + r.status + ' ' + r.raw)
      continue
    }

    const fork = await ensureFork(t.upstream, me.login)
    if (!fork.ok) {
      console.log('❌ ' + fork.why)
      continue
    }
    console.log('fork ' + (fork.existed ? '已存在' : '已创建') + ': ' + me.login + '/' + name)
    const repo = await REQ('GET', `/repos/${me.login}/${name}`)
    const base = repo.json.default_branch
    const baseRef = await REQ('GET', `/repos/${me.login}/${name}/git/ref/heads/${base}`)
    const headSha = baseRef.json.object.sha
    const br = await ensureBranch(`${me.login}/${name}`, t.branch, headSha)
    if (!br.ok) {
      console.log('❌ ' + br.why)
      continue
    }

    if (t.kind === 'add') {
      const r = await putFile(`${me.login}/${name}`, t.branch, t.path, t.content, 'catalog: add ' + name)
      console.log(r.ok ? '✅ 新增文件 ' + t.path : '❌ ' + r.why)
      if (!r.ok) continue
    } else if (t.kind === 'insert_after') {
      let failed = false
      for (const e of t.edits) {
        const raw = await getFileRaw(`${me.login}/${name}`, t.branch, e.path)
        if (!raw) {
          console.log('❌ 读不到 ' + e.path)
          failed = true
          break
        }
        const lines = raw.split('\n')
        const idx = lines.findIndex((l) => l.startsWith(e.anchor))
        if (idx < 0) {
          console.log('❌ 找不到锚点 in ' + e.path + ': ' + e.anchor.slice(0, 60))
          failed = true
          break
        }
        if (lines.some((l) => l.includes('ssy-in/dsh-my-phone'))) {
          console.log('· ' + e.path + ' 已经有条目，跳过')
          continue
        }
        lines.splice(idx + 1, 0, e.line)
        const r = await putFile(`${me.login}/${name}`, t.branch, e.path, lines.join('\n'), 'add ' + name + ' to ' + e.path)
        console.log(r.ok ? '✅ 插入 ' + e.path : '❌ ' + r.why)
        if (!r.ok) failed = true
      }
      if (failed) continue
    }

    const pr = await openPr(t.upstream, t.branch, t.title, t.body, base)
    console.log(pr.ok ? '✅ PR: ' + pr.url + (pr.note ? '  (' + pr.note + ')' : '') : '❌ ' + pr.why)
  }
})()
