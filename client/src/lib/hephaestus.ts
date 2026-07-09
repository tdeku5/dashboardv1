// Hephaestus client library — ChartSpecV1 type mirror + API helpers.
// The canonical types live in server/src/hephaestus/chartSpec.ts; this is a
// type-only mirror (the workspaces share no package). Keep the shapes in sync.

export type Transform =
  | { type: 'level' }
  | { type: 'rebase100' }
  | { type: 'yoy_pct' }
  | { type: 'mom_pct' }
  | { type: 'diff'; periods: number }
  | { type: 'zscore'; window: number }
  | { type: 'rolling_mean'; window: number }

export interface SeriesInput { id: string; param?: string }

export interface DirectSeries extends SeriesInput {
  kind: 'direct'
  transform?: Transform
  label?: string
  axis?: 'left' | 'right'
}

export interface DerivedSeries {
  kind: 'derived'
  op: 'subtract' | 'add' | 'ratio'
  a: SeriesInput
  b: SeriesInput
  transform?: Transform
  label: string
  axis?: 'left' | 'right'
}

export type SpecSeries = DirectSeries | DerivedSeries

export interface ChartSpecV1 {
  version: 1
  title: string
  series: SpecSeries[]
  from?: string
  to?: string
  leftAxisLabel?: string
  rightAxisLabel?: string
}

export interface RenderedSeries {
  key: string
  kind: 'direct' | 'derived'
  id: string
  param?: string
  label: string
  axis: 'left' | 'right'
  units: string | null
  frequency: string | null
  seasonal_adjustment: string | null
  transform: Transform['type']
  pointCount: number
}

export type RenderRow = { date: string } & Record<string, number | null | string>

export interface RenderResult {
  title: string
  series: RenderedSeries[]
  rows: RenderRow[]
  leftAxisLabel?: string
  rightAxisLabel?: string
  warnings: string[]
}

export interface ChatTurn { role: 'user' | 'assistant'; content: string }

export interface ChatResponse {
  reply: string
  spec: ChartSpecV1 | null
  iterations: number
  toolTrace: Array<{ tool: string; ok: boolean; summary: string }>
}

export interface SavedChart {
  id: number
  name: string
  spec: ChartSpecV1
  created_at: string
  updated_at: string
}

// ── Model selection (localStorage) ───────────────────────────────────────────

export const HEPHAESTUS_MODELS = ['claude-sonnet-5', 'claude-opus-4-8'] as const
export type HephaestusModel = typeof HEPHAESTUS_MODELS[number]
export const DEFAULT_MODEL: HephaestusModel = 'claude-sonnet-5'
const MODEL_STORAGE_KEY = 'hephaestus.model'

export function getStoredModel(): HephaestusModel {
  if (typeof localStorage === 'undefined') return DEFAULT_MODEL
  const v = localStorage.getItem(MODEL_STORAGE_KEY)
  return (HEPHAESTUS_MODELS as readonly string[]).includes(v ?? '') ? (v as HephaestusModel) : DEFAULT_MODEL
}

export function setStoredModel(model: HephaestusModel): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(MODEL_STORAGE_KEY, model)
}

// ── API helpers ──────────────────────────────────────────────────────────────

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as (T & { error?: string; validation_errors?: string[] }) | null
  if (!res.ok || body === null) {
    const detail = body?.validation_errors?.length
      ? `${body.error}: ${body.validation_errors.join('; ')}`
      : body?.error ?? `HTTP ${res.status}`
    throw new Error(detail)
  }
  return body
}

export async function sendChat(messages: ChatTurn[], model: HephaestusModel): Promise<ChatResponse> {
  const res = await fetch('/api/hephaestus/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, model }),
  })
  return jsonOrThrow<ChatResponse>(res)
}

export async function renderChart(spec: ChartSpecV1): Promise<RenderResult> {
  const res = await fetch('/api/hephaestus/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(spec),
  })
  return jsonOrThrow<RenderResult>(res)
}

export async function listSavedCharts(): Promise<SavedChart[]> {
  const res = await fetch('/api/hephaestus/charts')
  const body = await jsonOrThrow<{ charts: SavedChart[] }>(res)
  return body.charts
}

export async function saveChart(name: string, spec: ChartSpecV1): Promise<SavedChart> {
  const res = await fetch('/api/hephaestus/charts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, spec }),
  })
  return jsonOrThrow<SavedChart>(res)
}

export async function renameSavedChart(id: number, name: string): Promise<void> {
  const res = await fetch(`/api/hephaestus/charts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  await jsonOrThrow(res)
}

export async function deleteSavedChart(id: number): Promise<void> {
  const res = await fetch(`/api/hephaestus/charts/${id}`, { method: 'DELETE' })
  await jsonOrThrow(res)
}

/** Normalize a catalog frequency string to a coarse bucket (for annotations). */
export function frequencyBucket(freq: string | null): string | null {
  if (!freq) return null
  const f = freq.toLowerCase()
  for (const b of ['daily', 'weekly', 'monthly', 'quarterly', 'semiannual', 'annual']) {
    if (f.startsWith(b)) return b
  }
  return f
}
