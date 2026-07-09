import { describe, it, expect } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { runHephaestusChat, type ChatDeps } from './chat'
import type { CatalogRow } from './chartSpec'
import type { ChatRequest } from './claudeClient'

function row(overrides: Partial<CatalogRow>): CatalogRow {
  return {
    series_id: 'DGS10', series_kind: 'single', source_table: 'series_observations',
    description: '10-Year Treasury Yield', units: '%', frequency: 'daily',
    data_source: 'FRED', country: 'US', category: 'rates',
    first_date: '1962-01-02', last_date: '2026-07-01',
    ...overrides,
  }
}

// Minimal Anthropic.Message stub — the loop reads only `content`.
function msg(content: Array<Record<string, unknown>>): Anthropic.Message {
  return { content } as unknown as Anthropic.Message
}

function toolUse(id: string, name: string, input: unknown): Record<string, unknown> {
  return { type: 'tool_use', id, name, input }
}

function makeDeps(turns: Anthropic.Message[], catalog: Map<string, CatalogRow>): ChatDeps & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = []
  let i = 0
  return {
    requests,
    chatFn: async req => {
      // Snapshot: the loop reuses one messages array; capture its state per call.
      requests.push({ ...req, messages: [...req.messages] })
      if (i >= turns.length) throw new Error('stub exhausted')
      return turns[i++]
    },
    search: () => ({ total: 1, results: [...catalog.values()] }),
    lookup: id => catalog.get(id),
    listParamsFn: () => [],
    peek: () => [{ date: '2026-07-01', value: 4.2 }],
    now: () => 0,   // frozen clock — never times out in tests
  }
}

const CATALOG = new Map([['DGS10', row({})]])
const input = { messages: [{ role: 'user' as const, content: 'chart the US 10 year' }], model: 'claude-sonnet-5' }

describe('runHephaestusChat', () => {
  it('returns a plain reply when the model emits no tool calls', async () => {
    const deps = makeDeps([msg([{ type: 'text', text: 'Nothing matching in the catalog.' }])], CATALOG)
    const r = await runHephaestusChat(input, deps)
    expect(r.spec).toBeNull()
    expect(r.reply).toBe('Nothing matching in the catalog.')
    expect(r.iterations).toBe(1)
  })

  it('recovers from a rejected spec: invalid emit → is_error result → valid emit', async () => {
    const deps = makeDeps([
      msg([toolUse('t1', 'emit_chart_spec', { version: 1, title: 'US 10Y', series: [{ id: 'NOT_A_REAL_ID' }] })]),
      msg([
        { type: 'text', text: 'Corrected the series id.' },
        toolUse('t2', 'emit_chart_spec', { version: 1, title: 'US 10Y', series: [{ id: 'DGS10' }] }),
      ]),
    ], CATALOG)

    const r = await runHephaestusChat(input, deps)

    expect(r.spec).not.toBeNull()
    expect(r.spec?.series[0].id).toBe('DGS10')
    expect(r.iterations).toBe(2)
    expect(r.reply).toBe('Corrected the series id.')

    // The failed emit went back to the model as an is_error tool_result
    // carrying the validation errors (this is the recovery channel).
    const trace = r.toolTrace
    expect(trace[0]).toMatchObject({ tool: 'emit_chart_spec', ok: false })
    expect(trace[0].summary).toContain('not in the series catalog')
    expect(trace[1]).toMatchObject({ tool: 'emit_chart_spec', ok: true })

    const secondRequest = deps.requests[1]
    const toolResultTurn = secondRequest.messages[secondRequest.messages.length - 1]
    const blocks = toolResultTurn.content as Anthropic.ToolResultBlockParam[]
    expect(blocks[0].is_error).toBe(true)
    expect(String(blocks[0].content)).toContain('validation_errors')
  })

  it('runs search/peek tools and feeds results back', async () => {
    const deps = makeDeps([
      msg([toolUse('t1', 'search_catalog', { q: '10 year' })]),
      msg([toolUse('t2', 'emit_chart_spec', { version: 1, title: 'US 10Y', series: [{ id: 'DGS10' }] })]),
    ], CATALOG)
    const r = await runHephaestusChat(input, deps)
    expect(r.spec).not.toBeNull()
    const searchResultTurn = deps.requests[1].messages[deps.requests[1].messages.length - 1]
    const blocks = searchResultTurn.content as Anthropic.ToolResultBlockParam[]
    expect(String(blocks[0].content)).toContain('DGS10')
  })

  it('stops at the iteration cap when the model never emits a spec', async () => {
    const searchTurn = () => msg([toolUse('t', 'search_catalog', { q: 'x' })])
    const deps = makeDeps(Array.from({ length: 10 }, searchTurn), CATALOG)
    const r = await runHephaestusChat(input, deps)
    expect(r.spec).toBeNull()
    expect(r.iterations).toBe(10)
    expect(r.reply).toContain('10-iteration cap')
  })

  it('rejects unknown tools with an error result and keeps going', async () => {
    const deps = makeDeps([
      msg([toolUse('t1', 'run_sql', { sql: 'DROP TABLE series_catalog' })]),
      msg([{ type: 'text', text: 'Understood.' }]),
    ], CATALOG)
    const r = await runHephaestusChat(input, deps)
    expect(r.toolTrace[0]).toMatchObject({ tool: 'run_sql', ok: false })
    expect(r.spec).toBeNull()
  })
})
