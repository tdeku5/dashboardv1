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

const spec = (series: ChartSpecV1['series'], extra: Partial<ChartSpecV1> = {}): ChartSpecV1 => ({
  version: 1, title: 'T', series, ...extra,
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
