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
  MAX_SERIES_PER_SPEC, MAX_TITLE_LEN, TRANSFORM_TYPES, MAX_TRANSFORM_WINDOW, DERIVED_OPS,
  type ChartSpecV1, type CatalogRow,
} from './chartSpec'
import { searchCatalog, lookupCatalog, listParams, SEARCH_RESULT_CAP, type SearchFilters } from './catalogSearch'
import { fetchSeriesPoints, type Point } from './render'
import { makeChatFn, type ChatFn } from './claudeClient'

export const MAX_ITERATIONS = 10
export const TIMEOUT_MS = 60_000
export const PEEK_POINT_CAP = 5

// ── emit_chart_spec schema ───────────────────────────────────────────────────
// Built from the SAME canonical constants as the TS validator (chartSpec.ts)
// so the two cannot drift silently; chatSchema.test.ts guards the remaining
// hand-written parts. Deliberate schema limitation: the series item is a
// flattened direct/derived union (JSON Schema conditional requireds would be
// needed to enforce kind-dependent fields; the TS validator enforces them and
// returns specific errors the model recovers from).

const SERIES_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Exact catalog series_id from search_catalog' },
    param: { type: 'string', description: 'Only for parameterized/contract_family entries (see list_params)' },
  },
  required: ['id'],
} as const

const TRANSFORM_SCHEMA = {
  type: 'object',
  description:
    'Server-side transform. Shapes: {type:"level"} (default), {type:"rebase100"} (=100 at first point in range), ' +
    '{type:"yoy_pct"}, {type:"mom_pct"}, {type:"diff",periods:N}, {type:"zscore",window:N} (window ≥ 2), ' +
    '{type:"rolling_mean",window:N}. On derived series the transform applies AFTER the op.',
  properties: {
    type: { type: 'string', enum: [...TRANSFORM_TYPES] },
    periods: { type: 'integer', minimum: 1, maximum: MAX_TRANSFORM_WINDOW, description: 'diff only: observations back' },
    window: { type: 'integer', minimum: 1, maximum: MAX_TRANSFORM_WINDOW, description: 'zscore (min 2) / rolling_mean: rolling window in observations' },
  },
  required: ['type'],
} as const

export const EMIT_CHART_SPEC_SCHEMA = {
  type: 'object',
  properties: {
    version: { type: 'integer', enum: [1] },
    title: { type: 'string', maxLength: MAX_TITLE_LEN, description: `Chart title (max ${MAX_TITLE_LEN} chars)` },
    series: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_SERIES_PER_SPEC,
      description:
        'Each entry is either a direct series {id, param?, transform?, label?, axis?} or a derived series ' +
        '{kind: "derived", op, a: {id, param?}, b: {id, param?}, label (required), transform?, axis?}. ' +
        'Derived = a op b, computed only on dates where both inputs have native observations (no fill).',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['direct', 'derived'], description: 'Omit for direct series' },
          id: { type: 'string', description: 'Direct only: exact catalog series_id' },
          param: { type: 'string', description: 'Direct only: for parameterized/contract_family entries' },
          op: { type: 'string', enum: [...DERIVED_OPS], description: 'Derived only' },
          a: { ...SERIES_INPUT_SCHEMA, description: 'Derived only: first input' },
          b: { ...SERIES_INPUT_SCHEMA, description: 'Derived only: second input' },
          transform: TRANSFORM_SCHEMA,
          label: { type: 'string', description: 'Legend label — required for derived, optional for direct' },
          axis: { type: 'string', enum: ['left', 'right'], description: 'Use right for a second unit scale' },
        },
      },
    },
    from: { type: 'string', description: 'ISO start date YYYY-MM-DD (optional)' },
    to: { type: 'string', description: 'ISO end date YYYY-MM-DD (optional)' },
    leftAxisLabel: { type: 'string' },
    rightAxisLabel: { type: 'string' },
  },
  required: ['version', 'title', 'series'],
} as const

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
    // `as const` keeps the schema literal-typed for the drift-guard test;
    // the SDK's InputSchema wants mutable arrays, hence the cast.
    input_schema: EMIT_CHART_SPEC_SCHEMA as unknown as Anthropic.Tool.InputSchema,
  },
]

const SYSTEM_PROMPT = `You are Hephaestus, the charting agent inside the TND Research Terminal. You turn natural-language requests into chart specifications drawn from the terminal's own series catalog.

Workflow:
1. Use search_catalog to find candidate series for each concept the user names. Try category/country filters when free-text is noisy. Never invent or guess a series_id. Prefer canonical entries over ones whose description says "(duplicate of …)".
2. When series are parameterized (gilt curves, futures contract families), use list_params to pick a valid param.
3. Use peek_series when you need to confirm units, magnitude, or recency (e.g. before mixing series on one axis).
4. Emit the chart via emit_chart_spec. Put series with different units or magnitudes on separate axes (axis: "right" for the second scale). Give series short, human legend labels. Set from/to when the user names a period (compute dates from the current date given below).
5. If validation errors come back, correct the spec and emit again.

Transforms and derived series:
- Use transforms for "rebased/indexed to 100" (rebase100), "YoY/annual change" (yoy_pct), "MoM" (mom_pct), smoothing (rolling_mean), z-scores (zscore).
- Use derived series for spreads, differentials, real yields (nominal minus matching-tenor breakeven/inflation-expectation series), and ratios. Explain your construction briefly in your text response.
- Derived inputs (a and b) are RAW series — the transform applies only AFTER the op. You cannot transform an input first (e.g. nominal minus yoy_pct(CPI index) is NOT expressible). If a construction would require transforming an input, don't force it: offer the closest expressible chart (e.g. a different tenor where a breakeven series exists) or explain what's missing.
- Derived series compute only on dates where BOTH inputs have native observations — there is no fill. When the two inputs have different frequencies (e.g. daily vs monthly), warn the user in your text response that the derived line will be sparse (at most the coarser frequency).
- Be decisive: you have a hard budget of 10 turns. If a few searches don't surface the ideal series, emit the best expressible chart with caveats in your text, or say plainly what the catalog lacks — do not keep searching.

Rules:
- You cannot query the database directly and you never output data values; the terminal renders the spec from its own store.
- Match seasonal adjustment across compared series where possible; when you must mix SA and NSA, or mix frequencies on one chart, say so in your text response.
- If the request is ambiguous (e.g. "chart inflation" — which country? which measure?), ask a clarifying question in text and emit no spec.
- If the user's request cannot be satisfied from the catalog (nothing relevant found), say so plainly and do not emit a spec. Suggest the closest available series instead.
- Keep prose brief: one or two sentences on what you chose and why.`

// ── Loop ─────────────────────────────────────────────────────────────────────

export interface ChatTurn { role: 'user' | 'assistant'; content: string }

export interface ToolTraceEntry { tool: string; ok: boolean; summary: string }

export interface PeekResult {
  latest_points: Point[]     // hard-capped at PEEK_POINT_CAP
  count: number
  min: number | null
  max: number | null
}

export interface HephaestusChatResult {
  reply: string
  spec: ChartSpecV1 | null
  iterations: number
  toolTrace: ToolTraceEntry[]
  usage: { input_tokens: number; output_tokens: number }
}

export interface ChatDeps {
  chatFn: ChatFn
  search: (filters: SearchFilters) => { total: number; results: CatalogRow[] }
  lookup: (id: string) => CatalogRow | undefined
  listParamsFn: (row: CatalogRow) => string[]
  peek: (row: CatalogRow, param: string | undefined) => PeekResult
  now: () => number
}

function peekWithStats(row: CatalogRow, param: string | undefined): PeekResult {
  const points = fetchSeriesPoints(row, param, {})
  let min: number | null = null
  let max: number | null = null
  for (const p of points) {
    if (min === null || p.value < min) min = p.value
    if (max === null || p.value > max) max = p.value
  }
  return { latest_points: points.slice(-PEEK_POINT_CAP), count: points.length, min, max }
}

export function defaultChatDeps(): ChatDeps {
  return {
    chatFn: makeChatFn(),
    search: searchCatalog,
    lookup: lookupCatalog,
    listParamsFn: listParams,
    peek: peekWithStats,
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
  const usage = { input_tokens: 0, output_tokens: 0 }

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    if (deps.now() - start > TIMEOUT_MS) {
      return {
        reply: lastText || 'Request timed out before a chart could be produced — try a more specific request.',
        spec: null, iterations: iteration - 1, toolTrace, usage,
      }
    }

    const response = await deps.chatFn({ model: input.model, system, messages, tools: TOOLS })
    if (response.usage) {
      usage.input_tokens += response.usage.input_tokens ?? 0
      usage.output_tokens += response.usage.output_tokens ?? 0
    }

    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text')
    if (textBlocks.length > 0) lastText = textBlocks.map(b => b.text).join('\n').trim()
    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')

    if (toolUses.length === 0) {
      // Plain answer (clarification / "not in the catalog") — no spec this turn.
      return { reply: lastText, spec: null, iterations: iteration, toolTrace, usage }
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
        spec: acceptedSpec, iterations: iteration, toolTrace, usage,
      }
    }
  }

  return {
    reply: lastText || `Hit the ${MAX_ITERATIONS}-iteration cap without producing a chart — try a more specific request.`,
    spec: null, iterations: MAX_ITERATIONS, toolTrace, usage,
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
      const peek = deps.peek(row, param)
      return {
        ok: true,
        payload: {
          series_id: id, units: row.units, frequency: row.frequency,
          seasonal_adjustment: row.seasonal_adjustment ?? null, ...peek,
        },
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
