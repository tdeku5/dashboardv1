// @vitest-environment happy-dom
// M1: VolSummaryTable z-scores use the alert family as a cell tint + outline
// only (|z| > 2 mild, |z| > 3 strong; Phase 0 Decision 2); IV rank / percentile
// likewise at both ends (>= 90 / <= 10 mild, >= 98 / <= 2 strong; M1 ruling 2).
// Text stays primary, no sign tone; vol point changes render plain (ruling 1).
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { VolSummaryTable } from './VolSummaryTable'
import { rankAlertLevel, zAlertLevel } from './acm'
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

describe('rankAlertLevel (IV rank / percentile, 0–100)', () => {
  it('upper end: 89 none, 90 mild, 97 mild, 98 strong', () => {
    expect(rankAlertLevel(89)).toBeUndefined()
    expect(rankAlertLevel(90)).toBe('mild')
    expect(rankAlertLevel(97)).toBe('mild')
    expect(rankAlertLevel(98)).toBe('strong')
    expect(rankAlertLevel(100)).toBe('strong')
  })
  it('lower end: 11 none, 10 mild, 3 mild, 2 strong', () => {
    expect(rankAlertLevel(11)).toBeUndefined()
    expect(rankAlertLevel(10)).toBe('mild')
    expect(rankAlertLevel(3)).toBe('mild')
    expect(rankAlertLevel(2)).toBe('strong')
    expect(rankAlertLevel(0)).toBe('strong')
  })
  it('works on the whole number shown; null / NaN → none', () => {
    expect(rankAlertLevel(89.4)).toBeUndefined()
    expect(rankAlertLevel(89.5)).toBe('mild')
    expect(rankAlertLevel(10.4)).toBe('mild')
    expect(rankAlertLevel(10.5)).toBeUndefined()
    expect(rankAlertLevel(50)).toBeUndefined()
    expect(rankAlertLevel(null)).toBeUndefined()
    expect(rankAlertLevel(Number.NaN)).toBeUndefined()
  })
})

describe('VolSummaryTable render', () => {
  const ticker = (t: string, z6: number, z1: number, rk: [number, number] = [50, 95], pc: [number, number] = [40, 99]) => ({
    ticker: t, current: 20, changes: { '1d': -0.004, '5d': 1.2, '1m': -2, '3m': 0, ytd: 3 },
    zscore: { '6m': z6, '1y': z1 }, ivRank: { '6m': rk[0], '1y': rk[1] }, ivPercentile: { '6m': pc[0], '1y': pc[1] },
  })
  const data = { asOfDate: '2026-10-29', tickers: [ticker('VIX', 2.4, 3.6), ticker('MOVE', -1, 0.5, [11, 89], [50, 60])] } as unknown as CavSummaryResponse

  it('tints z cells beyond ±2σ and extreme rank / %ile cells only; no sign tone; near-zero change prints 0.00', () => {
    const { container } = render(<VolSummaryTable asOfDate="2026-10-29" data={data} loading={false} error={null} />)
    const rows = [...container.querySelectorAll('tbody tr')]
    const vix = [...rows[0].querySelectorAll('td')]
    // columns: ticker, current, 1D..YTD (5), 6M Z, 1Y Z, 6M/1Y rank, 6M/1Y %ile
    expect(vix[7].className).toMatch(/alertMild/)
    expect(vix[8].className).toMatch(/alertStrong/)
    expect(vix[9].className).not.toMatch(/alert/)    // rank 50
    expect(vix[10].className).toMatch(/alertMild/)   // rank 95
    expect(vix[11].className).not.toMatch(/alert/)   // %ile 40
    expect(vix[12].className).toMatch(/alertStrong/) // %ile 99
    expect(vix[2].textContent).toBe('0.00')
    const tinted = [vix[7], vix[8], vix[10], vix[12]]
    const all = [...container.querySelectorAll('td')]
    expect(all.some(td => /alert(Mild|Strong)/.test(td.className) && !tinted.includes(td))).toBe(false)
    expect(all.some(td => /positive|negative/.test(td.className))).toBe(false)
    for (const td of tinted) expect(td.className).not.toMatch(/tone|positive|negative/)
    expect(container.textContent).not.toContain('−')
  })
})
