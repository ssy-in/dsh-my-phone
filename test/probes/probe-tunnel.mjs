// 从公网侧（cloudflared 隧道）验证手机真正看到的东西
const BASE = process.env.PROBE_TUNNEL || 'https://putting-tour-hottest-alumni.trycloudflare.com'

const show = async (path) => {
  try {
    const res = await fetch(BASE + path, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone)' }, redirect: 'manual' })
    const text = await res.text()
    const title = text.match(/<title>([^<]*)<\/title>/)?.[1] || ''
    const head = text.replace(/\s+/g, ' ').slice(0, 160)
    console.log(`${path} → ${res.status} ${res.headers.get('content-type') || ''} ${text.length}B ${title ? '| ' + title : ''}`)
    if (res.status >= 400) console.log('   ' + head)
    return { status: res.status, text, headers: res.headers }
  } catch (err) {
    console.log(`${path} → 请求失败: ${err.message}`)
    return null
  }
}

console.log('隧道:', BASE)
const root = await show('/')
const pairNoTicket = await show('/__myphone/pair')
const adminPath = await show('/__myphone/')

// 带票据的二维码链接
const panel = await fetch('http://127.0.0.1:53937/__myphone/panel', { headers: { 'x-myphone-panel': '1' } }).then((r) => r.json())
const t = new URL(panel.pairUrl).searchParams.get('t')
const trust = await show(`/__myphone/pair?t=${t}`)
if (trust?.status === 200) {
  const body = `t=${encodeURIComponent(t)}`
  const post = await fetch(`${BASE}/__myphone/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Mozilla/5.0 (iPhone)' },
    body,
    redirect: 'manual',
  })
  const cookie = (post.headers.getSetCookie?.() || [])[0] || ''
  console.log(`POST 信任 → ${post.status} ${cookie ? '+ 凭据' : '无凭据'}`)
  if (cookie) {
    const home = await fetch(`${BASE}/`, { headers: { cookie: cookie.split(';')[0], 'user-agent': 'Mozilla/5.0 (iPhone)' }, redirect: 'manual' })
    const text = await home.text()
    console.log(`公网带凭据进 DSH → ${home.status} / ${text.length}B ${/DeepSeek Harness|<html/i.test(text) ? '✓' : '✗ ' + text.replace(/\s+/g, ' ').slice(0, 200)}`)
  }
}
