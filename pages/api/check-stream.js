// pages/api/check-stream.js — SiteCheck V2 SSE streaming endpoint

export const config = { api: { responseLimit: false } }
export const maxDuration = 60

import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Prompts (identiek aan check.js) ──────────────────────────────────────

const CLAIM_EXTRACTION_PROMPT = `Je bent een gespecialiseerde fact-check analist voor webinhoud.
Je krijgt de gecombineerde tekst van een website aangeleverd (hoofdpagina + sub-pagina's). Jouw taak:
1. Bepaal het hoofdonderwerp van de website
2. Identificeer tot 12 specifieke, controleerbare feitelijke beweringen
3. Suggereer per bewering 3 gerankte officiële documentatie-URLs (primair + 2 fallbacks)

BEKENDE GEZAGHEBBENDE BRONNEN (gebruik deze bij voorkeur):
- Microsoft 365 Copilot: https://learn.microsoft.com/en-us/copilot/microsoft-365/
- Microsoft Copilot Studio: https://learn.microsoft.com/en-us/microsoft-copilot-studio/
- Power Automate: https://learn.microsoft.com/en-us/power-automate/
- Power Platform: https://learn.microsoft.com/en-us/power-platform/
- Power BI: https://learn.microsoft.com/en-us/power-bi/
- Azure AI: https://learn.microsoft.com/en-us/azure/ai-services/
- SharePoint: https://learn.microsoft.com/en-us/sharepoint/
- Microsoft Teams: https://learn.microsoft.com/en-us/microsoftteams/
- Microsoft 365: https://learn.microsoft.com/en-us/microsoft-365/
- Wikipedia (generiek): https://en.wikipedia.org/wiki/[onderwerp]

Reageer UITSLUITEND met geldige JSON — geen uitleg, geen markdown, geen backticks.

Formaat:
{
  "onderwerp": "kort onderwerp (max 50 tekens)",
  "domein": "microsoft_copilot" of "power_platform" of "azure" of "microsoft_365" of "overig",
  "beweringen": [
    {
      "id": 1,
      "tekst": "De exacte bewering uit de pagina (max 150 tekens)",
      "categorie": "functionaliteit" of "prijs" of "integratie" of "beveiliging" of "prestaties" of "algemeen",
      "bron_urls": ["primaire_url", "fallback_url_1", "fallback_url_2"]
    }
  ]
}
Max 12 beweringen. Selecteer alleen controleerbare feitelijke beweringen, geen meningen of marketing-taal.`

const FACT_CHECK_PROMPT = `Je bent een nauwkeurige fact-checker. Je krijgt:
1. Een lijst van beweringen afkomstig van een website
2. Tekst uit officiële documentatiebronnen

Controleer elke bewering aan de hand van de bronteksten.

Reageer UITSLUITEND met geldige JSON — geen uitleg, geen markdown, geen backticks.

Formaat:
{
  "onderwerp": "paginaonderwerp",
  "oordeel": "betrouwbaar" of "twijfelachtig" of "onbetrouwbaar",
  "items": [
    {
      "id": 1,
      "bewering": "De originele bewering",
      "status": "bevestigd" of "onzeker" of "onjuist" of "niet_verifieerbaar",
      "vertrouwen": 85,
      "uitleg": "Korte uitleg max 100 tekens",
      "citaat": "Relevant citaat uit de bron max 120 tekens of lege string",
      "bron_url": "URL van de gebruikte bron of lege string",
      "bijgewerkt": false
    }
  ],
  "conclusie": "2-3 zinnen overall conclusie over de betrouwbaarheid van de website"
}

vertrouwen is een getal 0-100: 100 = volledig bevestigd door de bron, 0 = volledig tegengesproken.
Status-regels:
- "bevestigd": de bron bevestigt de bewering expliciet (vertrouwen 70-100)
- "onzeker": de bron is onduidelijk (vertrouwen 30-69)
- "onjuist": de bron weerspreekt de bewering duidelijk (vertrouwen 0-29)
- "niet_verifieerbaar": de bron bevat geen relevante informatie (vertrouwen 0-20)
Overall oordeel: "betrouwbaar" als >70% bevestigd, "onbetrouwbaar" als >30% onjuist, anders "twijfelachtig".`

const REFINEMENT_PROMPT = `Je bent een nauwkeurige fact-checker. Je heroverweegt specifieke beweringen die eerder onzeker of niet-verifieerbaar waren.

Je krijgt:
1. Een lijst van beweringen die eerder "onzeker" of "niet_verifieerbaar" waren
2. Aanvullende tekst uit andere officiële documentatiebronnen

Heroverweeg elke bewering op basis van de nieuwe bronteksten.

Reageer UITSLUITEND met geldige JSON — geen uitleg, geen markdown, geen backticks.

Formaat:
{
  "updates": [
    {
      "id": 1,
      "status": "bevestigd" of "onzeker" of "onjuist" of "niet_verifieerbaar",
      "vertrouwen": 85,
      "uitleg": "Korte uitleg max 100 tekens",
      "citaat": "Relevant citaat uit de nieuwe bron max 120 tekens of lege string",
      "bron_url": "URL van de gebruikte nieuwe bron of lege string",
      "bijgewerkt": true
    }
  ]
}

Geef alleen een update terug voor beweringen waarbij je nieuwe relevante informatie hebt gevonden.`

// ─── Helpers ──────────────────────────────────────────────────────────────

function log(level, fase, msg, meta = {}) {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  fn(JSON.stringify({ ts: new Date().toISOString(), fase, msg, ...meta }))
}

function validateUrl(rawUrl) {
  let parsed
  try { parsed = new URL(rawUrl) } catch { throw new Error('Ongeldig URL-formaat') }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Alleen HTTP en HTTPS URLs zijn toegestaan')
  const BLOCKED = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0|::1$)/i
  if (BLOCKED.test(parsed.hostname)) throw new Error('Privé-netwerkadressen zijn niet toegestaan')
  return parsed.href
}

const _rl = new Map()
function checkRateLimit(ip) {
  const now = Date.now(), WINDOW = 600_000, MAX = 5
  let e = _rl.get(ip)
  if (!e || now > e.r) e = { c: 0, r: now + WINDOW }
  e.c++
  _rl.set(ip, e)
  if (_rl.size > 500) for (const [k, v] of _rl) if (now > v.r) _rl.delete(k)
  return e.c <= MAX
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim()
}

function parseJson(text) {
  const clean = text.replace(/```[\w]*\n?/g, '').replace(/```/g, '').trim()
  const start = clean.indexOf('{'), end = clean.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('Geen geldig JSON-object')
  return JSON.parse(clean.slice(start, end + 1))
}

function extractInternalLinks(html, baseUrl) {
  let origin
  try { origin = new URL(baseUrl).origin } catch { return [] }
  const EXCLUDE = /\/(privacy|terms|contact|login|register|signup|logout|sitemap|feed|rss|cookie|legal|impressum|disclaimer)\b/i
  const BOOST = /\/(learn|guide|how|feature|docs|about|faq|help|product|service|platform|solution|module|training|course|lesson)/i
  const seen = new Set([baseUrl])
  const candidates = []
  let m
  const re = /href=["']([^"'#?]+)/gi
  while ((m = re.exec(html)) !== null) {
    try {
      const full = new URL(m[1], baseUrl).href
      const p = new URL(full)
      if (p.origin !== origin || seen.has(full) || EXCLUDE.test(p.pathname)) continue
      seen.add(full)
      const score = (BOOST.test(p.pathname) ? 2 : 0) + (p.pathname.split('/').filter(Boolean).length <= 2 ? 1 : 0)
      candidates.push({ url: full, score })
    } catch {}
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 3).map(c => c.url)
}

async function fetchPageRaw(url, timeoutMs = 10000) {
  const MAX = 524288
  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SiteCheckV2/1.0 (factcheck bot)' },
      signal: controller.signal,
    })
    clearTimeout(tid)
    if (!res.ok) return { html: '', error: `HTTP ${res.status}` }
    const reader = res.body.getReader()
    const chunks = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = MAX - total
      if (value.length >= remaining) { chunks.push(value.slice(0, remaining)); reader.cancel(); break }
      chunks.push(value); total += value.length
    }
    const html = new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))))
    return { html }
  } catch (err) {
    clearTimeout(tid)
    return { html: '', error: err.name === 'AbortError' ? 'Timeout' : err.message }
  }
}

async function fetchSource(url, maxChars = 8000) {
  const { html, error } = await fetchPageRaw(url)
  if (error || !html) return { url, text: '', error }
  return { url, text: stripHtml(html).slice(0, maxChars) }
}

async function isRobotsAllowed(baseUrl) {
  try {
    const robotsUrl = new URL('/robots.txt', baseUrl).href
    const res = await fetch(robotsUrl, { headers: { 'User-Agent': 'SiteCheckV2/1.0' }, signal: AbortSignal.timeout(3000) })
    if (!res.ok) return true
    const text = await res.text()
    let applies = false
    for (const raw of text.split('\n')) {
      const line = raw.trim()
      if (line.toLowerCase().startsWith('user-agent:')) {
        const a = line.slice(11).trim()
        applies = a === '*' || a.toLowerCase().startsWith('sitecheckv2')
      }
      if (applies && line.toLowerCase() === 'disallow: /') return false
    }
    return true
  } catch { return true }
}

function herberekeneOordeel(items) {
  const total = items.length
  if (!total) return 'twijfelachtig'
  const bevestigd = items.filter(i => i.status === 'bevestigd').length
  const onjuist = items.filter(i => i.status === 'onjuist').length
  if (bevestigd / total > 0.7) return 'betrouwbaar'
  if (onjuist / total > 0.3) return 'onbetrouwbaar'
  return 'twijfelachtig'
}

// ─── Handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown'
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Te veel verzoeken. Probeer het over 10 minuten opnieuw.' })
  }

  let url
  try { url = validateUrl(req.body?.url || '') } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY niet ingesteld' })
  }

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  if (res.socket) res.socket.setNoDelay(true)

  function send(data) {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`) } catch {}
  }

  log('info', 0, 'Stream start', { url, ip })

  try {
    // ─── FASE 0 ───
    send({ type: 'progress', fase: 0, bericht: 'Pagina ophalen...' })

    const { html: pageHtml, error: pageError } = await fetchPageRaw(url)
    if (pageError || !pageHtml) {
      send({ type: 'error', bericht: `Pagina niet bereikbaar: ${pageError}` })
      return res.end()
    }

    const pageText = stripHtml(pageHtml).slice(0, 12000)
    if (pageText.length < 50) {
      send({ type: 'error', bericht: 'Pagina bevat geen leesbare tekst' })
      return res.end()
    }

    let subPageTexts = []
    const robotsOk = await isRobotsAllowed(new URL(url).origin)
    if (robotsOk) {
      send({ type: 'progress', fase: 0, bericht: "Sub-pagina's ontdekken..." })
      const subUrls = extractInternalLinks(pageHtml, url)
      if (subUrls.length > 0) {
        send({ type: 'progress', fase: 0, bericht: `${subUrls.length} sub-pagina's ophalen...` })
        const results = await Promise.all(subUrls.map(u => fetchSource(u, 5000)))
        subPageTexts = results.filter(r => r.text)
      }
    } else {
      send({ type: 'progress', fase: 0, bericht: 'robots.txt: alleen hoofdpagina gecrawld' })
    }
    send({ type: 'subpaginas', urls: subPageTexts.map(s => s.url) })

    // ─── FASE 1 ───
    send({ type: 'progress', fase: 1, bericht: 'Beweringen identificeren via Claude...' })

    const combinedText = [
      `=== Hoofdpagina: ${url} ===\n${pageText}`,
      ...subPageTexts.map(s => `=== Sub-pagina: ${s.url} ===\n${s.text}`),
    ].join('\n\n')

    let claims
    const claimsRes = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 2048,
      system: [{ type: 'text', text: CLAIM_EXTRACTION_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `URL: ${url}\n\nWebsite-inhoud:\n${combinedText}` }],
    })
    claims = parseJson(claimsRes.content.filter(b => b.type === 'text').map(b => b.text).join(''))
    log('info', 1, 'Claims extracted', { count: claims.beweringen?.length })

    if (!claims.beweringen?.length) {
      send({ type: 'result', data: {
        onderwerp: claims.onderwerp || 'Onbekend', oordeel: 'twijfelachtig',
        items: [], bronnen: [], subPaginas: subPageTexts.map(s => s.url), iteraties: 1,
        conclusie: 'Er zijn geen verifieerbare feitelijke beweringen gevonden op deze website.',
      }})
      return res.end()
    }

    send({ type: 'progress', fase: 1, bericht: `${claims.beweringen.length} beweringen geïdentificeerd` })

    // ─── FASE 2 ───
    send({ type: 'progress', fase: 2, bericht: 'Officiële bronnen ophalen...' })

    const fase2Urls = [...new Set(claims.beweringen.flatMap(b => b.bron_urls?.[0] ? [b.bron_urls[0]] : []))].slice(0, 3)
    const fase2Bronnen = (await Promise.all(fase2Urls.map(fetchSource))).filter(b => b.text)

    send({ type: 'progress', fase: 2, bericht: `${fase2Bronnen.length} bronnen geladen — feitcontrole uitvoeren...` })

    let factCheck
    const bronText = fase2Bronnen.map((b, i) => `--- Bron ${i + 1}: ${b.url} ---\n${b.text}`).join('\n\n')
    const beweringenText = claims.beweringen.map(b => `[${b.id}] ${b.tekst}`).join('\n')
    const factRes = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 4096,
      system: [{ type: 'text', text: FACT_CHECK_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Originele website: ${url}\nOnderwerp: ${claims.onderwerp}\n\nBeweringen:\n${beweringenText}\n\nBronmateriaal:\n${bronText || 'Geen bronnen beschikbaar.'}` }],
    })
    factCheck = parseJson(factRes.content.filter(b => b.type === 'text').map(b => b.text).join(''))
    factCheck.items = (factCheck.items || []).map(i => ({ ...i, bijgewerkt: false }))
    log('info', 2, 'Fact-check complete', { oordeel: factCheck.oordeel })

    // ─── FASE 3 ───
    let iteraties = 1
    const onzekere = factCheck.items.filter(i => i.status === 'onzeker' || i.status === 'niet_verifieerbaar')

    if (onzekere.length > 0) {
      send({ type: 'progress', fase: 3, bericht: `${onzekere.length} onzekere bewering${onzekere.length === 1 ? '' : 'en'} heronderzoeken...` })
      const used = new Set(fase2Urls)
      const extra = []
      for (const item of onzekere) {
        const claim = claims.beweringen.find(b => b.id === item.id)
        for (const fb of (claim?.bron_urls || []).slice(1)) {
          if (!used.has(fb) && extra.length < 2) { extra.push(fb); used.add(fb) }
        }
      }
      if (extra.length > 0) {
        const extraBronnen = (await Promise.all(extra.map(fetchSource))).filter(b => b.text)
        if (extraBronnen.length > 0) {
          try {
            const refineRes = await client.messages.create({
              model: 'claude-sonnet-4-6', max_tokens: 2048,
              system: [{ type: 'text', text: REFINEMENT_PROMPT, cache_control: { type: 'ephemeral' } }],
              messages: [{ role: 'user', content: `Onzekere beweringen:\n${onzekere.map(i => `[${i.id}] ${i.bewering} (${i.status})`).join('\n')}\n\nAanvullende bronnen:\n${extraBronnen.map((b, i) => `--- Extra bron ${i + 1}: ${b.url} ---\n${b.text}`).join('\n\n')}` }],
            })
            const refined = parseJson(refineRes.content.filter(b => b.type === 'text').map(b => b.text).join(''))
            for (const u of (refined.updates || [])) {
              const idx = factCheck.items.findIndex(i => i.id === u.id)
              if (idx >= 0) factCheck.items[idx] = { ...factCheck.items[idx], ...u, bijgewerkt: true }
            }
            factCheck.oordeel = herberekeneOordeel(factCheck.items)
            iteraties = 2
            send({ type: 'progress', fase: 3, bericht: `${refined.updates?.length || 0} beweringen bijgesteld` })
          } catch (err) {
            log('warn', 3, 'Refinement mislukt (non-fatal): ' + err.message)
          }
        }
      }
    }

    const finalResult = {
      ...factCheck,
      bronnen: fase2Bronnen.map(b => b.url),
      subPaginas: subPageTexts.map(s => s.url),
      iteraties,
    }
    log('info', 'done', 'Stream complete', { oordeel: finalResult.oordeel, iteraties })
    send({ type: 'result', data: finalResult })
    res.end()

  } catch (err) {
    log('error', 'fatal', err.message)
    send({ type: 'error', bericht: err.message || 'Onbekende serverfout' })
    res.end()
  }
}
