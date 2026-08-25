import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { NavDropdown } from '../components/NavDropdown'
import {
  deriveSetup,
  deriveUnitCount,
  riskBudgetLadder,
  dollarPerPoint,
  maxContractsOnCapital,
  computeContractsGrid,
  computeMarginGrid,
  computeActualRiskGrid,
  computeInverseGrid,
  type PsSettingsValues,
} from '../lib/positionSizing'
import styles from './PositionSizingPage.module.css'

// Faithful port of position_sizing.xlsx (Setup / Instruments / Sizing Grid).
// All math lives in lib/positionSizing.ts — this component only fetches
// inputs, persists edits, and renders. Grids recompute from local state
// immediately on edit; the PUT round-trip only surfaces failures.

const API = '/api/portfolio/position-sizing'
const DASH = '–'
const MAX_LADDER_ROWS = 20

// ── API row shapes ───────────────────────────────────────────────────────────

interface SettingsRow {
  principle: number
  current_portfolio_value: number
  market_money_pct: number
  max_drawdown_pct: number
  unit_risk_pct: number
  max_units_risk_pct: number
}

interface InstrumentRow {
  symbol: string
  group_name: string
  tick_size_display: string
  tick_size_decimal: number
  tick_value: number | null
  initial_margin: number | null
  sort_order: number
}

interface LaddersRow {
  stopLadder: number[]
  contractLadder: number[]
}

function settingsFromRow(r: SettingsRow): PsSettingsValues {
  return {
    principle: r.principle,
    currentPortfolioValue: r.current_portfolio_value,
    marketMoneyPct: r.market_money_pct,
    maxDrawdownPct: r.max_drawdown_pct,
    unitRiskPct: r.unit_risk_pct,
    maxUnitsRiskPct: r.max_units_risk_pct,
  }
}

function settingsToBody(s: PsSettingsValues): SettingsRow {
  return {
    principle: s.principle,
    current_portfolio_value: s.currentPortfolioValue,
    market_money_pct: s.marketMoneyPct,
    max_drawdown_pct: s.maxDrawdownPct,
    unit_risk_pct: s.unitRiskPct,
    max_units_risk_pct: s.maxUnitsRiskPct,
  }
}

async function putJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let msg = `Save failed (HTTP ${res.status})`
    try {
      const j = (await res.json()) as { error?: string }
      if (j.error) msg = j.error
    } catch {
      // non-JSON error body — keep the status message
    }
    throw new Error(msg)
  }
}

// ── Number formats (workbook: zeros render as –, negatives in parentheses) ──

// Excel displays through a 15-significant-digit cosmetic rounding; formatting
// the raw double instead would show $114,900 where the workbook shows $114,901
// (5 × 22,980.1 is 114900.4999… as a double, 114900.5 at 15 digits).
function excelValue(v: number): number {
  return Number(v.toPrecision(15))
}

function withParens(v: number, body: string): string {
  return v < 0 ? `(${body})` : body
}

// The currency formatters are exported for the Excel-parity tests: rounding
// must be half-away-from-zero on BOTH signs (Intl's default halfExpand), so
// −0.5 is ($1) — routing through Math.round would give −0 → $0.

/** $#,##0.00 — Setup panel currency. */
export function fmtCurrency2(v: number | null): string {
  if (v === null) return DASH
  const n = excelValue(v)
  if (n === 0) return DASH
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return withParens(n, `$${abs}`)
}

/** $#,##0 — grid currency. */
export function fmtCurrency0(v: number | null): string {
  if (v === null) return DASH
  const n = excelValue(v)
  if (n === 0) return DASH
  const abs = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
  return withParens(n, `$${abs}`)
}

/** 0.00% — stored as a fraction. */
function fmtPct2(v: number | null): string {
  if (v === null || v === 0) return DASH
  const abs = Math.abs(excelValue(v * 100)).toFixed(2)
  return withParens(v, `${abs}%`)
}

/** Plain integer with thousands separators (contract and tick counts). */
function fmtInt(v: number | null): string {
  if (v === null || v === 0) return DASH
  const abs = Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })
  return withParens(v, abs)
}

/** Full-precision plain number — must show 6J's 0.0000005 without truncation. */
function fmtPlain(v: number | null): string {
  if (v === null || v === 0) return DASH
  const abs = Math.abs(v)
  const body = abs < 1e-6 ? abs.toFixed(Math.ceil(-Math.log10(abs))) : String(abs)
  return withParens(v, body)
}

// ── Inline-editable number ──────────────────────────────────────────────────
// Shows the formatted value; on focus becomes a raw editing buffer; commits on
// blur or Enter, reverts on Escape or an unparseable entry.

interface EditableNumberProps {
  value: number
  display: string
  toEditText: (v: number) => string
  parse: (text: string) => number
  onCommit: (n: number) => void
  ariaLabel: string
  className?: string
}

function EditableNumber({ value, display, toEditText, parse, onCommit, ariaLabel, className }: EditableNumberProps) {
  const [draft, setDraft] = useState<string | null>(null)

  function commit(): void {
    if (draft === null) return
    const n = parse(draft.trim())
    setDraft(null)
    if (Number.isFinite(n) && n !== value) onCommit(n)
  }

  return (
    <input
      className={`${styles.editable} ${className ?? ''}`}
      aria-label={ariaLabel}
      value={draft ?? display}
      onFocus={e => {
        setDraft(toEditText(value))
        e.target.select()
      }}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(null)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

const dollarEdit = {
  toEditText: (v: number) => String(v),
  parse: (t: string) => parseFloat(t),
}
// Percent fields edit in percent units (0.25 ⇒ type "0.25" for 0.25%).
const pctEdit = {
  toEditText: (v: number) => String(excelValue(v * 100)),
  parse: (t: string) => parseFloat(t) / 100,
}

// ── Sizing grid table ───────────────────────────────────────────────────────

interface GridCell {
  text: string
  red?: boolean
}

interface GridRowData {
  key: number
  headers: [string, string, string]
  cells: GridCell[]
}

interface SizingGridProps {
  heading: string
  testId: string
  rowHeaderLabels: [string, string, string]
  budgets: number[]
  rows: GridRowData[]
  footnote: string
  emptyMessage: string
  zeroUnitsMessage: string | null
}

function SizingGrid({ heading, testId, rowHeaderLabels, budgets, rows, footnote, emptyMessage, zeroUnitsMessage }: SizingGridProps) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>{heading}</span>
      </div>
      {rows.length === 0 ? (
        <div className={styles.gridEmpty}>{emptyMessage}</div>
      ) : (
        <>
          {zeroUnitsMessage !== null && <div className={styles.gridWarning}>{zeroUnitsMessage}</div>}
          <div className={styles.tableWrap}>
            <table className={styles.gridTable} data-testid={testId}>
              <thead>
                <tr>
                  {rowHeaderLabels.map(l => (
                    <th key={l} className={styles.rowHeadCell}>
                      {l}
                    </th>
                  ))}
                  {budgets.map((_, i) => (
                    <th key={i} className={styles.unitCell}>
                      {i + 1}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className={styles.rowHeadCell} colSpan={3} />
                  {budgets.map((b, i) => (
                    <th key={i} className={styles.budgetCell}>
                      {fmtCurrency0(b)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.key}>
                    {row.headers.map((h, i) => (
                      <th key={i} className={styles.rowHeadCell} scope={i === 0 ? 'row' : undefined}>
                        {h}
                      </th>
                    ))}
                    {row.cells.map((cell, i) => (
                      <td key={i} className={cell.red ? `${styles.bodyCell} ${styles.cellRed}` : styles.bodyCell}>
                        {cell.text}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className={styles.footnote}>{footnote}</div>
    </section>
  )
}

// ── Ladder editor ───────────────────────────────────────────────────────────

interface LadderEditorProps {
  label: string
  values: number[]
  onChange: (next: number[]) => void
}

function LadderEditor({ label, values, onChange }: LadderEditorProps) {
  const [addDraft, setAddDraft] = useState('')

  function commitRow(index: number, text: string): void {
    const n = parseInt(text, 10)
    if (!Number.isFinite(n) || n <= 0) return
    const next = [...new Set(values.map((v, i) => (i === index ? n : v)))].sort((a, b) => a - b)
    onChange(next)
  }

  function addRow(): void {
    const n = parseInt(addDraft.trim(), 10)
    setAddDraft('')
    if (!Number.isFinite(n) || n <= 0) return
    const next = [...new Set([...values, n])].sort((a, b) => a - b)
    if (next.length > MAX_LADDER_ROWS) return
    onChange(next)
  }

  return (
    <div className={styles.ladderEditor}>
      <div className={styles.ladderEditorLabel}>{label}</div>
      <div className={styles.ladderEditorRows}>
        {values.map((v, i) => (
          <span key={`${v}-${i}`} className={styles.ladderEditorRow}>
            <input
              className={styles.ladderInput}
              aria-label={`${label} row ${i + 1}`}
              defaultValue={String(v)}
              onBlur={e => commitRow(i, e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
            />
            <button
              className={styles.ladderRemove}
              aria-label={`Remove ${label} row ${v}`}
              onClick={() => onChange(values.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </span>
        ))}
        {values.length === 0 && <span className={styles.ladderEmptyNote}>empty — re-seeds on next server restart</span>}
      </div>
      {values.length < MAX_LADDER_ROWS && (
        <div className={styles.ladderAdd}>
          <input
            className={styles.ladderInput}
            aria-label={`Add ${label} row`}
            placeholder="add…"
            value={addDraft}
            onChange={e => setAddDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') addRow()
            }}
          />
          <button className={styles.ladderAddBtn} onClick={addRow}>
            + Add
          </button>
        </div>
      )}
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export function PositionSizingPage() {
  const [settings, setSettings] = useState<PsSettingsValues | null>(null)
  const [instruments, setInstruments] = useState<InstrumentRow[]>([])
  const [stopLadder, setStopLadder] = useState<number[]>([])
  const [contractLadder, setContractLadder] = useState<number[]>([])
  const [selected, setSelected] = useState('ES')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      try {
        const [sRes, iRes, lRes] = await Promise.all([
          fetch(`${API}/settings`),
          fetch(`${API}/instruments`),
          fetch(`${API}/ladders`),
        ])
        if (!sRes.ok || !iRes.ok || !lRes.ok) throw new Error('Failed to load position-sizing inputs')
        const s = (await sRes.json()) as SettingsRow
        const i = (await iRes.json()) as InstrumentRow[]
        const l = (await lRes.json()) as LaddersRow
        if (cancelled) return
        setSettings(settingsFromRow(s))
        setInstruments(i)
        setStopLadder(l.stopLadder)
        setContractLadder(l.contractLadder)
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'Failed to load position-sizing inputs')
        setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // Local state updates synchronously; the PUT only reports failures.
  function commitSettings(next: PsSettingsValues): void {
    setSettings(next)
    putJson(`${API}/settings`, settingsToBody(next))
      .then(() => setSaveError(null))
      .catch(err => setSaveError(err instanceof Error ? err.message : 'Settings save failed'))
  }

  function commitMargin(symbol: string, margin: number): void {
    setInstruments(rows => rows.map(r => (r.symbol === symbol ? { ...r, initial_margin: margin } : r)))
    putJson(`${API}/instruments/${symbol}`, { initial_margin: margin })
      .then(() => setSaveError(null))
      .catch(err => setSaveError(err instanceof Error ? err.message : 'Margin save failed'))
  }

  function commitLadders(next: { stopLadder?: number[]; contractLadder?: number[] }): void {
    if (next.stopLadder) setStopLadder(next.stopLadder)
    if (next.contractLadder) setContractLadder(next.contractLadder)
    putJson(`${API}/ladders`, next)
      .then(() => setSaveError(null))
      .catch(err => setSaveError(err instanceof Error ? err.message : 'Ladder save failed'))
  }

  const setup = useMemo(() => (settings ? deriveSetup(settings) : null), [settings])
  const unitCount = settings ? deriveUnitCount(settings.unitRiskPct, settings.maxUnitsRiskPct) : 0
  const budgets = useMemo(
    () => (setup ? riskBudgetLadder(setup.dollarBudgetPerUnit, unitCount) : []),
    [setup, unitCount],
  )

  const inst = instruments.find(r => r.symbol === selected) ?? null
  const capitalAvailable = settings?.currentPortfolioValue ?? 0

  const contractsGrid = useMemo(
    () => (inst ? computeContractsGrid(stopLadder, inst.tick_size_decimal, inst.tick_value, budgets) : []),
    [inst, stopLadder, budgets],
  )
  const marginGrid = useMemo(
    () => computeMarginGrid(contractsGrid, inst?.initial_margin ?? null),
    [contractsGrid, inst],
  )
  const actualGrid = useMemo(() => computeActualRiskGrid(contractsGrid), [contractsGrid])
  const inverseGrid = useMemo(
    () => (inst ? computeInverseGrid(contractLadder, inst.tick_value, inst.initial_margin, budgets) : []),
    [inst, contractLadder, budgets],
  )

  const groups = useMemo(() => {
    const m = new Map<string, InstrumentRow[]>()
    for (const r of instruments) {
      const list = m.get(r.group_name) ?? []
      list.push(r)
      m.set(r.group_name, list)
    }
    return [...m.entries()]
  }, [instruments])

  const zeroUnitsMessage =
    settings === null || unitCount > 0
      ? null
      : settings.unitRiskPct <= 0
        ? 'Unit of Risk Per Trade must be greater than zero — the unit ladder cannot be derived.'
        : 'Max Units of Risk Per Trade is below one Unit of Risk Per Trade — the ladder has zero units, so the grids have no unit columns. Raise Max Units of Risk or lower the Unit of Risk.'

  if (loading || settings === null || setup === null) {
    return (
      <div className={styles.shell}>
        <Chrome />
        <main className={styles.body}>
          <div className={styles.loading}>{loadError ?? 'Loading position sizing inputs…'}</div>
        </main>
      </div>
    )
  }

  return (
    <div className={styles.shell}>
      <Chrome />
      <main className={styles.body}>
        {saveError !== null && (
          <div className={styles.saveError} role="alert">
            Save failed: {saveError} — the value shown has not been persisted.
          </div>
        )}

        {/* ── 1. Setup ─────────────────────────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>SETUP</span>
          </div>
          {/* Workbook Setup!A2, verbatim. The key-assumption treatment here is
              a yellow fill (plus yellow text), so "Yellow fill" stands. */}
          <div className={styles.footnote}>
            Blue = your input&nbsp; | &nbsp;Black = formula&nbsp; | &nbsp;Green = pulled from another sheet&nbsp; |
            &nbsp;Yellow fill = key assumption
          </div>
          <div className={styles.setupWrap}>
            <table className={styles.setupTable}>
              <tbody>
                <tr>
                  <th>Principle</th>
                  <td>
                    <EditableNumber
                      value={settings.principle}
                      display={fmtCurrency2(settings.principle)}
                      {...dollarEdit}
                      onCommit={n => n >= 0 && commitSettings({ ...settings, principle: n })}
                      ariaLabel="Principle"
                      className={styles.keyInput}
                    />
                  </td>
                  {/* Workbook Setup!C4 — sits to the right of both yellow cells. */}
                  <td className={styles.inlinePointer} rowSpan={2}>
                    {'<-- yellow cells are the two you actually update'}
                  </td>
                </tr>
                <tr>
                  <th>Current Portfolio Value</th>
                  <td>
                    <EditableNumber
                      value={settings.currentPortfolioValue}
                      display={fmtCurrency2(settings.currentPortfolioValue)}
                      {...dollarEdit}
                      onCommit={n => n >= 0 && commitSettings({ ...settings, currentPortfolioValue: n })}
                      ariaLabel="Current Portfolio Value"
                      className={styles.keyInput}
                    />
                  </td>
                </tr>
                <tr>
                  <th>Additional Risk From Market Money (Profits)</th>
                  <td className={styles.computed}>{fmtCurrency2(setup.additionalRiskFromMarketMoney)}</td>
                </tr>
                <tr>
                  <th>% of Additional Risk From Market Money</th>
                  <td>
                    <EditableNumber
                      value={settings.marketMoneyPct}
                      display={fmtPct2(settings.marketMoneyPct)}
                      {...pctEdit}
                      onCommit={n => n >= 0 && n <= 1 && commitSettings({ ...settings, marketMoneyPct: n })}
                      ariaLabel="% of Additional Risk From Market Money"
                    />
                  </td>
                </tr>
                <tr>
                  <th>Additional Risk Budget From Market Money</th>
                  <td className={styles.computed}>{fmtCurrency2(setup.additionalRiskBudget)}</td>
                </tr>
                <tr>
                  <th>Current Risk Budget</th>
                  <td className={styles.computed}>{fmtCurrency2(setup.currentRiskBudget)}</td>
                </tr>
                <tr>
                  <th>Max Drawdown On Principle</th>
                  <td>
                    <EditableNumber
                      value={settings.maxDrawdownPct}
                      display={fmtPct2(settings.maxDrawdownPct)}
                      {...pctEdit}
                      onCommit={n => n >= 0 && n <= 1 && commitSettings({ ...settings, maxDrawdownPct: n })}
                      ariaLabel="Max Drawdown On Principle"
                    />
                  </td>
                </tr>
                <tr>
                  <th>Max Drawdown On Principle ($)</th>
                  <td className={styles.computed}>{fmtCurrency2(setup.maxDrawdownDollars)}</td>
                </tr>
                <tr>
                  <th>Unit of Risk Per Trade</th>
                  <td>
                    <EditableNumber
                      value={settings.unitRiskPct}
                      display={fmtPct2(settings.unitRiskPct)}
                      {...pctEdit}
                      onCommit={n => n > 0 && n <= 1 && commitSettings({ ...settings, unitRiskPct: n })}
                      ariaLabel="Unit of Risk Per Trade"
                    />
                  </td>
                </tr>
                <tr>
                  <th>$ Budget of Risk based on unit of risk per trade</th>
                  <td className={styles.computed}>{fmtCurrency2(setup.dollarBudgetPerUnit)}</td>
                </tr>
                <tr>
                  <th>Max Units of Risk Per Trade</th>
                  <td>
                    <EditableNumber
                      value={settings.maxUnitsRiskPct}
                      display={fmtPct2(settings.maxUnitsRiskPct)}
                      {...pctEdit}
                      onCommit={n => n >= 0 && n <= 1 && commitSettings({ ...settings, maxUnitsRiskPct: n })}
                      ariaLabel="Max Units of Risk Per Trade"
                    />
                  </td>
                </tr>
                <tr>
                  <th>Max Risk Budget</th>
                  <td className={styles.computed}>{fmtCurrency2(setup.maxRiskBudget)}</td>
                </tr>
              </tbody>
            </table>

            <div className={styles.unitLadder}>
              <table className={styles.ladderTable} data-testid="unit-ladder">
                <thead>
                  <tr>
                    <th>Risk Units</th>
                    <th>$ Risk Budget</th>
                  </tr>
                </thead>
                <tbody>
                  {budgets.map((b, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{fmtCurrency0(b)}</td>
                    </tr>
                  ))}
                  {budgets.length === 0 && (
                    <tr>
                      <td colSpan={2} className={styles.gridWarningCell}>
                        {zeroUnitsMessage}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {/* Workbook Setup!G11, with the derived values substituted live. */}
              <div className={styles.footnote}>
                {unitCount} units = Max Units of Risk ({fmtPct2(settings.maxUnitsRiskPct)}) cap. Units available = Max
                Units / Unit of Risk = {unitCount}.
              </div>
            </div>
          </div>
        </section>

        {/* ── 2. Instrument selector ───────────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>INSTRUMENT</span>
            <select
              className={styles.instrumentSelect}
              aria-label="Instrument"
              value={selected}
              onChange={e => setSelected(e.target.value)}
            >
              {groups.map(([groupName, rows]) => (
                <Fragment key={groupName}>
                  <option disabled value={`__${groupName}`}>
                    ── {groupName} ──
                  </option>
                  {rows.map(r => (
                    <option key={r.symbol} value={r.symbol}>
                      {r.symbol}
                    </option>
                  ))}
                </Fragment>
              ))}
            </select>
          </div>
          {inst !== null && (
            <div className={styles.specStrip} data-testid="spec-strip">
              <div className={styles.spec}>
                <span className={styles.specLabel}>Group</span>
                <span className={styles.specValue}>{inst.group_name}</span>
              </div>
              <div className={styles.spec}>
                <span className={styles.specLabel}>Tick Size</span>
                <span className={styles.specValue}>{inst.tick_size_display}</span>
              </div>
              <div className={styles.spec}>
                <span className={styles.specLabel}>Tick Size (decimal)</span>
                <span className={styles.specValue}>{fmtPlain(inst.tick_size_decimal)}</span>
              </div>
              <div className={styles.spec}>
                <span className={styles.specLabel}>Tick Value</span>
                <span className={styles.specValue}>{fmtCurrency2(inst.tick_value)}</span>
              </div>
              <div className={styles.spec}>
                <span className={styles.specLabel}>$ per Point</span>
                <span className={styles.specValue}>{fmtCurrency0(dollarPerPoint(inst.tick_value, inst.tick_size_decimal))}</span>
              </div>
              <div className={styles.spec}>
                <span className={styles.specLabel}>Initial Margin</span>
                <span className={styles.specValue}>{fmtCurrency2(inst.initial_margin)}</span>
              </div>
              <div className={styles.spec}>
                <span className={styles.specLabel}>Capital Available</span>
                <span className={styles.specValue}>{fmtCurrency2(capitalAvailable)}</span>
              </div>
            </div>
          )}
          {/* Workbook Sizing Grid!A2 — "B4" and "the yellow column" adapted to
              where those inputs live on this page. */}
          <div className={styles.footnote}>
            Pick an instrument in the selector above, then set your stop distances in the stop ladder editor (under
            Instrument Reference below). Everything else recalculates.
          </div>
        </section>

        {/* ── 3–6. The four grids. Headings and footnotes are the workbook's
            verbatim text (Sizing Grid!A13/A25, A28/A40, A43/A55, A58/A72);
            the inverse footnote's "(B6)" is mapped to the page's Tick Size
            (decimal) label. ───────────────────────────────────────────── */}
        <SizingGrid
          heading="1. CONTRACTS - largest size whose full stop-out stays inside the risk budget (rounded down)"
          testId="contracts-grid"
          rowHeaderLabels={['Stop (ticks)', 'Stop (price)', '$ Risk / Contract']}
          budgets={budgets}
          rows={contractsGrid.map(r => ({
            key: r.stopTicks,
            headers: [fmtInt(r.stopTicks), fmtPlain(r.stopPrice), fmtCurrency2(r.riskPerContract)],
            cells: r.contracts.map(c => ({ text: fmtInt(c), red: c === 0 })),
          }))}
          footnote="Red = the stop is so wide that even one contract breaches the budget. Trade the micro, or widen the risk unit."
          emptyMessage="No stop distances — add rows to the stop ladder in the ladder editors below."
          zeroUnitsMessage={zeroUnitsMessage}
        />

        <SizingGrid
          heading="2. INITIAL MARGIN REQUIRED - red where the position is risk-legal but cannot be funded"
          testId="margin-grid"
          rowHeaderLabels={['Stop (ticks)', 'Stop (price)', '$ Risk / Contract']}
          budgets={budgets}
          rows={marginGrid.map(r => ({
            key: r.stopTicks,
            headers: [fmtInt(r.stopTicks), fmtPlain(r.stopPrice), fmtCurrency2(r.riskPerContract)],
            // Null margin is unknown, not breaching — never red. Only a real
            // number above capital turns red.
            cells: r.marginRequired.map(m => ({
              text: fmtCurrency0(m),
              red: m !== null && m > capitalAvailable,
            })),
          }))}
          footnote="Margin is a funding constraint, not a risk constraint. Both grids must clear before a size is tradeable."
          emptyMessage="No stop distances — add rows to the stop ladder in the ladder editors below."
          zeroUnitsMessage={zeroUnitsMessage}
        />

        <SizingGrid
          heading="3. ACTUAL $ AT RISK - what a full stop-out really costs after rounding down"
          testId="risk-grid"
          rowHeaderLabels={['Stop (ticks)', 'Stop (price)', '$ Risk / Contract']}
          budgets={budgets}
          rows={actualGrid.map(r => ({
            key: r.stopTicks,
            headers: [fmtInt(r.stopTicks), fmtPlain(r.stopPrice), fmtCurrency2(r.riskPerContract)],
            cells: r.actualRisk.map(a => ({ text: fmtCurrency0(a) })),
          }))}
          footnote="The gap to the budget row is rounding slack - capital your chosen stop distance will not let you deploy."
          emptyMessage="No stop distances — add rows to the stop ladder in the ladder editors below."
          zeroUnitsMessage={zeroUnitsMessage}
        />

        <SizingGrid
          heading="4. INVERSE - you have fixed the contract count; how wide can the stop be? (ticks)"
          testId="inverse-grid"
          rowHeaderLabels={['Contracts', 'Margin Used', '$ Risk / Tick']}
          budgets={budgets}
          rows={inverseGrid.map(r => ({
            key: r.contracts,
            headers: [fmtInt(r.contracts), fmtCurrency0(r.marginUsed), fmtCurrency2(r.riskPerTick)],
            cells: r.maxStopTicks.map(t => ({ text: fmtInt(t) })),
          }))}
          footnote="Multiply by Tick Size (decimal) for price distance. Example: ES, 3 contracts, 4 units -> 133 ticks x 0.25 = 33.25 points."
          emptyMessage="No contract counts — add rows to the contract ladder in the ladder editors below."
          zeroUnitsMessage={zeroUnitsMessage}
        />

        {/* ── 7. Reference & assumptions ───────────────────────────────── */}
        <details className={styles.section}>
          <summary className={styles.collapseSummary}>INSTRUMENT REFERENCE</summary>
          {/* Workbook Instruments!A2 — its 'orange Estimate cell' clause is
              dropped: this port has no Margin Source column, so all margins
              are indicative. */}
          <div className={styles.footnote}>
            Tick specs are exchange contract terms. Margins vary by broker and by day - replace them with your own
            numbers.
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.refTable} data-testid="instrument-reference">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Group</th>
                  <th>Tick Size</th>
                  <th>Tick Size (decimal)</th>
                  <th>Tick Value</th>
                  <th>$ per Point</th>
                  <th>Initial Margin</th>
                  <th>Max Contracts on Capital</th>
                </tr>
              </thead>
              <tbody>
                {instruments.map(r => (
                  <tr key={r.symbol}>
                    <th scope="row">{r.symbol}</th>
                    <td>{r.group_name}</td>
                    <td>{r.tick_size_display}</td>
                    <td>{fmtPlain(r.tick_size_decimal)}</td>
                    <td>{fmtCurrency2(r.tick_value)}</td>
                    <td>{fmtCurrency0(dollarPerPoint(r.tick_value, r.tick_size_decimal))}</td>
                    <td>
                      <EditableNumber
                        value={r.initial_margin ?? 0}
                        display={fmtCurrency2(r.initial_margin)}
                        {...dollarEdit}
                        onCommit={n => n >= 0 && commitMargin(r.symbol, n)}
                        ariaLabel={`${r.symbol} initial margin`}
                      />
                    </td>
                    <td>{fmtInt(maxContractsOnCapital(capitalAvailable, r.initial_margin))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Workbook Instruments!A43:A52, verbatim; the sheet's "column C" /
              "column D" are this table's Tick Size and Tick Size (decimal)
              columns. <br/>s preserve the workbook's own line breaks. */}
          <ul className={styles.notes}>
            <li>$ per Point = Tick Value / Tick Size (decimal). ES: $12.50 / 0.25 = $50 per point.</li>
            <li>
              RATES: the Tick Size column shows 32nds notation; the Tick Size (decimal) column stores the decimal
              fraction of a point (ZN 0'005 = half a 32nd = 1/64 = 0.015625).
            </li>
            <li>
              STIR - VARIABLE TICK: SR3 trades at 1/4bp ($6.25) inside four months to expiry and 1/2bp ($12.50) beyond.
              Loaded at the 1/2bp value.
              <br />
              Halve the tick value for front contracts, which doubles the contract count at any given stop. Same caveat
              applies to SR1 and ZQ.
            </li>
            <li>STIR pricing: SR3 is $25/bp ($2,500 x IMM index). SR1 and ZQ are both $41.67/bp ($4,167 x index).</li>
            <li>
              FX: CME quotes are USD per unit of foreign currency. 6J's raw quote carries six decimals (e.g.
              0.0067505), which is why its $ per Point
              <br />
              figure is enormous - it is the full 12,500,000 JPY notional. Size off the tick value, not the point value.
            </li>
            <li>GRAINS: quoted in cents per bushel, 5,000 bu contracts. Minimum tick is 1/4 cent = $12.50; one full cent = $50.</li>
            <li>
              SB (Sugar No.11) is ICE, not CME: 112,000 lbs, 0.01 cent/lb tick = $11.20. VX is Cboe Futures Exchange:
              $1,000 multiplier, 0.05 tick = $50.
            </li>
            <li>
              Max Contracts on Capital ignores risk entirely - it is Current Portfolio Value / Initial Margin. A funding
              ceiling, not a sizing recommendation.
            </li>
          </ul>

          <div className={styles.ladderEditors}>
            <div className={styles.ladderEditorsTitle}>LADDER EDITORS</div>
            <LadderEditor
              label="Stop ladder (ticks)"
              values={stopLadder}
              onChange={next => commitLadders({ stopLadder: next })}
            />
            <LadderEditor
              label="Contract ladder"
              values={contractLadder}
              onChange={next => commitLadders({ contractLadder: next })}
            />
          </div>
        </details>

        <details className={styles.section}>
          <summary className={styles.collapseSummary}>ASSUMPTION LOG</summary>
          {/* Workbook Setup!E15:E21, verbatim — cell refs (B9, B5, B4) are the
              sheet's own shorthand, kept as written. The last note drops its
              "marked 'Estimate'" clause: no Margin Source column in this port,
              so all margins are indicative. */}
          <ul className={styles.notes}>
            <li>Portfolio figures are taken from the user's supplied paper-trading screenshot.</li>
            <li>
              Max Drawdown ($) and per-trade budgets are driven off Current Risk Budget (B9), not Principle,
              <br />
              so profits (market money) scale the whole ladder automatically once B5 exceeds B4.
            </li>
            <li>Ladder tops out at 8 units because Max Units (2.00%) / Unit of Risk (0.25%) = 8.</li>
            <li>Sizing rounds DOWN, so realised risk sits at or below budget, never above.</li>
            <li>Bond tick values are stored exactly ($7.8125 / $15.625), not rounded as the screenshot displays them.</li>
            <li>Margins are indicative only. Replace with your broker's numbers.</li>
          </ul>
        </details>
      </main>
    </div>
  )
}

function Chrome() {
  return (
    <>
      <header className={styles.topBar}>
        <div className={styles.barLeft}>
          <NavDropdown />
          <span className={styles.logo}>TND RESEARCH TERMINAL</span>
        </div>
        <div className={styles.barCenter} />
        <div className={styles.barRight} />
      </header>
      <nav className={styles.breadcrumb}>
        <Link to="/portfolio" className={styles.breadcrumbLink}>
          Portfolio Analytics
        </Link>
        <span className={styles.breadcrumbSep}>&rsaquo;</span>
        <span className={styles.breadcrumbCurrent}>Position Sizing</span>
      </nav>
    </>
  )
}
