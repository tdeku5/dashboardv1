import { useState, useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { NavDropdown } from '../components/NavDropdown'
import {
  fetchEconomicCalendar,
  triggerEconomicRefresh,
  fetchUnclassifiedEvents,
  addSurpriseRule,
  surpriseStyle,
  categoryOf,
  displayEventName,
  countryTint, countryHex,
  impactLabel, impactColor,
  isoDate, addDays, startOfWeekMonday, fmtMonthDay, hoursSince,
  CATEGORIES,
  type EconomicRelease,
  type UnclassifiedEvent,
  type RuleInput,
} from '../lib/economicCalendar'
import styles from './EconomicDataLogPage.module.css'

type Tab = 'calendar' | 'triage'

const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: 'calendar', label: 'Calendar' },
  { key: 'triage',   label: 'Triage' },
]

// Preferred country ordering for the sidebar (watchlist first, then others A–Z).
const COUNTRY_ORDER = [
  'United States', 'Eurozone', 'United Kingdom', 'Canada', 'Japan',
  'Australia', 'Germany', 'France', 'Italy', 'China',
]

// ── Date-range helpers ────────────────────────────────────────────────────────

// Parses a TE value string ("4.4%", "211K", "-46", "$1.2T", "0.2% MoM, 2.8% YoY")
// into { num, suffix }. The first numeric token is taken (multi-horizon strings
// like CPI "0.2% MoM, 2.8% YoY" use the MoM figure, which TE lists first —
// matching how classifySurprise reads these values).
function parseValue(s: string | null): { num: number; suffix: string } | null {
  if (s == null) return null
  const cleaned = String(s).replace(/,/g, '').trim()
  if (cleaned === '' || cleaned === '-' || cleaned === '—') return null
  const m = cleaned.match(/(-?\d+(?:\.\d+)?)\s*(%|[KkMmBb]|bps?|pp)?/)
  if (!m) return null
  const num = parseFloat(m[1])
  if (!Number.isFinite(num)) return null
  return { num, suffix: (m[2] ?? '').toUpperCase().replace('BPS', 'bp') }
}

// SURPRISE = actual − expected, displayed as a signed delta in the same unit.
// % → pp (percentage points), since the delta of two rates is in pp. Mismatched
// units (defensive — shouldn't happen on a clean source) → null (renders "—").
// No directional green/red coloring: which direction is "good" depends on the
// indicator; the temperature dot next to the event name carries that read.
function computeSurprise(expected: string | null, actual: string | null): string | null {
  const e = parseValue(expected)
  const a = parseValue(actual)
  if (!e || !a) return null
  if (e.suffix !== a.suffix) return null
  const delta = a.num - e.num
  const suffixOut = e.suffix === '%' ? 'pp' : e.suffix.toLowerCase()
  const rounded = Math.abs(delta) < 10 ? Number(delta.toFixed(2)) : Number(delta.toFixed(1))
  const sign = rounded > 0 ? '+' : ''
  return `${sign}${rounded}${suffixOut}`
}

// Numeric surprise delta = actual − expected, or null when the values don't
// parse / units differ. (computeSurprise above returns the formatted string;
// this returns just the number so we can take its sign for cell shading.)
function surpriseDelta(expected: string | null, actual: string | null): number | null {
  const e = parseValue(expected)
  const a = parseValue(actual)
  if (!e || !a || e.suffix !== a.suffix) return null
  return a.num - e.num
}

// SURPRISE CELL SHADE — the "activity lens": green when a beat means stronger
// economic activity than expected, red when weaker, none otherwise.
//
// Most categories use beat = HOT (higher actual = stronger activity). Three
// specific event patterns INVERT inside their category (a beat = WEAKER):
//   • unemployment level/rate    — more unemployed = weaker
//   • initial / continuing claims — more claims = weaker
//   • inventories (wholesale / retail / business) — judgment call: unexpected
//     inventory builds typically read as demand weakness (goods piling up).
//     This one is genuinely debatable — restocking can also drive a build —
//     but the conventional read is the demand-weakness one.
//
// Trade Balance is a judgment call too: we treat a beat (more positive / less
// negative) as HOT, since net exports contribute positively to GDP. Component
// dynamics (rising imports from strong demand) can argue either way.
//
// CB speeches, mortgage rates, and energy stock changes are NOT clean activity
// signals — left neutral regardless of sign.
type SurpriseShade = 'hot' | 'cold' | 'neutral'

const INVERTED_EVENT_RE = /unemploy|jobless claims|initial claims|continuing claims|inventor(y|ies)/i
const NEUTRAL_EVENT_RE = /mortgage rate|crude oil stock|gasoline stock|crude inventor|natural gas stocks/i

// Category-level default for "what does a beat mean?" 1 = beat is hot (most),
// 0 = no clean activity interpretation (CB Speeches, Other) → never shade.
const CATEGORY_BEAT_DIRECTION: Record<string, 1 | -1 | 0> = {
  Inflation: 1, Growth: 1, Labor: 1, Consumption: 1,
  Production: 1, Surveys: 1, Housing: 1,
  Trade: 1,            // judgment call (see comment above)
  'CB Speeches': 0,
  Other: 0,
}

export function surpriseDirection(event: string, category: string, sign: -1 | 0 | 1): SurpriseShade {
  if (sign === 0) return 'neutral'
  if (NEUTRAL_EVENT_RE.test(event)) return 'neutral'
  if (category === 'CB Speeches') return 'neutral'
  let beatDir = CATEGORY_BEAT_DIRECTION[category] ?? 0
  if (INVERTED_EVENT_RE.test(event)) beatDir = -1   // event-name override on the category default
  if (beatDir === 0) return 'neutral'
  return sign * beatDir > 0 ? 'hot' : 'cold'
}

// Picks the cell shade for one row. Prefers the stored temperature
// classification — for rule-matched events it already encodes activity-based
// hot/cold via the rule's `direction` field, and it respects the in-line
// deadzone (small surprises stay neutral). For everything else (most rows,
// since the seed rule set is small) we fall back to event + category logic on
// the raw delta sign.
function surpriseCellShade(r: EconomicRelease): SurpriseShade {
  if (r.surprise === 'hot' || r.surprise === 'warm') return 'hot'
  if (r.surprise === 'cold' || r.surprise === 'cool') return 'cold'
  if (r.surprise === 'in line') return 'neutral'
  // 'unclassified' / null / missing → fall back to event + category mapping.
  const delta = surpriseDelta(r.expected, r.actual)
  const sign = delta == null ? 0 : (Math.sign(delta) as -1 | 0 | 1)
  return surpriseDirection(r.event, categoryOf(r), sign)
}

// "5 min ago" style relative time, no date library (plain Date math).
function relativeTime(thenMs: number, nowMs: number): string {
  const min = Math.floor((nowMs - thenMs) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hour${hr > 1 ? 's' : ''} ago`
  const d = Math.floor(hr / 24)
  return `${d} day${d > 1 ? 's' : ''} ago`
}

function endOfWeekSunday(monday: Date): Date { return addDays(monday, 6) }
function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1) }
function endOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 0) }

type RangeKey = 'week' | 'nextWeek' | 'month' | 'nextMonth' | 'thruJun30'

function rangeFor(key: RangeKey): { from: string; to: string } {
  const now = new Date()
  switch (key) {
    case 'week': {
      const mon = startOfWeekMonday(now)
      return { from: isoDate(mon), to: isoDate(endOfWeekSunday(mon)) }
    }
    case 'nextWeek': {
      const mon = addDays(startOfWeekMonday(now), 7)
      return { from: isoDate(mon), to: isoDate(endOfWeekSunday(mon)) }
    }
    case 'month':
      return { from: isoDate(startOfMonth(now)), to: isoDate(endOfMonth(now)) }
    case 'nextMonth': {
      const nm = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      return { from: isoDate(startOfMonth(nm)), to: isoDate(endOfMonth(nm)) }
    }
    case 'thruJun30':
      return { from: isoDate(now), to: '2026-06-30' }
  }
}

const RANGE_BUTTONS: ReadonlyArray<{ key: RangeKey; label: string }> = [
  { key: 'week',      label: 'This Week' },
  { key: 'nextWeek',  label: 'Next Week' },
  { key: 'month',     label: 'This Month' },
  { key: 'nextMonth', label: 'Next Month' },
  { key: 'thruJun30', label: 'Thru Jun 30' },
]

// ── Table ─────────────────────────────────────────────────────────────────────

interface RenderRow extends EconomicRelease {
  showWeek: boolean
  showDay: boolean
  isToday: boolean
}

// Country ranking for the table sort: known countries follow COUNTRY_ORDER
// (the same convention the sidebar uses, so the page agrees with itself);
// anything off-watchlist falls through alphabetically at the end.
function countryRank(a: string, b: string): number {
  const ia = COUNTRY_ORDER.indexOf(a), ib = COUNTRY_ORDER.indexOf(b)
  if (ia === -1 && ib === -1) return a.localeCompare(b)
  if (ia === -1) return 1
  if (ib === -1) return -1
  return ia - ib
}

function toRenderRows(releases: EconomicRelease[], todayIso: string): RenderRow[] {
  // Sort hierarchy: date → country block → existing intra-country order.
  // No `importance` term: it was interleaving countries within a day (the bug
  // this prompt is fixing). Within a country block on a given day, events
  // tie-break by event name — a stable, deterministic stand-in for the
  // release-time order TE doesn't expose as a separate field.
  const sorted = [...releases].sort((a, b) =>
    a.release_date.localeCompare(b.release_date) ||
    countryRank(a.country, b.country) ||
    a.event.localeCompare(b.event),
  )
  let prevDate = ''
  let prevWeek = ''
  return sorted.map((r) => {
    const week = isoDate(startOfWeekMonday(new Date(`${r.release_date}T00:00:00`)))
    const showDay = r.release_date !== prevDate
    const showWeek = week !== prevWeek
    prevDate = r.release_date
    prevWeek = week
    return { ...r, showWeek, showDay, isToday: r.release_date === todayIso }
  })
}

function dayLabel(r: EconomicRelease): string {
  const dom = Number(r.release_date.slice(8, 10))
  const wd = (r.day_of_week || '').slice(0, 3)
  return wd ? `${wd} ${dom}` : String(dom)
}

function ReleaseTable({ rows }: { rows: RenderRow[] }) {
  if (rows.length === 0) return <div className={styles.empty}>No releases match the current range and filters.</div>
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.thWeek}>Week</th>
            <th className={styles.thDay}>Day</th>
            <th className={styles.thCountry}>Country</th>
            <th className={styles.thCategory}>Category</th>
            <th className={styles.thEvent}>Event</th>
            <th className={styles.thNum}>Expected</th>
            <th className={styles.thNum}>Actual</th>
            <th className={styles.thSurprise}>Surprise</th>
            <th className={styles.thImpact}>Impact</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            // Row background: ONLY the faint per-country tint (see lib/economicCalendar.ts).
            // Temperature classification (cold/warm/hot from r.surprise) is rendered
            // as a small dot next to the event name — never as a row fill.
            const tStyle = surpriseStyle(r.surprise)
            const surpriseDeltaStr = computeSurprise(r.expected, r.actual)
            const shade = surpriseCellShade(r)
            const shadeClass = shade === 'hot' ? styles.surpriseHot : shade === 'cold' ? styles.surpriseCold : ''
            const rowStyle = {
              '--tint': countryTint(r.country, 0.07),
              '--tint-hover': countryTint(r.country, 0.14),
              borderLeft: r.isToday ? '3px solid #22d3ee' : '3px solid transparent',
            } as CSSProperties
            return (
              <tr
                key={`${r.release_date}|${r.country}|${r.event}|${i}`}
                style={rowStyle}
                className={`${styles.tintRow} ${r.showDay ? styles.dayStart : ''}`}
              >
                <td className={styles.tdWeek}>{r.showWeek ? `wk ${fmtMonthDay(isoDate(startOfWeekMonday(new Date(`${r.release_date}T00:00:00`))))}` : ''}</td>
                <td className={styles.tdDay}>{r.showDay ? dayLabel(r) : ''}</td>
                <td className={styles.tdCountry}>
                  <span className={styles.countryDot} style={{ background: countryHex(r.country) }} />
                  {r.country}
                </td>
                <td className={styles.tdCategory}>{categoryOf(r)}</td>
                <td className={styles.tdEvent}>
                  <span className={styles.tempDot} style={{ background: tStyle.color }} title={`Surprise: ${tStyle.label}`} />
                  {displayEventName(r)}
                </td>
                <td className={styles.tdNum}>{r.expected ?? '—'}</td>
                <td className={styles.tdNum}>{r.actual ?? '—'}</td>
                <td className={`${styles.tdSurprise} ${shadeClass}`}>{surpriseDeltaStr ?? '—'}</td>
                <td className={styles.tdImpact} style={{ color: impactColor(r.importance) }}>{impactLabel(r.importance)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Filter sidebar ────────────────────────────────────────────────────────────

interface FilterSection {
  title: string
  items: Array<{ key: string; label: string; swatch?: string }>
  hidden: Set<string>
  toggle: (key: string) => void
  setHidden: (next: Set<string>) => void   // bulk Select/Clear All (this group only)
}

function CollapsibleSection({ section }: { section: FilterSection }) {
  const [open, setOpen] = useState(true)
  // "All shown" = no currently-visible item is in this group's hidden set. Any
  // stale hidden keys (countries that left the loaded window) are ignored.
  const allShown = !section.items.some(it => section.hidden.has(it.key))
  const bulkLabel = allShown ? 'Clear All' : 'Select All'
  const onBulkClick = (e: React.MouseEvent) => {
    e.stopPropagation()   // don't toggle collapse
    if (allShown) section.setHidden(new Set(section.items.map(i => i.key)))   // hide all in this group
    else section.setHidden(new Set())                                          // show all in this group
  }
  return (
    <div className={styles.filterSection}>
      <div className={styles.filterHeaderRow}>
        <button className={styles.filterHeader} onClick={() => setOpen(o => !o)}>
          <span className={styles.caret}>{open ? '▼' : '▶'}</span> {section.title}
        </button>
        <button className={styles.filterBulkBtn} onClick={onBulkClick} title={`${bulkLabel} in ${section.title}`}>
          {bulkLabel}
        </button>
      </div>
      {open && (
        <div className={styles.filterItems}>
          {section.items.map(it => (
            <label key={it.key} className={styles.filterItem}>
              <input type="checkbox" checked={!section.hidden.has(it.key)} onChange={() => section.toggle(it.key)} />
              {it.swatch && <span className={styles.filterSwatch} style={{ background: it.swatch }} />}
              {it.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Triage (unchanged from before) ────────────────────────────────────────────

function guessUnit(sample: string | null): RuleInput['unit'] {
  if (!sample) return 'absolute'
  if (sample.includes('%')) return 'percent'
  if (/[KkMmBb]/.test(sample)) return 'thousands'
  return 'absolute'
}

const EMPTY_RULE = { in_line_threshold: 0.1, warm_threshold: 0.2, hot_threshold: 0.3, direction: 1 as 1 | -1 }

function TriageView({ onChange }: { onChange: () => void }) {
  const [events, setEvents] = useState<UnclassifiedEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<RuleInput | null>(null)
  const [saving, setSaving] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetchUnclassifiedEvents()
      .then(evs => { if (!cancelled) { setEvents(evs); setLoading(false) } })
      .catch(err => { if (!cancelled) { setError(err instanceof Error ? err.message : String(err)); setLoading(false) } })
    return () => { cancelled = true }
  }, [reload])

  function startRule(ev: UnclassifiedEvent) {
    setActive({ event: ev.event, ...EMPTY_RULE, unit: guessUnit(ev.sampleActual ?? ev.sampleExpected) })
  }

  async function save() {
    if (!active) return
    setSaving(true); setError(null)
    try {
      await addSurpriseRule(active)
      setActive(null); setReload(r => r + 1); onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setSaving(false) }
  }

  if (loading) return <div className={styles.loading}>Loading triage queue…</div>
  if (error) return <div className={styles.error}>{error}</div>
  if (events.length === 0) return <div className={styles.empty}>No unclassified events — every stored release matched a rule. 🎉</div>

  return (
    <div className={styles.triageWrap}>
      <div className={styles.triageHint}>
        {events.length} event{events.length === 1 ? '' : 's'} need a rule. Click “+ Rule”, set thresholds (direction −1 inverts indicators like unemployment), and save — all stored rows re-classify instantly.
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thEvent}>Unclassified Event</th>
              <th className={styles.thNum}>#</th>
              <th>Sample (country · expected · actual)</th>
              <th className={styles.thNum}></th>
            </tr>
          </thead>
          <tbody>
            {events.map(ev => (
              <tr key={ev.event}>
                <td className={styles.tdEvent}>{ev.event}</td>
                <td className={styles.tdNum}>{ev.count}</td>
                <td className={styles.tdCountry}>{ev.sampleCountry} · exp {ev.sampleExpected ?? '—'} · act {ev.sampleActual ?? '—'}</td>
                <td className={styles.tdNum}><button className={styles.addRuleBtn} onClick={() => startRule(ev)}>+ Rule</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {active && (
        <div className={styles.ruleForm}>
          <div className={styles.ruleFormTitle}>New rule · <span className={styles.ruleFormEvent}>{active.event}</span></div>
          <div className={styles.ruleFormGrid}>
            <label>in&nbsp;line<input className={styles.dateInput} type="number" step="any" value={active.in_line_threshold}
              onChange={e => setActive({ ...active, in_line_threshold: Number(e.target.value) })} /></label>
            <label>warm<input className={styles.dateInput} type="number" step="any" value={active.warm_threshold}
              onChange={e => setActive({ ...active, warm_threshold: Number(e.target.value) })} /></label>
            <label>hot<input className={styles.dateInput} type="number" step="any" value={active.hot_threshold}
              onChange={e => setActive({ ...active, hot_threshold: Number(e.target.value) })} /></label>
            <label>direction
              <select className={styles.dateInput} value={active.direction}
                onChange={e => setActive({ ...active, direction: Number(e.target.value) === -1 ? -1 : 1 })}>
                <option value={1}>+1 (higher = hot)</option>
                <option value={-1}>−1 (lower = hot)</option>
              </select>
            </label>
            <label>unit
              <select className={styles.dateInput} value={active.unit}
                onChange={e => setActive({ ...active, unit: e.target.value as RuleInput['unit'] })}>
                <option value="percent">percent</option>
                <option value="thousands">thousands</option>
                <option value="absolute">absolute</option>
              </select>
            </label>
          </div>
          <div className={styles.ruleFormActions}>
            <button className={styles.saveBtn} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save rule'}</button>
            <button className={styles.cancelBtn} onClick={() => setActive(null)} disabled={saving}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function EconomicDataLogPage() {
  const [tab, setTab] = useState<Tab>('calendar')
  const [releases, setReleases] = useState<EconomicRelease[]>([])
  const [latestScrapedAt, setLatestScrapedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNote, setRefreshNote] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState(false)
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Ticks every 30s so the "Last refreshed (N min ago)" relative time stays current.
  const [nowTick, setNowTick] = useState(Date.now())

  // Date range (default = this week).
  const initial = rangeFor('week')
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [activeRange, setActiveRange] = useState<RangeKey | null>('week')

  // Sidebar filters — stored as "hidden" sets (checked = not hidden).
  const [hiddenCats, setHiddenCats] = useState<Set<string>>(new Set())
  const [hiddenCountries, setHiddenCountries] = useState<Set<string>>(new Set())
  const [hiddenImpacts, setHiddenImpacts] = useState<Set<string>>(new Set())

  const todayIso = isoDate(new Date())

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000)
    return () => { clearInterval(id); if (noteTimer.current) clearTimeout(noteTimer.current) }
  }, [])

  // Fetch the date-windowed slice from the DB whenever the window changes.
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetchEconomicCalendar({ startDate: from, endDate: to })
      .then(resp => { if (!cancelled) { setReleases(resp.releases); setLatestScrapedAt(resp.latestScrapedAt); setLoading(false) } })
      .catch(err => { if (!cancelled) { setError(err instanceof Error ? err.message : String(err)); setLoading(false) } })
    return () => { cancelled = true }
  }, [from, to, reloadKey])

  // Country list — dynamic from the loaded events (watchlist order, then A–Z).
  const countryItems = useMemo(() => {
    const present = [...new Set(releases.map(r => r.country))]
    present.sort((a, b) => {
      const ia = COUNTRY_ORDER.indexOf(a), ib = COUNTRY_ORDER.indexOf(b)
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
      return a.localeCompare(b)
    })
    return present.map(c => ({ key: c, label: c, swatch: countryHex(c) }))
  }, [releases])

  // Impact levels — dynamic from the loaded events (native importance).
  const impactItems = useMemo(() => {
    const present = [...new Set(releases.map(r => (r.importance ?? 0)))].sort((a, b) => b - a)
    return present.map(imp => ({ key: String(imp), label: impactLabel(imp || null), swatch: impactColor(imp || null) }))
  }, [releases])

  const visibleRows = useMemo(() => {
    const filtered = releases.filter(r =>
      !hiddenCats.has(categoryOf(r)) &&
      !hiddenCountries.has(r.country) &&
      !hiddenImpacts.has(String(r.importance ?? 0)),
    )
    return toRenderRows(filtered, todayIso)
  }, [releases, hiddenCats, hiddenCountries, hiddenImpacts, todayIso])

  const staleHours = hoursSince(latestScrapedAt)
  const isStale = staleHours != null && staleHours > 36

  function applyRange(key: RangeKey) {
    const r = rangeFor(key)
    setFrom(r.from); setTo(r.to); setActiveRange(key)
  }
  function toggleIn(set: Set<string>, setter: (s: Set<string>) => void, key: string) {
    const next = new Set(set)
    if (next.has(key)) next.delete(key); else next.add(key)
    setter(next)
  }
  function resetFilters() {
    setHiddenCats(new Set()); setHiddenCountries(new Set()); setHiddenImpacts(new Set())
  }

  // BEHAVIOR (audited 2026-05-27): "Refresh now" runs the FULL ingestion pipeline
  // server-side via POST /api/economic-calendar/refresh — the same logic the daily
  // 23:00 UTC cron runs: scrape Trading Economics (This Month + Next Month) →
  // Claude parse → upsert into economic_releases → surprise-classify. On success it
  // bumps reloadKey, which re-reads the DB (the fetch effect above) so the table
  // and the "Last refreshed" timestamp reflect new/updated rows. This is the
  // recommended "ingest AND re-read" behavior, so the logic is left as-is; this
  // change only adds progress/feedback, a tooltip, and the timestamp.
  async function handleRefresh() {
    if (noteTimer.current) clearTimeout(noteTimer.current)
    setRefreshing(true); setRefreshNote(null); setRefreshError(false)
    try {
      const r = await triggerEconomicRefresh()
      setReloadKey(k => k + 1)   // re-read DB → re-render table + refresh timestamp
      const t = new Date().toLocaleTimeString('en-US', { hour12: false })
      // r.upserted = rows touched (insert+update); the upsert can't cheaply
      // distinguish brand-new from updated, so phrase it as "refreshed", not "new".
      setRefreshNote(`Refreshed at ${t} · ${r.upserted} events`)
      setRefreshError(false)
      noteTimer.current = setTimeout(() => setRefreshNote(null), 3000)  // success toast fades
    } catch (err) {
      setRefreshNote(`Refresh failed: ${err instanceof Error ? err.message : String(err)} — retry?`)
      setRefreshError(true)   // error stays until the next click
    } finally {
      setRefreshing(false)
    }
  }

  const sections: FilterSection[] = [
    { title: 'Categories', items: CATEGORIES.map(c => ({ key: c, label: c })), hidden: hiddenCats,      toggle: k => toggleIn(hiddenCats,      setHiddenCats,      k), setHidden: setHiddenCats },
    { title: 'Countries',  items: countryItems,                                hidden: hiddenCountries, toggle: k => toggleIn(hiddenCountries, setHiddenCountries, k), setHidden: setHiddenCountries },
    { title: 'Impact',     items: impactItems,                                 hidden: hiddenImpacts,   toggle: k => toggleIn(hiddenImpacts,   setHiddenImpacts,   k), setHidden: setHiddenImpacts },
  ]

  // "Last refreshed" = newest scraped_at across the events table (set on every
  // upsert). nowTick keeps the relative part live without a re-fetch.
  const lastMs = latestScrapedAt ? new Date(latestScrapedAt).getTime() : null
  const lastTime = lastMs != null ? new Date(lastMs).toLocaleTimeString('en-US', { hour12: false }) : null
  const lastRel = lastMs != null ? relativeTime(lastMs, nowTick) : null
  const lastAbsolute = lastMs != null ? new Date(lastMs).toLocaleString() : 'No successful ingestion recorded'

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.barLeft}>
          <NavDropdown />
          <span className={styles.logo}>TND RESEARCH TERMINAL</span>
        </div>
        <div className={styles.barCenter} />
        <div className={styles.barRight}>
          {refreshNote && (
            <span className={`${styles.refreshNote} ${refreshError ? styles.refreshNoteError : styles.refreshNoteOk}`}>
              {refreshNote}
            </span>
          )}
          <button
            className={styles.refreshBtn}
            onClick={handleRefresh}
            disabled={refreshing}
            title="Fetches the latest economic events from the Trading Economics calendar (re-runs ingestion) and updates the table. Typically takes a few seconds."
          >
            {refreshing ? <><span className={styles.spinner} />Refreshing…</> : '↻ Refresh now'}
          </button>
          <span className={styles.lastRefreshed} title={`Last refreshed: ${lastAbsolute}`}>
            {lastTime ? <>Last refreshed: {lastTime} <span className={styles.lastRel}>({lastRel})</span></> : 'Last refreshed: Never'}
          </span>
        </div>
      </header>

      <nav className={styles.breadcrumb}>
        <Link to="/" className={styles.breadcrumbLink}>Home</Link>
        <span className={styles.breadcrumbSep}>›</span>
        <span className={styles.breadcrumbCurrent}>Economic Calendar</span>
      </nav>

      <main className={styles.body}>
        <div className={styles.viewTabs}>
          {TABS.map((t, idx) => (
            <button
              key={t.key}
              className={`${styles.viewTab} ${tab === t.key ? styles.viewTabActive : ''}`}
              onClick={() => setTab(t.key)}
              style={{ border: `1px solid ${tab === t.key ? '#22d3ee' : 'rgba(255, 255, 255, 0.12)'}`, ...(idx > 0 ? { borderLeft: 'none' } : {}) }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {refreshing && (
          <div className={styles.refreshStatus}>
            <span className={styles.spinner} />Fetching latest events from Trading Economics…
          </div>
        )}

        {isStale && (
          <div className={styles.staleWarn}>⚠ Data may be stale — last updated {Math.round(staleHours!)}h ago.</div>
        )}

        {tab === 'triage' ? (
          <TriageView onChange={() => setReloadKey(k => k + 1)} />
        ) : (
          <>
            {/* Date range controls */}
            <div className={styles.rangeBar}>
              {RANGE_BUTTONS.map(b => (
                <button key={b.key} className={`${styles.rangeBtn} ${activeRange === b.key ? styles.rangeBtnOn : ''}`} onClick={() => applyRange(b.key)}>
                  {b.label}
                </button>
              ))}
              <span className={styles.rangeSep} />
              <span className={styles.controlLabel}>From</span>
              <input className={styles.dateInput} type="date" value={from} onChange={e => { setFrom(e.target.value); setActiveRange(null) }} />
              <span className={styles.controlLabel}>To</span>
              <input className={styles.dateInput} type="date" value={to} onChange={e => { setTo(e.target.value); setActiveRange(null) }} />
            </div>

            {/* Surprise legend */}
            <div className={styles.legend}>
              {(['cold', 'cool', 'in line', 'warm', 'hot', 'unclassified'] as const).map(s => {
                const st = surpriseStyle(s)
                return (
                  <span key={s} className={styles.legendItem}>
                    <span className={styles.legendSwatch} style={{ color: st.color, background: st.background === 'transparent' ? 'rgba(255,255,255,0.04)' : st.background }} />
                    {s}
                  </span>
                )
              })}
            </div>

            <div className={styles.calendarLayout}>
              <aside className={styles.sidebar}>
                <div className={styles.sidebarTitle}>Filters</div>
                {sections.map(s => <CollapsibleSection key={s.title} section={s} />)}
                <button className={styles.resetBtn} onClick={resetFilters}>Reset Filters</button>
              </aside>

              <div className={styles.tableCol}>
                {loading ? (
                  <div className={styles.loading}>Loading economic calendar…</div>
                ) : error ? (
                  <div className={styles.error}>{error}</div>
                ) : (
                  <ReleaseTable rows={visibleRows} />
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
