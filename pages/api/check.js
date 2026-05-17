// pages/api/check.js — SiteCheck V2
// Twee-fase pipeline: claim-extractie → bronnen ophalen → feitcontrole

import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const CLAIM_EXTRACTION_PROMPT = `Je bent een gespecialiseerde fact-check analist voor webinhoud.
Je krijgt de tekst van een webpagina aangeleverd. Jouw taak:
1. Bepaal het hoofdonderwerp van de pagina
2. Identificeer tot 10 specifieke, controleerbare feitelijke beweringen
3. Suggereer voor elke bewering de meest relevante officiële documentatie-URL

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
      "bron_urls": ["https://..."]
    }
  ]
}
Max 10 beweringen. Selecteer alleen controleerbare feitelijke beweringen, geen meningen of marketing-taal.`

const FACT_CHECK_PROMPT = `Je bent een nauwkeurige fact-checker. Je krijgt:
1. Een lijst van beweringen afkomstig van een webpagina
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
      "uitleg": "Korte uitleg max 100 tekens",
      "citaat": "Relevant citaat uit de bron max 120 tekens of lege string",
      "bron_url": "URL van de gebruikte bron of lege string"
    }
  ],
  "conclusie": "2-3 zinnen overall conclusie over de betrouwbaarheid van de pagina"
}

Regels voor status:
- "bevestigd": de bron bevestigt de bewering expliciet
- "onzeker": de bron is onduidelijk of geeft geen definitief antwoord
- "onjuist": de bron weerspreekt de bewering duidelijk
- "niet_verifieerbaar": de bron bevat geen relevante informatie over deze bewering

Overall oordeel: "betrouwbaar" als meer dan 70% bevestigd, "onbetrouwbaar" als meer dan 30% onjuist, anders "twijfelachtig".`

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseJson(text) {
  const clean = text.replace(/```[\w]*\n?/g, '').replace(/```/g, '').trim()
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('Geen geldig JSON-object')
  return JSON.parse(clean.slice(start, end + 1))
}

async function fetchSource(url) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SiteCheckV2/1.0 (factcheck bot)' },
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) return { url, text: '', error: `HTTP ${res.status}` }
    const html = await res.text()
    return { url, text: stripHtml(html).slice(0, 8000) }
  } catch (err) {
    return { url, text: '', error: err.message }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { url } = req.body
  if (!url) return res.status(400).json({ error: 'url is verplicht' })

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY niet ingesteld op de server' })
  }

  // Stap 1: Haal de doelpagina op
  let pageText
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const pageRes = await fetch(url, {
      headers: { 'User-Agent': 'SiteCheckV2/1.0 (factcheck bot)' },
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!pageRes.ok) {
      return res.status(502).json({ error: `Pagina niet bereikbaar: HTTP ${pageRes.status}` })
    }
    const html = await pageRes.text()
    pageText = stripHtml(html).slice(0, 12000)
    if (!pageText || pageText.length < 50) {
      return res.status(502).json({ error: 'Pagina bevat geen leesbare tekst' })
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Pagina reageerde niet binnen 10 seconden' })
    }
    return res.status(502).json({ error: `Pagina ophalen mislukt: ${err.message}` })
  }

  // Stap 2: Fase 1 — claim-extractie
  let claims
  try {
    const claimsRes = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: [{ type: 'text', text: CLAIM_EXTRACTION_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `URL: ${url}\n\nPaginatekst:\n${pageText}` }],
    })
    const claimsText = (claimsRes.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
    claims = parseJson(claimsText)
  } catch (err) {
    console.error('Fase 1 fout:', err)
    return res.status(502).json({ error: 'Claim-extractie mislukt: ' + err.message })
  }

  if (!claims.beweringen?.length) {
    return res.status(200).json({
      onderwerp: claims.onderwerp || 'Onbekend',
      oordeel: 'twijfelachtig',
      items: [],
      bronnen: [],
      conclusie: 'Er zijn geen verifieerbare feitelijke beweringen gevonden op deze pagina.',
    })
  }

  // Stap 3: Bronnen ophalen (max 3 unieke URLs, parallel)
  const uniqueUrls = [...new Set(claims.beweringen.flatMap(b => b.bron_urls || []))].slice(0, 3)
  const bronResults = await Promise.all(uniqueUrls.map(fetchSource))
  const bronnen = bronResults.filter(b => b.text)

  // Stap 4: Fase 2 — feitcontrole
  let factCheck
  try {
    const bronText = bronnen.map((b, i) =>
      `--- Bron ${i + 1}: ${b.url} ---\n${b.text}`
    ).join('\n\n')

    const beweringenText = claims.beweringen.map(b =>
      `[${b.id}] ${b.tekst}`
    ).join('\n')

    const userMsg = `Originele pagina: ${url}\n\nOnderwerp: ${claims.onderwerp}\n\nBeweringen:\n${beweringenText}\n\nBronmateriaal:\n${bronText || 'Geen bronnen beschikbaar.'}`

    const factRes = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: [{ type: 'text', text: FACT_CHECK_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMsg }],
    })
    const factText = (factRes.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
    factCheck = parseJson(factText)
  } catch (err) {
    console.error('Fase 2 fout:', err)
    return res.status(502).json({ error: 'Feitcontrole mislukt: ' + err.message })
  }

  return res.status(200).json({
    ...factCheck,
    bronnen: bronnen.map(b => b.url),
  })
}
