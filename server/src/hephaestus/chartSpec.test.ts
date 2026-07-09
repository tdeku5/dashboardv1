import { describe, it, expect } from 'vitest'
import { validateSpecStructure, validateSpecCatalog, type CatalogRow } from './chartSpec'

const okSpec = { version: 1, title: 'Test', series: [{ id: 'DGS10' }] }

describe('validateSpecStructure', () => {
  it('accepts a minimal valid spec', () => {
    const r = validateSpecStructure(okSpec)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.spec.title).toBe('Test')
      expect(r.spec.series).toEqual([{ id: 'DGS10', param: undefined, label: undefined, axis: undefined }])
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
    version: 1 as const, title: 'T', series,
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
