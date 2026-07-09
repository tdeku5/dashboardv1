import { useState, useRef, useEffect, useCallback, type ReactNode, type KeyboardEvent } from 'react'
import { NavDropdown } from '../components/NavDropdown'
import { useSpecChart, SpecChartCore } from '../components/charts/SpecChart'
import {
  sendChat, saveChart, getStoredModel, setStoredModel,
  HEPHAESTUS_MODELS, type HephaestusModel, type ChartSpecV1, type ChatTurn,
} from '../lib/hephaestus'
import styles from './HephaestusPage.module.css'

/*
 * Hephaestus — the in-terminal AI charting agent (see docs/hephaestus.md).
 * Conversation state is client-side only and resets on page leave (v1).
 *
 * Design (visual pass): speaker asymmetry — user turns are right-aligned
 * bubbles, assistant turns are bare sans prose on the canvas with a mono
 * status line; chart cards break wider than the prose column. All colors
 * resolve from the --hp-* tokens in the CSS module; none are hardcoded here.
 */

interface FeedTurn {
  role: 'user' | 'assistant'
  content: string
  spec?: ChartSpecV1
  isError?: boolean
  iterations?: number
  model?: HephaestusModel
}

const MODEL_LABELS: Record<HephaestusModel, string> = {
  'claude-sonnet-5': 'Sonnet 5',
  'claude-opus-4-8': 'Opus 4.8',
}

export const EXAMPLE_PROMPTS = [
  'US 10Y vs German 10Y yield, last 5 years',
  'Rebase gold, copper and WTI to 100 over 2 years',
  'US core CPI YoY, last decade',
]

// ── Icons (stroke = currentColor, sized by the button) ──────────────────────

function ArrowUpIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SaveIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 2.5h8a1 1 0 0 1 1 1v10l-5-3-5 3v-10a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m3 8.5 3.5 3.5L13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Assistant prose with inline series-id chips ─────────────────────────────

function specSeriesIds(spec: ChartSpecV1): string[] {
  const ids = new Set<string>()
  for (const s of spec.series) {
    if (s.kind === 'derived') { ids.add(s.a.id); ids.add(s.b.id) } else ids.add(s.id)
  }
  // Longest first so e.g. "US10Y" never clips a longer id containing it.
  return [...ids].sort((a, b) => b.length - a.length)
}

function proseWithChips(text: string, spec: ChartSpecV1 | undefined): ReactNode {
  if (!spec || text === '') return text
  const ids = specSeriesIds(spec)
  if (ids.length === 0) return text
  const pattern = new RegExp(`(${ids.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g')
  const parts = text.split(pattern)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    ids.includes(part) ? <code key={i} className={styles.chip}>{part}</code> : part
  )
}

// ── Chart card (Hephaestus framing around the shared SpecChartCore) ─────────

function CardActions({ spec }: { spec: ChartSpecV1 }) {
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  const onSave = async () => {
    const name = window.prompt('Save chart to Misc. Charts as:', spec.title)
    if (!name || name.trim() === '') return
    try {
      await saveChart(name.trim(), spec)
      setSaved(true)
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
    <div className={styles.cardActions}>
      <button type="button" onClick={() => void onSave()}
        className={`${styles.iconBtn} ${saved ? styles.iconBtnDone : ''}`}
        title={saved ? 'Saved to Misc. Charts' : 'Save to Misc. Charts'}
        aria-label={saved ? 'Saved to Misc. Charts' : 'Save to Misc. Charts'}>
        {saved ? <CheckIcon /> : <SaveIcon />}
      </button>
      <button type="button" onClick={() => void onCopy()}
        className={`${styles.iconBtn} ${copied ? styles.iconBtnDone : ''}`}
        title={copied ? 'Copied' : 'Copy spec JSON'}
        aria-label={copied ? 'Copied' : 'Copy spec JSON'}>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  )
}

function HpChartCard({ spec }: { spec: ChartSpecV1 }) {
  const state = useSpecChart(spec)
  return (
    <div className={styles.chartCard}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitleWrap}>
          <div className={styles.cardTitle}>{spec.title}</div>
          {state.annotation && <div className={styles.cardAnnotation}>⚠ {state.annotation}</div>}
        </div>
        <CardActions spec={spec} />
      </div>
      <SpecChartCore state={state} />
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function HephaestusPage() {
  const [turns, setTurns] = useState<FeedTurn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [model, setModel] = useState<HephaestusModel>(() => getStoredModel())
  const feedEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns.length, busy])

  const onModelChange = (m: HephaestusModel) => {
    setModel(m)
    setStoredModel(m)
  }

  const autoGrow = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }

  const submit = useCallback(async () => {
    const text = input.trim()
    if (text === '' || busy) return
    setInput('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
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
        iterations: res.iterations,
        model,
      }])
    } catch (err) {
      setTurns(prev => [...prev, {
        role: 'assistant',
        content: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
        model,
      }])
    } finally {
      setBusy(false)
    }
  }, [input, busy, turns, model])

  const onComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
    // Cmd/Ctrl+Enter also submits (even with shift-newline habits)
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void submit()
    }
  }

  const useExample = (prompt: string) => {
    setInput(prompt)
    inputRef.current?.focus()
  }

  const statusLineFor = (t: FeedTurn): string => {
    const modelPart = t.model ? ` · ${MODEL_LABELS[t.model].toUpperCase()}` : ''
    if (t.isError) return `FAILED${modelPart}`
    const steps = t.iterations !== undefined ? `${t.iterations} ${t.iterations === 1 ? 'STEP' : 'STEPS'}` : ''
    return `${t.spec ? 'FORGED' : 'REPLY'}${steps ? ` · ${steps}` : ''}${modelPart}`
  }

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
        <div className={styles.feed}>
          {turns.map((t, i) => t.role === 'user' ? (
            <div key={i} className={styles.turnUser}>{t.content}</div>
          ) : (
            <div key={i} className={styles.turnAssistant}>
              <div className={styles.statusLine}>
                <span className={styles.statusDot} />
                {statusLineFor(t)}
              </div>
              {t.content && (
                t.isError
                  ? <div className={styles.assistantError}>{t.content}</div>
                  : <div className={styles.assistantText}>{proseWithChips(t.content, t.spec)}</div>
              )}
              {t.spec && <HpChartCard spec={t.spec} />}
            </div>
          ))}

          {busy && (
            <div className={styles.turnAssistant}>
              <div className={styles.statusLine}>
                <span className={styles.forgingDot} />
                <span className={styles.forgingWord}>Forging</span>
              </div>
            </div>
          )}

          {turns.length === 0 && !busy && (
            <div className={styles.emptyState}>
              <div className={styles.emptyTitle}>Ask Hephaestus for a chart.</div>
              <div className={styles.emptyBody}>
                Describe it in plain language — series resolve from the terminal's own catalog,
                and every chart renders live from the database. Save the good ones to Misc. Charts.
              </div>
              <div className={styles.exampleChips}>
                {EXAMPLE_PROMPTS.map(p => (
                  <button key={p} type="button" className={styles.exampleChip} onClick={() => useExample(p)}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div ref={feedEndRef} />
        </div>
      </div>

      <div className={styles.composerBar}>
        <div className={styles.composer}>
          <div className={styles.modelWrap}>
            <select
              className={styles.modelSelect}
              value={model}
              onChange={e => onModelChange(e.target.value as HephaestusModel)}
              aria-label="Model used for the agent loop"
              title="Model used for the agent loop"
            >
              {HEPHAESTUS_MODELS.map(m => <option key={m} value={m}>{MODEL_LABELS[m]}</option>)}
            </select>
          </div>
          <textarea
            ref={inputRef}
            className={styles.inputBox}
            rows={1}
            value={input}
            onChange={e => { setInput(e.target.value); autoGrow() }}
            onKeyDown={onComposerKeyDown}
            placeholder="Describe the chart you want…"
            disabled={busy}
            aria-label="Chart request"
          />
          <button
            type="button"
            className={styles.sendBtn}
            onClick={() => void submit()}
            disabled={busy || input.trim() === ''}
            title="Send (Enter)"
            aria-label="Send"
          >
            <ArrowUpIcon />
          </button>
        </div>
      </div>
    </div>
  )
}
