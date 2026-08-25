// @vitest-environment happy-dom
//
// Gate-3 acceptance demo for the Position Sizing page. No browser exists in
// this environment, so the page is mounted with @testing-library/react and
// driven through real focus/change/blur cycles. The GET payloads are pulled
// from the REAL seeded SQLite database (not fixtures), so a bad seed fails
// this demo exactly as it would fail the rendered page.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createRequire } from 'node:module'
import path from 'node:path'
import { PositionSizingPage, fmtCurrency0, fmtCurrency2 } from './PositionSizingPage'

interface StatementLike {
  get(...args: unknown[]): unknown
  all(...args: unknown[]): unknown[]
}
interface DatabaseLike {
  prepare(sql: string): StatementLike
  close(): void
}
type DatabaseCtor = new (path: string, opts?: { readonly?: boolean }) => DatabaseLike

// happy-dom rewrites import.meta.url to an http:// URL, so anchor on the
// vitest working directory (the client package root) instead.
const require = createRequire(path.join(process.cwd(), 'package.json'))
const Database = require('better-sqlite3') as DatabaseCtor
const dbPath = path.resolve(process.cwd(), '..', 'fred_data.db')

interface InstrumentSeedRow {
  symbol: string
  group_name: string
  tick_size_display: string
  tick_size_decimal: number
  tick_value: number | null
  initial_margin: number | null
  sort_order: number
}

function loadSeed() {
  const db = new Database(dbPath, { readonly: true })
  try {
    return {
      settings: db.prepare('SELECT * FROM ps_settings WHERE id = 1').get() as Record<string, number>,
      instruments: db.prepare('SELECT * FROM ps_instruments ORDER BY sort_order').all() as InstrumentSeedRow[],
      stopLadder: (db.prepare('SELECT stop_ticks FROM ps_stop_ladder ORDER BY sort_order').all() as Array<{ stop_ticks: number }>).map(r => r.stop_ticks),
      contractLadder: (db.prepare('SELECT contracts FROM ps_contract_ladder ORDER BY sort_order').all() as Array<{ contracts: number }>).map(r => r.contracts),
    }
  } finally {
    db.close()
  }
}

const SEED = loadSeed()

interface MockConfig {
  instruments: InstrumentSeedRow[]
  stopLadder: number[]
  contractLadder: number[]
}

const putCalls: Array<{ url: string; body: unknown }> = []

function stubFetch(config: MockConfig): void {
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const json = (data: unknown) => Promise.resolve(new Response(JSON.stringify(data), { status: 200 }))
    if (method === 'PUT') {
      putCalls.push({ url, body: JSON.parse(String(init?.body)) })
      return json({ ok: true })
    }
    if (url.endsWith('/settings')) return json(SEED.settings)
    if (url.endsWith('/instruments')) return json(config.instruments)
    if (url.endsWith('/ladders')) return json({ stopLadder: config.stopLadder, contractLadder: config.contractLadder })
    return Promise.resolve(new Response('not found', { status: 404 }))
  })
}

async function mountPage(): Promise<void> {
  render(
    <MemoryRouter>
      <PositionSizingPage />
    </MemoryRouter>,
  )
  await screen.findByText('SETUP')
}

interface ParsedCell {
  text: string
  red: boolean
}

function gridRows(testId: string): Array<{ headers: string[]; cells: ParsedCell[] }> {
  const table = screen.getByTestId(testId)
  return [...table.querySelectorAll('tbody tr')].map(tr => ({
    headers: [...tr.querySelectorAll('th')].map(th => th.textContent ?? ''),
    cells: [...tr.querySelectorAll('td')].map(td => ({
      text: td.textContent ?? '',
      red: td.className.includes('cellRed'),
    })),
  }))
}

function rowByFirstHeader(testId: string, header: string): { headers: string[]; cells: ParsedCell[] } {
  const row = gridRows(testId).find(r => r.headers[0] === header)
  expect(row, `${testId} row "${header}"`).toBeDefined()
  return row as { headers: string[]; cells: ParsedCell[] }
}

function unitColumnCount(testId: string): number {
  const table = screen.getByTestId(testId)
  const firstHeadRow = table.querySelector('thead tr')
  return (firstHeadRow?.querySelectorAll('th').length ?? 0) - 3
}

function commitInput(label: string, value: string): void {
  const input = screen.getByLabelText(label)
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

function parseDollars(text: string): number {
  return Number(text.replace(/[$,()]/g, '')) * (text.startsWith('(') ? -1 : 1)
}

/** The computed value cell of a Setup-panel row, addressed by its exact label. */
function setupValue(label: string): string {
  const th = screen.getByText(label)
  return th.parentElement?.querySelector('td')?.textContent ?? ''
}

beforeEach(() => {
  putCalls.length = 0
  stubFetch({ instruments: SEED.instruments, stopLadder: SEED.stopLadder, contractLadder: SEED.contractLadder })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('acceptance §2 — seed values, ES selected', () => {
  it('reproduces the workbook Setup figures and 1–8 unit ladder', async () => {
    await mountPage()
    expect(setupValue('Current Risk Budget')).toBe('$500,000.00')
    expect(setupValue('$ Budget of Risk based on unit of risk per trade')).toBe('$1,250.00')
    expect(setupValue('Max Risk Budget')).toBe('$10,000.00')
    expect(setupValue('Max Drawdown On Principle ($)')).toBe('$25,000.00')

    const ladder = screen.getByTestId('unit-ladder')
    const rows = [...ladder.querySelectorAll('tbody tr')].map(tr =>
      [...tr.querySelectorAll('td')].map(td => td.textContent ?? ''),
    )
    expect(rows).toEqual([
      ['1', '$1,250'], ['2', '$2,500'], ['3', '$3,750'], ['4', '$5,000'],
      ['5', '$6,250'], ['6', '$7,500'], ['7', '$8,750'], ['8', '$10,000'],
    ])
  })

  it('grid 1 reproduces all five spot-checked ES rows, zeros as red dashes', async () => {
    await mountPage()
    expect(rowByFirstHeader('contracts-grid', '20').cells.map(c => c.text)).toEqual(['5', '10', '15', '20', '25', '30', '35', '40'])
    expect(rowByFirstHeader('contracts-grid', '40').cells.map(c => c.text)).toEqual(['2', '5', '7', '10', '12', '15', '17', '20'])
    expect(rowByFirstHeader('contracts-grid', '60').cells.map(c => c.text)).toEqual(['1', '3', '5', '6', '8', '10', '11', '13'])
    expect(rowByFirstHeader('contracts-grid', '120').cells.map(c => c.text)).toEqual(['–', '1', '2', '3', '4', '5', '5', '6'])
    expect(rowByFirstHeader('contracts-grid', '200').cells.map(c => c.text)).toEqual(['–', '1', '1', '2', '2', '3', '3', '4'])

    // A zero cell is red AND still shows its dash — legible, not empty.
    const zeroCell = rowByFirstHeader('contracts-grid', '120').cells[0]
    expect(zeroCell.red).toBe(true)
    expect(zeroCell.text).toBe('–')
    // Non-zero cells are not red.
    expect(rowByFirstHeader('contracts-grid', '20').cells.every(c => !c.red)).toBe(true)
  })

  it('grid 2: stop 20 / 1 unit is $114,901; red iff the cell exceeds capital', async () => {
    await mountPage()
    expect(rowByFirstHeader('margin-grid', '20').cells[0].text).toBe('$114,901')
    for (const row of gridRows('margin-grid')) {
      for (const cell of row.cells) {
        const breaching = cell.text !== '–' && parseDollars(cell.text) > 500_000
        expect(cell.red, `${row.headers[0]} → ${cell.text}`).toBe(breaching)
      }
    }
    // and breaches do exist at seed: 40 contracts × 22,980.1 = $919,204
    expect(rowByFirstHeader('margin-grid', '20').cells[7]).toEqual({ text: '$919,204', red: true })
  })

  it('grid 3: stop 40 / 1 unit is $1,000 (rounding slack vs $1,250); never red', async () => {
    await mountPage()
    const row = rowByFirstHeader('risk-grid', '40')
    expect(row.cells[0].text).toBe('$1,000')
    expect(gridRows('risk-grid').every(r => r.cells.every(c => !c.red))).toBe(true)
  })

  it('grid 4: 3 contracts / 4 units is 133 ticks; margin-used column red only above capital', async () => {
    await mountPage()
    const row = rowByFirstHeader('inverse-grid', '3')
    expect(row.cells[3].text).toBe('133')
    expect(row.headers[1]).toBe('$68,940') // 3 × 22,980.1
  })
})

describe('acceptance §3 — market money above and below Principle', () => {
  it('600k portfolio → budget $525,000.00; 400k → $475,000.00 with parenthesized negatives', async () => {
    await mountPage()
    commitInput('Current Portfolio Value', '600000')
    expect(screen.getByText('$525,000.00')).toBeDefined() // 500k + 25% of 100k
    expect(screen.getByText('$100,000.00')).toBeDefined() // market money

    commitInput('Current Portfolio Value', '400000')
    expect(screen.getByText('$475,000.00')).toBeDefined() // NOT clamped
    expect(screen.getByText('($100,000.00)')).toBeDefined() // negatives in parentheses
    expect(screen.getByText('($25,000.00)')).toBeDefined() // additional risk budget

    // grids updated: per-unit budget now $1,187.50 → stop 20 → floor(1187.5/250) = 4
    expect(rowByFirstHeader('contracts-grid', '20').cells[0].text).toBe('4')
    // both edits were persisted via PUT
    expect(putCalls.filter(c => c.url.endsWith('/settings'))).toHaveLength(2)
  })
})

describe('acceptance §4 — ladder length follows the percentages', () => {
  it('Max Units 3.00% → 12 units; Unit of Risk 0.50% → 4 units; all grids widen/narrow', async () => {
    await mountPage()
    commitInput('Max Units of Risk Per Trade', '3')
    for (const grid of ['contracts-grid', 'margin-grid', 'risk-grid', 'inverse-grid']) {
      expect(unitColumnCount(grid), grid).toBe(12)
    }
    const ladderRows = screen.getByTestId('unit-ladder').querySelectorAll('tbody tr')
    expect(ladderRows).toHaveLength(12)
    expect(ladderRows[11].textContent).toContain('$15,000') // 12th budget: 1250 × 12

    commitInput('Unit of Risk Per Trade', '0.5')
    for (const grid of ['contracts-grid', 'margin-grid', 'risk-grid', 'inverse-grid']) {
      expect(unitColumnCount(grid), grid).toBe(6) // 3.00% / 0.50%
    }
    commitInput('Max Units of Risk Per Trade', '2')
    for (const grid of ['contracts-grid', 'margin-grid', 'risk-grid', 'inverse-grid']) {
      expect(unitColumnCount(grid), grid).toBe(4) // 2.00% / 0.50%
    }
  })
})

describe('acceptance §6 — instrument switching', () => {
  it('MES gives 10× the ES contract counts', async () => {
    await mountPage()
    fireEvent.change(screen.getByLabelText('Instrument'), { target: { value: 'MES' } })
    expect(rowByFirstHeader('contracts-grid', '20').cells.map(c => c.text)).toEqual(['50', '100', '150', '200', '250', '300', '350', '400'])
  })

  it('6J renders its tick size in full and $/point 12,500,000', async () => {
    await mountPage()
    fireEvent.change(screen.getByLabelText('Instrument'), { target: { value: '6J' } })
    const strip = screen.getByTestId('spec-strip')
    expect(strip.textContent).toContain('0.0000005')
    expect(strip.textContent).not.toContain('5e-7')
    expect(strip.textContent).toContain('$12,500,000')
  })
})

describe('acceptance §8 — margin editable, tick specs read-only, no Margin Source', () => {
  it('editing ES initial margin PUTs margin only and re-derives the margin grid', async () => {
    await mountPage()
    commitInput('ES initial margin', '23000')
    const call = putCalls.find(c => c.url.endsWith('/instruments/ES'))
    expect(call?.body).toEqual({ initial_margin: 23000 })
    expect(rowByFirstHeader('margin-grid', '20').cells[0].text).toBe('$115,000') // 5 × 23,000
  })

  it('the string "Margin Source" appears nowhere on the page', async () => {
    await mountPage()
    expect(document.body.textContent).not.toContain('Margin Source')
  })
})

describe('null-margin semantics (Gate-2 item 2)', () => {
  it('null ES margin → margin cells dash and NOT red; grids 1 and 3 unaffected', async () => {
    stubFetch({
      instruments: SEED.instruments.map(r => (r.symbol === 'ES' ? { ...r, initial_margin: null } : r)),
      stopLadder: SEED.stopLadder,
      contractLadder: SEED.contractLadder,
    })
    await mountPage()

    // Grid 2: every cell is – (unknown) and none is red (not breaching)
    for (const row of gridRows('margin-grid')) {
      expect(row.cells.every(c => c.text === '–' && !c.red)).toBe(true)
    }
    // Null never coerces to $0 anywhere
    expect(screen.getByTestId('margin-grid').textContent).not.toContain('$0')

    // Grid 1 and grid 3 depend on tick_value, not margin — untouched
    expect(rowByFirstHeader('contracts-grid', '20').cells.map(c => c.text)).toEqual(['5', '10', '15', '20', '25', '30', '35', '40'])
    expect(rowByFirstHeader('risk-grid', '40').cells[0].text).toBe('$1,000')

    // Grid 4: margin-used column dashes, but max stop ticks still computed
    const inverseRow = rowByFirstHeader('inverse-grid', '3')
    expect(inverseRow.headers[1]).toBe('–')
    expect(inverseRow.cells[3].text).toBe('133')

    // Reference table: Max Contracts on Capital is – for the null row
    const refRow = [...screen.getByTestId('instrument-reference').querySelectorAll('tbody tr')]
      .find(tr => tr.querySelector('th')?.textContent === 'ES')
    const lastCell = refRow?.querySelector('td:last-child')
    expect(lastCell?.textContent).toBe('–')
  })
})

describe('degenerate states (Gate-2 item 4)', () => {
  it('unitCount 0 renders the inline message, not a crash or empty page', async () => {
    await mountPage()
    commitInput('Max Units of Risk Per Trade', '0.1') // 0.10% < 0.25%
    const messages = screen.getAllByText(/below one Unit of Risk/)
    expect(messages.length).toBeGreaterThan(0)
    for (const grid of ['contracts-grid', 'margin-grid', 'risk-grid', 'inverse-grid']) {
      expect(unitColumnCount(grid), grid).toBe(0) // row headers remain, zero unit columns
    }
  })

  it('empty ladders render add-rows empty states instead of broken grids', async () => {
    stubFetch({ instruments: SEED.instruments, stopLadder: [], contractLadder: [] })
    await mountPage()
    expect(screen.getAllByText(/No stop distances — add rows/)).toHaveLength(3)
    expect(screen.getAllByText(/No contract counts — add rows/)).toHaveLength(1)
  })
})

describe('ladder editing persists via PUT', () => {
  it('removing a stop row updates grids and PUTs the new ladder', async () => {
    await mountPage()
    fireEvent.click(screen.getByLabelText('Remove Stop ladder (ticks) row 200'))
    await waitFor(() => {
      expect(gridRows('contracts-grid')).toHaveLength(7)
    })
    const call = putCalls.find(c => c.url.endsWith('/ladders'))
    expect(call?.body).toEqual({ stopLadder: [20, 40, 60, 80, 100, 120, 160] })
  })
})

describe('currency formatter — Excel rounding on negatives (Gate-3 item 3)', () => {
  it('rounds half AWAY from zero on negatives: −0.5 is ($1), never $0', () => {
    // Math.round(-0.5) is -0 in JS; the formatters must not route through it.
    expect(fmtCurrency0(-0.5)).toBe('($1)')
    expect(fmtCurrency2(-0.005)).toBe('($0.01)')
  })
})

describe('save-failure surfacing', () => {
  it('a failed PUT keeps the local value but shows the error banner', async () => {
    await mountPage()
    vi.stubGlobal('fetch', (): Promise<Response> =>
      Promise.resolve(new Response(JSON.stringify({ error: 'server rejected it' }), { status: 400 })),
    )
    commitInput('Current Portfolio Value', '650000')
    expect(screen.getByText('$537,500.00')).toBeDefined() // local recompute happened
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('server rejected it')
  })
})
