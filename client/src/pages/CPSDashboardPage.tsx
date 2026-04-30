import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Brush,
} from 'recharts'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { fetchFredSeries } from '../lib/fred'
import styles from './CPSDashboardPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type MD = { date: string; value: number }
type AllData = Record<string, MD[]>
type BrushState = { start: number; end: number; period: string }

// ── Series config ─────────────────────────────────────────────────────────────

const MA_SERIES = [
  { key: 'unrate', label: 'U-3 Actual', color: '#3b82f6', dashed: false },
  { key: 'ma3',    label: '3mo MA',     color: '#22c55e', dashed: true  },
  { key: 'ma6',    label: '6mo MA',     color: '#f43f5e', dashed: true  },
] as const

const DECOMP_SERIES = [
  { key: 'perm',     id: 'LNS13026638', label: 'Permanent Layoffs',   color: '#ef4444' },
  { key: 'reent',    id: 'LNS13023557', label: 'Reentrants',          color: '#3b82f6' },
  { key: 'newent',   id: 'LNS13023569', label: 'New Entrants',        color: '#f97316' },
  { key: 'leave',    id: 'LNS13023705', label: 'Job Leavers',         color: '#22c55e' },
  { key: 'comptemp', id: 'LNS13026637', label: 'Completed Temp Jobs', color: '#eab308' },
  { key: 'temploff', id: 'LNS13023653', label: 'Temporary Layoff',    color: '#a855f7' },
] as const

const DECOMP_BAR_LEGEND = [
  ...DECOMP_SERIES,
  { key: 'unrate', label: 'U-3 Actual', color: '#ffffff', dashed: false },
] as const

const URATE_SERIES = [
  { key: 'u1', id: 'U1RATE', label: 'U-1', color: '#ef4444' },
  { key: 'u2', id: 'U2RATE', label: 'U-2', color: '#a855f7' },
  { key: 'u3', id: 'UNRATE', label: 'U-3', color: '#3b82f6' },
  { key: 'u4', id: 'U4RATE', label: 'U-4', color: '#f97316' },
  { key: 'u5', id: 'U5RATE', label: 'U-5', color: '#ca8a04' },
  { key: 'u6', id: 'U6RATE', label: 'U-6', color: '#22c55e' },
] as const

const AGE_SERIES = [
  { key: 'y1624', id: 'LNS14024887', label: '16–24 yrs', color: '#3b82f6' },
  { key: 'y2554', id: 'LNS14000060', label: '25–54 yrs', color: '#22c55e' },
  { key: 'y5564', id: 'LNU04000095', label: '55–64 yrs', color: '#f97316' },
] as const

const QUICK_PERIODS = [
  { label: '1Y',  months: 12       },
  { label: '2Y',  months: 24       },
  { label: '5Y',  months: 60       },
  { label: '10Y', months: 120      },
  { label: 'Max', months: Infinity },
] as const

const EMRATIO_SERIES = [
  { key: 'emratio', id: 'EMRATIO',     label: 'Overall (L)',   color: '#3b82f6' },
  { key: 'prime',   id: 'LNS12300060', label: '25–54 yrs (R)', color: '#ef4444' },
] as const

const LFPR_SERIES = [
  { key: 'civpart', id: 'CIVPART',     label: 'Overall (L)',   color: '#a855f7' },
  { key: 'prime',   id: 'LNS11300060', label: '25–54 yrs (R)', color: '#22c55e' },
] as const

const CLF_SERIES = [
  { key: 'clf', id: 'CLF16OV', label: 'CLF', color: '#f97316' },
] as const

const CLF_MOM_SERIES = [
  { key: 'mom',  label: 'm/m Δ',                     color: '#f97316' },
  { key: 'ma12', label: '12 per. Mov. Avg. (m/m Δ)', color: '#3b82f6' },
] as const

const UNVCLF_SERIES = [
  { key: 'unemploy', id: 'UNEMPLOY', label: 'Unemployment (L)', color: '#a855f7' },
  { key: 'clf',      id: 'CLF16OV',  label: 'CLF (R)',          color: '#f97316' },
] as const

const ALL_SERIES_IDS = [
  'UNRATE', 'CLF16OV',
  'LNS13026638', 'LNS13023557', 'LNS13023569',
  'LNS13023705', 'LNS13026637', 'LNS13023653',
  'U1RATE', 'U2RATE', 'U4RATE', 'U5RATE', 'U6RATE',
  'LNS14024887', 'LNS14000060', 'LNU04000095',
  'EMRATIO', 'LNS12300060', 'CIVPART', 'LNS11300060', 'UNEMPLOY',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAxisDate(d: string): string {
  const [y, m] = d.split('-')
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${mo[parseInt(m) - 1]} '${y.slice(2)}`
}

function fmtFullDate(d: string): string {
  const [y, m] = d.split('-')
  const mo = ['January','February','March','April','May','June',
               'July','August','September','October','November','December']
  return `${mo[parseInt(m) - 1]} ${y}`
}

// Fill Oct 2023 if absent (government shutdown gap)
function fillOct2023(data: MD[]): MD[] {
  if (data.some(d => d.date === '2023-10')) return data
  const sep = data.find(d => d.date === '2023-09')
  const nov = data.find(d => d.date === '2023-11')
  if (!sep || !nov) return data
  const idx = data.findIndex(d => d.date > '2023-10')
  const result = [...data]
  result.splice(idx === -1 ? result.length : idx, 0, {
    date: '2023-10',
    value: (sep.value + nov.value) / 2,
  })
  return result
}

// Fill Oct 2025 if absent (potential data lag / shutdown gap)
function fillOct2025(data: MD[]): MD[] {
  if (data.some(d => d.date === '2025-10')) return data
  const sep = data.find(d => d.date === '2025-09')
  const nov = data.find(d => d.date === '2025-11')
  if (!sep || !nov) return data
  const idx = data.findIndex(d => d.date > '2025-10')
  const result = [...data]
  result.splice(idx === -1 ? result.length : idx, 0, {
    date: '2025-10',
    value: (sep.value + nov.value) / 2,
  })
  return result
}

// Default brush indices: start at `from`, end at last point
function initBrush(data: { date: string }[], from = '2021-01'): Pick<BrushState, 'start' | 'end'> {
  const end = data.length - 1
  const idx = data.findIndex(d => d.date >= from)
  return { start: idx >= 0 ? idx : 0, end }
}

// Create a Set toggler
function makeToggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>) {
  return (key: string) => setter(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })
}

// Create a period-select handler bound to specific data + state setter
function makeSelectPeriod(
  getData: () => { date: string }[],
  setter: React.Dispatch<React.SetStateAction<BrushState>>,
) {
  return (label: string, months: number) => {
    const data  = getData()
    const end   = data.length - 1
    const start = !isFinite(months) ? 0 : Math.max(0, end - months + 1)
    setter({ start, end, period: label })
  }
}

// Create an onChange handler for Brush component
function makeBrushChange(setter: React.Dispatch<React.SetStateAction<BrushState>>) {
  return ({ startIndex, endIndex }: { startIndex?: number; endIndex?: number }) => {
    setter(prev => ({
      period: '',
      start: startIndex ?? prev.start,
      end:   endIndex   ?? prev.end,
    }))
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface LegendSeries { key: string; label: string; color: string; dashed?: boolean }

function LegendRow({ series, active, onToggle }: {
  series: readonly LegendSeries[]
  active: Set<string>
  onToggle: (key: string) => void
}) {
  return (
    <div className={styles.legend}>
      {series.map(s => (
        <button
          key={s.key}
          type="button"
          className={`${styles.legendItem} ${active.has(s.key) ? '' : styles.legendItemOff}`}
          onClick={() => onToggle(s.key)}
        >
          {s.dashed
            ? <div className={`${styles.legendLine} ${styles.legendLineDashed}`} style={{ borderColor: s.color }} />
            : <div className={styles.legendLine} style={{ background: s.color }} />
          }
          <span>{s.label}</span>
        </button>
      ))}
    </div>
  )
}

function QuickSelect({ active, onSelect }: {
  active: string
  onSelect: (label: string, months: number) => void
}) {
  return (
    <div className={styles.quickSelectRow}>
      <span className={styles.quickSelectLabel}>Range</span>
      {QUICK_PERIODS.map(p => (
        <button
          key={p.label}
          type="button"
          className={`${styles.qsBtn} ${active === p.label ? styles.qsBtnActive : ''}`}
          onClick={() => onSelect(p.label, p.months)}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

function ChartTooltip({ active, payload, label, formatValue }: {
  active?: boolean
  payload?: Array<{ name: string; value: number | null | undefined; color: string }>
  label?: string
  formatValue?: (v: number) => string
}) {
  if (!active || !payload?.length || !label) return null
  const rows = payload.filter(p => p.value != null)
  if (!rows.length) return null
  const fmt = formatValue ?? ((v: number) => `${v.toFixed(2)}%`)
  return (
    <div style={{
      background: '#090e15', border: '1px solid rgba(255,255,255,0.13)',
      borderRadius: 2, padding: '8px 12px',
      fontFamily: 'var(--font-mono)', fontSize: 11,
    }}>
      <div style={{ color: '#94A3B8', marginBottom: 6, letterSpacing: '0.05em' }}>
        {fmtFullDate(label)}
      </div>
      {rows.map(p => (
        <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: p.color, display: 'inline-block', flexShrink: 0,
          }} />
          <span style={{ color: '#64748B', minWidth: 118 }}>{p.name}</span>
          <span style={{ color: '#CBD5E1' }}>{fmt(p.value as number)}</span>
        </div>
      ))}
    </div>
  )
}

const fmtMillions = (v: number) => `${(v / 1000).toFixed(1)}M`

// ── Shared recharts axis props ─────────────────────────────────────────────────

const BRUSH_PROPS = {
  height: 40,
  stroke: 'rgba(255,255,255,0.10)',
  fill: '#070b10',
  travellerWidth: 7,
  tickFormatter: fmtAxisDate,
  gap: 4,
} as const

// ── Main component ────────────────────────────────────────────────────────────

export function CPSDashboardContent() {
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [allData, setAllData] = useState<AllData>({})

  // ── Active series per chart ──────────────────────────────────────────────
  const [activeMA,     setActiveMA]     = useState<Set<string>>(() => new Set(['unrate', 'ma3', 'ma6']))
  const [activeDecomp, setActiveDecomp] = useState<Set<string>>(() => new Set([...DECOMP_SERIES.map(s => s.key), 'unrate']))
  const [activeCat,    setActiveCat]    = useState<Set<string>>(() => new Set(DECOMP_SERIES.map(s => s.key)))
  const [activeURate,  setActiveURate]  = useState<Set<string>>(() => new Set(URATE_SERIES.map(s => s.key)))
  const [activeAge,    setActiveAge]    = useState<Set<string>>(() => new Set(AGE_SERIES.map(s => s.key)))

  const [activeEmpRatio, setActiveEmpRatio] = useState<Set<string>>(() => new Set(EMRATIO_SERIES.map(s => s.key)))
  const [activeLFPR,     setActiveLFPR]     = useState<Set<string>>(() => new Set(LFPR_SERIES.map(s => s.key)))
  const [activeCLF,      setActiveCLF]      = useState<Set<string>>(() => new Set(CLF_SERIES.map(s => s.key)))
  const [activeClfMom,   setActiveClfMom]   = useState<Set<string>>(() => new Set(CLF_MOM_SERIES.map(s => s.key)))
  const [clfMaWindow,    setClfMaWindow]    = useState(12)
  const [activeUnvClf,   setActiveUnvClf]   = useState<Set<string>>(() => new Set(UNVCLF_SERIES.map(s => s.key)))

  const toggleMA       = makeToggle(setActiveMA)
  const toggleDecomp   = makeToggle(setActiveDecomp)
  const toggleCat      = makeToggle(setActiveCat)
  const toggleURate    = makeToggle(setActiveURate)
  const toggleAge      = makeToggle(setActiveAge)
  const toggleEmpRatio = makeToggle(setActiveEmpRatio)
  const toggleLFPR     = makeToggle(setActiveLFPR)
  const toggleCLF      = makeToggle(setActiveCLF)
  const toggleClfMom   = makeToggle(setActiveClfMom)
  const toggleUnvClf   = makeToggle(setActiveUnvClf)

  // ── Brush state per chart ────────────────────────────────────────────────
  const [bMA,       setBMA]       = useState<BrushState>({ start: 0, end: 0, period: '' })
  const [bDecomp,   setBDecomp]   = useState<BrushState>({ start: 0, end: 0, period: '' })
  const [bCat,      setBCat]      = useState<BrushState>({ start: 0, end: 0, period: '' })
  const [bURate,    setBURate]    = useState<BrushState>({ start: 0, end: 0, period: '' })
  const [bAge,      setBAge]      = useState<BrushState>({ start: 0, end: 0, period: '' })
  const [bEmpRatio, setBEmpRatio] = useState<BrushState>({ start: 0, end: 0, period: '' })
  const [bLFPR,     setBLFPR]     = useState<BrushState>({ start: 0, end: 0, period: '' })
  const [bCLF,      setBCLF]      = useState<BrushState>({ start: 0, end: 0, period: '' })
  const [bUnvClf,   setBUnvClf]   = useState<BrushState>({ start: 0, end: 0, period: '' })

  // ── Fetch all series ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    Promise.all(
      ALL_SERIES_IDS.map(id =>
        fetchFredSeries(id, { observationStart: '1948-01-01' })
          .then(obs => {
            const valid = obs
              .filter(o => o.value !== '.' && o.value.trim() !== '')
              .map(o => ({ date: o.date.slice(0, 7), value: parseFloat(o.value) }))
              .filter(o => !isNaN(o.value))
            return [id, fillOct2025(fillOct2023(valid))] as [string, MD[]]
          })
      )
    ).then(entries => {
      if (cancelled) return
      const data: AllData = Object.fromEntries(entries)
      setAllData(data)
      const unrate  = data['UNRATE']    ?? []
      const clf     = data['CLF16OV']   ?? []
      const emratio = data['EMRATIO']   ?? []
      const civpart = data['CIVPART']   ?? []
      const unemploy = data['UNEMPLOY'] ?? []
      setBMA(       b => ({ ...b, ...initBrush(unrate,   '2021-01') }))
      setBDecomp(   b => ({ ...b, ...initBrush(clf,      '2021-01') }))
      setBCat(      b => ({ ...b, ...initBrush(clf,      '2021-01') }))
      setBURate(    b => ({ ...b, ...initBrush(unrate,   '2021-01') }))
      setBAge(      b => ({ ...b, ...initBrush(unrate,   '2021-01') }))
      // Full history (start = 0)
      setBEmpRatio( b => ({ ...b, start: 0, end: emratio.length - 1  }))
      setBLFPR(     b => ({ ...b, start: 0, end: civpart.length - 1  }))
      setBCLF(      b => ({ ...b, start: 0, end: clf.length - 1      }))
      setBUnvClf(   b => ({ ...b, ...initBrush(unemploy, '2021-01')  }))
      setLoading(false)
    }).catch(err => {
      if (cancelled) return
      setError(err instanceof Error ? err.message : 'Failed to load data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  // ── Chart data ───────────────────────────────────────────────────────────

  // Chart 0: U-3 w Moving Averages
  const maData = useMemo(() => {
    const raw = allData['UNRATE'] ?? []
    return raw.map((d, i) => ({
      date:   d.date,
      unrate: activeMA.has('unrate') ? d.value : null,
      ma3:    activeMA.has('ma3') && i >= 2
        ? raw.slice(i - 2, i + 1).reduce((s, o) => s + o.value, 0) / 3
        : null,
      ma6:    activeMA.has('ma6') && i >= 5
        ? raw.slice(i - 5, i + 1).reduce((s, o) => s + o.value, 0) / 6
        : null,
    }))
  }, [allData, activeMA])

  // Decomposition base: each component as % of CLF (used by charts 1 & 2)
  const decompBase = useMemo(() => {
    const clf = allData['CLF16OV'] ?? []
    if (!clf.length) return [] as Record<string, string | number | null>[]
    const maps = Object.fromEntries(
      [...DECOMP_SERIES.map(s => s.id), 'UNRATE'].map(id => [
        id, new Map((allData[id] ?? []).map(d => [d.date, d.value])),
      ])
    )
    return clf
      .map(d => {
        const clfVal = d.value
        const row: Record<string, string | number | null> = { date: d.date }
        for (const s of DECOMP_SERIES) {
          const v = maps[s.id].get(d.date)
          row[s.key] = v !== undefined && clfVal ? (v / clfVal) * 100 : null
        }
        row['unrate'] = maps['UNRATE'].get(d.date) ?? null
        return row
      })
      .filter(row => DECOMP_SERIES.some(s => row[s.key] !== null))
  }, [allData])

  // Chart 1: Stacked bar decomposition
  const decompData = useMemo(() =>
    decompBase.map(row => ({
      ...row,
      ...Object.fromEntries(
        DECOMP_SERIES.map(s => [s.key, activeDecomp.has(s.key) ? row[s.key] : null])
      ),
      unrate: activeDecomp.has('unrate') ? row['unrate'] : null,
    }))
  , [decompBase, activeDecomp])

  // Chart 2: Line by category
  const catData = useMemo(() =>
    decompBase.map(row => ({
      ...row,
      ...Object.fromEntries(
        DECOMP_SERIES.map(s => [s.key, activeCat.has(s.key) ? row[s.key] : null])
      ),
    }))
  , [decompBase, activeCat])

  // Chart 3: U-1 through U-6
  const urateData = useMemo(() => {
    const base = allData['UNRATE'] ?? []
    const maps = Object.fromEntries(
      URATE_SERIES.map(s => [s.key, new Map((allData[s.id] ?? []).map(d => [d.date, d.value]))])
    )
    return base.map(d => {
      const row: Record<string, string | number | null> = { date: d.date }
      for (const s of URATE_SERIES) {
        const v = maps[s.key].get(d.date)
        row[s.key] = activeURate.has(s.key) && v !== undefined ? v : null
      }
      return row
    })
  }, [allData, activeURate])

  // Chart 4: Age groups
  const ageData = useMemo(() => {
    const base = allData['UNRATE'] ?? []
    const maps = Object.fromEntries(
      AGE_SERIES.map(s => [s.key, new Map((allData[s.id] ?? []).map(d => [d.date, d.value]))])
    )
    return base.map(d => {
      const row: Record<string, string | number | null> = { date: d.date }
      for (const s of AGE_SERIES) {
        const v = maps[s.key].get(d.date)
        row[s.key] = activeAge.has(s.key) && v !== undefined ? v : null
      }
      return row
    })
  }, [allData, activeAge])

  // Chart 5: Employment-Population Ratios (dual axis)
  const empRatioData = useMemo(() => {
    const base  = allData['EMRATIO']     ?? []
    const prMap = new Map((allData['LNS12300060'] ?? []).map(d => [d.date, d.value]))
    return base.map(d => ({
      date:    d.date,
      emratio: activeEmpRatio.has('emratio') ? d.value             : null,
      prime:   activeEmpRatio.has('prime')   ? (prMap.get(d.date) ?? null) : null,
    }))
  }, [allData, activeEmpRatio])

  // Chart 6: Labor Force Participation Rates (dual axis)
  const lfprData = useMemo(() => {
    const base  = allData['CIVPART']     ?? []
    const prMap = new Map((allData['LNS11300060'] ?? []).map(d => [d.date, d.value]))
    return base.map(d => ({
      date:    d.date,
      civpart: activeLFPR.has('civpart') ? d.value             : null,
      prime:   activeLFPR.has('prime')   ? (prMap.get(d.date) ?? null) : null,
    }))
  }, [allData, activeLFPR])

  // Chart 7: Civilian Labor Force Level (single axis, thousands)
  const clfData = useMemo(() => {
    const base = allData['CLF16OV'] ?? []
    return base.map(d => ({
      date: d.date,
      clf:  activeCLF.has('clf') ? d.value : null,
    }))
  }, [allData, activeCLF])

  // Chart 7b: CLF month-over-month % change + user-controlled MA
  const clfMomData = useMemo(() => {
    const raw = allData['CLF16OV'] ?? []
    const moms: (number | null)[] = raw.map((d, i) => {
      if (i === 0) return null
      const prev = raw[i - 1].value
      return prev !== 0 ? ((d.value - prev) / prev) * 100 : null
    })
    return raw.map((d, i) => ({
      date: d.date,
      mom:  activeClfMom.has('mom')  ? moms[i] : null,
      ma12: activeClfMom.has('ma12') && i >= clfMaWindow
        ? moms.slice(i - clfMaWindow + 1, i + 1).reduce<number>((s, v) => s + (v as number), 0) / clfMaWindow
        : null,
    }))
  }, [allData, activeClfMom, clfMaWindow])

  // Chart 8: Unemployment vs CLF (dual axis, thousands)
  const unvClfData = useMemo(() => {
    const base  = allData['UNEMPLOY']  ?? []
    const clfMp = new Map((allData['CLF16OV'] ?? []).map(d => [d.date, d.value]))
    return base.map(d => ({
      date:    d.date,
      unemploy: activeUnvClf.has('unemploy') ? d.value              : null,
      clf:      activeUnvClf.has('clf')       ? (clfMp.get(d.date) ?? null) : null,
    }))
  }, [allData, activeUnvClf])

  // ── Period selectors & brush handlers ─────────────────────────────────────
  const selectMA     = makeSelectPeriod(() => maData     as { date: string }[], setBMA)
  const selectDecomp = makeSelectPeriod(() => decompData as unknown as { date: string }[], setBDecomp)
  const selectCat    = makeSelectPeriod(() => catData    as unknown as { date: string }[], setBCat)
  const selectURate  = makeSelectPeriod(() => urateData  as { date: string }[], setBURate)
  const selectAge    = makeSelectPeriod(() => ageData    as { date: string }[], setBAge)

  const changeMA       = makeBrushChange(setBMA)
  const changeDecomp   = makeBrushChange(setBDecomp)
  const changeCat      = makeBrushChange(setBCat)
  const changeURate    = makeBrushChange(setBURate)
  const changeAge      = makeBrushChange(setBAge)
  const changeEmpRatio = makeBrushChange(setBEmpRatio)
  const changeLFPR     = makeBrushChange(setBLFPR)
  const changeCLF      = makeBrushChange(setBCLF)
  const changeUnvClf   = makeBrushChange(setBUnvClf)

  const selectEmpRatio = makeSelectPeriod(() => empRatioData as { date: string }[], setBEmpRatio)
  const selectLFPR     = makeSelectPeriod(() => lfprData     as { date: string }[], setBLFPR)
  const selectCLF      = makeSelectPeriod(() => clfData      as { date: string }[], setBCLF)
  const selectUnvClf   = makeSelectPeriod(() => unvClfData   as { date: string }[], setBUnvClf)

  // ── Shared inline axis props (typed as any to satisfy recharts generics) ──
  const xAxis = (
    <XAxis
      dataKey="date"
      tickFormatter={fmtAxisDate}
      tick={{ fill: '#64748B', fontSize: 12, fontFamily: 'var(--font-mono)' }}
      axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
      tickLine={false}
      interval="preserveStartEnd"
    />
  )
  const yAxis = (
    <YAxis
      tickFormatter={(v: number) => `${v.toFixed(1)}%`}
      tick={{ fill: '#64748B', fontSize: 12, fontFamily: 'var(--font-mono)' }}
      axisLine={false}
      tickLine={false}
      width={46}
      domain={['auto', 'auto']}
    />
  )
  const xAxisHidden = (
    <XAxis dataKey="date" tick={false} axisLine={false} tickLine={false} height={0} />
  )
  const grid = (
    <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.05)" vertical={false} />
  )
  const tooltip = <Tooltip content={<ChartTooltip />} />

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
        <div>
          <div className={styles.pageTitle}>CPS Dashboard</div>
          <div className={styles.pageSub}>
            Current Population Survey — unemployment indicators
          </div>
        </div>

        {loading ? (
          <div className={styles.statusBlock}>Loading FRED data…</div>
        ) : error ? (
          <div className={`${styles.statusBlock} ${styles.statusError}`}>Error: {error}</div>
        ) : (
          <>

            {/* ── Chart 0: U-3 w Moving Averages ──────────────────────────── */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>U-3 w Moving Averages</span>
                <LegendRow series={MA_SERIES} active={activeMA} onToggle={toggleMA} />
              </div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={maData} margin={{ top: 4, right: 24, bottom: 0, left: 0 }}>
                    {grid}{xAxis}{yAxis}{tooltip}
                    <Line dataKey="unrate" name="U-3 Actual" stroke="#3b82f6" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
                    <Line dataKey="ma3" name="3mo MA" stroke="#22c55e" strokeWidth={1.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} connectNulls={false} />
                    <Line dataKey="ma6" name="6mo MA" stroke="#f43f5e" strokeWidth={1.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} connectNulls={false} />
                    <Brush dataKey="date" startIndex={bMA.start} endIndex={bMA.end} onChange={changeMA} {...BRUSH_PROPS} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <QuickSelect active={bMA.period} onSelect={selectMA} />
            </div>

            {/* ── Chart 1: Unemployment Rate Decomposition ─────────────────── */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>Unemployment Rate Decomposition</span>
                <LegendRow series={DECOMP_BAR_LEGEND} active={activeDecomp} onToggle={toggleDecomp} />
              </div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={decompData} margin={{ top: 4, right: 24, bottom: 0, left: 0 }} barCategoryGap={0}>
                    {grid}{xAxis}{yAxis}{tooltip}
                    {DECOMP_SERIES.map(s => (
                      <Bar
                        key={s.key}
                        dataKey={s.key}
                        name={s.label}
                        fill={s.color}
                        stackId="stack"
                        isAnimationActive={false}
                      />
                    ))}
                    <Line dataKey="unrate" name="U-3 Actual" stroke="#ffffff" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
                    <Brush dataKey="date" startIndex={bDecomp.start} endIndex={bDecomp.end} onChange={changeDecomp} {...BRUSH_PROPS} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <QuickSelect active={bDecomp.period} onSelect={selectDecomp} />
            </div>

            {/* ── Chart 2: Unemployment Rates By Category ──────────────────── */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>Unemployment Rates By Category</span>
                <LegendRow series={DECOMP_SERIES} active={activeCat} onToggle={toggleCat} />
              </div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={catData} margin={{ top: 4, right: 24, bottom: 0, left: 0 }}>
                    {grid}{xAxis}{yAxis}{tooltip}
                    {DECOMP_SERIES.map(s => (
                      <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
                    ))}
                    <Brush dataKey="date" startIndex={bCat.start} endIndex={bCat.end} onChange={changeCat} {...BRUSH_PROPS} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <QuickSelect active={bCat.period} onSelect={selectCat} />
            </div>

            {/* ── Chart 3: Unemployment Rates (U-1 through U-6) ────────────── */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>Unemployment Rates</span>
                <LegendRow series={URATE_SERIES} active={activeURate} onToggle={toggleURate} />
              </div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={urateData} margin={{ top: 4, right: 24, bottom: 0, left: 0 }}>
                    {grid}{xAxis}{yAxis}{tooltip}
                    {URATE_SERIES.map(s => (
                      <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
                    ))}
                    <Brush dataKey="date" startIndex={bURate.start} endIndex={bURate.end} onChange={changeURate} {...BRUSH_PROPS} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <QuickSelect active={bURate.period} onSelect={selectURate} />
            </div>

            {/* ── Chart 4: U-3 Rates by Age Group ─────────────────────────── */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>U-3 Rates by Age Group</span>
                <LegendRow series={AGE_SERIES} active={activeAge} onToggle={toggleAge} />
              </div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={ageData} margin={{ top: 4, right: 24, bottom: 0, left: 0 }}>
                    {grid}{xAxis}{yAxis}{tooltip}
                    {AGE_SERIES.map(s => (
                      <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
                    ))}
                    <Brush dataKey="date" startIndex={bAge.start} endIndex={bAge.end} onChange={changeAge} {...BRUSH_PROPS} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <QuickSelect active={bAge.period} onSelect={selectAge} />
            </div>

            {/* ── Chart 5: Employment-Population Ratios (dual Y-axis) ──────── */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>Employment-Population Ratios</span>
                <LegendRow series={EMRATIO_SERIES} active={activeEmpRatio} onToggle={toggleEmpRatio} />
              </div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={empRatioData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    {grid}{xAxis}
                    <YAxis
                      yAxisId="left" orientation="left"
                      tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                      tick={{ fill: '#64748B', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                      axisLine={false} tickLine={false} width={46} domain={['auto', 'auto']}
                    />
                    <YAxis
                      yAxisId="right" orientation="right"
                      tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                      tick={{ fill: '#64748B', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                      axisLine={false} tickLine={false} width={46} domain={['auto', 'auto']}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Line yAxisId="left"  dataKey="emratio" name="Overall"   stroke="#3b82f6" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
                    <Line yAxisId="right" dataKey="prime"   name="25–54 yrs" stroke="#ef4444" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
                    <Brush dataKey="date" startIndex={bEmpRatio.start} endIndex={bEmpRatio.end} onChange={changeEmpRatio} {...BRUSH_PROPS} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <QuickSelect active={bEmpRatio.period} onSelect={selectEmpRatio} />
            </div>

            {/* ── Chart 6: Labor Force Participation Rates (dual Y-axis) ───── */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>Labor Force Participation Rates</span>
                <LegendRow series={LFPR_SERIES} active={activeLFPR} onToggle={toggleLFPR} />
              </div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={lfprData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    {grid}{xAxis}
                    <YAxis
                      yAxisId="left" orientation="left"
                      tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                      tick={{ fill: '#64748B', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                      axisLine={false} tickLine={false} width={46} domain={['auto', 'auto']}
                    />
                    <YAxis
                      yAxisId="right" orientation="right"
                      tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                      tick={{ fill: '#64748B', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                      axisLine={false} tickLine={false} width={46} domain={['auto', 'auto']}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Line yAxisId="left"  dataKey="civpart" name="Overall"   stroke="#a855f7" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
                    <Line yAxisId="right" dataKey="prime"   name="25–54 yrs" stroke="#22c55e" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
                    <Brush dataKey="date" startIndex={bLFPR.start} endIndex={bLFPR.end} onChange={changeLFPR} {...BRUSH_PROPS} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <QuickSelect active={bLFPR.period} onSelect={selectLFPR} />
            </div>

            {/* ── Chart 7: Civilian Labor Force Level (split panel) ────────── */}
            <div className={styles.section}>

              {/* Top panel header + CLF level chart */}
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>Civilian Labor Force Level</span>
                <LegendRow series={CLF_SERIES} active={activeCLF} onToggle={toggleCLF} />
              </div>
              <div className={styles.chartWrapTop}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={clfData.slice(bCLF.start, bCLF.end + 1)} margin={{ top: 4, right: 24, bottom: 0, left: 0 }}>
                    {grid}{xAxisHidden}
                    <YAxis
                      tickFormatter={fmtMillions}
                      tick={{ fill: '#64748B', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                      axisLine={false} tickLine={false} width={52} domain={['auto', 'auto']}
                    />
                    <Tooltip content={<ChartTooltip formatValue={fmtMillions} />} />
                    <Line dataKey="clf" name="CLF" stroke="#f97316" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Bottom panel sub-header + MoM % change chart */}
              <div className={styles.subHeader}>
                <span className={styles.subTitle}>Month-over-Month % Change</span>
                <div className={styles.subRight}>
                  <LegendRow
                    series={[
                      { key: 'mom',  label: 'm/m %',                                    color: '#f97316' },
                      { key: 'ma12', label: `${clfMaWindow} per. Mov. Avg. (m/m %)`,    color: '#3b82f6' },
                    ]}
                    active={activeClfMom}
                    onToggle={toggleClfMom}
                  />
                  <div className={styles.maControl}>
                    <span className={styles.maLabel}>MA Window</span>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={clfMaWindow}
                      onChange={e => {
                        const v = parseInt(e.target.value)
                        if (!isNaN(v) && v >= 1) setClfMaWindow(v)
                      }}
                      className={styles.maInput}
                    />
                  </div>
                </div>
              </div>
              <div className={styles.chartWrapBottom}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={clfMomData} margin={{ top: 4, right: 24, bottom: 0, left: 0 }}>
                    {grid}{xAxis}
                    <YAxis
                      tickFormatter={(v: number) => `${v.toFixed(2)}%`}
                      tick={{ fill: '#64748B', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                      axisLine={false} tickLine={false} width={52} domain={['auto', 'auto']}
                    />
                    <Tooltip content={<ChartTooltip formatValue={(v) => `${v.toFixed(3)}%`} />} />
                    <Bar dataKey="mom" name="m/m %" fill="#f97316" isAnimationActive={false} />
                    <Line dataKey="ma12" name={`${clfMaWindow} per. Mov. Avg. (m/m %)`} stroke="#3b82f6" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
                    <Brush dataKey="date" startIndex={bCLF.start} endIndex={bCLF.end} onChange={changeCLF} {...BRUSH_PROPS} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <QuickSelect active={bCLF.period} onSelect={selectCLF} />
            </div>

            {/* ── Chart 8: Unemployment vs CLF (dual Y-axis, thousands) ──────── */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>Unemployment vs CLF</span>
                <LegendRow series={UNVCLF_SERIES} active={activeUnvClf} onToggle={toggleUnvClf} />
              </div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={unvClfData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    {grid}{xAxis}
                    <YAxis
                      yAxisId="left" orientation="left"
                      tickFormatter={fmtMillions}
                      tick={{ fill: '#64748B', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                      axisLine={false} tickLine={false} width={52} domain={['auto', 'auto']}
                    />
                    <YAxis
                      yAxisId="right" orientation="right"
                      tickFormatter={fmtMillions}
                      tick={{ fill: '#64748B', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                      axisLine={false} tickLine={false} width={52} domain={['auto', 'auto']}
                    />
                    <Tooltip content={<ChartTooltip formatValue={fmtMillions} />} />
                    <Line yAxisId="left"  dataKey="unemploy" name="Unemployment" stroke="#a855f7" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
                    <Line yAxisId="right" dataKey="clf"      name="CLF"          stroke="#f97316" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
                    <Brush dataKey="date" startIndex={bUnvClf.start} endIndex={bUnvClf.end} onChange={changeUnvClf} {...BRUSH_PROPS} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <QuickSelect active={bUnvClf.period} onSelect={selectUnvClf} />
            </div>

          </>
        )}

        <div className={styles.footnote}>
          Source: FRED — Federal Reserve Bank of St. Louis.
          Decomposition series expressed as % of CLF16OV.
          Oct 2023 gaps (government shutdown) filled via linear interpolation.
        </div>
    </>
  )
}

export function CPSDashboardPage() {
  return (
    <div className={styles.shell}>

      {/* Top bar */}
      <header className={styles.topBar}>
        <div className={styles.barLeft}>
          <NavDropdown />
          <span className={styles.logo}>TND RESEARCH TERMINAL</span>
        </div>
        <div className={styles.barCenter} />
        <div className={styles.barRight}><FredRefreshButton /></div>
      </header>

      {/* Breadcrumb */}
      <nav className={styles.breadcrumb}>
        <Link to="/models" className={styles.breadcrumbLink}>Models</Link>
        <span className={styles.breadcrumbSep}>›</span>
        <Link to="/models/labor" className={styles.breadcrumbLink}>Labor Market</Link>
        <span className={styles.breadcrumbSep}>›</span>
        <span className={styles.breadcrumbCurrent}>CPS Dashboard</span>
      </nav>

      {/* Body */}
      <main className={styles.body}>
        <CPSDashboardContent />
      </main>
    </div>
  )
}
