// Hephaestus chat — a bounded tool loop that turns a natural-language chart
// request into a validated ChartSpecV1.
//
// Non-negotiables enforced here:
//   - The model NEVER writes SQL and NEVER emits data values. Its only output
//     channel for a chart is the emit_chart_spec tool, whose payload is a
//     catalog-reference spec validated before anything reaches the client.
//   - Series resolution is search-based (search_catalog / peek_series /
//     list_params) — the catalog is far too large to inject into context.
//   - Caps: 10 model iterations, 60s wall clock, 15 search results,
//     5 peek points.
//
// v1 exclusions: no conversation persistence (the client resends history),
// no streaming, line charts only.

import type Anthropic from '@anthropic-ai/sdk'
import {
  validateSpecStructure, validateSpecCatalog,
  type ChartSpecV1, type CatalogRow,
} from './chartSpec'
import { searchCatalog, lookupCatalog, listParams, SEARCH_RESULT_CAP, type SearchFilters } from './catalogSearch'
import { fetchSeriesPoints, type Point } from './render'
import { makeChatFn, type ChatFn } from './claudeClient'

export const MAX_ITERATIONS = 10
export const TIMEOUT_MS = 60_000
export const PEEK_POINT_CAP = 5

// ── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_catalog',
    description:
      `Search the series catalog (~2,800 entries). Returns up to ${SEARCH_RESULT_CAP} matches with series_id, description, units, frequency, country, category, and date coverage. ` +
      `Use q for free-text (matches series_id and description), and/or the exact-match filters. ` +
      `Categories: rates, inflation, growth, labor, fiscal, housing, credit, fx, equities, commodities, vol, breadth, crypto, industrial, calendar. ` +
      `Countries are mostly ISO-2 (US, UK, DE, FR, IT, JP, CA, AU, ...). ` +
      `Call this before referencing any series — never guess a series_id.`,
    input_schema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Free-text query, e.g. "10-year government bond yield"' },
        source: { type: 'string', description: 'Exact data_source filter, e.g. FRED, TradingView, ONS, ECB' },
        country: { type: 'string', description: 'Exact country filter, e.g. US, DE, UK' },
        category: { type: 'string', description: 'Exact category filter, e.g. rates' },
      },
    },
  },
  {
    name: 'peek_series',
    description:
      `Fetch the most recent ${PEEK_POINT_CAP} observations of a series (by catalog series_id) to sanity-check units, magnitude, and recency before putting it on a chart. ` +
      `Pass param for parameterized/contract-family entries.`,
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Exact series_id from search_catalog' },
        param: { type: 'string', description: 'Param for parameterized/contract-family series (see list_params)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_params',
    description:
      'List the valid param values for a parameterized or contract_family catalog entry (e.g. gilt curve maturities, futures contract symbols). Single series have no params.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Exact series_id from search_catalog' },
      },
      required: ['id'],
    },
  },
  {
    name: 'emit_chart_spec',
    description:
      'Emit the final chart specification. This is the ONLY way to produce a chart — never describe a spec in prose. ' +
      'Every series id must be an exact series_id you found via search_catalog. The spec contains no data values; the terminal renders it from its own database. ' +
      'If validation fails you will get the errors back — fix them and emit again.',
    input_schema: {
      type: 'object',
      properties: {
        version: { type: 'integer', enum: [1] },
        title: { type: 'string', description: 'Chart title (max 160 chars)' },
        series: {
          type: 'array',
          maxItems: 8,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Exact catalog series_id' },
              param: { type: 'string', description: 'Only for parameterized/contract_family entries' },
              label: { type: 'string', description: 'Legend label (defaults to catalog description)' },
              axis: { type: 'string', enum: ['left', 'right'], description: 'Use right for a second unit scale' },
            },
            required: ['id'],
          },
        },
        from: { type: 'string', description: 'ISO start date YYYY-MM-DD (optional)' },
        to: { type: 'string', description: 'ISO end date YYYY-MM-DD (optional)' },
        leftAxisLabel: { type: 'string' },
        rightAxisLabel: { type: 'string' },
      },
      required: ['version', 'title', 'series'],
    },
  },
]

const SYSTEM_PROMPT = `You are Hephaestus, the charting agent inside the TND Research Terminal. You turn natural-language requests into chart specifications drawn from the terminal's own series catalog.

Workflow:
1. Use search_catalog to find candidate series for each concept the user names. Try category/country filters when free-text is noisy. Never invent or guess a series_id.
2. When series are parameterized (gilt curves, futures contract families), use list_params to pick a valid param.
3. Use peek_series when you need to confirm units, magnitude, or recency (e.g. before mixing series on one axis).
4. Emit the chart via emit_chart_spec. Put series with different units or magnitudes on separate axes (axis: "right" for the second scale). Give series short, human legend labels. Set from/to when the user names a period (compute dates from the current date given below).
5. If validation errors come back, correct the spec and emit again.

Rules:
- You cannot query the database directly and you never output data values; the terminal renders the spec from its own store.
- If the user's request cannot be satisfied from the catalog (nothing relevant found), say so plainly and do not emit a spec. Suggest the closest available series instead.
- Keep prose brief: one or two sentences on what you chose and why.`

// ── Loop ─────────────────────────────────────────────────────────────────────

export interface ChatTurn { role: 'user' | 'assistant'; content: string }

export interface ToolTraceEntry { tool: string; ok: boolean; summary: string }

export interface HephaestusChatResult {
  reply: string
  spec: ChartSpecV1 | null
  iterations: number
  toolTrace: ToolTraceEntry[]
}

export interface ChatDeps {
  chatFn: ChatFn
  search: (filters: SearchFilters) => { total: number; results: CatalogRow[] }
  lookup: (id: string) => CatalogRow | undefined
  listParamsFn: (row: CatalogRow) => string[]
  peek: (row: CatalogRow, param: string | undefined) => Point[]
  now: () => number
}

export function defaultChatDeps(): ChatDeps {
  return {
    chatFn: makeChatFn(),
    search: searchCatalog,
    lookup: lookupCatalog,
    listParamsFn: listParams,
    peek: (row, param) => fetchSeriesPoints(row, param, { limit: PEEK_POINT_CAP }),
    now: () => Date.now(),
  }
}

function searchResultPayload(r: { total: number; results: CatalogRow[] }): unknown {
  return {
    total_matches: r.total,
    returned: r.results.length,
    results: r.results.map(row => ({
      series_id: row.series_id,
      kind: row.series_kind,
      description: row.description,
      units: row.units,
      frequency: row.frequency,
      data_source: row.data_source,
      country: row.country,
      category: row.category,
      first_date: row.first_date,
      last_date: row.last_date,
      seasonal_adjustment: row.seasonal_adjustment ?? null,
    })),
  }
}

export async function runHephaestusChat(
  input: { messages: ChatTurn[]; model: string },
  deps: ChatDeps = defaultChatDeps(),
): Promise<HephaestusChatResult> {
  const start = deps.now()
  const toolTrace: ToolTraceEntry[] = []
  const messages: Anthropic.MessageParam[] = input.messages.map(m => ({ role: m.role, content: m.content }))
  const system = `${SYSTEM_PROMPT}\n\nCurrent date: ${new Date().toISOString().slice(0, 10)}.`

  let lastText = ''

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    if (deps.now() - start > TIMEOUT_MS) {
      return {
        reply: lastText || 'Request timed out before a chart could be produced — try a more specific request.',
        spec: null, iterations: iteration - 1, toolTrace,
      }
    }

    const response = await deps.chatFn({ model: input.model, system, messages, tools: TOOLS })

    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text')
    if (textBlocks.length > 0) lastText = textBlocks.map(b => b.text).join('\n').trim()
    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')

    if (toolUses.length === 0) {
      // Plain answer (clarification / "not in the catalog") — no spec this turn.
      return { reply: lastText, spec: null, iterations: iteration, toolTrace }
    }

    messages.push({ role: 'assistant', content: response.content })

    const results: Anthropic.ToolResultBlockParam[] = []
    let acceptedSpec: ChartSpecV1 | null = null

    for (const tu of toolUses) {
      let result: { ok: boolean; payload: unknown }
      try {
        result = runTool(tu.name, tu.input, deps, s => { acceptedSpec = s })
      } catch (err) {
        result = { ok: false, payload: { error: err instanceof Error ? err.message : String(err) } }
      }
      toolTrace.push({
        tool: tu.name,
        ok: result.ok,
        summary: JSON.stringify(result.payload).slice(0, 200),
      })
      results.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result.payload),
        is_error: !result.ok,
      })
    }

    messages.push({ role: 'user', content: results })

    if (acceptedSpec) {
      return {
        reply: lastText || 'Chart spec ready.',
        spec: acceptedSpec, iterations: iteration, toolTrace,
      }
    }
  }

  return {
    reply: lastText || `Hit the ${MAX_ITERATIONS}-iteration cap without producing a chart — try a more specific request.`,
    spec: null, iterations: MAX_ITERATIONS, toolTrace,
  }
}

function runTool(
  name: string,
  rawInput: unknown,
  deps: ChatDeps,
  onSpecAccepted: (spec: ChartSpecV1) => void,
): { ok: boolean; payload: unknown } {
  const input = (typeof rawInput === 'object' && rawInput !== null ? rawInput : {}) as Record<string, unknown>

  switch (name) {
    case 'search_catalog': {
      const r = deps.search({
        q: typeof input.q === 'string' ? input.q : undefined,
        source: typeof input.source === 'string' ? input.source : undefined,
        country: typeof input.country === 'string' ? input.country : undefined,
        category: typeof input.category === 'string' ? input.category : undefined,
      })
      return { ok: true, payload: searchResultPayload(r) }
    }

    case 'peek_series': {
      const id = typeof input.id === 'string' ? input.id : ''
      const row = deps.lookup(id)
      if (!row) return { ok: false, payload: { error: `unknown series_id '${id}' — use search_catalog` } }
      const param = typeof input.param === 'string' ? input.param : undefined
      const points = deps.peek(row, param)
      return {
        ok: true,
        payload: { series_id: id, units: row.units, frequency: row.frequency, latest_points: points },
      }
    }

    case 'list_params': {
      const id = typeof input.id === 'string' ? input.id : ''
      const row = deps.lookup(id)
      if (!row) return { ok: false, payload: { error: `unknown series_id '${id}' — use search_catalog` } }
      if (row.series_kind === 'single') {
        return { ok: false, payload: { error: `'${id}' is a single series — no params; reference it directly` } }
      }
      return { ok: true, payload: { series_id: id, kind: row.series_kind, params: deps.listParamsFn(row) } }
    }

    case 'emit_chart_spec': {
      const structural = validateSpecStructure(rawInput)
      if (!structural.ok) return { ok: false, payload: { validation_errors: structural.errors } }
      const catalog = validateSpecCatalog(structural.spec, { lookup: deps.lookup, listParams: deps.listParamsFn })
      if (!catalog.ok) return { ok: false, payload: { validation_errors: catalog.errors } }
      onSpecAccepted(catalog.spec)
      return { ok: true, payload: { accepted: true } }
    }

    default:
      return { ok: false, payload: { error: `unknown tool '${name}'` } }
  }
}
