// @vitest-environment happy-dom
//
// Rule 6 clarification (R2d approval, Decision 1): LEVELS get no colour —
// spread, butterfly and breakeven / real spread levels on UST CURVE render as
// plain primary text — while CHANGES follow rule 6 (increase = negative/red,
// decrease = positive/green). Identity colour stays on tile labels only.
//
// FRED is mocked with synthetic yields chosen so the level tiles carry both
// signs (an inverted 2s10s, a positive 3m2s, flies either side of zero) and
// the day-on-day changes carry both signs too. Other FRED series resolve empty;
// every other fetch is held pending.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, act, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { FredObservation } from '../lib/fred'

// [previous, latest] in %. Latest curve: 3M 4.00, 1Y 4.60, 2Y 5.00, 5Y 4.40, 7Y 4.50, 10Y 4.70, 30Y 4.90.
const YIELDS: Record<string, [number, number]> = {
  DGS1MO: [3.95, 3.95], DGS3MO: [4.05, 4.0], DGS6MO: [4.3, 4.3], DGS1: [4.55, 4.6], DGS2: [4.9, 5.0],
  DGS5: [4.5, 4.4], DGS7: [4.5, 4.5], DGS10: [4.6, 4.7], DGS20: [4.8, 4.8], DGS30: [4.95, 4.9],
  T5YIE: [2.3, 2.4], T10YIE: [2.35, 2.3],
}
function series(id: string): FredObservation[] {
  const v = YIELDS[id]
  if (!v) return []
  // 40 business-ish days of history, flat at `previous`, then the latest print.
  const out: FredObservation[] = []
  for (let i = 40; i >= 1; i--) {
    const d = new Date(Date.UTC(2026, 9, 26) - i * 86_400_000)
    out.push({ date: d.toISOString().slice(0, 10), value: String(i === 1 ? v[1] : v[0]) })
  }
  return out
}

vi.mock('../lib/fred', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/fred')>()
  return {
    ...actual,
    // UST series get synthetic data; every other series resolves empty (UST's Promise.all includes extras).
    fetchFredSeries: (id: string) => Promise.resolve(series(id)),
  }
})
vi.mock('../lib/bea', () => ({ fetchBEASeries: () => new Promise(() => undefined) }))

const { STIRDashboardPage } = await import('./STIRDashboardPage')

beforeEach(() => { vi.stubGlobal('fetch', () => new Promise<Response>(() => undefined)) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const has = (el: Element, local: string) => [...el.classList].some(c => c === local || new RegExp(`^_?${local}_`).test(c))
const TONES = ['positive', 'negative', 'dirUp', 'dirDown']
const tone = (el: Element) => TONES.filter(c => has(el, c))

async function openUst(): Promise<HTMLElement> {
  const { container } = render(<MemoryRouter><STIRDashboardPage /></MemoryRouter>)
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  for (const label of ['RATES', 'US', 'UST CURVE']) {
    const btn = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === label)!
    await act(async () => { fireEvent.click(btn) })
  }
  await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  return container.querySelector('main') as HTMLElement
}

/** UST tiles: [label, value, change] spans inside an aria-pressed button. */
const tiles = (main: HTMLElement) => [...main.querySelectorAll('button[aria-pressed]')]
  .filter(b => b.children.length === 3)
  .map(b => { const [label, value, change] = [...b.children]; return { label: label.textContent ?? '', value, change } })

const IS_LEVEL = /^\d+[ms]\d+s/ // 3m2s, 2s10s, 2s5s10s, 5s10s real, 5s10s BE

describe('UST CURVE — levels get no colour, changes follow rule 6', () => {
  it('spread, butterfly and real / BE spread level values carry no sign tone', async () => {
    const all = tiles(await openUst())
    const levels = all.filter(t => IS_LEVEL.test(t.label))
    expect(levels.map(t => t.label)).toEqual(expect.arrayContaining(['2s10s', '3m2s', '5s10s real', '5s10s BE']))
    expect(levels.some(t => t.label.split('s').length === 4), 'at least one butterfly').toBe(true)
    // both signs of level are exercised
    expect(levels.some(t => t.value.textContent?.startsWith('+'))).toBe(true)
    expect(levels.some(t => t.value.textContent?.startsWith('-'))).toBe(true)
    for (const t of levels) expect(tone(t.value), `${t.label} = ${t.value.textContent}`).toEqual([])
  })

  it('changes on every tile follow rule 6: increase = negative, decrease = positive, zero untoned', async () => {
    const all = tiles(await openUst())
    expect(all.length).toBeGreaterThanOrEqual(7 + 9 + 3 + 3 + 3)
    let up = 0, down = 0
    for (const t of all) {
      const txt = t.change.textContent ?? ''
      const v = Number.parseFloat(txt)
      const want = !Number.isFinite(v) || v === 0 ? [] : v > 0 ? ['negative'] : ['positive']
      if (want[0] === 'negative') up++
      if (want[0] === 'positive') down++
      expect(tone(t.change), `${t.label} change ${txt}`).toEqual(want)
    }
    expect(up > 0 && down > 0, 'both signs of change exercised').toBe(true)
  })
})
