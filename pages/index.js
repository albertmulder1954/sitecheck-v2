import { useState, useEffect } from 'react'

const STATUS_MAP = {
  bevestigd:           { label: 'Bevestigd',           color: '#5ec46a', bg: 'rgba(94,196,106,.15)' },
  onzeker:             { label: 'Onzeker',             color: '#e6a817', bg: 'rgba(230,168,23,.15)'  },
  onjuist:             { label: 'Onjuist',             color: '#d95f5f', bg: 'rgba(217,95,95,.15)'   },
  niet_verifieerbaar:  { label: 'Niet verifieerbaar',  color: '#4a9fd4', bg: 'rgba(74,159,212,.15)'  },
}

const OORDEEL_MAP = {
  betrouwbaar:   { label: 'Betrouwbaar',   color: '#5ec46a', bg: 'rgba(94,196,106,.1)'  },
  twijfelachtig: { label: 'Twijfelachtig', color: '#e6a817', bg: 'rgba(230,168,23,.1)'  },
  onbetrouwbaar: { label: 'Onbetrouwbaar', color: '#d95f5f', bg: 'rgba(217,95,95,.1)'   },
}

function esc(s) { return String(s ?? '') }

function validateUrlClient(raw) {
  if (!raw.trim()) return null
  try {
    const p = new URL(raw)
    if (!['http:', 'https:'].includes(p.protocol)) return 'Gebruik http:// of https://'
    return null
  } catch { return 'Ongeldig URL-formaat' }
}

function exportJSON(result, checkedUrl) {
  const blob = new Blob([JSON.stringify({ url: checkedUrl, ...result }, null, 2)], { type: 'application/json' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `sitecheck-${Date.now()}.json` })
  a.click(); URL.revokeObjectURL(a.href)
}

function exportMarkdown(result, checkedUrl) {
  const lines = [
    `# Fact-check Rapport`,
    ``,
    `**Website:** ${checkedUrl}`,
    `**Onderwerp:** ${result.onderwerp}`,
    `**Oordeel:** ${result.oordeel}`,
    `**Iteraties:** ${result.iteraties}`,
    ``,
    `## Beweringen`,
    ``,
    ...(result.items || []).flatMap(i => [
      `### [${i.status.toUpperCase()}] ${i.bewering}`,
      i.vertrouwen != null ? `Vertrouwen: ${i.vertrouwen}%` : '',
      i.uitleg ? `*${i.uitleg}*` : '',
      i.citaat ? `> "${i.citaat}"` : '',
      i.bron_url ? `Bron: ${i.bron_url}` : '',
      ``,
    ].filter(l => l !== '')),
    `## Conclusie`,
    ``,
    result.conclusie || '',
    ``,
    `## Bronnen`,
    ...(result.bronnen || []).map(b => `- ${b}`),
  ].join('\n')
  const blob = new Blob([lines], { type: 'text/markdown' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `sitecheck-${Date.now()}.md` })
  a.click(); URL.revokeObjectURL(a.href)
}

function saveHistory(checkedUrl, result) {
  try {
    const h = JSON.parse(localStorage.getItem('sc_history') || '[]')
    h.unshift({ url: checkedUrl, ts: Date.now(), oordeel: result.oordeel, onderwerp: result.onderwerp })
    localStorage.setItem('sc_history', JSON.stringify(h.slice(0, 5)))
  } catch {}
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem('sc_history') || '[]') } catch { return [] }
}

export default function Home() {
  const [url, setUrl] = useState('https://pa-copilot-assist.vercel.app/')
  const [urlError, setUrlError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [logLines, setLogLines] = useState([])
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => { setHistory(loadHistory()) }, [])

  function addLog(msg, type = '') {
    setLogLines(prev => [...prev, { msg, type }])
  }

  function handleUrlChange(v) {
    setUrl(v)
    setUrlError(v ? validateUrlClient(v) : null)
  }

  async function startCheck(bypassCache = false) {
    const err = validateUrlClient(url.trim())
    if (err) { setUrlError(err); return }
    if (!url.trim()) return

    setLoading(true)
    setLogLines([])
    setResult(null)
    setError(null)

    addLog('Verbinding maken met server...')

    try {
      const res = await fetch('/api/check-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), bypassCache }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalResult = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'progress') {
              addLog(event.bericht)
            } else if (event.type === 'result') {
              finalResult = event.data
            } else if (event.type === 'error') {
              throw new Error(event.bericht)
            }
          } catch (e) {
            if (e.message !== 'Unexpected end of JSON input') throw e
          }
        }
      }

      if (!finalResult) throw new Error('Geen resultaat ontvangen van server')

      const count = finalResult.items?.length ?? 0
      const iter = finalResult.iteraties ?? 1
      addLog(`Klaar — ${count} bewering${count === 1 ? '' : 'en'} gecontroleerd in ${iter} iteratie${iter === 1 ? '' : 's'}.`, 'done')
      setResult(finalResult)
      saveHistory(url.trim(), finalResult)
      setHistory(loadHistory())
    } catch (err) {
      addLog('Fout: ' + err.message, 'err')
      setError(err.message)
    }

    setLoading(false)
  }

  const counts = result ? {
    bevestigd:          (result.items || []).filter(i => i.status === 'bevestigd').length,
    onzeker:            (result.items || []).filter(i => i.status === 'onzeker').length,
    onjuist:            (result.items || []).filter(i => i.status === 'onjuist').length,
    niet_verifieerbaar: (result.items || []).filter(i => i.status === 'niet_verifieerbaar').length,
  } : null

  const sortOrder = { onjuist: 0, onzeker: 1, niet_verifieerbaar: 2, bevestigd: 3 }
  const sortedItems = result
    ? [...(result.items || [])].sort((a, b) => (sortOrder[a.status] ?? 9) - (sortOrder[b.status] ?? 9))
    : []

  const oordeelInfo = result ? (OORDEEL_MAP[result.oordeel] || OORDEEL_MAP.twijfelachtig) : null
  const totalBronnen = result ? 1 + (result.subPaginas?.length ?? 0) + (result.bronnen?.length ?? 0) : 0

  return (
    <div style={{ width: '100%', maxWidth: 760 }}>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 28, fontWeight: 600, letterSpacing: '-0.5px', marginBottom: 4 }}>
          site<span style={{ color: '#5ec46a' }}>check</span>
          <span style={{ fontSize: 13, fontWeight: 400, color: '#5a635c', marginLeft: 8, fontFamily: "'DM Mono', monospace", letterSpacing: 0 }}>v2</span>
        </div>
        <div style={{ color: '#5a635c', fontSize: 11, letterSpacing: '.5px', textTransform: 'uppercase' }}>
          Diepte-analyse · feitcontrole via officiële bronnen · iteratief heronderzoek
        </div>
      </div>

      {/* Input card */}
      <div style={styles.card}>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              type="url"
              value={url}
              onChange={e => handleUrlChange(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !loading && startCheck()}
              placeholder="https://jouw-app.vercel.app/"
              style={{ ...styles.input, borderColor: urlError ? '#d95f5f' : undefined }}
            />
            {urlError && (
              <div style={{ position: 'absolute', bottom: -18, left: 0, fontSize: 10, color: '#d95f5f' }}>
                {urlError}
              </div>
            )}
          </div>
          <button
            onClick={() => startCheck()}
            disabled={loading || !!urlError}
            style={{ ...styles.btn, opacity: (loading || !!urlError) ? 0.4 : 1, cursor: (loading || !!urlError) ? 'not-allowed' : 'pointer' }}
          >
            {loading ? 'Bezig…' : 'Controleer'}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: urlError ? 22 : 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, color: '#5a635c', flex: 1 }}>
            Crawlt sub-pagina's · controleert via officiële bronnen · heronderzoekt onzekere claims
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {result && (
              <button
                onClick={() => startCheck(true)}
                disabled={loading}
                style={{ ...styles.smallBtn }}
                title="Nieuwe analyse uitvoeren (cache omzeilen)"
              >
                ↺ Opnieuw
              </button>
            )}
            {history.length > 0 && (
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  style={{ ...styles.smallBtn, background: showHistory ? '#2a2e2b' : '#1c1f1d' }}
                >
                  Recente checks ({history.length})
                </button>
                {showHistory && (
                  <div style={styles.historyPanel}>
                    {history.map((h, i) => (
                      <button key={i} onClick={() => { setUrl(h.url); setShowHistory(false) }}
                        style={styles.historyItem}>
                        <span style={{ color: OORDEEL_MAP[h.oordeel]?.color || '#5a635c', marginRight: 6, fontSize: 8 }}>●</span>
                        <span style={{ flex: 1, textAlign: 'left', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {h.onderwerp || h.url}
                        </span>
                        <span style={{ fontSize: 10, color: '#5a635c', marginLeft: 8, flexShrink: 0 }}>
                          {new Date(h.ts).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Log */}
      {logLines.length > 0 && (
        <div style={{ ...styles.card, marginTop: 14, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 18px', borderBottom: '1px solid #2a2e2b', fontSize: 11, color: '#5a635c', textTransform: 'uppercase', letterSpacing: '.5px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: loading ? '#5ec46a' : '#3a3f3c', display: 'inline-block', animation: loading ? 'blink .8s infinite' : 'none' }} />
            {loading ? 'Analyseren…' : 'Analyse voltooid'}
          </div>
          <div style={{ padding: '14px 18px', fontSize: 12, color: '#8a9489', lineHeight: 1.9, maxHeight: 200, overflowY: 'auto' }}>
            {logLines.map((l, i) => (
              <div key={i} style={{ color: l.type === 'done' ? '#5ec46a' : l.type === 'err' ? '#d95f5f' : '#8a9489' }}>
                › {l.msg}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Resultaten */}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>

          {/* Oordeel banner */}
          <div style={{ ...styles.card, borderLeft: `3px solid ${oordeelInfo.color}`, background: oordeelInfo.bg }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 10, color: '#5a635c', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 2 }}>Oordeel</div>
                <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 600, color: oordeelInfo.color }}>{oordeelInfo.label}</div>
                <div style={{ fontSize: 10, color: '#5a635c', marginTop: 3 }}>
                  {result.iteraties === 2 ? '↺ herzien na 2 iteraties' : '1 iteratie'} · {totalBronnen} bron{totalBronnen === 1 ? '' : 'nen'}
                </div>
              </div>
              <div style={{ width: 1, height: 50, background: '#2a2e2b', flexShrink: 0, alignSelf: 'center' }} />
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: 10, color: '#5a635c', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 2 }}>Onderwerp</div>
                <div style={{ fontSize: 14, color: '#e8ede9' }}>{esc(result.onderwerp)}</div>
              </div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {[
                  { key: 'bevestigd',          lbl: 'Bevestigd' },
                  { key: 'onzeker',            lbl: 'Onzeker'   },
                  { key: 'onjuist',            lbl: 'Onjuist'   },
                  { key: 'niet_verifieerbaar', lbl: 'N/V'       },
                ].map(s => (
                  <div key={s.key} style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 20, fontWeight: 600, color: STATUS_MAP[s.key].color, lineHeight: 1 }}>{counts[s.key]}</div>
                    <div style={{ fontSize: 9, color: '#5a635c', textTransform: 'uppercase', letterSpacing: '.3px', marginTop: 2 }}>{s.lbl}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Export knoppen */}
            <div style={{ display: 'flex', gap: 6, marginTop: 12, paddingTop: 10, borderTop: '1px solid #2a2e2b22' }}>
              <button onClick={() => exportJSON(result, url)} style={styles.exportBtn}>↓ JSON</button>
              <button onClick={() => exportMarkdown(result, url)} style={styles.exportBtn}>↓ Markdown</button>
            </div>
          </div>

          {/* Pagina's + Bronnen */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {result.subPaginas?.length > 0 && (
              <div style={{ ...styles.card, flex: 1, minWidth: 200, padding: '12px 18px' }}>
                <div style={{ fontSize: 10, color: '#5a635c', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>Geanalyseerde pagina's</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <a href={url} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 11, color: '#8a9489', textDecoration: 'none', wordBreak: 'break-all' }}>
                    ↗ {url.length > 52 ? url.slice(0, 52) + '…' : url}
                  </a>
                  {result.subPaginas.map((p, i) => (
                    <a key={i} href={p} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 11, color: '#5ec46a', textDecoration: 'none', wordBreak: 'break-all' }}>
                      ↗ {p.length > 52 ? p.slice(0, 52) + '…' : p}
                    </a>
                  ))}
                </div>
              </div>
            )}
            {result.bronnen?.length > 0 && (
              <div style={{ ...styles.card, flex: 1, minWidth: 200, padding: '12px 18px' }}>
                <div style={{ fontSize: 10, color: '#5a635c', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>Geraadpleegde bronnen</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {result.bronnen.map((b, i) => (
                    <a key={i} href={b} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 11, color: '#4a9fd4', textDecoration: 'none', wordBreak: 'break-all' }}>
                      ↗ {b.length > 52 ? b.slice(0, 52) + '…' : b}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Fact-check items */}
          {sortedItems.map((item, i) => {
            const s = STATUS_MAP[item.status] || STATUS_MAP.niet_verifieerbaar
            return (
              <div key={i} style={{ borderRadius: 10, padding: '14px 16px', border: `1px solid ${s.color}33`, borderLeft: `3px solid ${s.color}`, background: s.bg.replace('.15', '.07'), position: 'relative' }}>

                {item.bijgewerkt && (
                  <div style={{ position: 'absolute', top: 10, right: 12, fontSize: 9, color: '#5ec46a', background: 'rgba(94,196,106,.15)', padding: '2px 7px', borderRadius: 4, letterSpacing: '.4px', textTransform: 'uppercase' }}>
                    ↺ Herzien
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 6, paddingRight: item.bijgewerkt ? 72 : 0 }}>
                  <span style={{ fontSize: 9, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.6px', padding: '2px 7px', borderRadius: 4, background: s.bg, color: s.color, flexShrink: 0 }}>
                    {s.label}
                  </span>
                  <span style={{ fontSize: 13, color: '#e8ede9', flex: 1 }}>{esc(item.bewering)}</span>
                </div>

                {/* Vertrouwensbalk */}
                {item.vertrouwen != null && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ height: 3, background: '#2a2e2b', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${item.vertrouwen}%`, background: s.color, borderRadius: 2 }} />
                    </div>
                    <div style={{ fontSize: 9, color: '#5a635c', marginTop: 2 }}>Vertrouwen: {item.vertrouwen}%</div>
                  </div>
                )}

                {item.uitleg && (
                  <div style={{ fontSize: 12, color: '#8a9489', marginBottom: 4 }}>{esc(item.uitleg)}</div>
                )}
                {item.bijgewerkt && (
                  <div style={{ fontSize: 10, color: '#5a635c', marginBottom: 4, fontStyle: 'italic' }}>
                    Status bijgesteld na aanvullend brononderzoek
                  </div>
                )}
                {item.citaat && (
                  <div style={{ fontSize: 11, color: '#5a635c', marginTop: 5, paddingLeft: 10, borderLeft: '2px solid #3a3f3c', fontStyle: 'italic' }}>
                    "{esc(item.citaat)}"
                  </div>
                )}
                {item.bron_url && (
                  <div style={{ marginTop: 6 }}>
                    <a href={item.bron_url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 11, color: '#4a9fd4', textDecoration: 'none' }}>
                      ↗ {item.bron_url.length > 80 ? item.bron_url.slice(0, 80) + '…' : item.bron_url}
                    </a>
                  </div>
                )}
              </div>
            )
          })}

          {sortedItems.length === 0 && (
            <div style={{ ...styles.card, color: '#5a635c', fontSize: 13, textAlign: 'center', padding: 32 }}>
              Geen verifieerbare beweringen gevonden op deze website.
            </div>
          )}

          {result.conclusie && (
            <div style={{ ...styles.card, fontFamily: "'Fraunces', Georgia, serif", fontSize: 15, lineHeight: 1.65, color: '#8a9489' }}>
              {result.conclusie}
            </div>
          )}

        </div>
      )}

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.2} }
        input::placeholder { color: #5a635c; }
        input:focus { outline: none; border-color: #5ec46a !important; }
        a:hover { opacity: 0.8; }
        button:hover:not(:disabled) { opacity: 0.85; }
      `}</style>
    </div>
  )
}

const styles = {
  card: {
    background: '#151816',
    border: '1px solid #2a2e2b',
    borderRadius: 10,
    padding: '18px',
  },
  input: {
    flex: 1,
    background: '#1c1f1d',
    border: '1px solid #2a2e2b',
    borderRadius: 8,
    color: '#e8ede9',
    fontFamily: "'DM Mono', monospace",
    fontSize: 13,
    padding: '10px 14px',
    transition: 'border-color .2s',
    width: '100%',
  },
  btn: {
    background: '#5ec46a',
    border: 'none',
    borderRadius: 8,
    color: '#0d2610',
    fontFamily: "'DM Mono', monospace",
    fontSize: 13,
    fontWeight: 500,
    padding: '10px 20px',
    whiteSpace: 'nowrap',
    transition: 'opacity .15s',
  },
  smallBtn: {
    background: '#1c1f1d',
    border: '1px solid #2a2e2b',
    borderRadius: 6,
    color: '#8a9489',
    fontFamily: "'DM Mono', monospace",
    fontSize: 11,
    padding: '5px 10px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'opacity .15s',
  },
  exportBtn: {
    background: 'transparent',
    border: '1px solid #2a2e2b',
    borderRadius: 6,
    color: '#5a635c',
    fontFamily: "'DM Mono', monospace",
    fontSize: 10,
    padding: '4px 10px',
    cursor: 'pointer',
    transition: 'color .15s',
  },
  historyPanel: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 4,
    background: '#151816',
    border: '1px solid #2a2e2b',
    borderRadius: 8,
    minWidth: 280,
    zIndex: 100,
    overflow: 'hidden',
  },
  historyItem: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    padding: '8px 14px',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid #1c1f1d',
    cursor: 'pointer',
    color: '#e8ede9',
    fontFamily: "'DM Mono', monospace",
    transition: 'background .1s',
  },
}
