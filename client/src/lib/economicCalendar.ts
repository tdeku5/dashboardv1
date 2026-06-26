// Client API + helpers for the Economic Data Log view. Mirrors lib/news.ts:
// thin fetch wrapper + shared types + presentation helpers. The server reads
// SQLite at request time, so each fetch reflects the latest scrape.

export type SurpriseLabel = 'cold' | 'cool' | 'in line' | 'warm' | 'hot' | 'unclassified'

export type Category =
  | 'Labor' | 'Growth' | 'Inflation' | 'CB Speeches' | 'Housing'
  | 'Production' | 'Trade' | 'Consumption' | 'Surveys' | 'Other'

// Fixed category list for the sidebar (the classifier produces exactly these).
export const CATEGORIES: Category[] = [
  'Labor', 'Growth', 'Inflation', 'CB Speeches', 'Housing',
  'Production', 'Trade', 'Consumption', 'Surveys', 'Other',
]

export interface EconomicRelease {
  release_date: string
  day_of_week: string
  country: string
  event: string                       // BASE event name (no period suffix); identity key on the server
  reference_period: string | null     // e.g. "APR", "MAY/23", "Q1 2026"; shown next to event in the table
  category: string | null             // ingestion-time category; null only for un-backfilled legacy rows
  expected: string | null
  actual: string | null
  previous: string | null
  importance: number
  surprise: SurpriseLabel | null
  scraped_at: string
}

// The reference period is now rendered as its own column in the calendar
// table; the page reads r.event (the base name) directly. The combined "event
// + period" helper that used to live here has been removed — re-introduce it
// only if a future consumer genuinely needs the joined form.

// Normalizes a row's category to a known Category (null/unknown → 'Other').
export function categoryOf(r: EconomicRelease): Category {
  return (CATEGORIES as string[]).includes(r.category ?? '') ? (r.category as Category) : 'Other'
}

export interface CalendarResponse {
  latestScrapedAt: string | null
  releases: EconomicRelease[]
}

export interface CalendarFilter {
  countries?: string[]
  minImportance?: number
  startDate?: string
  endDate?: string
  eventSearch?: string
}

// Watchlist, mirrors server/src/economicCalendar/types.ts WATCHLIST_COUNTRIES.
export const WATCHLIST_COUNTRIES = [
  'United States', 'United Kingdom', 'Eurozone', 'Germany',
  'France', 'Japan', 'China', 'Australia', 'Canada',
] as const

export async function fetchEconomicCalendar(filter: CalendarFilter = {}): Promise<CalendarResponse> {
  const params = new URLSearchParams()
  if (filter.countries && filter.countries.length > 0) params.set('countries', filter.countries.join(','))
  if (filter.minImportance != null) params.set('minImportance', String(filter.minImportance))
  if (filter.startDate) params.set('startDate', filter.startDate)
  if (filter.endDate) params.set('endDate', filter.endDate)
  if (filter.eventSearch) params.set('eventSearch', filter.eventSearch)

  const qs = params.toString()
  const res = await fetch(`/api/economic-calendar${qs ? `?${qs}` : ''}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Failed to fetch economic calendar (HTTP ${res.status})`)
  }
  return res.json() as Promise<CalendarResponse>
}

// ── Manual refresh + triage (Phase 3) ────────────────────────────────────────

export interface RefreshResult { upserted: number; classified: number; unclassified: number }

export async function triggerEconomicRefresh(): Promise<RefreshResult> {
  const res = await fetch('/api/economic-calendar/refresh', { method: 'POST' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Refresh failed (HTTP ${res.status})`)
  }
  return res.json() as Promise<RefreshResult>
}

export interface UnclassifiedEvent {
  event: string
  count: number
  sampleCountry: string
  sampleExpected: string | null
  sampleActual: string | null
}

export async function fetchUnclassifiedEvents(): Promise<UnclassifiedEvent[]> {
  const res = await fetch('/api/economic-calendar/unclassified')
  if (!res.ok) throw new Error(`Failed to fetch triage queue (HTTP ${res.status})`)
  const body = await res.json() as { events: UnclassifiedEvent[] }
  return body.events
}

export interface RuleInput {
  event: string
  in_line_threshold: number
  warm_threshold: number
  hot_threshold: number
  direction: 1 | -1
  unit: 'absolute' | 'percent' | 'thousands'
}

export async function addSurpriseRule(rule: RuleInput): Promise<void> {
  const res = await fetch('/api/economic-calendar/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Failed to add rule (HTTP ${res.status})`)
  }
}

// Surprise cell styling. cold=red, cool=light red, in line=neutral,
// warm=light green, hot=green; unclassified=muted gray; null (rule matched but
// not yet printed) renders neutral. Reuses the dashboard's green/red palette.
export interface SurpriseStyle { label: string; color: string; background: string }

export function surpriseStyle(s: SurpriseLabel | null): SurpriseStyle {
  switch (s) {
    case 'hot':          return { label: 'HOT',      color: '#22c55e', background: 'rgba(34, 197, 94, 0.22)' }
    case 'warm':         return { label: 'WARM',     color: '#86efac', background: 'rgba(34, 197, 94, 0.10)' }
    case 'in line':      return { label: 'IN LINE',  color: '#94a3b8', background: 'transparent' }
    case 'cool':         return { label: 'COOL',     color: '#fca5a5', background: 'rgba(239, 68, 68, 0.10)' }
    case 'cold':         return { label: 'COLD',     color: '#ef4444', background: 'rgba(239, 68, 68, 0.22)' }
    case 'unclassified': return { label: '—',        color: '#475569', background: 'transparent' }
    default:             return { label: '·',        color: '#475569', background: 'transparent' } // null = pending
  }
}

// ── Date helpers (local time; release_date is a YYYY-MM-DD calendar date) ─────

export function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

// Monday of the week containing `d` (ISO week starts Monday).
export function startOfWeekMonday(d: Date): Date {
  const out = new Date(d)
  const dow = (out.getDay() + 6) % 7 // 0 = Monday
  out.setDate(out.getDate() - dow)
  out.setHours(0, 0, 0, 0)
  return out
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "May 27" from a YYYY-MM-DD string (parsed as local, no TZ shift).
export function fmtMonthDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${MONTHS[m - 1]} ${d}`
}

export function hoursSince(iso: string | null): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return (Date.now() - t) / 3_600_000
}

// ── Impact (native TE importance 1–3) ─────────────────────────────────────────

export function impactLabel(importance: number | null | undefined): string {
  if (importance === 3) return 'High'
  if (importance === 2) return 'Medium'
  if (importance === 1) return 'Low'
  return '—'
}

export function impactColor(importance: number | null | undefined): string {
  if (importance === 3) return '#ef4444'
  if (importance === 2) return '#f59e0b'
  if (importance === 1) return '#64748b'
  return '#475569'
}

// ── Country color coding ──────────────────────────────────────────────────────
// Reuses the dashboard's existing country palette (Global Policy Paths / Real
// Rates section: US blue, UK purple, EU gold, Canada red, Japan pink, Australia
// cyan) and extends it for the Euro-area members + others. Applied as a very
// faint row background tint via countryTint().

const COUNTRY_HEX: Record<string, string> = {
  'United States': '#60a5fa',
  'United Kingdom': '#a78bfa',
  'Eurozone': '#facc15',
  'Germany': '#c084fc',
  'France': '#818cf8',
  'Italy': '#f0abfc',
  'Canada': '#f87171',
  'Japan': '#f472b6',
  'Australia': '#22d3ee',
  'China': '#eab308',
}
const DEFAULT_HEX = '#64748b'

export function countryHex(country: string): string {
  return COUNTRY_HEX[country] ?? DEFAULT_HEX
}

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '')
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// Very faint per-country row tint (~7%). Subtle band-grouping when scanning,
// not loud. Hover can bump alpha slightly (handled in CSS via a CSS var).
export function countryTint(country: string, alpha = 0.07): string {
  return hexToRgba(countryHex(country), alpha)
}
