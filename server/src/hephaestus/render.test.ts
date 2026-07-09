import { describe, it, expect, vi } from 'vitest'
import { renderSpec, type RenderDeps, type Point } from './render'
import type { CatalogRow, ChartSpecV1 } from './chartSpec'

function row(overrides: Partial<CatalogRow>): CatalogRow {
  return {
    series_id: 'DGS10', series_kind: 'single', source_table: 'series_observations',
    description: '10-Year Treasury Yield', units: '%', frequency: 'daily',
    data_source: 'FRED', country: 'US', category: 'rates',
    first_date: '1962-01-02', last_date: '2026-07-01',
    ...overrides,
  }
}

function deps(catalog: Map<string, CatalogRow>, points: Map<string, Point[]>): RenderDeps & { ensureFresh: ReturnType<typeof vi.fn> } {
  return {
    lookup: id => catalog.get(id),
    fetchPoints: (r) => points.get(r.series_id) ?? [],
    ensureFresh: vi.fn(async () => {}),
  }
}

const spec = (series: Array<{ id: string; param?: string; label?: string; axis?: 'left' | 'right' }>, extra: Partial<ChartSpecV1> = {}): ChartSpecV1 => ({
  version: 1, title: 'T',
  series: series.map(s => ({ kind: 'direct' as const, ...s })),
  ...extra,
})

describe('renderSpec — FRED freshness gate', () => {
  it('calls ensureFresh for a FRED-tagged series_observations row', async () => {
    const d = deps(
      new Map([['DGS10', row({})]]),
      new Map([['DGS10', [{ date: '2026-01-01', value: 4.2 }]]]),
    )
    await renderSpec(spec([{ id: 'DGS10' }]), d)
    expect(d.ensureFresh).toHaveBeenCalledTimes(1)
    expect(d.ensureFresh).toHaveBeenCalledWith('DGS10')
  })

  it('does NOT call ensureFresh for a BEA-tagged row in the same table', async () => {
    // BEA_* ids live in series_observations but are not FRED series — a FRED
    // API refresh must never fire for them (decision 3, Phase B gate).
    const d = deps(
      new Map([['BEA_T10101_A191RL', row({ series_id: 'BEA_T10101_A191RL', data_source: 'BEA', description: 'Real GDP % change' })]]),
      new Map([['BEA_T10101_A191RL', [{ date: '2026-01-01', value: 2.1 }]]]),
    )
    await renderSpec(spec([{ id: 'BEA_T10101_A191RL' }]), d)
    expect(d.ensureFresh).not.toHaveBeenCalled()
  })

  it('does NOT call ensureFresh for non-series_observations FRED-less sources', async () => {
    const d = deps(
      new Map([['US10Y', row({ series_id: 'US10Y', source_table: 'tv_series', data_source: 'TradingView' })]]),
      new Map([['US10Y', [{ date: '2026-01-01', value: 4.3 }]]]),
    )
    await renderSpec(spec([{ id: 'US10Y' }]), d)
    expect(d.ensureFresh).not.toHaveBeenCalled()
  })

  it('downgrades a refresh failure to a warning and still renders', async () => {
    const d = deps(
      new Map([['DGS10', row({})]]),
      new Map([['DGS10', [{ date: '2026-01-01', value: 4.2 }]]]),
    )
    d.ensureFresh.mockRejectedValueOnce(new Error('FRED down'))
    const result = await renderSpec(spec([{ id: 'DGS10' }]), d)
    expect(result.rows).toHaveLength(1)
    expect(result.warnings.join(' ')).toContain('FRED refresh failed for DGS10')
  })
})

describe('renderSpec — outer join and defaults', () => {
  it('outer-joins on date with nulls, never fabricating values', async () => {
    const d = deps(
      new Map([
        ['A', row({ series_id: 'A', data_source: 'TradingView', source_table: 'tv_series', description: 'Series A' })],
        ['B', row({ series_id: 'B', data_source: 'TradingView', source_table: 'tv_series', description: 'Series B', units: 'index' })],
      ]),
      new Map([
        ['A', [{ date: '2026-01-01', value: 1 }, { date: '2026-01-02', value: 2 }]],
        ['B', [{ date: '2026-01-02', value: 20 }, { date: '2026-01-03', value: 30 }]],
      ]),
    )
    const result = await renderSpec(spec([{ id: 'A' }, { id: 'B', axis: 'right' }]), d)
    expect(result.rows).toEqual([
      { date: '2026-01-01', s0: 1, s1: null },
      { date: '2026-01-02', s0: 2, s1: 20 },
      { date: '2026-01-03', s0: null, s1: 30 },
    ])
    expect(result.series[0]).toMatchObject({ key: 's0', label: 'Series A', axis: 'left', units: '%' })
    expect(result.series[1]).toMatchObject({ key: 's1', label: 'Series B', axis: 'right', units: 'index' })
  })

  it('prefers the spec label over the catalog description', async () => {
    const d = deps(
      new Map([['A', row({ series_id: 'A', data_source: 'TradingView', source_table: 'tv_series' })]]),
      new Map([['A', [{ date: '2026-01-01', value: 1 }]]]),
    )
    const result = await renderSpec(spec([{ id: 'A', label: 'Custom' }]), d)
    expect(result.series[0].label).toBe('Custom')
  })

  it('throws on an unknown catalog id', async () => {
    const d = deps(new Map(), new Map())
    await expect(renderSpec(spec([{ id: 'NOPE' }]), d)).rejects.toThrow('not in the series catalog')
  })

  it('warns when a series returns no observations', async () => {
    const d = deps(
      new Map([['A', row({ series_id: 'A', data_source: 'TradingView', source_table: 'tv_series' })]]),
      new Map(),
    )
    const result = await renderSpec(spec([{ id: 'A' }]), d)
    expect(result.warnings.join(' ')).toContain('no observations')
  })
})

describe('renderSpec — transforms and derived series', () => {
  const tvRow = (id: string, extra: Partial<CatalogRow> = {}) =>
    row({ series_id: id, data_source: 'TradingView', source_table: 'tv_series', description: id, ...extra })

  it('rebase100 bases on the first point IN RANGE (range applied before transform)', async () => {
    const d = deps(
      new Map([['A', tvRow('A')]]),
      new Map([['A', [
        { date: '2025-12-01', value: 50 },   // pre-range history
        { date: '2026-01-01', value: 200 },  // first in-range point = base
        { date: '2026-01-02', value: 300 },
      ]]]),
    )
    const result = await renderSpec({
      version: 1, title: 'T', from: '2026-01-01',
      series: [{ kind: 'direct', id: 'A', transform: { type: 'rebase100' } }],
    }, d)
    expect(result.rows).toEqual([
      { date: '2026-01-01', s0: 100 },
      { date: '2026-01-02', s0: 150 },
    ])
    expect(result.series[0].transform).toBe('rebase100')
  })

  it('yoy_pct uses pre-range history (transform applied before range)', async () => {
    const d = deps(
      new Map([['A', tvRow('A')]]),
      new Map([['A', [
        { date: '2025-01-01', value: 100 },  // outside range, needed as yoy base
        { date: '2026-01-01', value: 110 },
      ]]]),
    )
    const result = await renderSpec({
      version: 1, title: 'T', from: '2026-01-01',
      series: [{ kind: 'direct', id: 'A', transform: { type: 'yoy_pct' } }],
    }, d)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].s0).toBeCloseTo(10)
  })

  it('derived subtract on mixed frequencies is sparse and warned, never filled', async () => {
    const d = deps(
      new Map([
        ['DAILY', tvRow('DAILY', { frequency: 'daily' })],
        ['MONTHLY', tvRow('MONTHLY', { frequency: 'monthly' })],
      ]),
      new Map([
        ['DAILY', [
          { date: '2026-01-01', value: 10 }, { date: '2026-01-02', value: 11 },
          { date: '2026-02-01', value: 12 },
        ]],
        ['MONTHLY', [{ date: '2026-01-01', value: 1 }, { date: '2026-02-01', value: 2 }]],
      ]),
    )
    const result = await renderSpec({
      version: 1, title: 'T',
      series: [{ kind: 'derived', op: 'subtract', a: { id: 'DAILY' }, b: { id: 'MONTHLY' }, label: 'spread' }],
    }, d)
    // Only the two shared dates survive — 2026-01-02 is not filled.
    expect(result.rows).toEqual([
      { date: '2026-01-01', s0: 9 },
      { date: '2026-02-01', s0: 10 },
    ])
    expect(result.series[0]).toMatchObject({ kind: 'derived', frequency: 'mixed (daily / monthly)' })
    expect(result.warnings.join(' ')).toContain('shared observation dates')
  })

  it('derived series with matching units keeps them; ratio reports "ratio"', async () => {
    const maps: [Map<string, CatalogRow>, Map<string, Point[]>] = [
      new Map([['A', tvRow('A')], ['B', tvRow('B')]]),
      new Map([
        ['A', [{ date: '2026-01-01', value: 6 }]],
        ['B', [{ date: '2026-01-01', value: 2 }]],
      ]),
    ]
    const sub = await renderSpec({
      version: 1, title: 'T',
      series: [{ kind: 'derived', op: 'subtract', a: { id: 'A' }, b: { id: 'B' }, label: 's' }],
    }, deps(...maps))
    expect(sub.series[0].units).toBe('%')
    const ratio = await renderSpec({
      version: 1, title: 'T',
      series: [{ kind: 'derived', op: 'ratio', a: { id: 'A' }, b: { id: 'B' }, label: 'r' }],
    }, deps(...maps))
    expect(ratio.series[0].units).toBe('ratio')
    expect(ratio.rows[0].s0).toBe(3)
  })

  it('FRED refresh gate fires for BOTH inputs of a derived series when applicable', async () => {
    const d = deps(
      new Map([
        ['DGS10', row({})],
        ['T10YIE', row({ series_id: 'T10YIE', description: 'Breakeven' })],
      ]),
      new Map([
        ['DGS10', [{ date: '2026-01-01', value: 4.5 }]],
        ['T10YIE', [{ date: '2026-01-01', value: 2.3 }]],
      ]),
    )
    await renderSpec({
      version: 1, title: 'T',
      series: [{ kind: 'derived', op: 'subtract', a: { id: 'DGS10' }, b: { id: 'T10YIE' }, label: 'real 10y' }],
    }, d)
    expect(d.ensureFresh).toHaveBeenCalledTimes(2)
  })
})

// ── Audit item 2: render coverage — every Transform member on BOTH kinds ─────
describe('renderSpec — full transform union on direct and derived (audit item 2)', () => {
  // 8 monthly points spanning >1 year so yoy/mom both produce output.
  const A_POINTS: Point[] = [
    ['2024-01-01', 100], ['2024-02-01', 102], ['2024-03-01', 104], ['2024-04-01', 106],
    ['2025-01-01', 110], ['2025-02-01', 112], ['2025-03-01', 108], ['2025-04-01', 114],
  ].map(([date, value]) => ({ date: date as string, value: value as number }))
  const ONES: Point[] = A_POINTS.map(p => ({ date: p.date, value: 1 }))

  const catalog = new Map([
    ['A', row({ series_id: 'A', data_source: 'TradingView', source_table: 'tv_series', frequency: 'monthly' })],
    ['ONE', row({ series_id: 'ONE', data_source: 'TradingView', source_table: 'tv_series', frequency: 'monthly' })],
  ])
  const points = new Map([['A', A_POINTS], ['ONE', ONES]])

  // transform → expected surviving point count on the 8-point fixture
  const CASES: Array<[Record<string, unknown>, number]> = [
    [{ type: 'level' }, 8],
    [{ type: 'rebase100' }, 8],
    [{ type: 'yoy_pct' }, 4],          // only the 2025 points have a base
    [{ type: 'mom_pct' }, 6],          // consecutive-month pairs only
    [{ type: 'diff', periods: 1 }, 7],
    [{ type: 'zscore', window: 2 }, 7],
    [{ type: 'rolling_mean', window: 2 }, 7],
  ]

  it.each(CASES.map(c => [c[0], c[1]] as const))('direct with %j renders', async (t, expected) => {
    const result = await renderSpec({
      version: 1, title: 'T',
      series: [{ kind: 'direct', id: 'A', transform: t as never }],
    }, deps(catalog, points))
    expect(result.series[0].pointCount).toBe(expected)
  })

  it.each(CASES.map(c => [c[0], c[1]] as const))('derived (A subtract ONE) with %j renders', async (t, expected) => {
    const result = await renderSpec({
      version: 1, title: 'T',
      series: [{ kind: 'derived', op: 'subtract', a: { id: 'A' }, b: { id: 'ONE' }, label: 'A−1', transform: t as never }],
    }, deps(catalog, points))
    expect(result.series[0].kind).toBe('derived')
    expect(result.series[0].transform).toBe((t as { type: string }).type)
    expect(result.series[0].pointCount).toBe(expected)
  })
})

// ── Audit item 2: hand-calculated transform-after-derived fixtures ───────────
describe('renderSpec — hand-calculated derived+transform combos (audit item 2)', () => {
  const tv = (id: string) => row({ series_id: id, data_source: 'TradingView', source_table: 'tv_series' })

  it('zscore(window 2) of a subtract spread matches hand calculation', async () => {
    // a−b spread: [9, 18, 9, 27]
    // z w2 (population std): d2 (18−13.5)/4.5 = 1; d3 (9−13.5)/4.5 = −1; d4 (27−18)/9 = 1
    const catalog = new Map([['X', tv('X')], ['Y', tv('Y')]])
    const points = new Map<string, Point[]>([
      ['X', [
        { date: '2026-01-01', value: 10 }, { date: '2026-01-02', value: 19 },
        { date: '2026-01-03', value: 10 }, { date: '2026-01-04', value: 28 },
      ]],
      ['Y', [
        { date: '2026-01-01', value: 1 }, { date: '2026-01-02', value: 1 },
        { date: '2026-01-03', value: 1 }, { date: '2026-01-04', value: 1 },
      ]],
    ])
    const result = await renderSpec({
      version: 1, title: 'T',
      series: [{
        kind: 'derived', op: 'subtract', a: { id: 'X' }, b: { id: 'Y' },
        label: 'z of spread', transform: { type: 'zscore', window: 2 },
      }],
    }, deps(catalog, points))
    expect(result.rows).toEqual([
      { date: '2026-01-02', s0: 1 },
      { date: '2026-01-03', s0: -1 },
      { date: '2026-01-04', s0: 1 },
    ])
  })

  it('rebase100 of a ratio matches hand calculation', async () => {
    // a/b ratio: [4/2, 9/3, 12/3] = [2, 3, 4] → rebase100 → [100, 150, 200]
    const catalog = new Map([['P', tv('P')], ['Q', tv('Q')]])
    const points = new Map<string, Point[]>([
      ['P', [
        { date: '2026-01-01', value: 4 }, { date: '2026-01-02', value: 9 }, { date: '2026-01-03', value: 12 },
      ]],
      ['Q', [
        { date: '2026-01-01', value: 2 }, { date: '2026-01-02', value: 3 }, { date: '2026-01-03', value: 3 },
      ]],
    ])
    const result = await renderSpec({
      version: 1, title: 'T',
      series: [{
        kind: 'derived', op: 'ratio', a: { id: 'P' }, b: { id: 'Q' },
        label: 'rebased ratio', transform: { type: 'rebase100' },
      }],
    }, deps(catalog, points))
    expect(result.rows).toEqual([
      { date: '2026-01-01', s0: 100 },
      { date: '2026-01-02', s0: 150 },
      { date: '2026-01-03', s0: 200 },
    ])
    expect(result.series[0].units).toBe('ratio')
  })
})
