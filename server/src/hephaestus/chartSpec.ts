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

export type Transform =
  | { type: 'level' }
  | { type: 'rebase100' }                 // = 100 at first point in range
  | { type: 'yoy_pct' }
  | { type: 'mom_pct' }
  | { type: 'diff'; periods: number }
  | { type: 'zscore'; window: number }    // rolling, in periods
  | { type: 'rolling_mean'; window: number }

export interface SeriesInput {
  /** series_catalog.series_id — globally unique across the catalog. */
  id: string
  /** Required for series_kind 'parameterized' (e.g. gilt maturity) and
   *  'contract_family' (member contract symbol). Forbidden on 'single'. */
  param?: string
}

export interface DirectSeries extends SeriesInput {
  /** Omitted kind defaults to 'direct'. */
  kind: 'direct'
  /** Applied server-side; omitted = level. */
  transform?: Transform
  /** Display label; defaults to the catalog description at render time. */
  label?: string
  axis?: 'left' | 'right'
}

export interface DerivedSeries {
  kind: 'derived'
  /** a op b, computed only on dates where BOTH inputs have observations. */
  op: 'subtract' | 'add' | 'ratio'
  a: SeriesInput
  b: SeriesInput
  /** Applied AFTER the op; omitted = level. */
  transform?: Transform
  /** Required — there is no catalog description to fall back on. */
  label: string
  axis?: 'left' | 'right'
}

export type SpecSeries = DirectSeries | DerivedSeries

export interface ChartSpecV1 {
  version: 1
  title: string
  series: SpecSeries[]
  /** Optional ISO date range (inclusive). */
  from?: string
  to?: string
  leftAxisLabel?: string
  rightAxisLabel?: string
}

export const MAX_SERIES_PER_SPEC = 8
export const MAX_TITLE_LEN = 160
// Exported so the emit_chart_spec tool schema and the drift-guard test build
// from the same canonical lists (chatSchema.test.ts).
export const TRANSFORM_TYPES = new Set(['level', 'rebase100', 'yoy_pct', 'mom_pct', 'diff', 'zscore', 'rolling_mean'])
export const MAX_TRANSFORM_WINDOW = 2000
export const DERIVED_OPS = ['subtract', 'add', 'ratio'] as const

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
  if (title.length > MAX_TITLE_LEN) errors.push(`title must be at most ${MAX_TITLE_LEN} characters`)

  const series: SpecSeries[] = []
  if (!Array.isArray(input.series) || input.series.length === 0) {
    errors.push('series must be a non-empty array')
  } else if (input.series.length > MAX_SERIES_PER_SPEC) {
    errors.push(`series must contain at most ${MAX_SERIES_PER_SPEC} entries`)
  } else {
    input.series.forEach((raw, i) => {
      if (!isPlainObject(raw)) { errors.push(`series[${i}] must be an object`); return }
      const parsed = raw.kind === 'derived'
        ? parseDerivedSeries(raw, i, errors)
        : parseDirectSeries(raw, i, errors)
      if (parsed) series.push(parsed)
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

function parseTransform(raw: unknown, path: string, errors: string[]): Transform | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!isPlainObject(raw) || typeof raw.type !== 'string' || !TRANSFORM_TYPES.has(raw.type)) {
    errors.push(`${path}.type must be one of: ${[...TRANSFORM_TYPES].join(', ')}`)
    return undefined
  }
  const type = raw.type as Transform['type']
  if (type === 'diff' || type === 'zscore' || type === 'rolling_mean') {
    const field = type === 'diff' ? 'periods' : 'window'
    const n = raw[field]
    const min = type === 'zscore' ? 2 : 1
    if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > MAX_TRANSFORM_WINDOW) {
      errors.push(`${path}.${field} must be an integer between ${min} and ${MAX_TRANSFORM_WINDOW}`)
      return undefined
    }
    return { type, [field]: n } as Transform
  }
  return { type } as Transform
}

function parseAxis(raw: unknown, path: string, errors: string[]): 'left' | 'right' | undefined {
  if (raw === undefined) return undefined
  if (raw === 'left' || raw === 'right') return raw
  errors.push(`${path} must be 'left' or 'right'`)
  return undefined
}

function parseSeriesInput(raw: unknown, path: string, errors: string[]): SeriesInput | undefined {
  if (!isPlainObject(raw)) { errors.push(`${path} must be an object {id, param?}`); return undefined }
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (id === '') { errors.push(`${path}.id must be a non-empty string`); return undefined }
  const param = optionalString(raw.param, `${path}.param`, errors)
  return { id, param }
}

function parseDirectSeries(raw: Record<string, unknown>, i: number, errors: string[]): DirectSeries | undefined {
  if (raw.kind !== undefined && raw.kind !== 'direct') {
    errors.push(`series[${i}].kind must be 'direct' or 'derived'`)
    return undefined
  }
  const base = parseSeriesInput(raw, `series[${i}]`, errors)
  if (!base) return undefined
  return {
    kind: 'direct',
    id: base.id,
    param: base.param,
    transform: parseTransform(raw.transform, `series[${i}].transform`, errors),
    label: optionalString(raw.label, `series[${i}].label`, errors),
    axis: parseAxis(raw.axis, `series[${i}].axis`, errors),
  }
}

function parseDerivedSeries(raw: Record<string, unknown>, i: number, errors: string[]): DerivedSeries | undefined {
  if (raw.op !== 'subtract' && raw.op !== 'add' && raw.op !== 'ratio') {
    errors.push(`series[${i}].op must be 'subtract', 'add', or 'ratio'`)
    return undefined
  }
  const a = parseSeriesInput(raw.a, `series[${i}].a`, errors)
  const b = parseSeriesInput(raw.b, `series[${i}].b`, errors)
  const label = typeof raw.label === 'string' ? raw.label.trim() : ''
  if (label === '') errors.push(`series[${i}].label is required for derived series`)
  if (!a || !b || label === '') return undefined
  return {
    kind: 'derived',
    op: raw.op,
    a, b, label,
    transform: parseTransform(raw.transform, `series[${i}].transform`, errors),
    axis: parseAxis(raw.axis, `series[${i}].axis`, errors),
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

function validateInputRef(input: SeriesInput, path: string, deps: CatalogDeps, errors: string[]): void {
  const row = deps.lookup(input.id)
  if (!row) {
    errors.push(`${path}.id '${input.id}' is not in the series catalog — use search_catalog to find the exact series_id`)
    return
  }
  if (UNRENDERABLE_SOURCE_TABLES.has(row.source_table)) {
    errors.push(`${path}.id '${input.id}' (${row.source_table}) is not renderable as a line chart in v1`)
    return
  }
  if (row.series_kind === 'single') {
    if (input.param !== undefined) errors.push(`${path} '${input.id}' is a single series — remove param`)
  } else if (input.param === undefined) {
    errors.push(`${path} '${input.id}' (${row.series_kind}) requires a param — use list_params to see valid values`)
  } else {
    const valid = deps.listParams(row)
    if (!valid.includes(input.param)) {
      errors.push(`${path}.param '${input.param}' is not valid for '${input.id}' — valid params include: ${valid.slice(0, 12).join(', ')}${valid.length > 12 ? ', …' : ''}`)
    }
  }
}

export function validateSpecCatalog(spec: ChartSpecV1, deps: CatalogDeps): SpecValidation {
  const errors: string[] = []
  for (const [i, s] of spec.series.entries()) {
    if (s.kind === 'derived') {
      validateInputRef(s.a, `series[${i}].a`, deps, errors)
      validateInputRef(s.b, `series[${i}].b`, deps, errors)
    } else {
      validateInputRef(s, `series[${i}]`, deps, errors)
    }
  }
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, spec }
}
