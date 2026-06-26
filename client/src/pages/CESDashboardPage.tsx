import { useState, useEffect, useMemo, useRef, useCallback, useId } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  Cell,
  Brush,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  Legend,
} from 'recharts'
import { NavDropdown } from '../components/NavDropdown'
import { FredRefreshButton } from '../components/FredRefreshButton'
import { fetchFredSeries } from '../lib/fred'
import styles from './CESDashboardPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type WD         = { date: string; value: number }
type AllData    = Record<string, WD[]>
type BrushState = { start: number; end: number; period: string }
type Grouping   = 'sector' | 'category'
type ChartKey       = 'level' | 'drawdown' | 'mom' | 'yoy'
type WagesChartKey  = 'aheLevel' | 'aheYoy' | 'aheMom'
type HoursChartKey        = 'awhLevel' | 'awhMom'
type AggPayrollsChartKey  = 'aggLevel' | 'aggYoy' | 'aggMom'

interface DecompRow {
  date:  string
  total: number | null
  [key: string]: string | number | null
}

interface RecentRow {
  sector: string
  color:  string
  t0:     number | null
  t1:     number | null
  t2:     number | null
  t3:     number | null
}

type GvSRow = { date: string; goods: number | null; services: number | null }

// ── Decomp series config ──────────────────────────────────────────────────────

const CES_SECTORS = [
  { id: 'USMINE',        label: 'Mining & Logging',      color: '#92400e' },
  { id: 'USCONS',        label: 'Construction',          color: '#f59e0b' },
  { id: 'MANEMP',        label: 'Manufacturing',         color: '#3b82f6' },
  { id: 'USWTRADE',      label: 'Wholesale Trade',       color: '#06b6d4' },
  { id: 'USTRADE',       label: 'Retail Trade',          color: '#0d9488' },
  { id: 'CES4300000001', label: 'Transport & Whsg.',     color: '#7c3aed' },
  { id: 'CES4422000001', label: 'Utilities',             color: '#c026d3' },
  { id: 'USINFO',        label: 'Information',           color: '#ec4899' },
  { id: 'USFIRE',        label: 'Financial Activities',  color: '#e11d48' },
  { id: 'USPBS',         label: 'Prof. & Bus. Svcs',     color: '#16a34a' },
  { id: 'USEHS',         label: 'Edu. & Health Svcs',    color: '#4ade80' },
  { id: 'USLAH',         label: 'Leisure & Hospitality', color: '#f97316' },
  { id: 'USSERV',        label: 'Other Services',        color: '#eab308' },
  { id: 'USGOVT',        label: 'Government',            color: '#94a3b8' },
] as const

type SectorId = typeof CES_SECTORS[number]['id']

const CES_CATEGORIES = [
  {
    id:     'goods',
    label:  'Goods Producing',
    color:  '#3b82f6',
    series: ['USMINE', 'USCONS', 'MANEMP'] as SectorId[],
  },
  {
    id:     'services',
    label:  'Private Services',
    color:  '#10b981',
    series: ['USWTRADE', 'USTRADE', 'CES4300000001', 'CES4422000001',
             'USINFO', 'USFIRE', 'USPBS', 'USEHS', 'USLAH', 'USSERV'] as SectorId[],
  },
  {
    id:     'govt',
    label:  'Government',
    color:  '#94a3b8',
    series: ['USGOVT'] as SectorId[],
  },
] as const

// ── Sub-decomp sector configs ─────────────────────────────────────────────────

const SERVICES_SECTORS = [
  { id: 'USWTRADE',      label: 'Wholesale Trade',       color: '#06b6d4' },
  { id: 'USTRADE',       label: 'Retail Trade',          color: '#0d9488' },
  { id: 'CES4300000001', label: 'Transport & Whsg.',     color: '#7c3aed' },
  { id: 'CES4422000001', label: 'Utilities',             color: '#c026d3' },
  { id: 'USINFO',        label: 'Information',           color: '#ec4899' },
  { id: 'USFIRE',        label: 'Financial Activities',  color: '#e11d48' },
  { id: 'USPBS',         label: 'Prof. & Bus. Svcs',     color: '#16a34a' },
  { id: 'USEHS',         label: 'Edu. & Health Svcs',    color: '#4ade80' },
  { id: 'USLAH',         label: 'Leisure & Hospitality', color: '#f97316' },
  { id: 'USSERV',        label: 'Other Services',        color: '#eab308' },
] as const

const GOODS_SECTORS = [
  { id: 'USMINE', label: 'Mining & Logging', color: '#92400e' },
  { id: 'USCONS', label: 'Construction',     color: '#f59e0b' },
  { id: 'MANEMP', label: 'Manufacturing',    color: '#3b82f6' },
] as const

const GOVT_SECTORS = [
  { id: 'CES9091000001', label: 'Federal', color: '#60a5fa' },
  { id: 'CES9092000001', label: 'State',   color: '#34d399' },
  { id: 'CES9093000001', label: 'Local',   color: '#fb923c' },
] as const

// ── Recent payroll growth config ──────────────────────────────────────────────

const RECENT_MONTHS = [
  { key: 't0', label: 'Last', color: '#60a5fa' },
  { key: 't1', label: 't-1', color: '#4ade80' },
  { key: 't2', label: 't-2', color: '#a78bfa' },
  { key: 't3', label: 't-3', color: '#c4b5fd' },
] as const

type RecentKey = typeof RECENT_MONTHS[number]['key']

// ── Sector explorer config ────────────────────────────────────────────────────

// Flat list reflecting the BLS nonfarm payrolls hierarchy.
// Items are rendered as plain <option> tags; depth determines the — prefix.
const SECTOR_ITEMS = [
  { id: 'PAYEMS',        label: 'Total Nonfarm'                      },
  { id: 'USGOOD',        label: 'Goods-Producing'                    },
  { id: 'USMINE',        label: '— Mining & Logging'                 },
  { id: 'USCONS',        label: '— Construction'                     },
  { id: 'MANEMP',        label: '— Manufacturing'                    },
  { id: 'SRVPRD',        label: 'Service-Providing'                  },
  { id: 'USTPU',         label: '— Trade, Transport & Utilities'     },
  { id: 'USWTRADE',      label: '— — Wholesale Trade'                },
  { id: 'USTRADE',       label: '— — Retail Trade'                   },
  { id: 'CES4300000001', label: '— — Transportation & Warehousing'   },
  { id: 'CES4422000001', label: '— — Utilities'                      },
  { id: 'USINFO',        label: '— Information'                      },
  { id: 'USFIRE',        label: '— Financial Activities'             },
  { id: 'USPBS',         label: '— Professional & Business Services' },
  { id: 'USEHS',         label: '— Education & Health Services'      },
  { id: 'USLAH',         label: '— Leisure & Hospitality'            },
  { id: 'USSERV',        label: '— Other Services'                   },
  { id: 'USGOVT',        label: '— Government'                       },
  { id: 'CES9091000001', label: '— — Federal'                        },
  { id: 'CES9092000001', label: '— — State'                          },
  { id: 'CES9093000001', label: '— — Local'                          },
] as const

// ── Wages sector explorer config ──────────────────────────────────────────────
// BLS publishes AHE for private-sector only; Government has no AHE series.
// "Service-Providing" entry is labeled (Private) accordingly.

const AHE_ITEMS: { id: string; label: string; disabled?: boolean }[] = [
  { id: 'CES0500000003', label: 'Total Private'                        },
  { id: 'CES0600000003', label: 'Goods-Producing'                      },
  { id: 'CES1000000003', label: '— Mining & Logging'                   },
  { id: 'CES2000000003', label: '— Construction'                       },
  { id: 'CES3000000003', label: '— Manufacturing'                      },
  { id: 'CES0800000003', label: 'Service-Providing (Private)'          },
  { id: 'CES4000000003', label: '— Trade, Transport & Utilities'       },
  { id: 'CES4142000003', label: '— — Wholesale Trade'                  },
  { id: 'CES4200000003', label: '— — Retail Trade'                     },
  { id: 'CES4300000003', label: '— — Transportation & Warehousing'     },
  { id: 'CES4422000003', label: '— — Utilities'                        },
  { id: 'CES5000000003', label: '— Information'                        },
  { id: 'CES5500000003', label: '— Financial Activities'               },
  { id: 'CES6000000003', label: '— Professional & Business Services'   },
  { id: 'CES6500000003', label: '— Education & Health Services'        },
  { id: 'CES7000000003', label: '— Leisure & Hospitality'              },
  { id: 'CES8000000003', label: '— Other Services'                     },
  { id: '__ahe_govt',    label: '— Government',  disabled: true        },
]

// ── Fetch IDs ─────────────────────────────────────────────────────────────────

const EXTRA_SECTOR_IDS = [
  'USPRIV', 'USGOOD', 'CES0800000001',
  'CES9091000001', 'CES9092000001', 'CES9093000001',
  'SRVPRD', 'USTPU',
]

const AHE_IDS = [
  'CES0500000003', 'CES0600000003', 'CES0800000003',
  'CES1000000003', 'CES2000000003', 'CES3000000003',
  'CES4000000003', 'CES4142000003', 'CES4200000003', 'CES4300000003', 'CES4422000003',
  'CES5000000003', 'CES5500000003', 'CES6000000003', 'CES6500000003', 'CES7000000003', 'CES8000000003',
]

// ── Hours sector explorer config ──────────────────────────────────────────────
// BLS publishes AWH for private-sector only; Government has no AWH series.
// "Service-Providing" entry is labeled (Private) accordingly.

const AWH_ITEMS: { id: string; label: string; disabled?: boolean }[] = [
  { id: 'AWHAETP',   label: 'Total Private'                          },
  { id: 'AWHAEGP',   label: 'Goods-Producing'                        },
  { id: 'AWHAEMAL',  label: '— Mining & Logging'                     },
  { id: 'AWHAECON',  label: '— Construction'                         },
  { id: 'AWHAEMAN',  label: '— Manufacturing'                        },
  { id: 'AWHAEPSP',  label: 'Service-Providing (Private)'            },
  { id: 'AWHAETTU',  label: '— Trade, Transport & Utilities'         },
  { id: 'AWHAEWT',   label: '— — Wholesale Trade'                    },
  { id: 'AWHAERT',   label: '— — Retail Trade'                       },
  { id: 'AWHAETAW',  label: '— — Transportation & Warehousing'       },
  { id: 'AWHAEUTIL', label: '— — Utilities'                          },
  { id: 'AWHAEINFO', label: '— Information'                          },
  { id: 'AWHAEFA',   label: '— Financial Activities'                 },
  { id: 'AWHAEPBS',  label: '— Professional & Business Services'     },
  { id: 'AWHAEEHS',  label: '— Education & Health Services'          },
  { id: 'AWHAELAH',  label: '— Leisure & Hospitality'                },
  { id: 'AWHAEOS',   label: '— Other Services'                       },
  { id: '__awh_govt', label: '— Government', disabled: true          },
]

const AWH_IDS = [
  'AWHAETP', 'AWHAEGP', 'AWHAEPSP',
  'AWHAEMAL', 'AWHAECON', 'AWHAEMAN',
  'AWHAETTU', 'AWHAEWT', 'AWHAERT', 'AWHAETAW', 'AWHAEUTIL',
  'AWHAEINFO', 'AWHAEFA', 'AWHAEPBS', 'AWHAEEHS', 'AWHAELAH', 'AWHAEOS',
]

// ── Aggregate Payrolls sector explorer config ─────────────────────────────────
// Each entry maps a friendly key → { emp, ahe, awh } series IDs.
// Aggregate Payrolls = emp_thousands × 1000 × ahe ($/hr) × awh (hrs/wk) × 4.33

const AGG_SECTOR_CONFIG: Record<string, { emp: string; ahe: string; awh: string }> = {
  agg_priv:  { emp: 'USPRIV',        ahe: 'CES0500000003', awh: 'AWHAETP'   },
  agg_goods: { emp: 'USGOOD',        ahe: 'CES0600000003', awh: 'AWHAEGP'   },
  agg_svc:   { emp: 'CES0800000001', ahe: 'CES0800000003', awh: 'AWHAEPSP'  },
  agg_mine:  { emp: 'USMINE',        ahe: 'CES1000000003', awh: 'AWHAEMAL'  },
  agg_cons:  { emp: 'USCONS',        ahe: 'CES2000000003', awh: 'AWHAECON'  },
  agg_mfg:   { emp: 'MANEMP',        ahe: 'CES3000000003', awh: 'AWHAEMAN'  },
  agg_ttu:   { emp: 'USTPU',         ahe: 'CES4000000003', awh: 'AWHAETTU'  },
  agg_wt:    { emp: 'USWTRADE',      ahe: 'CES4142000003', awh: 'AWHAEWT'   },
  agg_rt:    { emp: 'USTRADE',       ahe: 'CES4200000003', awh: 'AWHAERT'   },
  agg_taw:   { emp: 'CES4300000001', ahe: 'CES4300000003', awh: 'AWHAETAW'  },
  agg_util:  { emp: 'CES4422000001', ahe: 'CES4422000003', awh: 'AWHAEUTIL' },
  agg_info:  { emp: 'USINFO',        ahe: 'CES5000000003', awh: 'AWHAEINFO' },
  agg_fin:   { emp: 'USFIRE',        ahe: 'CES5500000003', awh: 'AWHAEFA'   },
  agg_pbs:   { emp: 'USPBS',         ahe: 'CES6000000003', awh: 'AWHAEPBS'  },
  agg_ehs:   { emp: 'USEHS',         ahe: 'CES6500000003', awh: 'AWHAEEHS'  },
  agg_lah:   { emp: 'USLAH',         ahe: 'CES7000000003', awh: 'AWHAELAH'  },
  agg_os:    { emp: 'USSERV',        ahe: 'CES8000000003', awh: 'AWHAEOS'   },
}

// Aggregate Payrolls = emp × 1000 × ahe × awh × 4.33 — all private-sector only.
// Government has no AHE/AWH series so it cannot be computed; omitted here.

const AGG_PAYROLLS_ITEMS: { id: string; label: string; disabled?: boolean }[] = [
  { id: 'agg_priv',  label: 'Total Private'                          },
  { id: 'agg_goods', label: 'Goods-Producing'                        },
  { id: 'agg_mine',  label: '— Mining & Logging'                     },
  { id: 'agg_cons',  label: '— Construction'                         },
  { id: 'agg_mfg',   label: '— Manufacturing'                        },
  { id: 'agg_svc',   label: 'Service-Providing (Private)'            },
  { id: 'agg_ttu',   label: '— Trade, Transport & Utilities'         },
  { id: 'agg_wt',    label: '— — Wholesale Trade'                    },
  { id: 'agg_rt',    label: '— — Retail Trade'                       },
  { id: 'agg_taw',   label: '— — Transportation & Warehousing'       },
  { id: 'agg_util',  label: '— — Utilities'                          },
  { id: 'agg_info',  label: '— Information'                          },
  { id: 'agg_fin',   label: '— Financial Activities'                 },
  { id: 'agg_pbs',   label: '— Professional & Business Services'     },
  { id: 'agg_ehs',   label: '— Education & Health Services'          },
  { id: 'agg_lah',   label: '— Leisure & Hospitality'                },
  { id: 'agg_os',    label: '— Other Services'                       },
]

const ALL_FETCH_IDS: string[] = [
  ...new Set([...CES_SECTORS.map(s => s.id), 'PAYEMS', ...EXTRA_SECTOR_IDS, ...AHE_IDS, ...AWH_IDS]),
]

const QUICK_PERIODS = [
  { label: '1Y',  count: 12       },
  { label: '2Y',  count: 24       },
  { label: '5Y',  count: 60       },
  { label: '10Y', count: 120      },
  { label: 'Max', count: Infinity },
] as const

// ── Chart constants ───────────────────────────────────────────────────────────

const CM   = { top: 8, right: 16, bottom: 28, left: 62 } as const
const TICK = { fontSize: 11, fontFamily: 'var(--font-mono)', fill: '#64748B' }

const TOOLTIP_STYLE = {
  contentStyle: {
    background:  '#090e15',
    border:      '1px solid rgba(255,255,255,0.13)',
    borderRadius: 2,
    fontFamily:  'var(--font-mono)',
    fontSize:    11,
    padding:     '6px 10px',
  },
  labelStyle:    { color: '#94A3B8', marginBottom: 4, letterSpacing: '0.05em' },
  itemStyle:     { color: '#CBD5E1', padding: '1px 0' },
  cursor:        { stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 },
  labelFormatter: (v: unknown) => typeof v === 'string' ? fmtFullDate(v) : '',
}

const MINI_BRUSH = {
  height:         34,
  stroke:         'rgba(255,255,255,0.10)',
  fill:           '#070b10',
  travellerWidth: 6,
  tickFormatter:  (d: string) => {
    const [y, m] = d.split('-')
    const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return `${mo[parseInt(m) - 1]} '${y.slice(2)}`
  },
  gap: 3,
} as const

// ── Pure helpers ──────────────────────────────────────────────────────────────

function subMonths(dateStr: string, n: number): string {
  const [y, m] = dateStr.split('-').map(Number)
  let yr = y, mo = m - n
  while (mo <= 0) { mo += 12; yr -= 1 }
  return `${yr}-${String(mo).padStart(2, '0')}-01`
}

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

function fmtK(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}M`
  return `${v.toFixed(0)}K`
}

function fmtPct(v: number): string {
  return `${v.toFixed(1)}%`
}

function fmtDollar(v: number): string {
  return `$${v.toFixed(2)}`
}

function fmtHrs(v: number): string {
  return v.toFixed(1)
}

function fmtAggPayrolls(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (abs >= 1e9)  return `$${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`
  return `$${Math.round(v).toLocaleString()}`
}

function fmtAggPayrollsFull(v: number): string {
  return `$${Math.round(v).toLocaleString()}`
}

function initBrush(data: { date: string }[], from: string): Pick<BrushState, 'start' | 'end'> {
  const end = data.length - 1
  const idx = data.findIndex(d => d.date >= from)
  return { start: idx >= 0 ? idx : 0, end }
}

function niceAxisTicks(min: number, max: number, targetCount = 6): number[] {
  if (min === max) return [min]
  const range     = max - min
  const roughStep = range / targetCount
  const mag       = Math.pow(10, Math.floor(Math.log10(Math.abs(roughStep) || 1)))
  const niceStep  = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= roughStep) ?? roughStep
  const start     = Math.ceil(min / niceStep) * niceStep
  const ticks: number[] = []
  for (let t = start; t <= max + niceStep * 0.01; t += niceStep) {
    ticks.push(Math.round(t))
  }
  return ticks
}

// ── Sector explorer data helpers ──────────────────────────────────────────────

type NullableRow = { date: string; value: number | null }

function computeDrawdown3Y(data: WD[]): NullableRow[] {
  return data.map((d, i) => {
    const slice = data.slice(Math.max(0, i - 35), i + 1)
    const peak  = Math.max(...slice.map(w => w.value))
    return { date: d.date, value: peak > 0 ? (d.value / peak - 1) * 100 : 0 }
  })
}

function computeMoM(data: WD[]): NullableRow[] {
  return data.map((d, i) => ({
    date:  d.date,
    value: i === 0 ? null : d.value - data[i - 1].value,
  }))
}

function computeMA(data: NullableRow[], window: number): NullableRow[] {
  return data.map((d, i) => {
    if (i < window - 1) return { date: d.date, value: null }
    const slice = data.slice(i - window + 1, i + 1)
    const valid = slice.filter(s => s.value != null).map(s => s.value as number)
    if (valid.length < window) return { date: d.date, value: null }
    return { date: d.date, value: valid.reduce((a, b) => a + b, 0) / window }
  })
}

function computeYoY(data: WD[]): NullableRow[] {
  const map = new Map(data.map(d => [d.date, d.value]))
  return data.map(d => {
    const [y, m] = d.date.split('-').map(Number)
    const prior  = `${y - 1}-${String(m).padStart(2, '0')}-01`
    const pv     = map.get(prior)
    if (pv == null || pv === 0) return { date: d.date, value: null }
    return { date: d.date, value: (d.value / pv - 1) * 100 }
  })
}

function computeMoMPct(data: WD[]): NullableRow[] {
  return data.map((d, i) => ({
    date:  d.date,
    value: i === 0 || data[i - 1].value === 0
      ? null
      : ((d.value - data[i - 1].value) / data[i - 1].value) * 100,
  }))
}

// ── Decomp data builder ───────────────────────────────────────────────────────

function buildDecompData(allData: AllData, lookback: number, grouping: Grouping): DecompRow[] {
  const payems = allData['PAYEMS'] ?? []

  const maps: Record<string, Map<string, number>> = {}
  for (const [id, data] of Object.entries(allData)) {
    const m = new Map<string, number>()
    data.forEach(d => m.set(d.date, d.value))
    maps[id] = m
  }

  return payems.map(({ date }) => {
    const priorDate = subMonths(date, lookback)
    const row: DecompRow = { date, total: null }

    const payNow   = maps['PAYEMS']?.get(date)
    const payPrior = maps['PAYEMS']?.get(priorDate)
    row.total = (payNow != null && payPrior != null) ? payNow - payPrior : null

    if (grouping === 'sector') {
      for (const s of CES_SECTORS) {
        const now   = maps[s.id]?.get(date)
        const prior = maps[s.id]?.get(priorDate)
        row[s.id] = (now != null && prior != null) ? now - prior : null
      }
    } else {
      for (const cat of CES_CATEGORIES) {
        let sum = 0; let hasData = false
        for (const sid of cat.series) {
          const now   = maps[sid]?.get(date)
          const prior = maps[sid]?.get(priorDate)
          if (now != null && prior != null) { sum += now - prior; hasData = true }
        }
        row[cat.id] = hasData ? sum : null
      }
    }

    return row
  })
}

// ── Sub-decomp data builder ───────────────────────────────────────────────────
//
// Uses PAYEMS as the date spine so brush indices are consistent across all charts.

function buildSubDecompData(
  allData:     AllData,
  sectors:     readonly { id: string }[],
  aggregateId: string,
  lookback:    number,
): DecompRow[] {
  const spine = allData['PAYEMS'] ?? []

  const maps: Record<string, Map<string, number>> = {}
  for (const [id, data] of Object.entries(allData)) {
    const m = new Map<string, number>()
    data.forEach(d => m.set(d.date, d.value))
    maps[id] = m
  }

  return spine.map(({ date }) => {
    const priorDate = subMonths(date, lookback)
    const row: DecompRow = { date, total: null }

    const aggNow   = maps[aggregateId]?.get(date)
    const aggPrior = maps[aggregateId]?.get(priorDate)
    row.total = (aggNow != null && aggPrior != null) ? aggNow - aggPrior : null

    for (const s of sectors) {
      const now   = maps[s.id]?.get(date)
      const prior = maps[s.id]?.get(priorDate)
      row[s.id] = (now != null && prior != null) ? now - prior : null
    }

    return row
  })
}

// ── Shared domain helper ──────────────────────────────────────────────────────

function computeDecompDomain(
  data:         DecompRow[],
  brush:        { start: number; end: number },
  sectors:      readonly { id: string }[],
  activeSeries: Set<string>,
): [number, number] {
  if (!data.length || brush.end < brush.start) return [-100, 100]
  const vis         = data.slice(Math.max(0, brush.start), Math.min(data.length, brush.end + 1))
  const activeItems = sectors.filter(s => activeSeries.has(s.id))
  let maxVal = 0, minVal = 0
  for (const row of vis) {
    let posSum = 0, negSum = 0
    for (const s of activeItems) {
      const delta = row[s.id] as number | null
      if (delta == null) continue
      if (delta >= 0) posSum += delta; else negSum += delta
    }
    const tot = (row.total as number | null) ?? 0
    maxVal = Math.max(maxVal, posSum, tot)
    minVal = Math.min(minVal, negSum, tot)
  }
  const pad = Math.max((maxVal - minVal) * 0.08, 50)
  return [Math.floor(minVal - pad), Math.ceil(maxVal + pad)]
}

// ── Recent payroll growth builder ─────────────────────────────────────────────

function buildRecentData(allData: AllData): { rows: RecentRow[]; dates: string[] } {
  const payems = allData['PAYEMS'] ?? []
  const n = payems.length
  if (n < 5) return { rows: [], dates: [] }

  const dates = [
    payems[n - 1].date,
    payems[n - 2].date,
    payems[n - 3].date,
    payems[n - 4].date,
  ]

  const rows: RecentRow[] = CES_SECTORS.map(s => {
    const data = allData[s.id] ?? []
    const map  = new Map(data.map(d => [d.date, d.value]))
    const v0 = map.get(payems[n - 1].date) ?? null
    const v1 = map.get(payems[n - 2].date) ?? null
    const v2 = map.get(payems[n - 3].date) ?? null
    const v3 = map.get(payems[n - 4].date) ?? null
    const v4 = map.get(payems[n - 5].date) ?? null
    return {
      sector: s.label,
      color:  s.color,
      t0: v0 != null && v1 != null ? v0 - v1 : null,
      t1: v1 != null && v2 != null ? v1 - v2 : null,
      t2: v2 != null && v3 != null ? v2 - v3 : null,
      t3: v3 != null && v4 != null ? v3 - v4 : null,
    }
  })

  return { rows, dates }
}

// ── Diffusion index builder ───────────────────────────────────────────────────

function buildDiffusionData(allData: AllData): { date: string; value: number | null }[] {
  const payems = allData['PAYEMS'] ?? []
  return payems.map(({ date }) => {
    const [y, m] = date.split('-').map(Number)
    const priorDate = `${y - 1}-${String(m).padStart(2, '0')}-01`
    let count = 0, total = 0
    for (const s of CES_SECTORS) {
      const sdata = allData[s.id] ?? []
      const map   = new Map(sdata.map(d => [d.date, d.value]))
      const now   = map.get(date)
      const prior = map.get(priorDate)
      if (now != null && prior != null) {
        total++
        if (now > prior) count++
      }
    }
    return { date, value: total > 0 ? (count / total) * 100 : null }
  })
}

// ── Goods vs Services builders ────────────────────────────────────────────────

function buildGvSData(allData: AllData): GvSRow[] {
  const payems = allData['PAYEMS'] ?? []
  return payems.map(({ date }) => {
    const gd = allData['USGOOD'] ?? []
    const sd = allData['CES0800000001'] ?? []
    const gMap = new Map(gd.map(d => [d.date, d.value]))
    const sMap = new Map(sd.map(d => [d.date, d.value]))
    return {
      date,
      goods:    gMap.get(date) ?? null,
      services: sMap.get(date) ?? null,
    }
  })
}

function buildGvSYoY(rows: GvSRow[]): GvSRow[] {
  const dateMap = new Map(rows.map(r => [r.date, r]))
  return rows.map(r => {
    const [y, m] = r.date.split('-').map(Number)
    const priorDate = `${y - 1}-${String(m).padStart(2, '0')}-01`
    const prior = dateMap.get(priorDate)
    const goods    = r.goods    != null && prior?.goods    != null && prior.goods    !== 0
      ? ((r.goods    - prior.goods)    / Math.abs(prior.goods))    * 100 : null
    const services = r.services != null && prior?.services != null && prior.services !== 0
      ? ((r.services - prior.services) / Math.abs(prior.services)) * 100 : null
    return { date: r.date, goods, services }
  })
}

function buildGvSMoM(rows: GvSRow[]): GvSRow[] {
  return rows.map((r, i) => {
    if (i === 0) return { date: r.date, goods: null, services: null }
    const prev = rows[i - 1]
    return {
      date:     r.date,
      goods:    r.goods    != null && prev.goods    != null ? r.goods    - prev.goods    : null,
      services: r.services != null && prev.services != null ? r.services - prev.services : null,
    }
  })
}

// ── Goods vs Services Wages builders ─────────────────────────────────────────

function buildGvsWageLevel(allData: AllData): GvSRow[] {
  const goodsData = allData['CES0600000003'] ?? []
  const sMap = new Map((allData['CES0800000003'] ?? []).map(d => [d.date, d.value]))
  return goodsData.map(d => ({
    date:     d.date,
    goods:    d.value,
    services: sMap.get(d.date) ?? null,
  }))
}

function buildGvsWageMoMPct(rows: GvSRow[]): GvSRow[] {
  return rows.map((r, i) => {
    if (i === 0) return { date: r.date, goods: null, services: null }
    const prev = rows[i - 1]
    return {
      date:     r.date,
      goods:    r.goods    != null && prev.goods    != null && prev.goods    !== 0
        ? ((r.goods    - prev.goods)    / prev.goods)    * 100 : null,
      services: r.services != null && prev.services != null && prev.services !== 0
        ? ((r.services - prev.services) / prev.services) * 100 : null,
    }
  })
}

// ── Agg Payrolls Goods vs Services builder ────────────────────────────────────

function buildAggPayrollsGvS(allData: AllData): GvSRow[] {
  const goodsEmp = allData['USGOOD']        ?? []
  const gAheMap  = new Map((allData['CES0600000003'] ?? []).map(d => [d.date, d.value]))
  const gAwhMap  = new Map((allData['AWHAEGP']       ?? []).map(d => [d.date, d.value]))

  const sEmpData = allData['CES0800000001'] ?? []
  const sAheMap  = new Map((allData['CES0800000003'] ?? []).map(d => [d.date, d.value]))
  const sAwhMap  = new Map((allData['AWHAEPSP']      ?? []).map(d => [d.date, d.value]))

  const svcMap = new Map<string, number>()
  for (const d of sEmpData) {
    const ahe = sAheMap.get(d.date)
    const awh = sAwhMap.get(d.date)
    if (ahe != null && awh != null) svcMap.set(d.date, d.value * 1000 * ahe * awh * 4.33)
  }

  const rows = goodsEmp.map(d => {
    const ahe = gAheMap.get(d.date)
    const awh = gAwhMap.get(d.date)
    return {
      date:     d.date,
      goods:    ahe != null && awh != null ? d.value * 1000 * ahe * awh * 4.33 : null,
      services: svcMap.get(d.date) ?? null,
    }
  })
  // Trim to the first date where both goods and services are available
  const firstValid = rows.findIndex(r => r.goods !== null && r.services !== null)
  return firstValid >= 0 ? rows.slice(firstValid) : rows
}

// ── Decomp tooltip ────────────────────────────────────────────────────────────

function DecompTooltip({
  row,
  activeItems,
  mouseX,
  mouseY,
  isRightHalf,
}: {
  row:         DecompRow
  activeItems: readonly { id: string; label: string; color: string }[]
  mouseX:      number
  mouseY:      number
  isRightHalf: boolean
}) {
  const items = [...activeItems]
    .map(s => ({ ...s, delta: row[s.id] as number | null }))
    .filter(s => s.delta != null && s.delta !== 0)
    .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!))

  const total = row.total as number | null

  const horizPos = isRightHalf
    ? { right: window.innerWidth - mouseX + 14 }
    : { left:  mouseX + 14 }

  return (
    <div style={{
      position: 'fixed',
      ...horizPos,
      top: mouseY - 24,
      background: '#090e15',
      border: '1px solid rgba(255,255,255,0.13)',
      borderRadius: 2,
      padding: '8px 12px',
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      maxWidth: 272,
      pointerEvents: 'none',
      zIndex: 1000,
    }}>
      <div style={{ color: '#94A3B8', marginBottom: 6, letterSpacing: '0.05em' }}>
        {fmtFullDate(row.date)}
      </div>
      {items.map(item => (
        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{
            width: 8, height: 8, borderRadius: 1,
            background: item.color, display: 'inline-block', flexShrink: 0,
          }} />
          <span style={{ color: '#64748B', flex: 1, marginRight: 8 }}>{item.label}</span>
          <span style={{ color: item.delta! >= 0 ? '#4ade80' : '#f87171' }}>
            {item.delta! >= 0 ? '+' : ''}{item.delta!.toFixed(0)}K
          </span>
        </div>
      ))}
      {total !== null && (
        <div style={{
          marginTop: 5, paddingTop: 5,
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ width: 14, height: 2, background: '#fff', display: 'inline-block', flexShrink: 0 }} />
          <span style={{ color: '#94A3B8', flex: 1 }}>Total Nonfarm</span>
          <span style={{ color: total >= 0 ? '#4ade80' : '#f87171' }}>
            {total >= 0 ? '+' : ''}{total.toFixed(0)}K
          </span>
        </div>
      )}
    </div>
  )
}

// ── Custom SVG diverging stacked bar chart ────────────────────────────────────

function DecompChart({
  data,
  visibleStart,
  visibleEnd,
  currentItems,
  activeSeries,
  yDomain,
}: {
  data:         DecompRow[]
  visibleStart: number
  visibleEnd:   number
  currentItems: readonly { id: string; label: string; color: string }[]
  activeSeries: Set<string>
  yDomain:      [number, number]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize]         = useState({ width: 600, height: 400 })
  const [hovered, setHovered]   = useState<number | null>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const visible = useMemo(
    () => data.slice(Math.max(0, visibleStart), Math.min(data.length, visibleEnd + 1)),
    [data, visibleStart, visibleEnd]
  )

  const { width, height } = size
  const innerW = Math.max(0, width  - CM.left - CM.right)
  const innerH = Math.max(0, height - CM.top  - CM.bottom)
  const [yMin, yMax] = yDomain
  const yRange = yMax - yMin || 1
  const n      = visible.length
  const colW   = n > 0 ? innerW / n : 0
  const barW   = Math.min(28, colW * 0.82)

  const activeItems = useMemo(
    () => [...currentItems].filter(s => activeSeries.has(s.id)),
    [currentItems, activeSeries]
  )

  const y0 = CM.top + (1 - (0 - yMin) / yRange) * innerH

  const { columns, linePts } = useMemo(() => {
    const toY = (v: number) => CM.top + (1 - (v - yMin) / yRange) * innerH
    type Rect = { y: number; h: number; color: string; id: string; delta: number }

    const cols = visible.map((row, i) => {
      const cx    = CM.left + (i + 0.5) * colW
      const rects: Rect[] = []
      let posStack = 0
      let negStack = 0

      for (const s of activeItems) {
        const delta = row[s.id] as number | null
        if (delta == null || delta === 0) continue

        if (delta > 0) {
          const yTop = toY(posStack + delta)
          const yBot = toY(posStack)
          const h    = yBot - yTop
          if (h > 0.1) rects.push({ y: yTop, h, color: s.color, id: s.id, delta })
          posStack += delta
        } else {
          const yTop = toY(negStack)
          const yBot = toY(negStack + delta)
          const h    = yBot - yTop
          if (h > 0.1) rects.push({ y: yTop, h, color: s.color, id: s.id, delta })
          negStack += delta
        }
      }

      return { cx, rects, row }
    })

    const pts = cols
      .filter(c => (c.row.total as number | null) != null)
      .map(c => ({ cx: c.cx, cy: toY(c.row.total as number) }))

    return { columns: cols, linePts: pts }
  }, [visible, activeItems, colW, yMin, yRange, innerH])

  const yTicks = useMemo(() => niceAxisTicks(yMin, yMax, 6), [yMin, yMax])

  const xTicks = useMemo(() => {
    const ticks: { label: string; cx: number }[] = []
    let lastX = -Infinity
    visible.forEach((row, i) => {
      const cx = CM.left + (i + 0.5) * colW
      if (cx - lastX >= 60) {
        ticks.push({ label: fmtAxisDate(row.date), cx })
        lastX = cx
      }
    })
    return ticks
  }, [visible, colW])

  const linePath = linePts.length > 1
    ? `M${linePts.map(p => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join('L')}`
    : ''

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx   = e.clientX - rect.left - CM.left
    setMousePos({ x: e.clientX, y: e.clientY })
    if (n > 0 && mx >= 0 && mx <= innerW) {
      setHovered(Math.min(n - 1, Math.floor(mx / colW)))
    } else {
      setHovered(null)
    }
  }, [n, innerW, colW])

  const handleMouseLeave = useCallback(() => setHovered(null), [])

  const uid         = useId()
  const hovCol      = hovered != null ? columns[hovered] : null
  const isRightHalf = hovered != null && hovered >= n / 2
  const clipId      = `dc${uid.replace(/[^a-zA-Z0-9]/g, '')}`

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg
        width={width}
        height={height}
        style={{ display: 'block' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={CM.left} y={CM.top} width={innerW} height={innerH} />
          </clipPath>
        </defs>

        {yTicks.map(t => {
          const ty = CM.top + (1 - (t - yMin) / yRange) * innerH
          return (
            <line key={t}
              x1={CM.left} x2={CM.left + innerW}
              y1={ty}      y2={ty}
              stroke="rgba(255,255,255,0.04)" strokeWidth={1}
            />
          )
        })}

        <line
          x1={CM.left} x2={CM.left + innerW}
          y1={y0}      y2={y0}
          stroke="rgba(255,255,255,0.25)" strokeWidth={1}
        />

        {hovCol && (
          <rect
            x={hovCol.cx - colW / 2} y={CM.top}
            width={colW} height={innerH}
            fill="rgba(255,255,255,0.04)"
            pointerEvents="none"
            clipPath={`url(#${clipId})`}
          />
        )}

        <g clipPath={`url(#${clipId})`}>
          {columns.map(col =>
            col.rects.map(r => (
              <rect
                key={`${col.row.date}-${r.id}`}
                x={col.cx - barW / 2}
                y={r.y}
                width={barW}
                height={r.h}
                fill={r.color}
              />
            ))
          )}
        </g>

        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="#ffffff"
            strokeWidth={1.8}
            strokeLinejoin="round"
            strokeLinecap="round"
            clipPath={`url(#${clipId})`}
          />
        )}

        {yTicks.map(t => {
          const ty = CM.top + (1 - (t - yMin) / yRange) * innerH
          return (
            <text key={t}
              x={CM.left - 6} y={ty + 4}
              textAnchor="end"
              fontSize={11} fontFamily="var(--font-mono)" fill="#64748B"
            >
              {fmtK(t)}
            </text>
          )
        })}

        {xTicks.map(t => (
          <text key={t.label}
            x={t.cx} y={height - CM.bottom + 14}
            textAnchor="middle"
            fontSize={11} fontFamily="var(--font-mono)" fill="#64748B"
          >
            {t.label}
          </text>
        ))}
      </svg>

      {hovCol && (
        <DecompTooltip
          row={hovCol.row}
          activeItems={activeItems}
          mouseX={mousePos.x}
          mouseY={mousePos.y}
          isRightHalf={isRightHalf}
        />
      )}
    </div>
  )
}

// ── Quick-select row (shared across all charts) ───────────────────────────────

function QuickSelectRow({
  period,
  onSelect,
}: {
  period:   string
  onSelect: (label: string, count: number) => void
}) {
  return (
    <div className={styles.quickSelectRow}>
      <span className={styles.quickSelectLabel}>Range</span>
      {QUICK_PERIODS.map(p => (
        <button
          key={p.label}
          type="button"
          className={`${styles.qsBtn} ${period === p.label ? styles.qsBtnActive : ''}`}
          onClick={() => onSelect(p.label, p.count)}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

// ── Sub-decomp section card ───────────────────────────────────────────────────

function SubDecompSection({
  title,
  subtitle,
  sectors,
  aggregateLabel,
  data,
  brush,
  onBrushChange,
  onQuickSelect,
  activeSeries,
  onToggle,
  lookback,
  onLookbackChange,
  yDomain,
  fullWidth = false,
}: {
  title:            string
  subtitle:         string
  sectors:          readonly { id: string; label: string; color: string }[]
  aggregateLabel:   string
  data:             DecompRow[]
  brush:            BrushState
  onBrushChange:    (range: { startIndex?: number; endIndex?: number }) => void
  onQuickSelect:    (label: string, count: number) => void
  activeSeries:     Set<string>
  onToggle:         (id: string) => void
  lookback:         number
  onLookbackChange: (n: number) => void
  yDomain:          [number, number]
  fullWidth?:       boolean
}) {
  return (
    <div className={`${styles.section} ${fullWidth ? styles.fullSpan : ''}`}>

      {/* Header */}
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionTitle}>{title}</div>
          <div className={styles.sectionSubtitle}>{subtitle}</div>
        </div>
        <div className={styles.lookbackWrap}>
          <span className={styles.lookbackLabel}>Lookback (mo)</span>
          <input
            type="number" min={1} max={60} value={lookback}
            onChange={e => {
              const n = parseInt(e.target.value)
              if (!isNaN(n) && n >= 1 && n <= 60) onLookbackChange(n)
            }}
            className={styles.lookbackInput}
          />
        </div>
      </div>

      {/* Legend */}
      <div className={styles.legendRow}>
        <div className={styles.legend}>
          {sectors.map(s => (
            <button
              key={s.id}
              type="button"
              className={`${styles.legendItem} ${activeSeries.has(s.id) ? '' : styles.legendItemOff}`}
              onClick={() => onToggle(s.id)}
            >
              <span className={styles.legendSwatch} style={{ background: s.color }} />
              <span>{s.label}</span>
            </button>
          ))}
          <div className={styles.legendItem} style={{ cursor: 'default' }}>
            <span className={styles.legendLine} style={{ background: '#ffffff' }} />
            <span style={{ color: '#94A3B8' }}>{aggregateLabel}</span>
          </div>
        </div>
      </div>

      {/* Custom SVG chart */}
      <div className={styles.chartWrap}>
        <DecompChart
          data={data}
          visibleStart={brush.start}
          visibleEnd={brush.end}
          currentItems={sectors}
          activeSeries={activeSeries}
          yDomain={yDomain}
        />
      </div>

      {/* Brush */}
      <div className={styles.brushWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 0, right: CM.right, bottom: 0, left: CM.left }}>
            <XAxis dataKey="date" hide />
            <YAxis hide />
            <Line
              type="monotone" dataKey="total"
              stroke="rgba(255,255,255,0.18)" strokeWidth={1}
              dot={false} isAnimationActive={false} legendType="none" connectNulls
            />
            <Brush
              dataKey="date"
              startIndex={brush.start}
              endIndex={brush.end}
              onChange={onBrushChange}
              height={40}
              stroke="rgba(255,255,255,0.10)"
              fill="#070b10"
              travellerWidth={7}
              tickFormatter={fmtAxisDate}
              gap={4}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Quick-select */}
      <QuickSelectRow period={brush.period} onSelect={onQuickSelect} />
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function CESDashboardContent() {
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [allData,  setAllData]  = useState<AllData>({})
  const [lookback, setLookback] = useState(1)
  const [grouping, setGrouping] = useState<Grouping>('sector')

  const [activeSectors, setActiveSectors] = useState<Set<string>>(
    () => new Set(CES_SECTORS.map(s => s.id))
  )
  const [activeCategories, setActiveCategories] = useState<Set<string>>(
    () => new Set(CES_CATEGORIES.map(c => c.id))
  )
  const [brush, setBrush] = useState<BrushState>({ start: 0, end: 0, period: '' })

  // ── Sub-decomp state ─────────────────────────────────────────────────────────
  const [svcLookback,  setSvcLookback]  = useState(1)
  const [goodsLookback, setGoodsLookback] = useState(1)
  const [govtLookback, setGovtLookback] = useState(1)

  const [svcBrush,  setSvcBrush]  = useState<BrushState>({ start: 0, end: 0, period: '' })
  const [goodsBrush, setGoodsBrush] = useState<BrushState>({ start: 0, end: 0, period: '' })
  const [govtBrush, setGovtBrush] = useState<BrushState>({ start: 0, end: 0, period: '' })

  const [activeSvc,   setActiveSvc]   = useState<Set<string>>(() => new Set(SERVICES_SECTORS.map(s => s.id)))
  const [activeGoods, setActiveGoods] = useState<Set<string>>(() => new Set(GOODS_SECTORS.map(s => s.id)))
  const [activeGovt,  setActiveGovt]  = useState<Set<string>>(() => new Set(GOVT_SECTORS.map(s => s.id)))

  // ── Diffusion index state ────────────────────────────────────────────────────
  const [diffusionBrush, setDiffusionBrush] = useState<BrushState>({ start: 0, end: 0, period: 'Max' })

  // ── Goods vs Services state ──────────────────────────────────────────────────
  const [gvsBrush1, setGvsBrush1] = useState<BrushState>({ start: 0, end: 0, period: 'Max' })
  const [gvsBrush2, setGvsBrush2] = useState<BrushState>({ start: 0, end: 0, period: 'Max' })
  const [gvsBrush3, setGvsBrush3] = useState<BrushState>({ start: 0, end: 0, period: 'Max' })

  // ── Goods vs Services Wages state ────────────────────────────────────────────
  const [gvsWageBrush1, setGvsWageBrush1] = useState<BrushState>({ start: 0, end: 0, period: 'Max' })
  const [gvsWageBrush2, setGvsWageBrush2] = useState<BrushState>({ start: 0, end: 0, period: 'Max' })
  const [gvsWageBrush3, setGvsWageBrush3] = useState<BrushState>({ start: 0, end: 0, period: 'Max' })

  // ── Sector explorer state ────────────────────────────────────────────────────
  const [selectedSector, setSelectedSector] = useState('PAYEMS')
  const [ma1, setMa1] = useState(3)
  const [ma2, setMa2] = useState(6)
  const [chartBrushes, setChartBrushes] = useState<Record<ChartKey, BrushState>>({
    level:    { start: 0, end: 0, period: 'Max' },
    drawdown: { start: 0, end: 0, period: 'Max' },
    mom:      { start: 0, end: 0, period: '' },
    yoy:      { start: 0, end: 0, period: 'Max' },
  })

  // ── Wages explorer state ──────────────────────────────────────────────────────
  const [selectedAheSector, setSelectedAheSector] = useState('CES0500000003')
  const [aheMaWindow, setAheMaWindow] = useState(12)
  const [aheChartBrushes, setAheChartBrushes] = useState<Record<WagesChartKey, BrushState>>({
    aheLevel: { start: 0, end: 0, period: 'Max' },
    aheYoy:   { start: 0, end: 0, period: 'Max' },
    aheMom:   { start: 0, end: 0, period: 'Max' },
  })

  // ── Hours explorer state ──────────────────────────────────────────────────────
  const [selectedAwhSector, setSelectedAwhSector] = useState('AWHAETP')
  const [awhMaWindow, setAwhMaWindow] = useState(12)
  const [awhChartBrushes, setAwhChartBrushes] = useState<Record<HoursChartKey, BrushState>>({
    awhLevel: { start: 0, end: 0, period: 'Max' },
    awhMom:   { start: 0, end: 0, period: 'Max' },
  })

  // ── Hours Goods vs Services state ─────────────────────────────────────────────
  const [gvsHoursBrush, setGvsHoursBrush] = useState<BrushState>({ start: 0, end: 0, period: 'Max' })

  // ── Aggregate Payrolls explorer state ─────────────────────────────────────────
  const [selectedAggSector, setSelectedAggSector] = useState('agg_priv')
  const [aggMaWindow, setAggMaWindow] = useState(12)
  const [aggChartBrushes, setAggChartBrushes] = useState<Record<AggPayrollsChartKey, BrushState>>({
    aggLevel: { start: 0, end: 0, period: 'Max' },
    aggYoy:   { start: 0, end: 0, period: 'Max' },
    aggMom:   { start: 0, end: 0, period: 'Max' },
  })

  // ── Agg Payrolls Goods vs Services state ──────────────────────────────────────
  const [gvsAggBrush1, setGvsAggBrush1] = useState<BrushState>({ start: 0, end: 0, period: 'Max' })
  const [gvsAggBrush2, setGvsAggBrush2] = useState<BrushState>({ start: 0, end: 0, period: 'Max' })
  const [gvsAggBrush3, setGvsAggBrush3] = useState<BrushState>({ start: 0, end: 0, period: 'Max' })

  const activeSeries = grouping === 'sector' ? activeSectors : activeCategories
  const currentItems = (grouping === 'sector'
    ? (CES_SECTORS    as readonly { id: string; label: string; color: string }[])
    : (CES_CATEGORIES as readonly { id: string; label: string; color: string }[]))

  const handleToggle = (id: string) => {
    const setter = grouping === 'sector' ? setActiveSectors : setActiveCategories
    setter(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── Data fetch ──────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    Promise.all(
      ALL_FETCH_IDS.map(id =>
        fetchFredSeries(id)
          .then(obs => {
            const valid = obs
              .filter(o => o.value !== '.' && o.value.trim() !== '')
              .map(o => ({ date: o.date, value: parseFloat(o.value) }))
              .filter(o => !isNaN(o.value))
            return [id, valid] as [string, WD[]]
          })
      )
    ).then(entries => {
      if (cancelled) return
      const data: AllData = Object.fromEntries(entries)
      setAllData(data)
      const payems  = data['PAYEMS'] ?? []
      const subInit = initBrush(payems, '2023-01-01')
      setBrush(b    => ({ ...b, ...subInit }))
      setSvcBrush(b  => ({ ...b, ...subInit }))
      setGoodsBrush(b => ({ ...b, ...subInit }))
      setGovtBrush(b  => ({ ...b, ...subInit }))
      setDiffusionBrush({ start: 0, end: payems.length - 1, period: 'Max' })
      setGvsBrush1({ start: 0, end: payems.length - 1, period: 'Max' })
      setGvsBrush2({ start: 0, end: payems.length - 1, period: 'Max' })
      setGvsBrush3({ start: 0, end: payems.length - 1, period: 'Max' })
      const aheEnd = Math.max(0, (data['CES0600000003'] ?? []).length - 1)
      setGvsWageBrush1({ start: 0, end: aheEnd, period: 'Max' })
      setGvsWageBrush2({ start: 0, end: aheEnd, period: 'Max' })
      setGvsWageBrush3({ start: 0, end: aheEnd, period: 'Max' })
      const awhEnd = Math.max(0, (data['AWHAETP'] ?? []).length - 1)
      setAwhChartBrushes({
        awhLevel: { start: 0, end: awhEnd, period: 'Max' },
        awhMom:   { start: 0, end: awhEnd, period: 'Max' },
      })
      const gvsHoursEnd = Math.max(0, (data['AWHAEGP'] ?? []).length - 1)
      setGvsHoursBrush({ start: 0, end: gvsHoursEnd, period: 'Max' })
      const aggEnd = Math.max(0, (data['USPRIV'] ?? []).length - 1)
      setAggChartBrushes({
        aggLevel: { start: 0, end: aggEnd, period: 'Max' },
        aggYoy:   { start: 0, end: aggEnd, period: 'Max' },
        aggMom:   { start: 0, end: aggEnd, period: 'Max' },
      })
      const gvsAggEnd = Math.max(0, (data['CES0600000003'] ?? []).length - 1)
      setGvsAggBrush1({ start: 0, end: gvsAggEnd, period: 'Max' })
      setGvsAggBrush2({ start: 0, end: gvsAggEnd, period: 'Max' })
      setGvsAggBrush3({ start: 0, end: gvsAggEnd, period: 'Max' })
      setLoading(false)
    }).catch(err => {
      if (cancelled) return
      setError(err instanceof Error ? err.message : 'Failed to load data')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  // ── Decomp chart data ────────────────────────────────────────────────────────

  const chartData = useMemo(
    () => buildDecompData(allData, lookback, grouping),
    [allData, lookback, grouping]
  )

  const yDomain = useMemo(
    () => computeDecompDomain(chartData, brush, currentItems, activeSeries),
    [chartData, brush, currentItems, activeSeries]
  )

  // ── Decomp brush handlers ────────────────────────────────────────────────────

  const handleBrushChange = ({ startIndex, endIndex }: { startIndex?: number; endIndex?: number }) => {
    setBrush(prev => ({
      period: '',
      start:  startIndex ?? prev.start,
      end:    endIndex   ?? prev.end,
    }))
  }

  const handleSelectPeriod = (label: string, count: number) => {
    const end = chartData.length - 1
    setBrush({ start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label })
  }

  // ── Sub-decomp handlers ──────────────────────────────────────────────────────

  const mkToggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) =>
    (id: string) => setter(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const handleSvcToggle   = mkToggle(setActiveSvc)
  const handleGoodsToggle = mkToggle(setActiveGoods)
  const handleGovtToggle  = mkToggle(setActiveGovt)

  const mkBrushHandler = (setter: React.Dispatch<React.SetStateAction<BrushState>>) =>
    ({ startIndex, endIndex }: { startIndex?: number; endIndex?: number }) =>
      setter(prev => ({ period: '', start: startIndex ?? prev.start, end: endIndex ?? prev.end }))

  const handleSvcBrush   = mkBrushHandler(setSvcBrush)
  const handleGoodsBrush = mkBrushHandler(setGoodsBrush)
  const handleGovtBrush  = mkBrushHandler(setGovtBrush)

  const mkQuickSelect = (setter: React.Dispatch<React.SetStateAction<BrushState>>, len: number) =>
    (label: string, count: number) => {
      const end = len - 1
      setter({ start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label })
    }

  // ── Sector explorer data ─────────────────────────────────────────────────────

  const levelData = useMemo(
    () => allData[selectedSector] ?? [],
    [allData, selectedSector]
  )

  const drawdownData = useMemo(() => computeDrawdown3Y(levelData), [levelData])
  const momData      = useMemo(() => computeMoM(levelData),        [levelData])
  const ma1Data      = useMemo(() => computeMA(momData, ma1),      [momData, ma1])
  const ma2Data      = useMemo(() => computeMA(momData, ma2),      [momData, ma2])
  const yoyData      = useMemo(() => computeYoY(levelData),        [levelData])

  const yDomainLevel = useMemo((): [number, number] | undefined => {
    const { start, end } = chartBrushes.level
    if (!levelData.length || end < start) return undefined
    const visible = levelData.slice(Math.max(0, start), Math.min(levelData.length, end + 1))
    if (!visible.length) return undefined
    const vals = visible.map(d => d.value)
    const min  = Math.min(...vals)
    const max  = Math.max(...vals)
    const pad  = (max - min) * 0.06 || max * 0.02
    return [min - pad, max + pad]
  }, [levelData, chartBrushes.level.start, chartBrushes.level.end])

  const momChartData = useMemo(() =>
    momData.map((d, i) => ({
      date: d.date,
      mom:  d.value   ?? null,
      ma1:  ma1Data[i]?.value ?? null,
      ma2:  ma2Data[i]?.value ?? null,
    })),
    [momData, ma1Data, ma2Data]
  )

  // ── Sub-decomp data ──────────────────────────────────────────────────────────

  const svcData = useMemo(
    () => buildSubDecompData(allData, SERVICES_SECTORS, 'CES0800000001', svcLookback),
    [allData, svcLookback]
  )
  const goodsData = useMemo(
    () => buildSubDecompData(allData, GOODS_SECTORS, 'USGOOD', goodsLookback),
    [allData, goodsLookback]
  )
  const govtData = useMemo(
    () => buildSubDecompData(allData, GOVT_SECTORS, 'USGOVT', govtLookback),
    [allData, govtLookback]
  )

  const yDomainSvc = useMemo(
    () => computeDecompDomain(svcData, svcBrush, SERVICES_SECTORS, activeSvc),
    [svcData, svcBrush, activeSvc]
  )
  const yDomainGoods = useMemo(
    () => computeDecompDomain(goodsData, goodsBrush, GOODS_SECTORS, activeGoods),
    [goodsData, goodsBrush, activeGoods]
  )
  const yDomainGovt = useMemo(
    () => computeDecompDomain(govtData, govtBrush, GOVT_SECTORS, activeGovt),
    [govtData, govtBrush, activeGovt]
  )

  // ── Recent payroll growth data ───────────────────────────────────────────────

  const { recentRows, recentDates } = useMemo(() => {
    const { rows, dates } = buildRecentData(allData)
    return { recentRows: rows, recentDates: dates }
  }, [allData])

  const xDomainRecent = useMemo((): [number, number] => {
    if (!recentRows.length) return [-100, 100]
    let min = 0, max = 0
    for (const row of recentRows) {
      for (const k of ['t0', 't1', 't2', 't3'] as RecentKey[]) {
        const v = row[k]
        if (v != null) { min = Math.min(min, v); max = Math.max(max, v) }
      }
    }
    const pad = Math.max((max - min) * 0.08, 10)
    return [Math.floor(min - pad), Math.ceil(max + pad)]
  }, [recentRows])

  const diffusionData = useMemo(() => buildDiffusionData(allData), [allData])

  const gvsLevelData = useMemo(() => buildGvSData(allData), [allData])
  const gvsYoyData   = useMemo(() => buildGvSYoY(gvsLevelData), [gvsLevelData])
  const gvsMomData   = useMemo(() => buildGvSMoM(gvsLevelData), [gvsLevelData])

  // ── Goods vs Services Wages data ──────────────────────────────────────────────

  const gvsWageLevelData = useMemo(() => buildGvsWageLevel(allData), [allData])
  const gvsWageYoyData   = useMemo(() => buildGvSYoY(gvsWageLevelData),      [gvsWageLevelData])
  const gvsWageMomData   = useMemo(() => buildGvsWageMoMPct(gvsWageLevelData), [gvsWageLevelData])

  // ── Wages explorer data ───────────────────────────────────────────────────────

  const aheLevelData = useMemo(
    () => allData[selectedAheSector] ?? [],
    [allData, selectedAheSector]
  )

  const aheYoyData = useMemo(() => computeYoY(aheLevelData), [aheLevelData])
  const aheMomData = useMemo(() => computeMoMPct(aheLevelData), [aheLevelData])
  const aheMaData  = useMemo(() => computeMA(aheMomData, aheMaWindow), [aheMomData, aheMaWindow])

  const aheMomChartData = useMemo(() =>
    aheMomData.map((d, i) => ({
      date: d.date,
      mom:  d.value ?? null,
      ma:   aheMaData[i]?.value ?? null,
    })),
    [aheMomData, aheMaData]
  )

  // ── Hours explorer data ───────────────────────────────────────────────────────

  const awhLevelData = useMemo(
    () => allData[selectedAwhSector] ?? [],
    [allData, selectedAwhSector]
  )

  const awhMomData = useMemo(() => computeMoM(awhLevelData), [awhLevelData])
  const awhMaData  = useMemo(() => computeMA(awhMomData, awhMaWindow), [awhMomData, awhMaWindow])

  const awhMomChartData = useMemo(() =>
    awhMomData.map((d, i) => ({
      date: d.date,
      mom:  d.value ?? null,
      ma:   awhMaData[i]?.value ?? null,
    })),
    [awhMomData, awhMaData]
  )

  // ── Hours Goods vs Services data ──────────────────────────────────────────────

  const gvsHoursData = useMemo(() => {
    const goodsData = allData['AWHAEGP'] ?? []
    const sMap = new Map((allData['AWHAEPSP'] ?? []).map(d => [d.date, d.value]))
    return goodsData.map(d => ({
      date:     d.date,
      goods:    d.value,
      services: sMap.get(d.date) ?? null,
    }))
  }, [allData])

  // ── Aggregate Payrolls data ───────────────────────────────────────────────────

  const aggPayrollsData = useMemo((): WD[] => {
    const cfg = AGG_SECTOR_CONFIG[selectedAggSector]
    if (!cfg) return []
    const empData = allData[cfg.emp] ?? []
    const aheMap  = new Map((allData[cfg.ahe] ?? []).map(d => [d.date, d.value]))
    const awhMap  = new Map((allData[cfg.awh] ?? []).map(d => [d.date, d.value]))
    const result: WD[] = []
    for (const d of empData) {
      const ahe = aheMap.get(d.date)
      const awh = awhMap.get(d.date)
      if (ahe == null || awh == null) continue
      result.push({ date: d.date, value: d.value * 1000 * ahe * awh * 4.33 })
    }
    return result
  }, [allData, selectedAggSector])

  const aggYoyData = useMemo(() => computeYoY(aggPayrollsData),    [aggPayrollsData])
  const aggMomData = useMemo(() => computeMoMPct(aggPayrollsData), [aggPayrollsData])
  const aggMaData  = useMemo(() => computeMA(aggMomData, aggMaWindow), [aggMomData, aggMaWindow])

  const aggMomChartData = useMemo(() =>
    aggMomData.map((d, i) => ({
      date: d.date,
      mom:  d.value ?? null,
      ma:   aggMaData[i]?.value ?? null,
    })),
    [aggMomData, aggMaData]
  )

  // ── Agg Payrolls Goods vs Services data ───────────────────────────────────────

  const gvsAggLevelData = useMemo(() => buildAggPayrollsGvS(allData), [allData])
  const gvsAggYoyData   = useMemo(() => buildGvSYoY(gvsAggLevelData),        [gvsAggLevelData])
  const gvsAggMomData   = useMemo(() => buildGvsWageMoMPct(gvsAggLevelData), [gvsAggLevelData])

  // Re-initialise sector chart brushes when the selected sector changes
  useEffect(() => {
    if (!levelData.length) return
    const end      = levelData.length - 1
    const momStart = levelData.findIndex(d => d.date >= '2023-01-01')
    setChartBrushes({
      level:    { start: 0,                            end, period: 'Max' },
      drawdown: { start: 0,                            end, period: 'Max' },
      mom:      { start: momStart >= 0 ? momStart : 0, end, period: ''    },
      yoy:      { start: 0,                            end, period: 'Max' },
    })
  }, [levelData])

  // Re-initialise AHE brushes when the selected AHE sector changes
  useEffect(() => {
    if (!aheLevelData.length) return
    const end = aheLevelData.length - 1
    setAheChartBrushes({
      aheLevel: { start: 0, end, period: 'Max' },
      aheYoy:   { start: 0, end, period: 'Max' },
      aheMom:   { start: 0, end, period: 'Max' },
    })
  }, [aheLevelData])

  // Re-initialise AWH brushes when the selected AWH sector changes
  useEffect(() => {
    if (!awhLevelData.length) return
    const end = awhLevelData.length - 1
    setAwhChartBrushes({
      awhLevel: { start: 0, end, period: 'Max' },
      awhMom:   { start: 0, end, period: 'Max' },
    })
  }, [awhLevelData])

  // Re-initialise Agg Payrolls brushes when the selected sector changes
  useEffect(() => {
    if (!aggPayrollsData.length) return
    const end = aggPayrollsData.length - 1
    setAggChartBrushes({
      aggLevel: { start: 0, end, period: 'Max' },
      aggYoy:   { start: 0, end, period: 'Max' },
      aggMom:   { start: 0, end, period: 'Max' },
    })
  }, [aggPayrollsData])

  // ── Sector chart brush handlers ──────────────────────────────────────────────

  const handleSectorBrush = useCallback(
    (key: ChartKey, startIndex?: number, endIndex?: number) => {
      setChartBrushes(prev => ({
        ...prev,
        [key]: {
          period: '',
          start:  startIndex ?? prev[key].start,
          end:    endIndex   ?? prev[key].end,
        },
      }))
    },
    []
  )

  const handleSectorQuickSelect = useCallback(
    (key: ChartKey, label: string, count: number) => {
      setChartBrushes(prev => {
        const end = levelData.length - 1
        return {
          ...prev,
          [key]: {
            start:  isFinite(count) ? Math.max(0, end - count + 1) : 0,
            end,
            period: label,
          },
        }
      })
    },
    [levelData.length]
  )

  // ── Wages chart brush handlers ────────────────────────────────────────────────

  const handleAheBrush = useCallback(
    (key: WagesChartKey, startIndex?: number, endIndex?: number) => {
      setAheChartBrushes(prev => ({
        ...prev,
        [key]: {
          period: '',
          start:  startIndex ?? prev[key].start,
          end:    endIndex   ?? prev[key].end,
        },
      }))
    },
    []
  )

  const handleAheQuickSelect = useCallback(
    (key: WagesChartKey, label: string, count: number) => {
      setAheChartBrushes(prev => {
        const end = aheLevelData.length - 1
        return {
          ...prev,
          [key]: {
            start:  isFinite(count) ? Math.max(0, end - count + 1) : 0,
            end,
            period: label,
          },
        }
      })
    },
    [aheLevelData.length]
  )

  // ── Hours chart brush handlers ────────────────────────────────────────────────

  const handleAwhBrush = useCallback(
    (key: HoursChartKey, startIndex?: number, endIndex?: number) => {
      setAwhChartBrushes(prev => ({
        ...prev,
        [key]: {
          period: '',
          start:  startIndex ?? prev[key].start,
          end:    endIndex   ?? prev[key].end,
        },
      }))
    },
    []
  )

  const handleAwhQuickSelect = useCallback(
    (key: HoursChartKey, label: string, count: number) => {
      setAwhChartBrushes(prev => {
        const end = awhLevelData.length - 1
        return {
          ...prev,
          [key]: {
            start:  isFinite(count) ? Math.max(0, end - count + 1) : 0,
            end,
            period: label,
          },
        }
      })
    },
    [awhLevelData.length]
  )

  // ── Aggregate Payrolls brush handlers ────────────────────────────────────────

  const handleAggBrush = useCallback(
    (key: AggPayrollsChartKey, startIndex?: number, endIndex?: number) => {
      setAggChartBrushes(prev => ({
        ...prev,
        [key]: {
          period: '',
          start:  startIndex ?? prev[key].start,
          end:    endIndex   ?? prev[key].end,
        },
      }))
    },
    []
  )

  const handleAggQuickSelect = useCallback(
    (key: AggPayrollsChartKey, label: string, count: number) => {
      setAggChartBrushes(prev => {
        const end = aggPayrollsData.length - 1
        return {
          ...prev,
          [key]: {
            start:  isFinite(count) ? Math.max(0, end - count + 1) : 0,
            end,
            period: label,
          },
        }
      })
    },
    [aggPayrollsData.length]
  )

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className={styles.gridBody}>
        <div className={styles.pageHead}>
          <div className={styles.pageTitle}>CES Dashboard</div>
          <div className={styles.pageSub}>
            Current Employment Statistics — monthly payroll employment by sector
          </div>
        </div>

        {loading && <div className={styles.statusBlock}>LOADING DATA…</div>}
        {error   && (
          <div className={`${styles.statusBlock} ${styles.statusError}`}>Error: {error}</div>
        )}

        {!loading && !error && (<>

          {/* ════════════════════════════════════════════════════════════════
              Payrolls Decomposition
          ════════════════════════════════════════════════════════════════ */}
          <div className={styles.majorHeader}>Payrolls</div>

          {/* Densest chart on the page — 14-sector diverging stacked bars +
              full legend. Kept full-width; unreadable at half-width. */}
          <div className={`${styles.section} ${styles.fullSpan}`}>

            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>Payrolls Decomposition</div>
                <div className={styles.sectionSubtitle}>thousands of persons</div>
              </div>
              <div className={styles.controls}>
                <div className={styles.groupToggle}>
                  <button
                    type="button"
                    className={`${styles.groupBtn} ${grouping === 'sector' ? styles.groupBtnActive : ''}`}
                    onClick={() => setGrouping('sector')}
                  >
                    Sector
                  </button>
                  <button
                    type="button"
                    className={`${styles.groupBtn} ${grouping === 'category' ? styles.groupBtnActive : ''}`}
                    onClick={() => setGrouping('category')}
                  >
                    Category
                  </button>
                </div>
                <div className={styles.lookbackWrap}>
                  <span className={styles.lookbackLabel}>Lookback (mo)</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={lookback}
                    onChange={e => {
                      const n = parseInt(e.target.value)
                      if (!isNaN(n) && n >= 1 && n <= 60) setLookback(n)
                    }}
                    className={styles.lookbackInput}
                  />
                </div>
              </div>
            </div>

            <div className={styles.legendRow}>
              <div className={styles.legend}>
                {currentItems.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    className={`${styles.legendItem} ${activeSeries.has(s.id) ? '' : styles.legendItemOff}`}
                    onClick={() => handleToggle(s.id)}
                  >
                    <span className={styles.legendSwatch} style={{ background: s.color }} />
                    <span>{s.label}</span>
                  </button>
                ))}
                <div className={styles.legendItem} style={{ cursor: 'default' }}>
                  <span className={styles.legendLine} style={{ background: '#ffffff' }} />
                  <span style={{ color: '#94A3B8' }}>Total Nonfarm</span>
                </div>
              </div>
            </div>

            <div className={styles.chartWrap}>
              <DecompChart
                data={chartData}
                visibleStart={brush.start}
                visibleEnd={brush.end}
                currentItems={currentItems}
                activeSeries={activeSeries}
                yDomain={yDomain}
              />
            </div>

            <div className={styles.brushWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 0, right: CM.right, bottom: 0, left: CM.left }}
                >
                  <XAxis dataKey="date" hide />
                  <YAxis hide />
                  <Line
                    type="monotone"
                    dataKey="total"
                    stroke="rgba(255,255,255,0.18)"
                    strokeWidth={1}
                    dot={false}
                    isAnimationActive={false}
                    legendType="none"
                    connectNulls
                  />
                  <Brush
                    dataKey="date"
                    startIndex={brush.start}
                    endIndex={brush.end}
                    onChange={handleBrushChange}
                    height={40}
                    stroke="rgba(255,255,255,0.10)"
                    fill="#070b10"
                    travellerWidth={7}
                    tickFormatter={fmtAxisDate}
                    gap={4}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <QuickSelectRow period={brush.period} onSelect={handleSelectPeriod} />
          </div>

          {/* ════════════════════════════════════════════════════════════════
              Sub-decomposition charts
          ════════════════════════════════════════════════════════════════ */}

          {/* 10-sector stacked bars — kept full-width (dense at half). */}
          <SubDecompSection
            title="Services Payrolls Decomposition"
            subtitle="1moΔ, thousands of persons"
            sectors={SERVICES_SECTORS}
            aggregateLabel="Private Service Providing"
            data={svcData}
            brush={svcBrush}
            onBrushChange={handleSvcBrush}
            onQuickSelect={mkQuickSelect(setSvcBrush, svcData.length)}
            activeSeries={activeSvc}
            onToggle={handleSvcToggle}
            lookback={svcLookback}
            onLookbackChange={setSvcLookback}
            yDomain={yDomainSvc}
            fullWidth
          />
          <SubDecompSection
            title="Goods Payrolls Decomposition"
            subtitle="1moΔ, thousands of persons"
            sectors={GOODS_SECTORS}
            aggregateLabel="Goods Producing"
            data={goodsData}
            brush={goodsBrush}
            onBrushChange={handleGoodsBrush}
            onQuickSelect={mkQuickSelect(setGoodsBrush, goodsData.length)}
            activeSeries={activeGoods}
            onToggle={handleGoodsToggle}
            lookback={goodsLookback}
            onLookbackChange={setGoodsLookback}
            yDomain={yDomainGoods}
          />
          <SubDecompSection
            title="Government Payrolls Decomposition"
            subtitle="1moΔ, thousands of persons"
            sectors={GOVT_SECTORS}
            aggregateLabel="Government"
            data={govtData}
            brush={govtBrush}
            onBrushChange={handleGovtBrush}
            onQuickSelect={mkQuickSelect(setGovtBrush, govtData.length)}
            activeSeries={activeGovt}
            onToggle={handleGovtToggle}
            lookback={govtLookback}
            onLookbackChange={setGovtLookback}
            yDomain={yDomainGovt}
          />

          {/* ════════════════════════════════════════════════════════════════
              Recent payroll growth + Diffusion Index (side-by-side)
          ════════════════════════════════════════════════════════════════ */}
          <div className={styles.twoColGrid}>

            {/* ── Most Recent 4 Months of Payroll Growth ── */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>Most Recent 4 Months of Payroll Growth</div>
                  <div className={styles.sectionSubtitle}>Month-over-month change · thousands of jobs</div>
                </div>
              </div>
              <div className={styles.legendRow}>
                <div className={styles.legend}>
                  {RECENT_MONTHS.map((m, i) => (
                    <span key={m.key} className={styles.legendItem} style={{ cursor: 'default' }}>
                      <span className={styles.legendSwatch} style={{ background: m.color }} />
                      {m.label}{recentDates[i] ? ` · ${fmtFullDate(recentDates[i])}` : ''}
                    </span>
                  ))}
                </div>
              </div>
              <div className={styles.recentChartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    layout="vertical"
                    data={recentRows}
                    margin={{ top: 8, right: 24, bottom: 8, left: 165 }}
                  >
                    <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      type="number"
                      domain={xDomainRecent}
                      tick={TICK} tickLine={false} axisLine={false}
                      tickFormatter={(v: number) => `${v >= 0 ? '+' : ''}${fmtK(v)}`}
                    />
                    <YAxis
                      type="category"
                      dataKey="sector"
                      tick={{ ...TICK, textAnchor: 'end' }}
                      tickLine={false}
                      axisLine={false}
                      width={165}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE.contentStyle}
                      labelStyle={TOOLTIP_STYLE.labelStyle}
                      itemStyle={TOOLTIP_STYLE.itemStyle}
                      cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                      formatter={(v: unknown, name: unknown) => {
                        const idx = RECENT_MONTHS.findIndex(m => m.key === name)
                        const monthCfg = RECENT_MONTHS[idx]
                        const dateLabel = idx >= 0 && recentDates[idx] ? ` · ${fmtFullDate(recentDates[idx])}` : ''
                        const nameLabel = monthCfg ? `${monthCfg.label}${dateLabel}` : String(name)
                        return [typeof v === 'number' ? `${v >= 0 ? '+' : ''}${fmtK(v)}` : '-', nameLabel] as [string, string]
                      }}
                    />
                    <ReferenceLine x={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                    {RECENT_MONTHS.map(m => (
                      <Bar
                        key={m.key}
                        dataKey={m.key}
                        name={m.key}
                        fill={m.color}
                        barSize={7}
                        isAnimationActive={false}
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ── Payrolls Diffusion Index ── */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>Payrolls Diffusion Index</div>
                  <div className={styles.sectionSubtitle}>% of Sectors w Y/Y Growth</div>
                </div>
              </div>
              <div className={styles.diffChartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={diffusionData}
                    margin={{ top: 8, right: 16, bottom: 28, left: 54 }}
                  >
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="date"
                      tick={TICK} tickLine={false} axisLine={false}
                      tickFormatter={fmtAxisDate} minTickGap={60}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={TICK} tickLine={false} axisLine={false}
                      width={46}
                      tickFormatter={(v: number) => `${v}%`}
                    />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      formatter={(v: unknown) => [
                        typeof v === 'number' ? `${v.toFixed(1)}%` : '-',
                        '% Sectors w/ YoY Growth',
                      ] as [string, string]}
                    />
                    <ReferenceLine
                      y={60}
                      stroke="#ef4444"
                      strokeDasharray="4 3"
                      strokeWidth={1.5}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      name="Diffusion Index"
                      stroke="#93c5fd"
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls
                    />
                    <Brush
                      dataKey="date"
                      startIndex={diffusionBrush.start}
                      endIndex={diffusionBrush.end}
                      onChange={({ startIndex, endIndex }) =>
                        setDiffusionBrush(prev => ({
                          period: '',
                          start:  startIndex ?? prev.start,
                          end:    endIndex   ?? prev.end,
                        }))
                      }
                      {...MINI_BRUSH}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <QuickSelectRow
                period={diffusionBrush.period}
                onSelect={(label, count) => {
                  const end = diffusionData.length - 1
                  setDiffusionBrush({
                    start:  isFinite(count) ? Math.max(0, end - count + 1) : 0,
                    end,
                    period: label,
                  })
                }}
              />
            </div>

          </div>{/* end twoColGrid */}

          {/* ════════════════════════════════════════════════════════════════
              Sector Explorer
          ════════════════════════════════════════════════════════════════ */}

          {/* Selector header */}
          <div className={styles.explorerHeader}>
            <div className={styles.sectionTitle}>Sector Explorer</div>
            <div className={styles.sectorSelectWrap}>
              <span className={styles.lookbackLabel}>Sector</span>
              <select
                className={styles.sectorSelect}
                value={selectedSector}
                onChange={e => setSelectedSector(e.target.value)}
              >
                {SECTOR_ITEMS.map(item => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 2×2 chart grid */}
          <div className={styles.sectorGrid}>

            {/* ── Chart 1: Level ─────────────────────────────────────────── */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>Nonfarm Payrolls — Level</div>
                  <div className={styles.sectionSubtitle}>thousands of persons</div>
                </div>
              </div>
              <div className={styles.miniChartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={levelData}
                    margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="date"
                      tick={TICK} tickLine={false} axisLine={false}
                      tickFormatter={fmtAxisDate} minTickGap={60}
                    />
                    <YAxis
                      tick={TICK} tickLine={false} axisLine={false}
                      width={58} tickFormatter={fmtK}
                      domain={yDomainLevel}
                    />
                    <Tooltip
                      {...TOOLTIP_STYLE}

                      formatter={(v: unknown) => [typeof v === 'number' ? fmtK(v) : '-', ''] as [string, string]}
                    />
                    <Line
                      type="monotone" dataKey="value" name="Level"
                      stroke="#60a5fa" strokeWidth={1.5}
                      dot={false} isAnimationActive={false} connectNulls
                    />
                    <Brush
                      dataKey="date"
                      startIndex={chartBrushes.level.start}
                      endIndex={chartBrushes.level.end}
                      onChange={({ startIndex, endIndex }) =>
                        handleSectorBrush('level', startIndex, endIndex)}
                      {...MINI_BRUSH}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <QuickSelectRow
                period={chartBrushes.level.period}
                onSelect={(l, c) => handleSectorQuickSelect('level', l, c)}
              />
            </div>

            {/* ── Chart 2: 3Y Drawdown ───────────────────────────────────── */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>Nonfarm Payrolls — 3Y Drawdown</div>
                  <div className={styles.sectionSubtitle}>% below rolling 3-year peak</div>
                </div>
              </div>
              <div className={styles.miniChartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={drawdownData}
                    margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="date"
                      tick={TICK} tickLine={false} axisLine={false}
                      tickFormatter={fmtAxisDate} minTickGap={60}
                    />
                    <YAxis
                      tick={TICK} tickLine={false} axisLine={false}
                      width={58} tickFormatter={fmtPct}
                      domain={['auto', 0]}
                    />
                    <Tooltip
                      {...TOOLTIP_STYLE}

                      formatter={(v: unknown) => [typeof v === 'number' ? `${v.toFixed(2)}%` : '-', ''] as [string, string]}
                    />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                    <Line
                      type="monotone" dataKey="value" name="Drawdown"
                      stroke="#f87171" strokeWidth={1.5}
                      dot={false} isAnimationActive={false} connectNulls
                    />
                    <Brush
                      dataKey="date"
                      startIndex={chartBrushes.drawdown.start}
                      endIndex={chartBrushes.drawdown.end}
                      onChange={({ startIndex, endIndex }) =>
                        handleSectorBrush('drawdown', startIndex, endIndex)}
                      {...MINI_BRUSH}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <QuickSelectRow
                period={chartBrushes.drawdown.period}
                onSelect={(l, c) => handleSectorQuickSelect('drawdown', l, c)}
              />
            </div>

            {/* ── Chart 3: 1mo Change ────────────────────────────────────── */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>Payroll Growth — 1mo Change</div>
                  <div className={styles.sectionSubtitle}>thousands of persons</div>
                </div>
                <div className={styles.controls}>
                  <div className={styles.lookbackWrap}>
                    <span className={styles.lookbackLabel}>MA1</span>
                    <input
                      type="number" min={1} max={24} value={ma1}
                      onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 1 && n <= 24) setMa1(n) }}
                      className={styles.lookbackInput}
                    />
                  </div>
                  <div className={styles.lookbackWrap}>
                    <span className={styles.lookbackLabel}>MA2</span>
                    <input
                      type="number" min={1} max={24} value={ma2}
                      onChange={e => { const n = parseInt(e.target.value); if (!isNaN(n) && n >= 1 && n <= 24) setMa2(n) }}
                      className={styles.lookbackInput}
                    />
                  </div>
                </div>
              </div>
              <div className={styles.miniChartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={momChartData}
                    margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="date"
                      tick={TICK} tickLine={false} axisLine={false}
                      tickFormatter={fmtAxisDate} minTickGap={60}
                    />
                    <YAxis
                      tick={TICK} tickLine={false} axisLine={false}
                      width={58} tickFormatter={fmtK}
                    />
                    <Tooltip
                      {...TOOLTIP_STYLE}

                      formatter={(v: unknown, name: unknown) => {
                        const val = typeof v === 'number' ? fmtK(v) : '-'
                        const lbl = name === 'mom' ? '1mo Δ'
                          : name === 'ma1' ? `${ma1}mo MA`
                          : `${ma2}mo MA`
                        return [val, lbl] as [string, string]
                      }}
                    />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                    <Bar dataKey="mom" isAnimationActive={false} legendType="none" maxBarSize={16}>
                      {momChartData.map((entry, idx) => (
                        <Cell
                          key={`cell-${idx}`}
                          fill={(entry.mom ?? 0) >= 0 ? 'rgba(74,222,128,0.75)' : 'rgba(248,113,113,0.75)'}
                        />
                      ))}
                    </Bar>
                    <Line
                      type="monotone" dataKey="ma1" name="ma1"
                      stroke="#facc15" strokeWidth={1.5}
                      dot={false} isAnimationActive={false} connectNulls legendType="none"
                    />
                    <Line
                      type="monotone" dataKey="ma2" name="ma2"
                      stroke="#fb923c" strokeWidth={1.5}
                      dot={false} isAnimationActive={false} connectNulls legendType="none"
                    />
                    <Brush
                      dataKey="date"
                      startIndex={chartBrushes.mom.start}
                      endIndex={chartBrushes.mom.end}
                      onChange={({ startIndex, endIndex }) =>
                        handleSectorBrush('mom', startIndex, endIndex)}
                      {...MINI_BRUSH}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <QuickSelectRow
                period={chartBrushes.mom.period}
                onSelect={(l, c) => handleSectorQuickSelect('mom', l, c)}
              />
            </div>

            {/* ── Chart 4: YoY ──────────────────────────────────────────── */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>Payroll Growth — YoY %Δ</div>
                  <div className={styles.sectionSubtitle}>year-over-year % change</div>
                </div>
              </div>
              <div className={styles.miniChartWrap}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={yoyData}
                    margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="date"
                      tick={TICK} tickLine={false} axisLine={false}
                      tickFormatter={fmtAxisDate} minTickGap={60}
                    />
                    <YAxis
                      tick={TICK} tickLine={false} axisLine={false}
                      width={58} tickFormatter={fmtPct}
                    />
                    <Tooltip
                      {...TOOLTIP_STYLE}

                      formatter={(v: unknown) => [typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '-', ''] as [string, string]}
                    />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
                    <Line
                      type="monotone" dataKey="value" name="YoY %Δ"
                      stroke="#a78bfa" strokeWidth={1.5}
                      dot={false} isAnimationActive={false} connectNulls
                    />
                    <Brush
                      dataKey="date"
                      startIndex={chartBrushes.yoy.start}
                      endIndex={chartBrushes.yoy.end}
                      onChange={({ startIndex, endIndex }) =>
                        handleSectorBrush('yoy', startIndex, endIndex)}
                      {...MINI_BRUSH}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <QuickSelectRow
                period={chartBrushes.yoy.period}
                onSelect={(l, c) => handleSectorQuickSelect('yoy', l, c)}
              />
            </div>

          </div>{/* end sectorGrid */}

          {/* ════════════════════════════════════════════════════════════════
              Goods vs Services
          ════════════════════════════════════════════════════════════════ */}

          <div className={styles.explorerHeader}>
            <div className={styles.sectionTitle}>Goods vs Services</div>
          </div>

          {/* Chart 1: Level (dual Y-axis) */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>Goods vs Services — Employment Level</div>
                <div className={styles.sectionSubtitle}>thousands of persons, seasonally adjusted</div>
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={gvsLevelData} margin={{ top: 8, right: 64, bottom: 28, left: 64 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tickFormatter={fmtAxisDate} tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={40} />
                  <YAxis
                    yAxisId="left"
                    orientation="left"
                    tickFormatter={fmtK}
                    tick={{ fontSize: 10, fill: '#ef4444' }}
                    width={58}
                    domain={['auto', 'auto']}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tickFormatter={fmtK}
                    tick={{ fontSize: 10, fill: '#60a5fa' }}
                    width={58}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => [typeof v === 'number' ? fmtK(v) : '-', String(name)] as [string, string]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Line yAxisId="left"  type="monotone" dataKey="goods"    name="Goods-Producing (L)"   stroke="#ef4444" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Line yAxisId="right" type="monotone" dataKey="services" name="Service-Providing (R)"  stroke="#60a5fa" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Brush
                    dataKey="date"
                    startIndex={gvsBrush1.start}
                    endIndex={gvsBrush1.end}
                    onChange={({ startIndex, endIndex }) =>
                      setGvsBrush1(prev => ({ ...prev, period: '', start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
                    {...MINI_BRUSH}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow
              period={gvsBrush1.period}
              onSelect={(label, count) => {
                const end = gvsLevelData.length - 1
                setGvsBrush1({ start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label })
              }}
            />
          </div>

          {/* Chart 2: YoY % */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>Goods vs Services — Payroll Growth, YoY %Δ</div>
                <div className={styles.sectionSubtitle}>year-over-year % change</div>
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={gvsYoyData} margin={{ top: 8, right: 16, bottom: 28, left: 54 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tickFormatter={fmtAxisDate} tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={40} />
                  <YAxis tickFormatter={(v: number) => fmtPct(v)} tick={{ fontSize: 10, fill: '#64748B' }} width={54} domain={['auto', 'auto']} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => [typeof v === 'number' ? `${v >= 0 ? '+' : ''}${fmtPct(v)}` : '-', String(name)] as [string, string]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Line type="monotone" dataKey="goods"    name="Goods-Producing"  stroke="#ef4444" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Line type="monotone" dataKey="services" name="Service-Providing" stroke="#60a5fa" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Brush
                    dataKey="date"
                    startIndex={gvsBrush2.start}
                    endIndex={gvsBrush2.end}
                    onChange={({ startIndex, endIndex }) =>
                      setGvsBrush2(prev => ({ ...prev, period: '', start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
                    {...MINI_BRUSH}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow
              period={gvsBrush2.period}
              onSelect={(label, count) => {
                const end = gvsYoyData.length - 1
                setGvsBrush2({ start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label })
              }}
            />
          </div>

          {/* Chart 3: MoM Δ */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>Goods vs Services — Payroll Growth, 1moΔ</div>
                <div className={styles.sectionSubtitle}>month-over-month change, thousands of persons</div>
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={gvsMomData} margin={{ top: 8, right: 16, bottom: 28, left: 54 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tickFormatter={fmtAxisDate} tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={40} />
                  <YAxis tickFormatter={(v: number) => `${v >= 0 ? '+' : ''}${fmtK(v)}`} tick={{ fontSize: 10, fill: '#64748B' }} width={54} domain={['auto', 'auto']} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => [typeof v === 'number' ? `${v >= 0 ? '+' : ''}${fmtK(v)}` : '-', String(name)] as [string, string]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Line type="monotone" dataKey="goods"    name="Goods-Producing"  stroke="#ef4444" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Line type="monotone" dataKey="services" name="Service-Providing" stroke="#60a5fa" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Brush
                    dataKey="date"
                    startIndex={gvsBrush3.start}
                    endIndex={gvsBrush3.end}
                    onChange={({ startIndex, endIndex }) =>
                      setGvsBrush3(prev => ({ ...prev, period: '', start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
                    {...MINI_BRUSH}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow
              period={gvsBrush3.period}
              onSelect={(label, count) => {
                const end = gvsMomData.length - 1
                setGvsBrush3({ start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label })
              }}
            />
          </div>

          <div className={styles.majorHeader}>Wages</div>

          {/* ════════════════════════════════════════════════════════════════
              Wages Sector Explorer
          ════════════════════════════════════════════════════════════════ */}

          {/* Selector header */}
          <div className={styles.explorerHeader}>
            <div className={styles.sectionTitle}>Wages Sector Explorer</div>
            <div className={styles.sectorSelectWrap}>
              <span className={styles.lookbackLabel}>Sector</span>
              <select
                className={styles.sectorSelect}
                value={selectedAheSector}
                onChange={e => setSelectedAheSector(e.target.value)}
              >
                {AHE_ITEMS.map(item => (
                  <option key={item.id} value={item.id} disabled={item.disabled}>{item.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Chart 1: AHE Level */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>Average Hourly Earnings — Level</div>
                <div className={styles.sectionSubtitle}>$/hr</div>
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={aheLevelData} margin={{ top: 8, right: 16, bottom: 28, left: 64 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tickFormatter={fmtAxisDate} tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={40} />
                  <YAxis tickFormatter={fmtDollar} tick={{ fontSize: 10, fill: '#64748B' }} width={64} domain={['auto', 'auto']} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v: unknown) => [typeof v === 'number' ? fmtDollar(v) : '-', 'AHE'] as [string, string]}
                  />
                  <Line
                    type="monotone" dataKey="value" name="Level"
                    stroke="#4ade80" strokeWidth={1.5}
                    dot={false} isAnimationActive={false} connectNulls
                  />
                  <Brush
                    dataKey="date"
                    startIndex={aheChartBrushes.aheLevel.start}
                    endIndex={aheChartBrushes.aheLevel.end}
                    onChange={({ startIndex, endIndex }) =>
                      handleAheBrush('aheLevel', startIndex, endIndex)}
                    {...MINI_BRUSH}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow
              period={aheChartBrushes.aheLevel.period}
              onSelect={(l, c) => handleAheQuickSelect('aheLevel', l, c)}
            />
          </div>

          {/* Chart 2: AHE YoY */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>Average Hourly Earnings — YoY %Δ</div>
                <div className={styles.sectionSubtitle}>yoy %Δ</div>
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={aheYoyData} margin={{ top: 8, right: 16, bottom: 28, left: 54 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tickFormatter={fmtAxisDate} tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={40} />
                  <YAxis tickFormatter={fmtPct} tick={{ fontSize: 10, fill: '#64748B' }} width={54} domain={['auto', 'auto']} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v: unknown) => [
                      typeof v === 'number' ? `${v >= 0 ? '+' : ''}${fmtPct(v)}` : '-',
                      'YoY %Δ',
                    ] as [string, string]}
                  />
                  <Line
                    type="monotone" dataKey="value" name="YoY %Δ"
                    stroke="#fb923c" strokeWidth={1.5}
                    dot={false} isAnimationActive={false} connectNulls
                  />
                  <Brush
                    dataKey="date"
                    startIndex={aheChartBrushes.aheYoy.start}
                    endIndex={aheChartBrushes.aheYoy.end}
                    onChange={({ startIndex, endIndex }) =>
                      handleAheBrush('aheYoy', startIndex, endIndex)}
                    {...MINI_BRUSH}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow
              period={aheChartBrushes.aheYoy.period}
              onSelect={(l, c) => handleAheQuickSelect('aheYoy', l, c)}
            />
          </div>

          {/* Chart 3: AHE MoM */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>Average Hourly Earnings — MoM %Δ</div>
                <div className={styles.sectionSubtitle}>m/m %Δ</div>
              </div>
              <div className={styles.controls}>
                <div className={styles.lookbackWrap}>
                  <span className={styles.lookbackLabel}>MA Window</span>
                  <input
                    type="number" min={1} max={36} value={aheMaWindow}
                    onChange={e => {
                      const n = parseInt(e.target.value)
                      if (!isNaN(n) && n >= 1 && n <= 36) setAheMaWindow(n)
                    }}
                    className={styles.lookbackInput}
                  />
                </div>
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={aheMomChartData} margin={{ top: 8, right: 16, bottom: 28, left: 54 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tickFormatter={fmtAxisDate} tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={40} />
                  <YAxis tickFormatter={fmtPct} tick={{ fontSize: 10, fill: '#64748B' }} width={54} domain={['auto', 'auto']} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => {
                      const val = typeof v === 'number' ? `${v >= 0 ? '+' : ''}${fmtPct(v)}` : '-'
                      const lbl = name === 'mom' ? 'MoM %Δ' : `${aheMaWindow}mo MA`
                      return [val, lbl] as [string, string]
                    }}
                  />
                  <Bar dataKey="mom" isAnimationActive={false} legendType="none" maxBarSize={16}>
                    {aheMomChartData.map((entry, idx) => (
                      <Cell
                        key={`ahe-cell-${idx}`}
                        fill={(entry.mom ?? 0) >= 0 ? 'rgba(251,146,60,0.8)' : 'rgba(252,165,165,0.75)'}
                      />
                    ))}
                  </Bar>
                  <Line
                    type="monotone" dataKey="ma" name="ma"
                    stroke="#60a5fa" strokeWidth={1.5}
                    dot={false} isAnimationActive={false} connectNulls legendType="none"
                  />
                  <Brush
                    dataKey="date"
                    startIndex={aheChartBrushes.aheMom.start}
                    endIndex={aheChartBrushes.aheMom.end}
                    onChange={({ startIndex, endIndex }) =>
                      handleAheBrush('aheMom', startIndex, endIndex)}
                    {...MINI_BRUSH}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow
              period={aheChartBrushes.aheMom.period}
              onSelect={(l, c) => handleAheQuickSelect('aheMom', l, c)}
            />
          </div>

          {/* ════════════════════════════════════════════════════════════════
              Goods vs Services Wages
          ════════════════════════════════════════════════════════════════ */}

          <div className={styles.explorerHeader}>
            <div className={styles.sectionTitle}>Goods vs Services</div>
          </div>

          {/* Chart 1: Wage Level */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>Goods vs Services Wages — Level</div>
                <div className={styles.sectionSubtitle}>AHE, $/hr</div>
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={gvsWageLevelData} margin={{ top: 8, right: 16, bottom: 28, left: 64 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tickFormatter={fmtAxisDate} tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={40} />
                  <YAxis tickFormatter={fmtDollar} tick={{ fontSize: 10, fill: '#64748B' }} width={64} domain={['auto', 'auto']} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => [
                      typeof v === 'number' ? fmtDollar(v) : '-',
                      String(name),
                    ] as [string, string]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Line type="monotone" dataKey="goods"    name="Goods-Producing"   stroke="#ef4444" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Line type="monotone" dataKey="services" name="Service-Providing" stroke="#60a5fa" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Brush
                    dataKey="date"
                    startIndex={gvsWageBrush1.start}
                    endIndex={gvsWageBrush1.end}
                    onChange={({ startIndex, endIndex }) =>
                      setGvsWageBrush1(prev => ({ ...prev, period: '', start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
                    {...MINI_BRUSH}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow
              period={gvsWageBrush1.period}
              onSelect={(label, count) => {
                const end = gvsWageLevelData.length - 1
                setGvsWageBrush1({ start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label })
              }}
            />
          </div>

          {/* Chart 2: Wage YoY */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>Goods vs Services Wages — YoY %Δ</div>
                <div className={styles.sectionSubtitle}>AHE, yoy %Δ</div>
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={gvsWageYoyData} margin={{ top: 8, right: 16, bottom: 28, left: 54 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tickFormatter={fmtAxisDate} tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={40} />
                  <YAxis tickFormatter={fmtPct} tick={{ fontSize: 10, fill: '#64748B' }} width={54} domain={['auto', 'auto']} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => [
                      typeof v === 'number' ? `${v >= 0 ? '+' : ''}${fmtPct(v)}` : '-',
                      String(name),
                    ] as [string, string]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Line type="monotone" dataKey="goods"    name="Goods-Producing"   stroke="#ef4444" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Line type="monotone" dataKey="services" name="Service-Providing" stroke="#60a5fa" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Brush
                    dataKey="date"
                    startIndex={gvsWageBrush2.start}
                    endIndex={gvsWageBrush2.end}
                    onChange={({ startIndex, endIndex }) =>
                      setGvsWageBrush2(prev => ({ ...prev, period: '', start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
                    {...MINI_BRUSH}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow
              period={gvsWageBrush2.period}
              onSelect={(label, count) => {
                const end = gvsWageYoyData.length - 1
                setGvsWageBrush2({ start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label })
              }}
            />
          </div>

          {/* Chart 3: Wage MoM */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>Goods vs Services Wages — MoM %Δ</div>
                <div className={styles.sectionSubtitle}>AHE, m/m %Δ</div>
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={gvsWageMomData} margin={{ top: 8, right: 16, bottom: 28, left: 54 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tickFormatter={fmtAxisDate} tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={40} />
                  <YAxis tickFormatter={fmtPct} tick={{ fontSize: 10, fill: '#64748B' }} width={54} domain={['auto', 'auto']} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => [
                      typeof v === 'number' ? `${v >= 0 ? '+' : ''}${fmtPct(v)}` : '-',
                      String(name),
                    ] as [string, string]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Line type="monotone" dataKey="goods"    name="Goods-Producing"   stroke="#ef4444" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Line type="monotone" dataKey="services" name="Service-Providing" stroke="#60a5fa" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Brush
                    dataKey="date"
                    startIndex={gvsWageBrush3.start}
                    endIndex={gvsWageBrush3.end}
                    onChange={({ startIndex, endIndex }) =>
                      setGvsWageBrush3(prev => ({ ...prev, period: '', start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
                    {...MINI_BRUSH}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow
              period={gvsWageBrush3.period}
              onSelect={(label, count) => {
                const end = gvsWageMomData.length - 1
                setGvsWageBrush3({ start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label })
              }}
            />
          </div>

          <div className={styles.majorHeader}>Hours</div>

          {/* ════════════════════════════════════════════════════════════════
              Hours Sector Explorer
          ════════════════════════════════════════════════════════════════ */}

          {/* Selector header */}
          <div className={styles.explorerHeader}>
            <div className={styles.sectionTitle}>Hours Sector Explorer</div>
            <div className={styles.sectorSelectWrap}>
              <span className={styles.lookbackLabel}>Sector</span>
              <select
                className={styles.sectorSelect}
                value={selectedAwhSector}
                onChange={e => setSelectedAwhSector(e.target.value)}
              >
                {AWH_ITEMS.map(item => (
                  <option key={item.id} value={item.id} disabled={item.disabled}>{item.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Chart 1: AWH Level */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>Average Weekly Hours — Level</div>
                <div className={styles.sectionSubtitle}>hours per week</div>
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={awhLevelData} margin={{ top: 8, right: 16, bottom: 28, left: 54 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tickFormatter={fmtAxisDate} tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={40} />
                  <YAxis tickFormatter={fmtHrs} tick={{ fontSize: 10, fill: '#64748B' }} width={54} domain={['auto', 'auto']} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v: unknown) => [typeof v === 'number' ? `${fmtHrs(v)} hrs` : '-', 'AWH'] as [string, string]}
                  />
                  <Line
                    type="monotone" dataKey="value" name="Level"
                    stroke="#4ade80" strokeWidth={1.5}
                    dot={false} isAnimationActive={false} connectNulls
                  />
                  <Brush
                    dataKey="date"
                    startIndex={awhChartBrushes.awhLevel.start}
                    endIndex={awhChartBrushes.awhLevel.end}
                    onChange={({ startIndex, endIndex }) =>
                      handleAwhBrush('awhLevel', startIndex, endIndex)}
                    {...MINI_BRUSH}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow
              period={awhChartBrushes.awhLevel.period}
              onSelect={(l, c) => handleAwhQuickSelect('awhLevel', l, c)}
            />
          </div>

          {/* Chart 2: AWH MoM Change */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>Average Weekly Hours — MoM Change</div>
                <div className={styles.sectionSubtitle}>m/m Δ</div>
              </div>
              <div className={styles.controls}>
                <div className={styles.lookbackWrap}>
                  <span className={styles.lookbackLabel}>MA Window</span>
                  <input
                    type="number" min={1} max={36} value={awhMaWindow}
                    onChange={e => {
                      const n = parseInt(e.target.value)
                      if (!isNaN(n) && n >= 1 && n <= 36) setAwhMaWindow(n)
                    }}
                    className={styles.lookbackInput}
                  />
                </div>
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={awhMomChartData} margin={{ top: 8, right: 16, bottom: 28, left: 54 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tickFormatter={fmtAxisDate} tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={40} />
                  <YAxis tickFormatter={v => v.toFixed(2)} tick={{ fontSize: 10, fill: '#64748B' }} width={54} domain={['auto', 'auto']} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => {
                      const val = typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(2)} hrs` : '-'
                      const lbl = name === 'mom' ? 'MoM Δ' : `${awhMaWindow}mo MA`
                      return [val, lbl] as [string, string]
                    }}
                  />
                  <Bar dataKey="mom" isAnimationActive={false} legendType="none" maxBarSize={16}>
                    {awhMomChartData.map((entry, idx) => (
                      <Cell
                        key={`awh-cell-${idx}`}
                        fill={(entry.mom ?? 0) >= 0 ? 'rgba(167,139,250,0.85)' : 'rgba(192,132,252,0.7)'}
                      />
                    ))}
                  </Bar>
                  <Line
                    type="monotone" dataKey="ma" name="ma"
                    stroke="#fb923c" strokeWidth={1.5}
                    dot={false} isAnimationActive={false} connectNulls legendType="none"
                  />
                  <Brush
                    dataKey="date"
                    startIndex={awhChartBrushes.awhMom.start}
                    endIndex={awhChartBrushes.awhMom.end}
                    onChange={({ startIndex, endIndex }) =>
                      handleAwhBrush('awhMom', startIndex, endIndex)}
                    {...MINI_BRUSH}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow
              period={awhChartBrushes.awhMom.period}
              onSelect={(l, c) => handleAwhQuickSelect('awhMom', l, c)}
            />
          </div>

          {/* ════════════════════════════════════════════════════════════════
              Hours — Goods vs Services
          ════════════════════════════════════════════════════════════════ */}

          <div className={styles.explorerHeader}>
            <div className={styles.sectionTitle}>Goods vs Services</div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>Average Weekly Hours — Goods vs Services</div>
                <div className={styles.sectionSubtitle}>Goods vs Services</div>
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={gvsHoursData} margin={{ top: 8, right: 64, bottom: 28, left: 64 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tickFormatter={fmtAxisDate} tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={40} />
                  <YAxis
                    yAxisId="left"
                    orientation="left"
                    tickFormatter={fmtHrs}
                    tick={{ fontSize: 10, fill: '#ef4444' }}
                    width={54}
                    domain={['auto', 'auto']}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tickFormatter={fmtHrs}
                    tick={{ fontSize: 10, fill: '#60a5fa' }}
                    width={54}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => [
                      typeof v === 'number' ? `${fmtHrs(v)} hrs` : '-',
                      String(name),
                    ] as [string, string]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Line yAxisId="left"  type="monotone" dataKey="goods"    name="Goods-Producing (L)"    stroke="#ef4444" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Line yAxisId="right" type="monotone" dataKey="services" name="Service-Providing (R)"  stroke="#60a5fa" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Brush
                    dataKey="date"
                    startIndex={gvsHoursBrush.start}
                    endIndex={gvsHoursBrush.end}
                    onChange={({ startIndex, endIndex }) =>
                      setGvsHoursBrush(prev => ({ ...prev, period: '', start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
                    {...MINI_BRUSH}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow
              period={gvsHoursBrush.period}
              onSelect={(label, count) => {
                const end = gvsHoursData.length - 1
                setGvsHoursBrush({ start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label })
              }}
            />
          </div>

          <div className={styles.majorHeader}>Aggregate Payrolls</div>

          {/* ════════════════════════════════════════════════════════════════
              Aggregate Payrolls Sector Explorer
          ════════════════════════════════════════════════════════════════ */}

          {/* Selector header */}
          <div className={styles.explorerHeader}>
            <div className={styles.sectionTitle}>Aggregate Payrolls Sector Explorer</div>
            <div className={styles.sectorSelectWrap}>
              <span className={styles.lookbackLabel}>Sector</span>
              <select
                className={styles.sectorSelect}
                value={selectedAggSector}
                onChange={e => setSelectedAggSector(e.target.value)}
              >
                {AGG_PAYROLLS_ITEMS.map(item => (
                  <option key={item.id} value={item.id} disabled={item.disabled}>{item.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Chart 1: Level */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>Aggregate Payrolls — Level</div>
                <div className={styles.sectionSubtitle}>Aggregate Payrolls, $</div>
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={aggPayrollsData} margin={{ top: 8, right: 16, bottom: 28, left: 80 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tickFormatter={fmtAxisDate} tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={40} />
                  <YAxis tickFormatter={fmtAggPayrolls} tick={{ fontSize: 10, fill: '#64748B' }} width={80} domain={['auto', 'auto']} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v: unknown) => [typeof v === 'number' ? fmtAggPayrollsFull(v) : '-', 'Agg. Payrolls'] as [string, string]}
                  />
                  <Line
                    type="monotone" dataKey="value" name="Level"
                    stroke="#4ade80" strokeWidth={1.5}
                    dot={false} isAnimationActive={false} connectNulls
                  />
                  <Brush
                    dataKey="date"
                    startIndex={aggChartBrushes.aggLevel.start}
                    endIndex={aggChartBrushes.aggLevel.end}
                    onChange={({ startIndex, endIndex }) =>
                      handleAggBrush('aggLevel', startIndex, endIndex)}
                    {...MINI_BRUSH}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow
              period={aggChartBrushes.aggLevel.period}
              onSelect={(l, c) => handleAggQuickSelect('aggLevel', l, c)}
            />
          </div>

          {/* Chart 2: YoY */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>Aggregate Payrolls — YoY %Δ</div>
                <div className={styles.sectionSubtitle}>yoy %Δ</div>
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={aggYoyData} margin={{ top: 8, right: 16, bottom: 28, left: 54 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tickFormatter={fmtAxisDate} tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={40} />
                  <YAxis tickFormatter={fmtPct} tick={{ fontSize: 10, fill: '#64748B' }} width={54} domain={['auto', 'auto']} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v: unknown) => [
                      typeof v === 'number' ? `${v >= 0 ? '+' : ''}${fmtPct(v)}` : '-',
                      'YoY %Δ',
                    ] as [string, string]}
                  />
                  <Line
                    type="monotone" dataKey="value" name="YoY %Δ"
                    stroke="#a78bfa" strokeWidth={1.5}
                    dot={false} isAnimationActive={false} connectNulls
                  />
                  <Brush
                    dataKey="date"
                    startIndex={aggChartBrushes.aggYoy.start}
                    endIndex={aggChartBrushes.aggYoy.end}
                    onChange={({ startIndex, endIndex }) =>
                      handleAggBrush('aggYoy', startIndex, endIndex)}
                    {...MINI_BRUSH}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow
              period={aggChartBrushes.aggYoy.period}
              onSelect={(l, c) => handleAggQuickSelect('aggYoy', l, c)}
            />
          </div>

          {/* Chart 3: MoM */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>Aggregate Payrolls — MoM %Δ</div>
                <div className={styles.sectionSubtitle}>m/m %Δ</div>
              </div>
              <div className={styles.controls}>
                <div className={styles.lookbackWrap}>
                  <span className={styles.lookbackLabel}>MA Window</span>
                  <input
                    type="number" min={1} max={36} value={aggMaWindow}
                    onChange={e => {
                      const n = parseInt(e.target.value)
                      if (!isNaN(n) && n >= 1 && n <= 36) setAggMaWindow(n)
                    }}
                    className={styles.lookbackInput}
                  />
                </div>
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={aggMomChartData} margin={{ top: 8, right: 16, bottom: 28, left: 54 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tickFormatter={fmtAxisDate} tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={40} />
                  <YAxis tickFormatter={fmtPct} tick={{ fontSize: 10, fill: '#64748B' }} width={54} domain={['auto', 'auto']} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => {
                      const val = typeof v === 'number' ? `${v >= 0 ? '+' : ''}${fmtPct(v)}` : '-'
                      const lbl = name === 'mom' ? 'MoM %Δ' : `${aggMaWindow}mo MA`
                      return [val, lbl] as [string, string]
                    }}
                  />
                  <Bar dataKey="mom" isAnimationActive={false} legendType="none" maxBarSize={16}>
                    {aggMomChartData.map((entry, idx) => (
                      <Cell
                        key={`agg-cell-${idx}`}
                        fill={(entry.mom ?? 0) >= 0 ? 'rgba(251,146,60,0.8)' : 'rgba(252,165,165,0.75)'}
                      />
                    ))}
                  </Bar>
                  <Line
                    type="monotone" dataKey="ma" name="ma"
                    stroke="#60a5fa" strokeWidth={1.5}
                    dot={false} isAnimationActive={false} connectNulls legendType="none"
                  />
                  <Brush
                    dataKey="date"
                    startIndex={aggChartBrushes.aggMom.start}
                    endIndex={aggChartBrushes.aggMom.end}
                    onChange={({ startIndex, endIndex }) =>
                      handleAggBrush('aggMom', startIndex, endIndex)}
                    {...MINI_BRUSH}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow
              period={aggChartBrushes.aggMom.period}
              onSelect={(l, c) => handleAggQuickSelect('aggMom', l, c)}
            />
          </div>

          {/* ════════════════════════════════════════════════════════════════
              Agg Payrolls — Goods vs Services
          ════════════════════════════════════════════════════════════════ */}

          <div className={styles.explorerHeader}>
            <div className={styles.sectionTitle}>Goods vs Services</div>
          </div>

          {/* Chart 1: Level — dual Y-axis */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>Goods vs Services Agg Payrolls — Level</div>
                <div className={styles.sectionSubtitle}>Goods vs Services Agg Payrolls, $</div>
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={gvsAggLevelData} margin={{ top: 8, right: 80, bottom: 28, left: 80 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tickFormatter={fmtAxisDate} tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={40} />
                  <YAxis
                    yAxisId="left"
                    orientation="left"
                    tickFormatter={fmtAggPayrolls}
                    tick={{ fontSize: 10, fill: '#ef4444' }}
                    width={80}
                    domain={['auto', 'auto']}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tickFormatter={fmtAggPayrolls}
                    tick={{ fontSize: 10, fill: '#60a5fa' }}
                    width={80}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => [
                      typeof v === 'number' ? fmtAggPayrollsFull(v) : '-',
                      String(name),
                    ] as [string, string]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Line yAxisId="left"  type="monotone" dataKey="goods"    name="Goods-Producing"      stroke="#ef4444" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Line yAxisId="right" type="monotone" dataKey="services" name="Service-Providing (R)" stroke="#60a5fa" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Brush
                    dataKey="date"
                    startIndex={gvsAggBrush1.start}
                    endIndex={gvsAggBrush1.end}
                    onChange={({ startIndex, endIndex }) =>
                      setGvsAggBrush1(prev => ({ ...prev, period: '', start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
                    {...MINI_BRUSH}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow
              period={gvsAggBrush1.period}
              onSelect={(label, count) => {
                const end = gvsAggLevelData.length - 1
                setGvsAggBrush1({ start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label })
              }}
            />
          </div>

          {/* Chart 2: YoY */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>Goods vs Services — YoY %Δ</div>
                <div className={styles.sectionSubtitle}>Agg Payrolls, y/y %Δ</div>
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={gvsAggYoyData} margin={{ top: 8, right: 16, bottom: 28, left: 54 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tickFormatter={fmtAxisDate} tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={40} />
                  <YAxis tickFormatter={fmtPct} tick={{ fontSize: 10, fill: '#64748B' }} width={54} domain={['auto', 'auto']} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => [
                      typeof v === 'number' ? `${v >= 0 ? '+' : ''}${fmtPct(v)}` : '-',
                      String(name),
                    ] as [string, string]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Line type="monotone" dataKey="goods"    name="Goods-Producing"   stroke="#ef4444" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Line type="monotone" dataKey="services" name="Service-Providing"  stroke="#60a5fa" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Brush
                    dataKey="date"
                    startIndex={gvsAggBrush2.start}
                    endIndex={gvsAggBrush2.end}
                    onChange={({ startIndex, endIndex }) =>
                      setGvsAggBrush2(prev => ({ ...prev, period: '', start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
                    {...MINI_BRUSH}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow
              period={gvsAggBrush2.period}
              onSelect={(label, count) => {
                const end = gvsAggYoyData.length - 1
                setGvsAggBrush2({ start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label })
              }}
            />
          </div>

          {/* Chart 3: MoM */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>Goods vs Services — MoM %Δ</div>
                <div className={styles.sectionSubtitle}>Agg Payrolls, m/m %Δ</div>
              </div>
            </div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={gvsAggMomData} margin={{ top: 8, right: 16, bottom: 28, left: 54 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tickFormatter={fmtAxisDate} tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={40} />
                  <YAxis tickFormatter={fmtPct} tick={{ fontSize: 10, fill: '#64748B' }} width={54} domain={['auto', 'auto']} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v: unknown, name: unknown) => [
                      typeof v === 'number' ? `${v >= 0 ? '+' : ''}${fmtPct(v)}` : '-',
                      String(name),
                    ] as [string, string]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Line type="monotone" dataKey="goods"    name="Goods-Producing"   stroke="#ef4444" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Line type="monotone" dataKey="services" name="Service-Providing"  stroke="#60a5fa" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Brush
                    dataKey="date"
                    startIndex={gvsAggBrush3.start}
                    endIndex={gvsAggBrush3.end}
                    onChange={({ startIndex, endIndex }) =>
                      setGvsAggBrush3(prev => ({ ...prev, period: '', start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
                    {...MINI_BRUSH}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <QuickSelectRow
              period={gvsAggBrush3.period}
              onSelect={(label, count) => {
                const end = gvsAggMomData.length - 1
                setGvsAggBrush3({ start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label })
              }}
            />
          </div>

        </>)}
    </div>
  )
}

export function CESDashboardPage() {
  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.barLeft}>
          <NavDropdown />
          <span className={styles.logo}>TND RESEARCH TERMINAL</span>
        </div>
        <div className={styles.barCenter} />
        <div className={styles.barRight}><FredRefreshButton /></div>
      </header>

      <nav className={styles.breadcrumb}>
        <Link to="/models" className={styles.breadcrumbLink}>Models</Link>
        <span className={styles.breadcrumbSep}>›</span>
        <Link to="/models/labor" className={styles.breadcrumbLink}>Labor Market</Link>
        <span className={styles.breadcrumbSep}>›</span>
        <span className={styles.breadcrumbCurrent}>CES Dashboard</span>
      </nav>

      <main className={styles.body}>
        <CESDashboardContent />
      </main>
    </div>
  )
}
