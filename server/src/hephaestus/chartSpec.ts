// ChartSpecV1 — the ONLY artifact the Hephaestus model may emit. A spec
// references series_catalog entries by series_id (globally unique across the
// catalog); it never carries data values, so fabricated observations are
// structurally impossible: every number on a chart comes from the render
// endpoint reading SQLite.
//
// Validation is two-layered and both layers are pure/injectable for tests:
//   1. validateSpecStructure  — shape only, no DB.
//   2. validateSpecCatalog    — every ref resolves to a renderable catalog
//      entry; parameterized/contract-family refs carry a valid `param`.
// Phase C mirrors the ChartSpecV1 type client-side (type-only copy).

export interface SpecSeriesRef {
  /** series_catalog.series_id — globally unique across the catalog. */
  id: string
  /** Required for series_kind 'parameterized' (e.g. gilt maturity) and
   *  'contract_family' (member contract symbol). Forbidden on 'single'. */
  param?: string
  /** Display label; defaults to the catalog description at render time. */
  label?: string
  axis?: 'left' | 'right'
}

export interface ChartSpecV1 {
  version: 1
  title: string
  series: SpecSeriesRef[]
  /** Optional ISO date range (inclusive). */
  from?: string
  to?: string
  leftAxisLabel?: string
  rightAxisLabel?: string
}

export const MAX_SERIES_PER_SPEC = 8

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export type SpecValidation =
  | { ok: true; spec: ChartSpecV1 }
  | { ok: false; errors: string[] }

// Source tables the render endpoint cannot draw as line charts in v1
// (event/multi-column shapes, not single-valued time series).
export const UNRENDERABLE_SOURCE_TABLES = new Set([
  'economic_releases',
  'treasury_auctions',
  'treasury_investor_class',
  'gdpnow_forecasts',
  'gdpnow_contributions',
])

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function optionalString(v: unknown, name: string, errors: string[]): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') { errors.push(`${name} must be a string`); return undefined }
  return v
}

export function validateSpecStructure(input: unknown): SpecValidation {
  const errors: string[] = []
  if (!isPlainObject(input)) return { ok: false, errors: ['spec must be an object'] }

  if (input.version !== 1) errors.push('version must be the number 1')
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (title === '') errors.push('title must be a non-empty string')
  if (title.length > 160) errors.push('title must be at most 160 characters')

  const series: SpecSeriesRef[] = []
  if (!Array.isArray(input.series) || input.series.length === 0) {
    errors.push('series must be a non-empty array')
  } else if (input.series.length > MAX_SERIES_PER_SPEC) {
    errors.push(`series must contain at most ${MAX_SERIES_PER_SPEC} entries`)
  } else {
    input.series.forEach((raw, i) => {
      if (!isPlainObject(raw)) { errors.push(`series[${i}] must be an object`); return }
      const id = typeof raw.id === 'string' ? raw.id.trim() : ''
      if (id === '') { errors.push(`series[${i}].id must be a non-empty string`); return }
      const param = optionalString(raw.param, `series[${i}].param`, errors)
      const label = optionalString(raw.label, `series[${i}].label`, errors)
      let axis: 'left' | 'right' | undefined
      if (raw.axis !== undefined) {
        if (raw.axis === 'left' || raw.axis === 'right') axis = raw.axis
        else errors.push(`series[${i}].axis must be 'left' or 'right'`)
      }
      series.push({ id, param, label, axis })
    })
  }

  const from = optionalString(input.from, 'from', errors)
  const to = optionalString(input.to, 'to', errors)
  if (from !== undefined && !ISO_DATE_RE.test(from)) errors.push('from must be an ISO date (YYYY-MM-DD)')
  if (to !== undefined && !ISO_DATE_RE.test(to)) errors.push('to must be an ISO date (YYYY-MM-DD)')
  if (from && to && from > to) errors.push('from must not be after to')
  const leftAxisLabel = optionalString(input.leftAxisLabel, 'leftAxisLabel', errors)
  const rightAxisLabel = optionalString(input.rightAxisLabel, 'rightAxisLabel', errors)

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    spec: { version: 1, title, series, from, to, leftAxisLabel, rightAxisLabel },
  }
}

// Catalog row fields the validator/renderer need. Matches series_catalog.
export interface CatalogRow {
  series_id: string
  series_kind: string      // 'single' | 'parameterized' | 'contract_family'
  source_table: string
  description: string | null
  units: string | null
  frequency: string | null
  data_source: string | null
  country: string | null
  category: string | null
  first_date: string | null
  last_date: string | null
  seasonal_adjustment?: string | null
}

export interface CatalogDeps {
  /** series_id → catalog row, or undefined when unknown. */
  lookup: (id: string) => CatalogRow | undefined
  /** Valid params for a parameterized/contract_family row. */
  listParams: (row: CatalogRow) => string[]
}

export function validateSpecCatalog(spec: ChartSpecV1, deps: CatalogDeps): SpecValidation {
  const errors: string[] = []
  for (const [i, ref] of spec.series.entries()) {
    const row = deps.lookup(ref.id)
    if (!row) {
      errors.push(`series[${i}].id '${ref.id}' is not in the series catalog — use search_catalog to find the exact series_id`)
      continue
    }
    if (UNRENDERABLE_SOURCE_TABLES.has(row.source_table)) {
      errors.push(`series[${i}].id '${ref.id}' (${row.source_table}) is not renderable as a line chart in v1`)
      continue
    }
    if (row.series_kind === 'single') {
      if (ref.param !== undefined) errors.push(`series[${i}] '${ref.id}' is a single series — remove param`)
    } else {
      if (ref.param === undefined) {
        errors.push(`series[${i}] '${ref.id}' (${row.series_kind}) requires a param — use list_params to see valid values`)
      } else {
        const valid = deps.listParams(row)
        if (!valid.includes(ref.param)) {
          errors.push(`series[${i}].param '${ref.param}' is not valid for '${ref.id}' — valid params include: ${valid.slice(0, 12).join(', ')}${valid.length > 12 ? ', …' : ''}`)
        }
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, spec }
}
