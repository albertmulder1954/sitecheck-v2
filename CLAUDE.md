# SiteCheck V2 — Claude Code Instructions

## Project
Next.js 14 (Page Router) app die beweringen op webpagina's factcheckt via gezaghebbende bronnen.
Gebouwd door Albert Mulder / WorldEmp India. Stack: Next.js, React 18, Anthropic SDK.
V1 (stijl/spelling-checker): https://github.com/albertmulder1954/sitecheck
V2 (fact-checker): https://github.com/albertmulder1954/sitecheck-v2 → https://sitecheck-v2.vercel.app

## Architectuur
```
pages/index.js              — Frontend UI (dark theme, groen accent #5ec46a)
pages/_app.js               — App wrapper + Google Fonts (DM Mono, Fraunces)
pages/api/check.js          — Vier-fase Claude pipeline (batch, niet-streaming)
pages/api/check-stream.js   — Identieke pipeline via Server-Sent Events (SSE)
styles/globals.css          — Globale stijlen (dark background #0d0f0e)
```

## Vier-fase pipeline

### Fase 0 — Sub-pagina crawling
- Haalt de hoofd-URL op (max 500 KB via ReadableStream)
- Extraheert interne links, scoort op relevantie (nav, hero-woorden, /about, /features)
- Controleert robots.txt vóór elke sub-pagina-fetch
- Fetcht top 3 sub-pagina's voor rijkere tekst

### Fase 1 — Claim-extractie
- Gecombineerde paginatekst (hoofd + sub-pagina's, max 12.000 tekens) → Claude
- Output: onderwerp, domein, lijst van beweringen + gesuggereerde bron-URLs
- Model: claude-sonnet-4-6, max_tokens: 2048

### Fase 2 — Feitcontrole
- Server fetcht max 3 brondocumenten (elk max 8.000 tekens, timeout 10s)
- Beweringen + bronteksten → Claude
- Output per bewering: bevestigd / onzeker / onjuist / niet_verifieerbaar + citaat + bron_url + vertrouwen (0-100)
- Model: claude-sonnet-4-6, max_tokens: 4096

### Fase 3 — Iteratieve verdieping (conditioneel)
- Alleen actief als er onzekere/niet-verifieerbare beweringen zijn
- Fetcht extra bronnen en verfijnt de beweringen via REFINEMENT_PROMPT
- Output: herziene statuslijst met bijgewerkt vertrouwen
- Model: claude-sonnet-4-6, max_tokens: 2048

## Gezaghebbende bronnen (curated lijst in CLAIM_EXTRACTION_PROMPT)
- Microsoft 365 Copilot: learn.microsoft.com/en-us/copilot/microsoft-365/
- Microsoft Copilot Studio: learn.microsoft.com/en-us/microsoft-copilot-studio/
- Power Automate: learn.microsoft.com/en-us/power-automate/
- Power Platform: learn.microsoft.com/en-us/power-platform/
- Azure AI: learn.microsoft.com/en-us/azure/ai-services/
- Wikipedia (generiek fallback)

## Statusniveaus
`bevestigd` (groen) → `onzeker` (geel) → `onjuist` (rood) → `niet_verifieerbaar` (blauw)

## Overall oordeel
- `betrouwbaar`: >70% bevestigd
- `onbetrouwbaar`: >30% onjuist
- `twijfelachtig`: overig

## Veiligheid
- **SSRF-bescherming**: validateUrl() blokkeert localhost, 10.x, 192.168.x, 172.16-31.x, 169.254.x
- **Rate limiting**: 5 verzoeken per IP per 10 minuten (in-memory Map, max 500 entries)
- **Content-size limiet**: ReadableStream reader stopt na 500 KB per fetch
- **robots.txt**: isRobotsAllowed() geraadpleegd vóór sub-pagina-crawling

## SSE Streaming (check-stream.js)
Event-types die de server stuurt:
- `{type:'progress', fase:N, bericht:'...'}` — voortgangsmelding per fase
- `{type:'subpaginas', urls:[...]}` — gevonden sub-pagina's na fase 0
- `{type:'result', data:{...}}` — eindresultaat
- `{type:'error', bericht:'...'}` — foutmelding

Frontend gebruikt streaming fetch + ReadableStream reader (geen EventSource, want die ondersteunt alleen GET).

## Frontend features (index.js)
- Live URL-validatie: foutmelding terwijl de gebruiker typt
- Vertrouwensscores: dunne kleurenbalken per bewering (0-100%)
- Exporteren: JSON en Markdown download via Blob + URL.createObjectURL
- Geschiedenis: laatste 5 checks in localStorage (sleutel `sc_history`)
- "↺ Opnieuw" knop: bypass cache, nieuwe analyse
- "Recente checks" dropdown: klik herstelt URL + vorig resultaat

## Logging
Gestructureerde JSON-logs naar stdout (voor Vercel Runtime Logs):
```js
log('info', 0, 'Sub-pagina ophalen', { url, bytes })
log('error', 2, 'Claude API fout', { message: err.message })
```

## Environment
- `ANTHROPIC_API_KEY` — vereist, server-side only
- Lokaal: `.env.local` (staat in `.gitignore`)
- Productie: Vercel Environment Variable

## Model & Caching
- Model: `claude-sonnet-4-6`
- Prompt caching: `cache_control: { type: 'ephemeral' }` op alle system prompts
- Fase 1 max tokens: 2048 | Fase 2 max tokens: 4096 | Fase 3 max tokens: 2048
- Vercel serverless timeout: `export const maxDuration = 60`

## Lokaal draaien
```powershell
cd "C:\Users\alber\Work\Active\site cheker\sitecheck-v2"
npm install
# Zet ANTHROPIC_API_KEY in .env.local
npm run dev   # → http://localhost:3000
```

## Deployen
```powershell
# Via GitHub push (auto-deploy via Vercel):
git add . && git commit -m "..." && git push

# Of directe Vercel deploy:
C:\Users\alber\AppData\Roaming\npm\vercel.cmd --prod
```

## Stijlconventies
- Geen TypeScript — gewone JS
- Inline styles in React (geen CSS modules)
- Geen Tailwind
- Fonts: DM Mono (monospace), Fraunces (serif headers)

## Verbeteringen niet-geïmplementeerd (toekomstig)
- Vercel KV resultaatcaching (30 min, @vercel/kv)
- Domeingerichte expertprompts (Microsoft/medical/legal routing)
- Sitemap.xml-bewuste crawling
- Claim-deduplicatie over sub-pagina's
- Extended Thinking voor hoge-stakes beweringen
- React Error Boundary om resultaatssectie
- Vercel Analytics (@vercel/analytics)
