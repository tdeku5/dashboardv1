// Shared time-series transforms, formatters and chart constants.
// Extracted from RetailSalesDashboardPage.tsx (2026-07, UK models Phase 3) so
// US and UK dashboards consume identical math. All functions preserve the
// original per-page semantics exactly.

export type WD = { date: string; value: number }
export type NV = { date: string; value: number | null }

export type Frequency = 'monthly' | 'quarterly'

export type ContribRow = { date: string; [key: string]: number | null | string }

export function periodsPerYear(freq: Frequency): number {
  return freq === 'quarterly' ? 4 : 12
}

/** % change vs `lag` periods ago (YoY = lag 12 monthly / 4 quarterly; MoM/QoQ = lag 1) */
export function computeChangePct(data: WD[], lag: number): NV[] {
  return data.map((d, i) => {
    if (i < lag) return { date: d.date, value: null }
    const prev = data[i - lag].value
    if (prev === 0) return { date: d.date, value: null }
    return { date: d.date, value: ((d.value - prev) / Math.abs(prev)) * 100 }
  })
}

/** Annualized n-period change: (v/v₋ₙ)^(ppy/n) − 1 */
export function computeAnnualized(data: WD[], n: number, ppy: number): NV[] {
  const exp = ppy / n
  return data.map((d, i) => {
    if (i < n) return { date: d.date, value: null }
    const prev = data[i - n].value
    if (prev <= 0) return { date: d.date, value: null }
    return { date: d.date, value: (Math.pow(d.value / prev, exp) - 1) * 100 }
  })
}

export function computeMA(data: NV[], period: number): NV[] {
  return data.map((d, i) => {
    if (i < period - 1) return { date: d.date, value: null }
    let sum = 0
    let count = 0
    for (let j = i - period + 1; j <= i; j++) {
      const v = data[j].value
      if (v != null) { sum += v; count++ }
    }
    return { date: d.date, value: count === period ? sum / count : null }
  })
}

export function computeYoYDelta(yoy: NV[], lag = 1): NV[] {
  return yoy.map((d, i) => {
    const prev = i >= lag ? yoy[i - lag].value : null
    if (d.value == null || prev == null) return { date: d.date, value: null }
    return { date: d.date, value: d.value - prev }
  })
}

export type RegimeRow = { date: string; yoy: number | null; regime: '+' | '-' | '|' }

export function computeRegimes(yoy: NV[], maWindow: number): RegimeRow[] {
  const ma = computeMA(yoy, maWindow)
  return yoy.map((d, i) => {
    const maVal = ma[i]?.value
    if (d.value == null || maVal == null) return { date: d.date, yoy: d.value, regime: '|' as const }
    const regime = d.value > maVal ? '+' as const : d.value < maVal ? '-' as const : '|' as const
    return { date: d.date, yoy: d.value, regime }
  })
}

/**
 * Weighted contribution rows: componentᵢ contribution = (compₜ₋ₗ/parentₜ₋ₗ)·(compₜ/compₜ₋ₗ − 1)·100,
 * plus the parent's own % change under `lineKey`. mode 'yoy' uses a 12-calendar-month prior,
 * 'mom' the previous observation. Valid for additive (current-price / value) series only —
 * never chained-volume components.
 */
export function buildContribSeries(
  allData: Record<string, WD[]>,
  parentKey: string,
  components: readonly { key: string; seriesId: string }[],
  lineKey: string,
  mode: 'yoy' | 'mom',
): ContribRow[] {
  const parentData = allData[parentKey] ?? []
  const compMaps = components.map(c => ({
    key: c.key,
    map: new Map((allData[c.seriesId] ?? []).map(r => [r.date, r.value])),
  }))
  const parentMap = new Map(parentData.map(r => [r.date, r.value]))

  return parentData.map((pt, i) => {
    const { date } = pt
    let priorDate: string | undefined

    if (mode === 'yoy') {
      const [y, m] = date.split('-').map(Number)
      let pm = m - 12, py = y
      if (pm <= 0) { pm += 12; py -= 1 }
      priorDate = `${py}-${String(pm).padStart(2, '0')}-01`
    } else {
      if (i === 0) {
        const row: ContribRow = { date }
        for (const c of components) row[c.key] = null
        row[lineKey] = null
        return row
      }
      priorDate = parentData[i - 1].date
    }

    const pPrior = parentMap.get(priorDate)
    const pNow = parentMap.get(date)
    const row: ContribRow = { date }

    for (const cm of compMaps) {
      const now = cm.map.get(date)
      const prior = cm.map.get(priorDate)
      if (now == null || prior == null || prior === 0 || pPrior == null || pPrior === 0) {
        row[cm.key] = null
      } else {
        row[cm.key] = (prior / pPrior) * ((now / prior) - 1) * 100
      }
    }

    row[lineKey] = (pNow != null && pPrior != null && pPrior !== 0)
      ? (pNow / pPrior - 1) * 100
      : null

    return row
  })
}

// ── Formatters ───────────────────────────────────────────────────────────────

export function fmtAxisDate(d: string): string {
  const [y, m] = d.split('-')
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${mo[parseInt(m) - 1]} '${y.slice(2)}`
}

export function fmtFullDate(d: string): string {
  const [y, m] = d.split('-')
  const mo = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  return `${mo[parseInt(m) - 1]} ${y}`
}

export function fmtPctTick(v: number): string {
  return `${v.toFixed(1)}%`
}

export function fmtPctTooltip(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

export function contribNiceTicks(min: number, max: number, target = 6): number[] {
  if (min === max) return [min]
  const range = max - min
  const roughStep = range / target
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(roughStep) || 1)))
  const niceStep = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= roughStep) ?? roughStep
  const start = Math.ceil(min / niceStep) * niceStep
  const ticks: number[] = []
  for (let t = start; t <= max + niceStep * 0.01; t += niceStep) {
    ticks.push(parseFloat(t.toFixed(6)))
  }
  return ticks
}

// ── Shared chart constants ───────────────────────────────────────────────────

export const TICK = { fontSize: 11, fontFamily: 'var(--font-mono)', fill: '#64748B' }

export const TOOLTIP_STYLE = {
  contentStyle: {
    background: '#090e15',
    border: '1px solid rgba(255,255,255,0.13)',
    borderRadius: 2,
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    padding: '6px 10px',
  },
  labelStyle: { color: '#94A3B8', marginBottom: 4, letterSpacing: '0.05em' },
  itemStyle: { color: '#CBD5E1', padding: '1px 0' },
  cursor: { stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 },
  labelFormatter: (v: unknown) => typeof v === 'string' ? fmtFullDate(v) : '',
}

export const BRUSH_STYLE = {
  height: 34,
  stroke: 'rgba(255,255,255,0.10)',
  fill: '#070b10',
  travellerWidth: 6,
  tickFormatter: (d: string) => fmtAxisDate(d),
  gap: 3,
} as const

export type QuickPeriod = { label: string; count: number }

export const QUICK_PERIODS_M: readonly QuickPeriod[] = [
  { label: '1Y', count: 12 },
  { label: '3Y', count: 36 },
  { label: '5Y', count: 60 },
  { label: '10Y', count: 120 },
  { label: 'Max', count: Infinity },
]

export const QUICK_PERIODS_Q: readonly QuickPeriod[] = [
  { label: '3Y', count: 12 },
  { label: '5Y', count: 20 },
  { label: '10Y', count: 40 },
  { label: '20Y', count: 80 },
  { label: 'Max', count: Infinity },
]

export const QUICK_PERIODS_CONTRIB: readonly QuickPeriod[] = [
  { label: '5Y', count: 60 },
  { label: '10Y', count: 120 },
  { label: '20Y', count: 240 },
  { label: 'Max', count: Infinity },
]
