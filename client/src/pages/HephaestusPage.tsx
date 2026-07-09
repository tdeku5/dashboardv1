import { useState, useRef, useEffect, useCallback } from 'react'
import { NavDropdown } from '../components/NavDropdown'
import { SpecChart } from '../components/charts/SpecChart'
import {
  sendChat, saveChart, getStoredModel, setStoredModel,
  HEPHAESTUS_MODELS, type HephaestusModel, type ChartSpecV1, type ChatTurn,
} from '../lib/hephaestus'
import styles from './HephaestusPage.module.css'

/*
 * Hephaestus — the in-terminal AI charting agent (see docs/hephaestus.md).
 * Conversation state is client-side only and resets on page leave (v1).
 * Each assistant turn that yields a spec renders live via <SpecChart>; the
 * spec can be saved to Misc. Charts or copied as JSON.
 */

interface FeedTurn {
  role: 'user' | 'assistant'
  content: string
  spec?: ChartSpecV1
  isError?: boolean
}

const MODEL_LABELS: Record<HephaestusModel, string> = {
  'claude-sonnet-5': 'Sonnet 5',
  'claude-opus-4-8': 'Opus 4.8',
}

function ChartActions({ spec }: { spec: ChartSpecV1 }) {
  const [savedAs, setSavedAs] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const onSave = async () => {
    const name = window.prompt('Save chart to Misc. Charts as:', spec.title)
    if (!name || name.trim() === '') return
    try {
      await saveChart(name.trim(), spec)
      setSavedAs(name.trim())
    } catch (err) {
      window.alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(spec, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt('Copy the spec JSON:', JSON.stringify(spec))
    }
  }

  return (
    <div className={styles.chartActions}>
      <button type="button" className={styles.actionBtn} onClick={onSave}>
        {savedAs ? `SAVED ✓` : 'SAVE TO MISC. CHARTS'}
      </button>
      <button type="button" className={styles.actionBtn} onClick={onCopy}>
        {copied ? 'COPIED ✓' : 'COPY SPEC JSON'}
      </button>
    </div>
  )
}

export function HephaestusPage() {
  const [turns, setTurns] = useState<FeedTurn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [model, setModel] = useState<HephaestusModel>(() => getStoredModel())
  const feedEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns.length, busy])

  const onModelChange = (m: HephaestusModel) => {
    setModel(m)
    setStoredModel(m)
  }

  const submit = useCallback(async () => {
    const text = input.trim()
    if (text === '' || busy) return
    setInput('')
    setBusy(true)
    const nextTurns: FeedTurn[] = [...turns, { role: 'user', content: text }]
    setTurns(nextTurns)
    try {
      // Full history each turn (text only) — no server-side persistence in v1.
      const history: ChatTurn[] = nextTurns
        .filter(t => !t.isError)
        .map(t => ({ role: t.role, content: t.content }))
      const res = await sendChat(history, model)
      setTurns(prev => [...prev, {
        role: 'assistant',
        content: res.reply,
        spec: res.spec ?? undefined,
      }])
    } catch (err) {
      setTurns(prev => [...prev, {
        role: 'assistant',
        content: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      }])
    } finally {
      setBusy(false)
    }
  }, [input, busy, turns, model])

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.barLeft}>
          <NavDropdown />
          <span className={styles.logo}>TND RESEARCH TERMINAL</span>
        </div>
        <div className={styles.barCenter} />
        <div className={styles.barRight} />
      </header>

      <nav className={styles.breadcrumb}>
        <span className={styles.breadcrumbCurrent}>Hephaestus</span>
      </nav>

      <div className={styles.body}>
        <div className={styles.pageHeader}>
          <div className={styles.pageTitle}>HEPHAESTUS</div>
          <div className={styles.pageSubtitle}>AI charting agent — describe a chart; series resolve from the terminal's own catalog</div>
        </div>

        <div className={styles.feed}>
          {turns.length === 0 && !busy && (
            <div className={styles.emptyState}>
              <div>Ask for a chart in plain language.</div>
              <div>"US 10Y treasury yield vs Germany 10Y yield, last 5 years" · "Rebase gold, copper and WTI to 100 over 2 years"</div>
            </div>
          )}
          {turns.map((t, i) => t.role === 'user' ? (
            <div key={i} className={styles.turnUser}>{t.content}</div>
          ) : (
            <div key={i} className={styles.turnAssistant}>
              {t.content && (
                <div className={t.isError ? styles.assistantError : styles.assistantText}>{t.content}</div>
              )}
              {t.spec && <SpecChart spec={t.spec} headerExtra={<ChartActions spec={t.spec} />} />}
            </div>
          ))}
          {busy && <div className={styles.forging}>FORGING…</div>}
          <div ref={feedEndRef} />
        </div>
      </div>

      <div className={styles.inputBar}>
        <select
          className={styles.modelSelect}
          value={model}
          onChange={e => onModelChange(e.target.value as HephaestusModel)}
          title="Model used for the agent loop"
        >
          {HEPHAESTUS_MODELS.map(m => <option key={m} value={m}>{MODEL_LABELS[m]}</option>)}
        </select>
        <input
          className={styles.inputBox}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void submit() }}
          placeholder="Describe the chart you want…"
          disabled={busy}
        />
        <button type="button" className={styles.sendBtn} onClick={() => void submit()} disabled={busy || input.trim() === ''}>
          FORGE
        </button>
      </div>
    </div>
  )
}
