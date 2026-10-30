// @vitest-environment happy-dom
// M1: VolSummaryTable z-scores use the alert family as a cell tint + outline
// only (|z| > 2 mild, |z| > 3 strong; Phase 0 Decision 2); text stays primary,
// no sign tone; vol point changes and IV rank / percentile render plain
// pending the user's classification.
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { VolSummaryTable, zAlertLevel } from './VolSummaryTable'
import type { CavSummaryResponse } from '../hooks/useCavSummary'

afterEach(() => cleanup())

describe('zAlertLevel', () => {
  it('|z| > 2 mild, |z| > 3 strong, otherwise none (on the displayed 2dp value)', () => {
    expect(zAlertLevel(1.99)).toBeUndefined()
    expect(zAlertLevel(2.0)).toBeUndefined()
    expect(zAlertLevel(2.004)).toBeUndefined()
    expect(zAlertLevel(2.01)).toBe('mild')
    expect(zAlertLevel(-2.5)).toBe('mild')
    expect(zAlertLevel(3.0)).toBe('mild')
    expect(zAlertLevel(3.01)).toBe('strong')
    expect(zAlertLevel(-4)).toBe('strong')
    expect(zAlertLevel(null)).toBeUndefined()
  })
})

describe('VolSummaryTable render', () => {
  const ticker = (t: string, z6: number, z1: number) => ({
    ticker: t, current: 20, changes: { '1d': -0.004, '5d': 1.2, '1m': -2, '3m': 0, ytd: 3 },
    zscore: { '6m': z6, '1y': z1 }, ivRank: { '6m': 50, '1y': 95 }, ivPercentile: { '6m': 40, '1y': 99 },
  })
  const data = { asOfDate: '2026-10-29', tickers: [ticker('VIX', 2.4, 3.6), ticker('MOVE', -1, 0.5)] } as unknown as CavSummaryResponse

  it('tints only the z cells beyond ±2σ; no sign tone anywhere; near-zero change prints 0.00', () => {
    const { container } = render(<VolSummaryTable asOfDate="2026-10-29" data={data} loading={false} error={null} />)
    const rows = [...container.querySelectorAll('tbody tr')]
    const vix = [...rows[0].querySelectorAll('td')]
    // columns: ticker, current, 1D..YTD (5), 6M Z, 1Y Z, ranks (2), pctiles (2)
    expect(vix[7].className).toMatch(/alertMild/)
    expect(vix[8].className).toMatch(/alertStrong/)
    expect(vix[2].textContent).toBe('0.00')
    const all = [...container.querySelectorAll('td')]
    expect(all.some(td => /positive|negative|alert(Mild|Strong)/.test(td.className) && ![vix[7], vix[8]].includes(td))).toBe(false)
    expect(container.textContent).not.toContain('−')
  })
})
