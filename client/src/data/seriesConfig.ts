import {
  toValid, lastObsDate, lastObsRawDate, nthLast,
  yoyPct, annualisedGrowth, pctChange,
  latestMomChange, prevMomChange, avgMomChange,
  buildYoyHistory,
  fmtPct, fmtPctLvl, fmtK, dirOf,
} from '../lib/transforms'
import type { FredObservation } from '../lib/fred'
import type { LiveRow } from '../types'

export interface SeriesDef {
  fredId:     string
  label:      string
  panelId:    string
  frequency?:  string
  aggMethod?:  string
  staleFreq?:  'daily' | 'weekly' | 'monthly' | 'quarterly'
  compute: (raw: FredObservation[]) => Omit<LiveRow, 'id' | 'label' | 'status' | 'seriesFreq'>
}

export const SERIES_DEFS: SeriesDef[] = [

  // ── Growth ───────────────────────────────────────────────────────────────────
  // Quarterly series. annualisedGrowth(obs, 3) computes (q/q-1)^4 − 1, which is
  // the standard SAAR formula.  findMonthsAgo handles quarterly dates by matching
  // on YYYY-MM, so no special frequency wiring is needed.
  {
    fredId:    'GDP',
    label:     'Nominal GDP',
    panelId:   'growth',
    staleFreq: 'quarterly',
    compute(raw) {
      const obs     = toValid(raw)
      const obsPrev = obs.slice(0, -1)          // drop latest to reference prev quarter
      const currQoQ = annualisedGrowth(obs, 3)  // current quarter SAAR
      const prevQoQ = annualisedGrowth(obsPrev, 3) // prior quarter SAAR
      const yoy     = yoyPct(obs)
      return {
        lastDate:    lastObsDate(obs),
        lastRawDate: lastObsRawDate(obs),
        regimeHistory: buildYoyHistory(obs),
        cells: [
          { sub: '',           val: '—' },
          { sub: 'Prev QoQ a', val: fmtPct(prevQoQ), dir: dirOf(prevQoQ), pos: 'up' },
          { sub: 'QoQ Ann',    val: fmtPct(currQoQ), dir: dirOf(currQoQ), pos: 'up' },
          { sub: 'YoY',        val: fmtPct(yoy),     dir: dirOf(yoy),     pos: 'up' },
        ],
      }
    },
  },
  {
    fredId:    'GDPC1',
    label:     'Real GDP',
    panelId:   'growth',
    staleFreq: 'quarterly',
    compute(raw) {
      const obs     = toValid(raw)
      const obsPrev = obs.slice(0, -1)
      const currQoQ = annualisedGrowth(obs, 3)
      const prevQoQ = annualisedGrowth(obsPrev, 3)
      const yoy     = yoyPct(obs)
      return {
        lastDate:    lastObsDate(obs),
        lastRawDate: lastObsRawDate(obs),
        regimeHistory: buildYoyHistory(obs),
        cells: [
          { sub: '',           val: '—' },
          { sub: 'Prev QoQ a', val: fmtPct(prevQoQ), dir: dirOf(prevQoQ), pos: 'up' },
          { sub: 'QoQ Ann',    val: fmtPct(currQoQ), dir: dirOf(currQoQ), pos: 'up' },
          { sub: 'YoY',        val: fmtPct(yoy),     dir: dirOf(yoy),     pos: 'up' },
        ],
      }
    },
  },

  // ── Inflation ─────────────────────────────────────────────────────────────────
  {
    fredId:  'PCEPILFE',
    label:   'Core PCE',
    panelId: 'inflation',
    compute(raw) {
      const obs = toValid(raw)
      const yoy = yoyPct(obs)
      const d6a = annualisedGrowth(obs, 6)
      const d3a = annualisedGrowth(obs, 3)
      const mom = pctChange(obs, 1)
      return {
        lastDate:    lastObsDate(obs),
        lastRawDate: lastObsRawDate(obs),
        regimeHistory: buildYoyHistory(obs),
        cells: [
          { sub: 'YoY',    val: fmtPct(yoy), dir: dirOf(yoy), pos: 'down' },
          { sub: '6mo Δa', val: fmtPct(d6a), dir: dirOf(d6a), pos: 'down' },
          { sub: '3mo Δa', val: fmtPct(d3a), dir: dirOf(d3a), pos: 'down' },
          { sub: 'MoM',    val: fmtPct(mom), dir: dirOf(mom), pos: 'down' },
        ],
      }
    },
  },
  {
    fredId:  'CPILFESL',
    label:   'Core CPI',
    panelId: 'inflation',
    compute(raw) {
      const obs = toValid(raw)
      const yoy = yoyPct(obs)
      const d6a = annualisedGrowth(obs, 6)
      const d3a = annualisedGrowth(obs, 3)
      const mom = pctChange(obs, 1)
      return {
        lastDate:    lastObsDate(obs),
        lastRawDate: lastObsRawDate(obs),
        regimeHistory: buildYoyHistory(obs),
        cells: [
          { sub: 'YoY',    val: fmtPct(yoy), dir: dirOf(yoy), pos: 'down' },
          { sub: '6mo Δa', val: fmtPct(d6a), dir: dirOf(d6a), pos: 'down' },
          { sub: '3mo Δa', val: fmtPct(d3a), dir: dirOf(d3a), pos: 'down' },
          { sub: 'MoM',    val: fmtPct(mom), dir: dirOf(mom), pos: 'down' },
        ],
      }
    },
  },
  {
    fredId:  'CES0500000003',
    label:   'Avg Hourly Earnings',
    panelId: 'inflation',
    compute(raw) {
      const obs = toValid(raw)
      const yoy = yoyPct(obs)
      const d6a = annualisedGrowth(obs, 6)
      const d3a = annualisedGrowth(obs, 3)
      const mom = pctChange(obs, 1)
      return {
        lastDate:    lastObsDate(obs),
        lastRawDate: lastObsRawDate(obs),
        regimeHistory: buildYoyHistory(obs),
        cells: [
          { sub: 'YoY',    val: fmtPct(yoy), dir: dirOf(yoy), pos: 'down' },
          { sub: '6mo Δa', val: fmtPct(d6a), dir: dirOf(d6a), pos: 'down' },
          { sub: '3mo Δa', val: fmtPct(d3a), dir: dirOf(d3a), pos: 'down' },
          { sub: 'MoM',    val: fmtPct(mom), dir: dirOf(mom), pos: 'down' },
        ],
      }
    },
  },

  // ── Labor Market ──────────────────────────────────────────────────────────────
  {
    fredId:  'UNRATE',
    label:   'Unemployment Rate',
    panelId: 'labor',
    compute(raw) {
      const obs = toValid(raw)
      return {
        lastDate:    lastObsDate(obs),
        lastRawDate: lastObsRawDate(obs),
        regimeHistory: obs.map(o => o.value),  // level-based MA signal, not YoY%
        cells: [
          { sub: '6mo Lag',  val: fmtPctLvl(nthLast(obs, 6), 1) },
          { sub: '3mo Lag',  val: fmtPctLvl(nthLast(obs, 3), 1) },
          { sub: 'Previous', val: fmtPctLvl(nthLast(obs, 1), 1) },
          { sub: 'Current',  val: fmtPctLvl(nthLast(obs, 0), 1) },
        ],
      }
    },
  },
  {
    fredId:  'PAYEMS',
    label:   'Nonfarm Payrolls',
    panelId: 'labor',
    compute(raw) {
      const obs  = toValid(raw)
      const curr = latestMomChange(obs)
      const prev = prevMomChange(obs)
      const av6  = avgMomChange(obs, 6)
      const av3  = avgMomChange(obs, 3)
      return {
        lastDate:    lastObsDate(obs),
        lastRawDate: lastObsRawDate(obs),
        regimeHistory: buildYoyHistory(obs),
        cells: [
          { sub: 'Previous', val: fmtK(prev), dir: dirOf(prev), pos: 'up' },
          { sub: 'Current',  val: fmtK(curr), dir: dirOf(curr), pos: 'up' },
          { sub: '6mo Avg',  val: fmtK(av6) },
          { sub: '3mo Avg',  val: fmtK(av3) },
        ],
      }
    },
  },

  // ── Consumer ──────────────────────────────────────────────────────────────────
  {
    fredId:  'RPI',
    label:   'Real Personal Income',
    panelId: 'consumer',
    compute(raw) {
      const obs = toValid(raw)
      const yoy = yoyPct(obs)
      const d6a = annualisedGrowth(obs, 6)
      const d3a = annualisedGrowth(obs, 3)
      const mom = pctChange(obs, 1)
      return {
        lastDate:    lastObsDate(obs),
        lastRawDate: lastObsRawDate(obs),
        regimeHistory: buildYoyHistory(obs),
        cells: [
          { sub: 'YoY',    val: fmtPct(yoy), dir: dirOf(yoy), pos: 'up' },
          { sub: '6mo Δa', val: fmtPct(d6a), dir: dirOf(d6a), pos: 'up' },
          { sub: '3mo Δa', val: fmtPct(d3a), dir: dirOf(d3a), pos: 'up' },
          { sub: 'MoM',    val: fmtPct(mom), dir: dirOf(mom), pos: 'up' },
        ],
      }
    },
  },
  {
    fredId:  'DPCERA3M086SBEA',
    label:   'Real PCE',
    panelId: 'consumer',
    compute(raw) {
      const obs = toValid(raw)
      const yoy = yoyPct(obs)
      const d6a = annualisedGrowth(obs, 6)
      const d3a = annualisedGrowth(obs, 3)
      const mom = pctChange(obs, 1)
      return {
        lastDate:    lastObsDate(obs),
        lastRawDate: lastObsRawDate(obs),
        regimeHistory: buildYoyHistory(obs),
        cells: [
          { sub: 'YoY',    val: fmtPct(yoy), dir: dirOf(yoy), pos: 'up' },
          { sub: '6mo Δa', val: fmtPct(d6a), dir: dirOf(d6a), pos: 'up' },
          { sub: '3mo Δa', val: fmtPct(d3a), dir: dirOf(d3a), pos: 'up' },
          { sub: 'MoM',    val: fmtPct(mom), dir: dirOf(mom), pos: 'up' },
        ],
      }
    },
  },
  {
    fredId:  'RSXFS',
    label:   'Retail Sales',
    panelId: 'consumer',
    compute(raw) {
      const obs = toValid(raw)
      const yoy = yoyPct(obs)
      const d6a = annualisedGrowth(obs, 6)
      const d3a = annualisedGrowth(obs, 3)
      const mom = pctChange(obs, 1)
      return {
        lastDate:    lastObsDate(obs),
        lastRawDate: lastObsRawDate(obs),
        regimeHistory: buildYoyHistory(obs),
        cells: [
          { sub: 'YoY',    val: fmtPct(yoy), dir: dirOf(yoy), pos: 'up' },
          { sub: '6mo Δa', val: fmtPct(d6a), dir: dirOf(d6a), pos: 'up' },
          { sub: '3mo Δa', val: fmtPct(d3a), dir: dirOf(d3a), pos: 'up' },
          { sub: 'MoM',    val: fmtPct(mom), dir: dirOf(mom), pos: 'up' },
        ],
      }
    },
  },

  // ── Industry ──────────────────────────────────────────────────────────────────
  {
    fredId:  'INDPRO',
    label:   'Industrial Production',
    panelId: 'industry',
    compute(raw) {
      const obs = toValid(raw)
      const yoy = yoyPct(obs)
      const d6a = annualisedGrowth(obs, 6)
      const d3a = annualisedGrowth(obs, 3)
      const mom = pctChange(obs, 1)
      return {
        lastDate:    lastObsDate(obs),
        lastRawDate: lastObsRawDate(obs),
        regimeHistory: buildYoyHistory(obs),
        cells: [
          { sub: 'YoY',    val: fmtPct(yoy), dir: dirOf(yoy), pos: 'up' },
          { sub: '6mo Δa', val: fmtPct(d6a), dir: dirOf(d6a), pos: 'up' },
          { sub: '3mo Δa', val: fmtPct(d3a), dir: dirOf(d3a), pos: 'up' },
          { sub: 'MoM',    val: fmtPct(mom), dir: dirOf(mom), pos: 'up' },
        ],
      }
    },
  },
  {
    fredId:  'DGORDER',
    label:   'Durable Goods Orders',
    panelId: 'industry',
    compute(raw) {
      const obs = toValid(raw)
      const yoy = yoyPct(obs)
      const d6a = annualisedGrowth(obs, 6)
      const d3a = annualisedGrowth(obs, 3)
      const mom = pctChange(obs, 1)
      return {
        lastDate:    lastObsDate(obs),
        lastRawDate: lastObsRawDate(obs),
        regimeHistory: buildYoyHistory(obs),
        cells: [
          { sub: 'YoY',    val: fmtPct(yoy), dir: dirOf(yoy), pos: 'up' },
          { sub: '6mo Δa', val: fmtPct(d6a), dir: dirOf(d6a), pos: 'up' },
          { sub: '3mo Δa', val: fmtPct(d3a), dir: dirOf(d3a), pos: 'up' },
          { sub: 'MoM',    val: fmtPct(mom), dir: dirOf(mom), pos: 'up' },
        ],
      }
    },
  },
]
