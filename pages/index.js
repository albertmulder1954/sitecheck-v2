import { useState } from 'react'

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

export default function Home() {
  const [url, setUrl] = useState('https://pa-copilot-assist.vercel.app/')
  const [loading, setLoading] = useState(false)
  const [logLines, setLogLines] = useState([])
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  function addLog(msg, type = '') {
    setLogLines(prev => [...prev, { msg, type }])
  }

  async function startCheck() {
    if (!url.trim()) return
    setLoading(true)
    setLogLines([])
    setResult(null)
    setError(null)

    addLog('Pagina ophalen en tekst extraheren...')

    try {
      const fetchPromise = fetch('/api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })

      await new Promise(r => setTimeout(r, 600))
      addLog("Sub-pagina's van de website ontdekken...")

      await new Promise(r => setTimeout(r, 1000))
      addLog('Diepere lagen ophalen en analyseren...')

      await new Promise(r => setTimeout(r, 1200))
      addLog('Beweringen identificeren via Claude (fase 1)...')

      await new Promise(r => setTimeout(r, 1200))
      addLog('Officiële documentatiebronnen ophalen...')

      await new Promise(r => setTimeout(r, 800))
      addLog('Beweringen toetsen aan bronteksten (fase 2)...')

      await new Promise(r => setTimeout(r, 2500))
      addLog('Onzekere beweringen verder onderzoeken (fase 3)...')

      const res = await fetchPromise
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)

      const count = data.items?.length ?? 0
      const iter = data.iteraties ?? 1
      addLog(`Klaar — ${count} bewering${count === 1 ? '' : 'en'} gecontroleerd in ${iter} iteratie${iter === 1 ? '' : 's'}.`, 'done')
      setResult(data)
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

  const totalBronnen = result
    ? (result.bronnen?.length ?? 0) + (result.subPaginas?.length ?? 0) + 1
    : 0

  return (
    <div style={{ width: '100%', maxWidth: 760 }}>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 28, fontWeight: 600, letterSpacing: '-0.5px', marginBottom: 4 }}>
          site<span style={{ color: '#5ec46a' }}>check</span>
          <span style={{ fontSize: 13, fontWeight: 400, color: '#5a635c', marginLeft: 8, fontFamily: "'DM Mono', monospace", letterSpacing: 0 }}>v2</span>
        </div>
        <div style={{ color: '#5a635c', fontSize: 11, letterSpacing: '.5px', textTransform: 'uppercase' }}>
          Feitelijke verificatie via officiële bronnen · diepte-analyse
        </div>
      </div>

      {/* Input card */}
      <div style={styles.card}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && startCheck()}
            placeholder="https://jouw-app.vercel.app/"
            style={styles.input}
          />
          <button
            onClick={startCheck}
            disabled={loading}
            style={{ ...styles.btn, opacity: loading ? 0.4 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            {loading ? 'Bezig…' : 'Controleer'}
          </button>
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: '#5a635c' }}>
          Crawlt sub-pagina's · controleert beweringen via Microsoft Learn & andere officiële bronnen · heronderzoekt onzekere claims
        </div>
      </div>

      {/* Log */}
      {logLines.length > 0 && (
        <div style={{ ...styles.card, marginTop: 14, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 18px', borderBottom: '1px solid #2a2e2b', fontSize: 11, color: '#5a635c', textTransform: 'uppercase', letterSpacing: '.5px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: loading ? '#5ec46a' : '#3a3f3c', display: 'inline-block', animation: loading ? 'blink .8s infinite' : 'none' }} />
            {loading ? 'Analyseren…' : 'Analyse voltooid'}
          </div>
          <div style={{ padding: '14px 18px', fontSize: 12, color: '#8a9489', lineHeight: 1.9, maxHeight: 180, overflowY: 'auto' }}>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 10, color: '#5a635c', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 2 }}>Oordeel</div>
                <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 600, color: oordeelInfo.color }}>{oordeelInfo.label}</div>
                <div style={{ fontSize: 10, color: '#5a635c', marginTop: 3 }}>
                  {result.iteraties === 2 ? '↺ herzien na 2 iteraties' : '1 iteratie'} · {totalBronnen} bron{totalBronnen === 1 ? '' : 'nen'}
                </div>
              </div>
              <div style={{ width: 1, height: 44, background: '#2a2e2b', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 10, color: '#5a635c', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 2 }}>Onderwerp</div>
                <div style={{ fontSize: 14, color: '#e8ede9' }}>{esc(result.onderwerp)}</div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 16 }}>
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
          </div>

          {/* Geanalyseerde pagina's */}
          {(result.subPaginas?.length > 0 || true) && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>

              {/* Sub-pagina's */}
              {result.subPaginas?.length > 0 && (
                <div style={{ ...styles.card, flex: 1, minWidth: 200, padding: '12px 18px' }}>
                  <div style={{ fontSize: 10, color: '#5a635c', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>Geanalyseerde pagina's</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <a href={url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 11, color: '#8a9489', textDecoration: 'none', wordBreak: 'break-all' }}>
                      ↗ {url.length > 55 ? url.slice(0, 55) + '…' : url}
                    </a>
                    {result.subPaginas.map((p, i) => (
                      <a key={i} href={p} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 11, color: '#5ec46a', textDecoration: 'none', wordBreak: 'break-all' }}>
                        ↗ {p.length > 55 ? p.slice(0, 55) + '…' : p}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Geraadpleegde bronnen */}
              {result.bronnen?.length > 0 && (
                <div style={{ ...styles.card, flex: 1, minWidth: 200, padding: '12px 18px' }}>
                  <div style={{ fontSize: 10, color: '#5a635c', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>Geraadpleegde bronnen</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {result.bronnen.map((bron, i) => (
                      <a key={i} href={bron} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 11, color: '#4a9fd4', textDecoration: 'none', wordBreak: 'break-all' }}>
                        ↗ {bron.length > 55 ? bron.slice(0, 55) + '…' : bron}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Fact-check items */}
          {sortedItems.map((item, i) => {
            const s = STATUS_MAP[item.status] || STATUS_MAP.niet_verifieerbaar
            const bgCard = s.bg.replace('.15', '.07')
            return (
              <div key={i} style={{ borderRadius: 10, padding: '14px 16px', border: `1px solid ${s.color}33`, borderLeft: `3px solid ${s.color}`, background: bgCard, position: 'relative' }}>

                {/* Herzien badge */}
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

          {/* Geen beweringen */}
          {sortedItems.length === 0 && (
            <div style={{ ...styles.card, color: '#5a635c', fontSize: 13, textAlign: 'center', padding: 32 }}>
              Geen verifieerbare beweringen gevonden op deze website.
            </div>
          )}

          {/* Conclusie */}
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
}
