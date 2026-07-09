import { describe, it, expect } from 'vitest'
import { validateSpecStructure, validateSpecCatalog, type CatalogRow } from './chartSpec'

const okSpec = { version: 1, title: 'Test', series: [{ id: 'DGS10' }] }

describe('validateSpecStructure', () => {
  it('accepts a minimal valid spec (kind defaults to direct)', () => {
    const r = validateSpecStructure(okSpec)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.spec.title).toBe('Test')
      expect(r.spec.series).toEqual([{ kind: 'direct', id: 'DGS10', param: undefined, transform: undefined, label: undefined, axis: undefined }])
    }
  })

  it('accepts full optional fields', () => {
    const r = validateSpecStructure({
      ...okSpec,
      series: [{ id: 'DGS10', label: 'US 10Y', axis: 'right' }],
      from: '2021-01-01', to: '2026-01-01',
      leftAxisLabel: '%', rightAxisLabel: 'bp',
    })
    expect(r.ok).toBe(true)
  })

  it.each([
    [{ ...okSpec, version: 2 }, 'version'],
    [{ ...okSpec, title: '' }, 'title'],
    [{ ...okSpec, title: 'x'.repeat(161) }, '160'],
    [{ ...okSpec, series: [] }, 'non-empty'],
    [{ ...okSpec, series: Array.from({ length: 9 }, (_, i) => ({ id: `S${i}` })) }, 'at most 8'],
    [{ ...okSpec, series: [{ id: '' }] }, 'series[0].id'],
    [{ ...okSpec, series: [{ id: 'X', axis: 'top' }] }, 'axis'],
    [{ ...okSpec, from: 'Jan 2021' }, 'ISO date'],
    [{ ...okSpec, from: '2025-01-01', to: '2024-01-01' }, 'after'],
    ['not an object', 'object'],
  ])('rejects invalid input %#', (input, needle) => {
    const r = validateSpecStructure(input)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' | ')).toContain(needle)
  })
})

function row(overrides: Partial<CatalogRow>): CatalogRow {
  return {
    series_id: 'DGS10', series_kind: 'single', source_table: 'series_observations',
    description: '10-Year Treasury', units: '%', frequency: 'daily',
    data_source: 'FRED', country: 'US', category: 'rates',
    first_date: '1962-01-02', last_date: '2026-07-01',
    ...overrides,
  }
}

describe('validateSpecCatalog', () => {
  const catalog = new Map<string, CatalogRow>([
    ['DGS10', row({})],
    ['GILT_CURVE:nominal_spot', row({ series_id: 'GILT_CURVE:nominal_spot', series_kind: 'parameterized', source_table: 'gilt_yield_curve' })],
    ['CAL:US:CPI', row({ series_id: 'CAL:US:CPI', series_kind: 'parameterized', source_table: 'economic_releases' })],
  ])
  const deps = {
    lookup: (id: string) => catalog.get(id),
    listParams: (r: CatalogRow) => (r.source_table === 'gilt_yield_curve' ? ['5', '10', '25'] : []),
  }
  const spec = (series: Array<{ id: string; param?: string }>) => ({
    version: 1 as const, title: 'T',
    series: series.map(s => ({ kind: 'direct' as const, ...s })),
  })

  it('accepts a resolvable single series', () => {
    expect(validateSpecCatalog(spec([{ id: 'DGS10' }]), deps).ok).toBe(true)
  })

  it('rejects an unknown series_id', () => {
    const r = validateSpecCatalog(spec([{ id: 'NOT_A_SERIES' }]), deps)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toContain('not in the series catalog')
  })

  it('rejects unrenderable source tables', () => {
    const r = validateSpecCatalog(spec([{ id: 'CAL:US:CPI', param: 'x' }]), deps)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toContain('not renderable')
  })

  it('rejects param on a single series', () => {
    const r = validateSpecCatalog(spec([{ id: 'DGS10', param: '10' }]), deps)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toContain('remove param')
  })

  it('requires param on parameterized series', () => {
    const r = validateSpecCatalog(spec([{ id: 'GILT_CURVE:nominal_spot' }]), deps)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toContain('requires a param')
  })

  it('rejects a param outside the valid set', () => {
    const r = validateSpecCatalog(spec([{ id: 'GILT_CURVE:nominal_spot', param: '99' }]), deps)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toContain('not valid')
  })

  it('accepts a valid parameterized ref', () => {
    expect(validateSpecCatalog(spec([{ id: 'GILT_CURVE:nominal_spot', param: '10' }]), deps).ok).toBe(true)
  })
})

describe('transforms and derived series (structural)', () => {
  const direct = (extra: Record<string, unknown>) =>
    validateSpecStructure({ version: 1, title: 'T', series: [{ id: 'DGS10', ...extra }] })

  it('accepts every transform shape', () => {
    for (const t of [
      { type: 'level' }, { type: 'rebase100' }, { type: 'yoy_pct' }, { type: 'mom_pct' },
      { type: 'diff', periods: 1 }, { type: 'zscore', window: 20 }, { type: 'rolling_mean', window: 3 },
    ]) {
      expect(direct({ transform: t }).ok, JSON.stringify(t)).toBe(true)
    }
  })

  it.each([
    [{ type: 'log' }, 'transform.type'],
    [{ type: 'diff', periods: 0 }, 'periods'],
    [{ type: 'diff' }, 'periods'],
    [{ type: 'zscore', window: 1 }, 'window'],       // zscore needs >= 2
    [{ type: 'rolling_mean', window: 2.5 }, 'window'],
    [{ type: 'rolling_mean', window: 99999 }, 'window'],
  ])('rejects bad transform %j', (t, needle) => {
    const r = direct({ transform: t })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' | ')).toContain(needle)
  })

  it('accepts a valid derived series', () => {
    const r = validateSpecStructure({
      version: 1, title: 'T',
      series: [{ kind: 'derived', op: 'subtract', a: { id: 'A' }, b: { id: 'B' }, label: 'A minus B' }],
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.spec.series[0]).toMatchObject({ kind: 'derived', op: 'subtract' })
  })

  it.each([
    [{ kind: 'derived', op: 'multiply', a: { id: 'A' }, b: { id: 'B' }, label: 'x' }, 'op'],
    [{ kind: 'derived', op: 'subtract', a: { id: 'A' }, b: { id: 'B' } }, 'label is required'],
    [{ kind: 'derived', op: 'subtract', a: { id: '' }, b: { id: 'B' }, label: 'x' }, 'a.id'],
    [{ kind: 'derived', op: 'subtract', a: 'A', b: { id: 'B' }, label: 'x' }, 'must be an object'],
  ])('rejects malformed derived series %#', (s, needle) => {
    const r = validateSpecStructure({ version: 1, title: 'T', series: [s] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' | ')).toContain(needle)
  })
})

describe('validateSpecCatalog — derived refs', () => {
  const catalog = new Map<string, CatalogRow>([['DGS10', {
    series_id: 'DGS10', series_kind: 'single', source_table: 'series_observations',
    description: '10-Year Treasury', units: '%', frequency: 'daily',
    data_source: 'FRED', country: 'US', category: 'rates',
    first_date: '1962-01-02', last_date: '2026-07-01',
  }]])
  const deps = { lookup: (id: string) => catalog.get(id), listParams: () => [] as string[] }

  it('validates both derived inputs against the catalog', () => {
    const r = validateSpecCatalog({
      version: 1, title: 'T',
      series: [{ kind: 'derived', op: 'subtract', a: { id: 'DGS10' }, b: { id: 'GHOST' }, label: 'spread' }],
    }, deps)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toHaveLength(1)
      expect(r.errors[0]).toContain("series[0].b.id 'GHOST'")
    }
  })

  it('accepts a derived series whose inputs both resolve', () => {
    const r = validateSpecCatalog({
      version: 1, title: 'T',
      series: [{ kind: 'derived', op: 'ratio', a: { id: 'DGS10' }, b: { id: 'DGS10' }, label: 'unity' }],
    }, deps)
    expect(r.ok).toBe(true)
  })
})

// ── Audit item 1: derived-input param parity with direct refs ────────────────
// DerivedSeries.a/.b run through the SAME validateInputRef as direct series —
// these cases assert the param rules produce the same error class either way.
describe('validateSpecCatalog — derived param parity (audit item 1)', () => {
  const catalog = new Map<string, CatalogRow>([
    ['DGS10', {
      series_id: 'DGS10', series_kind: 'single', source_table: 'series_observations',
      description: '10-Year Treasury', units: '%', frequency: 'daily',
      data_source: 'FRED', country: 'US', category: 'rates',
      first_date: '1962-01-02', last_date: '2026-07-01',
    }],
    ['GILT_CURVE:nominal_spot', {
      series_id: 'GILT_CURVE:nominal_spot', series_kind: 'parameterized', source_table: 'gilt_yield_curve',
      description: 'UK nominal spot curve', units: '%', frequency: 'daily',
      data_source: 'BoE', country: 'UK', category: 'rates',
      first_date: '2016-01-04', last_date: '2026-02-27',
    }],
  ])
  const deps = {
    lookup: (id: string) => catalog.get(id),
    listParams: (r: CatalogRow) => (r.source_table === 'gilt_yield_curve' ? ['5', '10', '25'] : []),
  }
  const derived = (a: { id: string; param?: string }) => ({
    version: 1 as const, title: 'T',
    series: [{ kind: 'derived' as const, op: 'subtract' as const, a, b: { id: 'DGS10' }, label: 'spread' }],
  })
  const direct = (s: { id: string; param?: string }) => ({
    version: 1 as const, title: 'T', series: [{ kind: 'direct' as const, ...s }],
  })

  it('derived gilt input missing param → same error class as direct', () => {
    const dv = validateSpecCatalog(derived({ id: 'GILT_CURVE:nominal_spot' }), deps)
    const dr = validateSpecCatalog(direct({ id: 'GILT_CURVE:nominal_spot' }), deps)
    expect(dv.ok).toBe(false)
    expect(dr.ok).toBe(false)
    if (!dv.ok && !dr.ok) {
      // Identical message modulo the path prefix (shared validateInputRef).
      expect(dv.errors[0]).toContain('requires a param — use list_params')
      expect(dr.errors[0]).toContain('requires a param — use list_params')
      expect(dv.errors[0].replace('series[0].a', 'series[0]')).toBe(dr.errors[0])
    }
  })

  it('derived gilt input with invalid param → same error class as direct', () => {
    const dv = validateSpecCatalog(derived({ id: 'GILT_CURVE:nominal_spot', param: '99' }), deps)
    const dr = validateSpecCatalog(direct({ id: 'GILT_CURVE:nominal_spot', param: '99' }), deps)
    expect(dv.ok).toBe(false)
    expect(dr.ok).toBe(false)
    if (!dv.ok && !dr.ok) {
      expect(dv.errors[0]).toContain("param '99' is not valid")
      expect(dv.errors[0].replace('series[0].a', 'series[0]')).toBe(dr.errors[0])
    }
  })

  it('derived single-series input with a param → same error class as direct', () => {
    const dv = validateSpecCatalog(derived({ id: 'DGS10', param: '10' }), deps)
    const dr = validateSpecCatalog(direct({ id: 'DGS10', param: '10' }), deps)
    expect(dv.ok).toBe(false)
    expect(dr.ok).toBe(false)
    if (!dv.ok && !dr.ok) {
      expect(dv.errors[0]).toContain('remove param')
      expect(dv.errors[0].replace('series[0].a', 'series[0]')).toBe(dr.errors[0])
    }
  })
})

// ── Audit item 2: every Transform member accepted on DerivedSeries ───────────
describe('validateSpecStructure — transform union on derived series (audit item 2)', () => {
  const ALL_TRANSFORMS = [
    { type: 'level' }, { type: 'rebase100' }, { type: 'yoy_pct' }, { type: 'mom_pct' },
    { type: 'diff', periods: 1 }, { type: 'zscore', window: 20 }, { type: 'rolling_mean', window: 5 },
  ]

  it.each(ALL_TRANSFORMS.map(t => [t] as const))('accepts %j on a derived series', (t) => {
    const r = validateSpecStructure({
      version: 1, title: 'T',
      series: [{ kind: 'derived', op: 'ratio', a: { id: 'A' }, b: { id: 'B' }, label: 'r', transform: t }],
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.spec.series[0].transform?.type).toBe(t.type)
  })

  it('rejects a bad transform on a derived series via the same shared parseTransform', () => {
    const r = validateSpecStructure({
      version: 1, title: 'T',
      series: [{ kind: 'derived', op: 'ratio', a: { id: 'A' }, b: { id: 'B' }, label: 'r', transform: { type: 'zscore', window: 1 } }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toContain('series[0].transform.window')
  })
})
