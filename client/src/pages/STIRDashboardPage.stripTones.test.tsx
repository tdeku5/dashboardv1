// @vitest-environment happy-dom
//
// Pins the rates colour rule (R2b approval; docs/asset-class-models-design-notes.md,
// colour rule 6) on the converted STIR STRIPS and FORWARD PRICING views:
//
//   • every yield / rate / spread change is VALENCE in the bond-price view —
//     increase = negative (red), decrease = positive (green); hike = red,
//     cut = green; futures price up (rate down) = positive;
//   • the strip implied-rate Δ columns AND the FF price-change cells are
//     named heatmap #3: valence heat fill by price sign, primary text, no
//     tone, no alert;
//   • NEXT MOVE, Terminal−OCR, ±OCR, calendar spreads, the FORWARD PRICING
//     summary table and its "Change vs benchmark" bars all follow the rule;
//   • no direction tone appears anywhere in these views.
//
// Data hooks are mocked with a fixed strip and curve; every other fetch is
// held pending. ResponsiveContainer is given a fixed size so the bar chart
// actually renders its bars in happy-dom.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { render, fireEvent, act, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { StripContract } from '../hooks/useFuturesStrip'
import type { FuturesCurvePoint } from '../hooks/useFuturesCurve'

// price changes chosen so each column has both signs, a zero and a null;
// column max |Δ| is 0.08 for every column.
const PX: Array<[number | null, number | null, number | null]> = [
  [0.08, -0.08, 0],
  [-0.01, 0.03, -0.05],
  [0.05, null, 0.08],
  [-0.03, 0.0, -0.08],
  [0.02, 0.06, 0.01],
  [-0.06, -0.02, 0.04],
  [0, 0.01, -0.02],
  [0.04, -0.04, null],
]
const CODES = ['H', 'M', 'U', 'Z']
const MONTH = { H: '03', M: '06', U: '09', Z: '12' } as const
// 4.00 → 3.90 → … falling: NEXT MOVE = CUT; spreads (back − front) negative.
const CONTRACTS: StripContract[] = PX.map(([d1, d5, m1], i) => ({
  symbol: `/X${CODES[i % 4]}${7 + Math.floor(i / 4)}`,
  monthCode: CODES[i % 4],
  year: 2027 + Math.floor(i / 4),
  expiryLabel: `${CODES[i % 4]} ${2027 + Math.floor(i / 4)}`,
  lastPrice: 96 + i * 0.1,
  impliedRate: 4 - i * 0.1,
  volume: 1000,
  openInterest: 5000,
  pxChg1d: d1,
  pxChg5d: d5,
  pxChg1m: m1,
  oiChg: 0,
}))
/** Strip served by the mocked hook; one test swaps in a rising strip (NEXT MOVE = HIKE). */
let stripServed: StripContract[] = CONTRACTS
const EFFR = 3.75 // ±OCR: first contracts above (rate up → negative), later ones below (positive)

// Forward curve: latest vs benchmark, alternating Δ sign (+10bp, −10bp, …).
const curvePoint = (c: StripContract, rate: number): FuturesCurvePoint => ({
  symbol: c.symbol, monthCode: c.monthCode, year: c.year, expiryLabel: c.expiryLabel,
  expiryDate: `${c.year}-${MONTH[c.monthCode as keyof typeof MONTH]}-15`,
  lastPrice: 100 - rate, impliedRate: rate, volume: null, openInterest: null,
})
const CURRENT = CONTRACTS.map(c => curvePoint(c, c.impliedRate))
const LOOKBACK = CONTRACTS.map((c, i) => curvePoint(c, c.impliedRate + (i % 2 === 0 ? -0.1 : 0.1)))
const DELTA_SIGN = CONTRACTS.map((_, i) => (i % 2 === 0 ? 1 : -1)) // latest − benchmark

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      isValidElement(children) ? cloneElement(children as ReactElement<{ width: number; height: number }>, { width: 800, height: 300 }) : null,
  }
})
vi.mock('../hooks/useFuturesStrip', () => ({
  useFuturesStrip: (root: string) => ({
    data: { rootSymbol: root, latestDate: '2026-10-14', lookbackDates: { '1d': null, '5d': null, '1m': null }, contracts: stripServed },
    loading: false,
    error: null,
  }),
}))
vi.mock('../hooks/useFedWatch', () => ({
  useFedWatch: () => ({
    asOfDate: '2026-10-14', currentEFFR: EFFR, currentPolicyRate: EFFR, currentTargetRange: '',
    meetings: [], cumulativeProbabilities: [], rangeColumns: [], proxyToPolicySpread: 0, proxyToPolicySpreadSource: '',
    loading: false, error: null,
  }),
}))
vi.mock('../hooks/useFuturesCurve', () => ({
  useFuturesCurve: (root: string, lookbackDays: number) => ({
    currentCurve: CURRENT, lookbackCurve: LOOKBACK, currentDate: '2026-10-14', lookbackDate: '2026-10-07', availableDates: [],
    lookbackDays, rootSymbol: root, trimmedStaleSymbols: [], lastGoodContract: null, loading: false, error: null,
  }),
}))

const { STIRDashboardPage } = await import('./STIRDashboardPage')

beforeEach(() => { vi.stubGlobal('fetch', () => new Promise<Response>(() => undefined)) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); stripServed = CONTRACTS })

const click = async (root: HTMLElement, label: string) => {
  const btns = [...root.querySelectorAll('button')].filter(b => b.textContent?.trim() === label)
  expect(btns, label).toHaveLength(1)
  await act(async () => { fireEvent.click(btns[0]) })
}

async function openView(country: string, view: string, product?: string): Promise<HTMLElement> {
  const { container } = render(<MemoryRouter><STIRDashboardPage /></MemoryRouter>)
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  for (const l of ['RATES', country, view]) await click(container, l)
  if (product) await click(container, product)
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  return container.querySelector('main') as HTMLElement
}

// CSS-module class names are matched by their local name, whatever the hash.
const has = (el: Element, local: string) => [...el.classList].some(c => c === local || new RegExp(`^_?${local}_`).test(c))
const VALENCE = ['positive', 'negative']
const DIRECTION = ['dirUp', 'dirDown']
const HEAT_POS = [1, 2, 3, 4].map(n => `stripHeatPositive${n}`)
const HEAT_NEG = [1, 2, 3, 4].map(n => `stripHeatNegative${n}`)
const tone = (el: Element) => [...VALENCE, ...DIRECTION].filter(c => has(el, c))
/** Rate / spread change → expected tone under the rates rule. */
const rateTone = (v: number) => (Math.abs(v) < 1e-9 ? [] : [v > 0 ? 'negative' : 'positive'])

/** The strip table's move cells, in row order: [pxChg1d, pxChg5d, pxChg1m] per contract. */
const moveCells = (main: HTMLElement) => [...main.querySelectorAll('td[data-strip-move]')]

function expectHeatCells(main: HTMLElement) {
  const cells = moveCells(main)
  expect(cells).toHaveLength(PX.length * 3)
  cells.forEach((td, k) => {
    const px = PX[Math.floor(k / 3)][k % 3]
    const pos = HEAT_POS.filter(c => has(td, c)), neg = HEAT_NEG.filter(c => has(td, c))
    if (px == null || px === 0) {
      expect([...pos, ...neg], `cell ${k} (${px}) has no fill`).toEqual([])
      expect(has(td, 'muted'), `cell ${k} (${px}) is muted`).toBe(true)
    } else if (px > 0) {
      expect(pos, `cell ${k} price up → positive fill`).toHaveLength(1)
      expect(neg).toEqual([])
    } else {
      expect(neg, `cell ${k} price down → negative fill`).toHaveLength(1)
      expect(pos).toEqual([])
    }
    // heatmap rule: text stays primary — no sign tone, no alert on the cell
    expect([...VALENCE, ...DIRECTION, 'alertMild', 'alertStrong'].filter(c => has(td, c))).toEqual([])
  })
  // quartile-of-column-max buckets: column max |Δ| = 0.08 → 0.08 step 4, 0.01 step 1, 0.03 step 2, 0.05 step 3
  const step = (row: number, col: number) => [...HEAT_POS, ...HEAT_NEG].find(c => has(cells[row * 3 + col], c))
  expect(step(0, 0)).toBe('stripHeatPositive4')
  expect(step(1, 0)).toBe('stripHeatNegative1')
  expect(step(1, 1)).toBe('stripHeatPositive2')
  expect(step(1, 2)).toBe('stripHeatNegative3')
  expect(step(3, 2)).toBe('stripHeatNegative4')
}

describe('STIR STRIPS — strip move cells are named heatmap #3 (valence, price view)', () => {
  for (const country of ['US', 'EU']) {
    it(`${country} implied-rate Δ columns: valence heat fill by price sign, primary text, ≤ 4 steps`, async () => {
      expectHeatCells(await openView(country, 'STIR STRIPS'))
    })
  }

  it('US FED FUNDS price-change cells: the same valence heat fills, primary text', async () => {
    expectHeatCells(await openView('US', 'STIR STRIPS', 'FED FUNDS'))
  })
})

describe('STIR STRIPS — NEXT MOVE, OCR and calendar spreads follow the rates rule (increase = red)', () => {
  for (const country of ['US', 'EU']) {
    it(`${country}: hike/cut, Terminal−OCR, ±OCR and calendar spreads are valence, increase = negative`, async () => {
      const main = await openView(country, 'STIR STRIPS')

      const boxes = [...main.querySelectorAll('div')].filter(d => has(d, 'summaryBox'))
      const value = (label: string) => {
        const box = boxes.find(b => b.querySelector('div')?.textContent === label)!
        return box.querySelectorAll('div')[1]
      }
      expect(value('NEXT MOVE').textContent).toBe('CUT')
      expect(tone(value('NEXT MOVE')), 'cut = green').toEqual(['positive'])
      // terminal = lowest implied rate (3.30) vs EFFR 3.75 → −45bp → decrease → positive
      expect(tone(value('Terminal - OCR'))).toEqual(['positive'])

      // ±OCR column: the cell before each row's first move cell
      const ocr = [...main.querySelectorAll('td[data-strip-move]')]
        .filter((_, k) => k % 3 === 0).map(td => td.previousElementSibling!)
      expect(ocr).toHaveLength(PX.length)
      ocr.forEach((td, i) => {
        const bps = (CONTRACTS[i].impliedRate - EFFR) * 100
        expect(tone(td), `±OCR row ${i} (${bps.toFixed(1)})`).toEqual(rateTone(bps))
      })
      expect(ocr.some(td => has(td, 'negative')) && ocr.some(td => has(td, 'positive')), 'both signs exercised').toBe(true)

      // calendar spreads: back − front is negative here → every value cell positive (green)
      const calTables = [...main.querySelectorAll('table')].filter(t => has(t, 'calTable'))
      const valueCells = calTables.flatMap(t => [...t.querySelectorAll<HTMLTableRowElement>('tbody tr')].map(r => r.cells[1]))
      expect(valueCells.length).toBeGreaterThan(0)
      for (const td of valueCells) expect(tone(td), td.textContent ?? '').toEqual(['positive'])
      // Δ cells: tone follows the printed sign (increase = negative)
      const deltaCells = calTables.flatMap(t => [...t.querySelectorAll<HTMLTableRowElement>('tbody tr')].flatMap(r => [...r.cells].slice(2)))
      const toned = deltaCells.filter(td => tone(td).length > 0)
      expect(toned.length, 'some Δ cells are toned').toBeGreaterThan(0)
      for (const td of toned) {
        const v = Number(td.textContent)
        expect(tone(td), td.textContent ?? '').toEqual(v > 0 || td.textContent?.startsWith('+') ? ['negative'] : ['positive'])
      }

      expect(main.querySelectorAll('[class*="dirUp"], [class*="dirDown"]'), 'no direction tone in STIR STRIPS').toHaveLength(0)
    })
  }
})

describe('STIR STRIPS — a priced hike is red', () => {
  it('US rising strip: NEXT MOVE = HIKE → negative; Terminal−OCR above cash → negative', async () => {
    stripServed = CONTRACTS.map((c, i) => ({ ...c, impliedRate: 3.8 + i * 0.1 }))
    const main = await openView('US', 'STIR STRIPS')
    const boxes = [...main.querySelectorAll('div')].filter(d => has(d, 'summaryBox'))
    const value = (label: string) => boxes.find(b => b.querySelector('div')?.textContent === label)!.querySelectorAll('div')[1]
    expect(value('NEXT MOVE').textContent).toBe('HIKE')
    expect(tone(value('NEXT MOVE')), 'hike = red').toEqual(['negative'])
    expect(tone(value('Terminal - OCR'))).toEqual(['negative'])
  })
})

describe('FORWARD PRICING — summary table and Δ bars follow the rates rule', () => {
  for (const country of ['US', 'EU']) {
    it(`${country}: bps / implied-move / summary cells and Change-vs-benchmark bars are valence, increase = red`, async () => {
      const main = await openView(country, 'FORWARD PRICING')

      // summary table (contract fallback: falling curve → cuts, vs EFFR both signs)
      const table = [...main.querySelectorAll('table')].find(t => t.querySelector('th')?.textContent === 'Meeting')!
      expect(table).toBeTruthy()
      const rows = [...table.querySelectorAll<HTMLTableRowElement>('tbody tr')]
      expect(rows.length).toBeGreaterThan(2)
      let checked = 0
      for (const r of rows) {
        for (const td of [...r.cells].slice(2)) {
          const span = td.querySelector('span')!
          const text = span.textContent ?? ''
          const expected = /Hike$/.test(text) || /^\+/.test(text) ? ['negative']
            : /Cut$/.test(text) || /^-/.test(text) ? ['positive'] : []
          expect(tone(span), `${r.cells[0].textContent} ${text}`).toEqual(expected)
          checked += expected.length
        }
      }
      expect(checked, 'toned summary cells exercised').toBeGreaterThan(5)

      // Δ bars: latest − benchmark alternates +10 / −10 bp
      const fills = [...main.querySelectorAll('.recharts-bar-rectangle path')].map(p => p.getAttribute('fill'))
      expect(fills).toHaveLength(CONTRACTS.length)
      fills.forEach((f, i) => expect(f, `bar ${i}`).toBe(DELTA_SIGN[i] > 0 ? 'var(--acm-negative)' : 'var(--acm-positive)'))

      // legend swatches
      const swatch = (label: string) => [...main.querySelectorAll('li')].find(li => li.textContent === label)
        ?.querySelector<HTMLElement>('span[aria-hidden]')?.style.getPropertyValue('--acm-swatch')
      expect(swatch('Rate up')).toBe('var(--acm-negative)')
      expect(swatch('Rate down')).toBe('var(--acm-positive)')

      expect(main.innerHTML, 'no direction token in FORWARD PRICING').not.toMatch(/acm-dir-|dirUp|dirDown/)
    })
  }
})
