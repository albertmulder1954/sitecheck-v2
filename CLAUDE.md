# SiteCheck V2 — Claude Code Instructions

## Project
Next.js 14 (Page Router) app die beweringen op webpagina's factcheckt via gezaghebbende bronnen.
Gebouwd door Albert Mulder / WorldEmp India. Stack: Next.js, React 18, Anthropic SDK.
V1 (stijl/spelling-checker): https://github.com/albertmulder1954/sitecheck

## Architectuur
```
pages/index.js        — Frontend UI (dark theme, groen accent #5ec46a)
pages/_app.js         — App wrapper + Google Fonts (DM Mono, Fraunces)
pages/api/check.js    — Twee-fase Claude pipeline (claim-extractie + feitcontrole)
styles/globals.css    — Globale stijlen (dark background #0d0f0e)
```

## Twee-fase pipeline

### Fase 1 — Claim-extractie
- Paginatekst (max 12.000 tekens) → Claude
- Output: onderwerp, domein, lijst van beweringen + gesuggereerde bron-URLs
- Model: claude-sonnet-4-6, max_tokens: 2048

### Fase 2 — Feitcontrole
- Server fetcht max 3 brondocumenten (elk max 8.000 tekens, timeout 10s)
- Beweringen + bronteksten → Claude
- Output per bewering: bevestigd / onzeker / onjuist / niet_verifieerbaar + citaat + bron_url
- Model: claude-sonnet-4-6, max_tokens: 4096

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

## Environment
- `ANTHROPIC_API_KEY` — vereist, server-side only
- Lokaal: `.env.local` (staat in `.gitignore`)
- Productie: Vercel Environment Variable

## Model & Caching
- Model: `claude-sonnet-4-6`
- Prompt caching: `cache_control: { type: 'ephemeral' }` op beide system prompts
- Fase 1 max tokens: 2048 | Fase 2 max tokens: 4096

## Lokaal draaien
```powershell
cd "C:\Users\alber\Work\Active\site cheker\sitecheck-v2"
npm install
# Zet ANTHROPIC_API_KEY in .env.local
npm run dev   # → http://localhost:3000
```

## Stijlconventies
- Geen TypeScript — gewone JS
- Inline styles in React (geen CSS modules)
- Geen Tailwind
- Fonts: DM Mono (monospace), Fraunces (serif headers)
