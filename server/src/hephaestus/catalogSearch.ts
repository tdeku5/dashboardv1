// Catalog access for Hephaestus: series resolution is SEARCH-based (the
// catalog's ~2,800 entries are far too many for model context), backed by the
// same series_catalog queries as GET /api/catalog — called directly in-process,
// not over HTTP. Read-only.

import { db } from '../db'
import type { CatalogRow } from './chartSpec'

export const SEARCH_RESULT_CAP = 15

const CATALOG_COLS = `series_id, series_kind, source_table, description, units, frequency,
  data_source, country, category, first_date, last_date, seasonal_adjustment`

export function lookupCatalog(id: string): CatalogRow | undefined {
  // series_id is globally unique across the catalog (verified at build time by
  // the UNIQUE(series_id, source_table, source_db) constraint + a zero-dupe
  // check), so id alone resolves the entry.
  return db.prepare(
    `SELECT ${CATALOG_COLS} FROM series_catalog WHERE series_id = ?`
  ).get(id) as CatalogRow | undefined
}

export interface SearchFilters {
  q?: string
  source?: string
  country?: string
  category?: string
}

export function searchCatalog(filters: SearchFilters): { total: number; results: CatalogRow[] } {
  const clauses: string[] = []
  const params: string[] = []
  if (filters.source?.trim()) { clauses.push('data_source = ?'); params.push(filters.source.trim()) }
  if (filters.country?.trim()) { clauses.push('country = ? COLLATE NOCASE'); params.push(filters.country.trim()) }
  if (filters.category?.trim()) { clauses.push('category = ?'); params.push(filters.category.trim()) }
  if (filters.q?.trim()) {
    clauses.push('(series_id LIKE ? COLLATE NOCASE OR description LIKE ? COLLATE NOCASE)')
    const like = `%${filters.q.trim()}%`
    params.push(like, like)
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM series_catalog ${where}`).get(...params) as { n: number }).n
  const results = db.prepare(`
    SELECT ${CATALOG_COLS} FROM series_catalog ${where}
    ORDER BY (description IS NULL), category, series_id
    LIMIT ${SEARCH_RESULT_CAP}
  `).all(...params) as CatalogRow[]
  return { total, results }
}

// ── Params for non-single entries ────────────────────────────────────────────

// Same dated-contract shape the catalog builder uses (build-series-catalog.ts):
// root + month code + 1-digit year, or 2-digit year only in 24–29.
const CONTRACT_RE = /^([A-Z0-9]{1,6}?)([FGHJKMNQUVXZ])(\d{1,2})$/

function contractMembers(root: string): string[] {
  const rows = db.prepare(
    `SELECT DISTINCT symbol FROM tv_series WHERE symbol LIKE ? ORDER BY symbol`
  ).all(`${root}%`) as Array<{ symbol: string }>
  return rows
    .map(r => r.symbol)
    .filter(sym => {
      const core = sym.includes(':') ? sym.split(':').pop() ?? sym : sym
      const m = CONTRACT_RE.exec(core)
      if (!m || m[1] !== root) return false
      if (m[3].length === 2 && !(parseInt(m[3], 10) >= 24 && parseInt(m[3], 10) <= 29)) return false
      return true
    })
}

/** Valid `param` values for a parameterized or contract_family catalog row. */
export function listParams(row: CatalogRow): string[] {
  if (row.series_kind === 'contract_family' && row.source_table === 'tv_series') {
    const root = row.series_id.replace(/:contracts$/, '')
    return contractMembers(root)
  }
  if (row.source_table === 'gilt_yield_curve') {
    // series_id = GILT_CURVE:{curve_type}; param = maturity in years.
    const curveType = row.series_id.replace(/^GILT_CURVE:/, '')
    const rows = db.prepare(
      `SELECT DISTINCT maturity FROM gilt_yield_curve WHERE curve_type = ? ORDER BY maturity`
    ).all(curveType) as Array<{ maturity: number }>
    return rows.map(r => String(r.maturity))
  }
  return []
}
