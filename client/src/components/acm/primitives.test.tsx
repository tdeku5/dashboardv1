// @vitest-environment happy-dom
//
// Asset Class Models shared primitives (Phase 1 Turn 4).
// Spec: docs/asset-class-models-design-notes.md + the turn-3 approval prompt.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  AcmPageHeader, AcmNavTier, AcmPanel, AcmDataTable, AcmStatTile, AcmStatStrip, AcmChartFrame,
  AcmCollapsible, isSeriesColor, NULL_DASH, type AcmColumn,
} from './index'
import tableStyles from './AcmDataTable.module.css'
import tones from './tones.module.css'
import navStyles from './AcmNavTier.module.css'
import { COUNTRY_COLORS } from '../../constants/identityColors'
import { contrast, composite } from '../../lib/paletteCheck'
import { hex, tint } from '../../styles/acmTokenReader'

afterEach(() => cleanup())

const DIR = [path.resolve(process.cwd(), 'src/components/acm'), path.resolve(process.cwd(), 'client/src/components/acm')]
  .find(p => { try { readdirSync(p); return true } catch { return false } })!
const cssOf = (f: string) => readFileSync(path.join(DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
/** Declarations inside every rule whose selector matches `sel`. */
function declsFor(css: string, sel: RegExp): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => sel.test(m[1])).flatMap(m => m[2].split(';').map(d => d.trim()).filter(Boolean))
}
const MINUS = '−'

// ── Component-level root rule ───────────────────────────────────────────────

describe('every primitive carries acm-root on its own outermost element', () => {
  const cases: Array<[string, () => JSX.Element]> = [
    ['AcmPageHeader', () => <AcmPageHeader title="T" />],
    ['AcmNavTier', () => <AcmNavTier tier="section" label="L" items={[{ key: 'a', label: 'A' }]} value="a" onChange={() => {}} />],
    ['AcmPanel', () => <AcmPanel>x</AcmPanel>],
    ['AcmDataTable', () => <AcmDataTable columns={[]} rows={[]} rowKey={(_, i) => String(i)} />],
    ['AcmStatTile', () => <AcmStatTile label="L" value={1} />],
    ['AcmStatStrip', () => <AcmStatStrip>x</AcmStatStrip>],
    ['AcmChartFrame', () => <AcmChartFrame title="T" height={100}><div /></AcmChartFrame>],
    ['AcmCollapsible', () => <AcmCollapsible title="T">x</AcmCollapsible>],
  ]
  for (const [name, el] of cases) {
    it(name, () => {
      const { container } = render(el())
      expect(container.firstElementChild?.classList.contains('acm-root')).toBe(true)
    })
  }
})

// ── Page header ─────────────────────────────────────────────────────────────

describe('AcmPageHeader', () => {
  it('renders title, subtitle and as-of (as-of in mono figures)', () => {
    render(<AcmPageHeader title="US Rates — VOL" subtitle="Realized MOVE" asOf="2026-10-12" />)
    expect(screen.getByRole('heading', { name: 'US Rates — VOL' })).toBeTruthy()
    expect(screen.getByText('Realized MOVE')).toBeTruthy()
    expect(screen.getByText('2026-10-12').className).toContain('acm-num')
  })
  it('omits the as-of block when there is no date', () => {
    const { container } = render(<AcmPageHeader title="T" asOf={null} />)
    expect(container.textContent).not.toMatch(/as of/i)
  })
})

// ── Nav tiers ───────────────────────────────────────────────────────────────

describe('AcmNavTier — one unified active treatment', () => {
  const items = [{ key: 'rates', label: 'RATES' }, { key: 'fx', label: 'FX' }] as const

  it('marks the active tab (aria-selected + active class) and reports clicks', () => {
    const onChange = vi.fn()
    render(<AcmNavTier tier="asset-class" label="Asset class" items={items} value="rates" onChange={onChange} />)
    const [rates, fx] = screen.getAllByRole('tab')
    expect(rates.getAttribute('aria-selected')).toBe('true')
    expect(fx.getAttribute('aria-selected')).toBe('false')
    expect(rates.className).toContain(navStyles.active)
    expect(fx.className).not.toContain(navStyles.active)
    fireEvent.click(fx)
    expect(onChange).toHaveBeenCalledWith('fx')
  })

  it('the active class is the same on all three tiers', () => {
    const activeClasses = (['asset-class', 'country', 'section'] as const).map(tier => {
      const { getAllByRole, unmount } = render(<AcmNavTier tier={tier} label={tier} items={items} value="fx" onChange={() => {}} />)
      const cls = getAllByRole('tab')[1].className
      unmount()
      return cls
    })
    expect(new Set(activeClasses).size).toBe(1)
  })

  it('active text clears 4.5:1 over accent-muted composited on bg and panel', () => {
    const css = cssOf('AcmNavTier.module.css')
    const activeColor = declsFor(css, /^\s*\.active,\s*\.active:hover\s*$/).find(d => d.startsWith('color'))!.match(/var\(--(acm-[\w-]+)\)/)![1]
    const [fill, alpha] = tint('acm-accent-muted')
    const rows: string[] = []
    for (const text of [...new Set([activeColor, 'acm-accent'])]) {
      for (const surface of ['acm-surface-bg', 'acm-surface-panel']) {
        const ratio = contrast(hex(text), composite(fill, alpha, hex(surface)))
        rows.push(`${text.padEnd(17)} on accent-muted (${Math.round(alpha * 100)}%) over ${surface.replace('acm-surface-', '').padEnd(6)} ${ratio.toFixed(2)}`)
        expect(ratio, `${text} / ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    }
    console.log(`AcmNavTier .active text = --${activeColor}\n` + rows.join('\n'))
  })

  it('CSS: active + hover use accent / surface tokens; tier rules set size only, never colour', () => {
    const css = cssOf('AcmNavTier.module.css')
    const active = declsFor(css, /\.active/).join(';')
    expect(active).toContain('var(--acm-accent-hover)')
    expect(active).toContain('var(--acm-accent-muted)')
    expect(declsFor(css, /\.tab:hover/).join(';')).toMatch(/var\(--acm-/)
    const tierDecls = declsFor(css, /^\s*\.(asset-class|country|section)\b/)
    expect(tierDecls.length).toBeGreaterThan(0)
    tierDecls.forEach(d => expect(d).not.toMatch(/^(color|background|border-color|box-shadow)\s*:/))
    expect(css).not.toMatch(/#60a5fa|#4ade80|#f87171|blue|green|red/i)
  })
})

// ── Panel ───────────────────────────────────────────────────────────────────

describe('AcmPanel', () => {
  it('renders title, actions, body and footer', () => {
    render(<AcmPanel title="Contribution" actions={<button>1Y</button>} footer="Source: TV">body</AcmPanel>)
    expect(screen.getByRole('heading', { name: 'Contribution' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '1Y' })).toBeTruthy()
    expect(screen.getByText('body')).toBeTruthy()
    expect(screen.getByText('Source: TV')).toBeTruthy()
  })
  it('renders no header strip when there is no title or actions', () => {
    const { container } = render(<AcmPanel>only body</AcmPanel>)
    expect(container.querySelector('h3')).toBeNull()
  })
})

// ── Data table ──────────────────────────────────────────────────────────────

interface Row { tenor: string; rv: number | null; chg: number | null; z: number | null; text: string | null }
const ROWS: Row[] = [
  { tenor: '2Y', rv: 81.234, chg: -3.5, z: 2.4, text: `${MINUS}1.20` },
  { tenor: '10Y', rv: null, chg: 1.25, z: -0.3, text: null },
  { tenor: '30Y', rv: NaN, chg: null, z: 3.6, text: '' },
]
const COLS: AcmColumn<Row>[] = [
  { key: 'tenor', header: 'Tenor', kind: 'label', value: r => r.tenor },
  { key: 'rv', header: 'RV', kind: 'num', value: r => r.rv, format: v => v.toFixed(1) },
  {
    key: 'chg', header: 'Δ bp', kind: 'num', value: r => r.chg, format: v => (v > 0 ? '+' : '') + v.toFixed(2),
    tone: r => (r.chg == null ? undefined : r.chg > 0 ? 'dir-up' : 'dir-down'),
  },
  {
    key: 'z', header: 'z', kind: 'num', value: r => r.z, format: v => v.toFixed(1),
    alert: r => (r.z == null ? undefined : Math.abs(r.z) > 3 ? 'strong' : Math.abs(r.z) > 2 ? 'mild' : undefined),
  },
  { key: 'text', header: 'Pre-formatted', kind: 'num', value: r => r.text },
]

function renderTable(sticky = false) {
  return render(<AcmDataTable columns={COLS} rows={ROWS} rowKey={r => r.tenor} stickyHeader={sticky} />)
}
const cell = (container: HTMLElement, row: number, col: number) =>
  container.querySelectorAll('tbody tr')[row].querySelectorAll('td')[col] as HTMLTableCellElement

describe('AcmDataTable — alignment', () => {
  it('labels are left/sans; numerics right/mono-tabular (acm-num); headers follow alignment', () => {
    const { container } = renderTable()
    expect(cell(container, 0, 0).className).toContain(tableStyles.label)
    expect(cell(container, 0, 0).className).not.toContain('acm-num')
    for (const c of [1, 2, 3, 4]) {
      expect(cell(container, 0, c).className).toContain(tableStyles.num)
      expect(cell(container, 0, c).className).toContain('acm-num')
    }
    const ths = container.querySelectorAll('th')
    expect(ths[0].className).toContain(tableStyles.label)
    expect(ths[1].className).toContain(tableStyles.num)
    const css = cssOf('AcmDataTable.module.css')
    expect(declsFor(css, /^\s*\.label\s*$/).join(';')).toContain('text-align: left')
    const num = declsFor(css, /^\s*\.num\s*$/).join(';')
    expect(num).toContain('text-align: right')
    expect(num).toContain('font-variant-numeric: tabular-nums')
    expect(num).toContain('var(--acm-font-mono)')
  })
})

describe('AcmDataTable — nulls and negatives', () => {
  it('null, undefined, NaN and empty string render as the em dash', () => {
    const { container } = renderTable()
    expect(cell(container, 1, 1).textContent).toBe(NULL_DASH)   // null
    expect(cell(container, 2, 1).textContent).toBe(NULL_DASH)   // NaN
    expect(cell(container, 2, 2).textContent).toBe(NULL_DASH)   // null with a tone fn
    expect(cell(container, 1, 4).textContent).toBe(NULL_DASH)   // null string
    expect(cell(container, 2, 4).textContent).toBe(NULL_DASH)   // ''
    expect(cell(container, 1, 1).getAttribute('data-null')).toBe('true')
  })
  it('negatives use ASCII "-" — U+2212 from a caller is normalised', () => {
    const { container } = renderTable()
    expect(cell(container, 0, 2).textContent).toBe('-3.50')
    expect(cell(container, 0, 4).textContent).toBe('-1.20')
    expect(container.textContent).not.toContain(MINUS)
  })
})

describe('AcmDataTable — colour channels (Rule 2)', () => {
  it('tone colours the value TEXT span, never the cell', () => {
    const { container } = renderTable()
    const down = cell(container, 0, 2)
    expect(down.querySelector('span')!.className).toContain(tones.dirDown)
    expect(down.className).not.toContain(tones.dirDown)
    expect(cell(container, 1, 2).querySelector('span')!.className).toContain(tones.dirUp)
  })
  it('alert tints the CELL, never the value text', () => {
    const { container } = renderTable()
    expect(cell(container, 0, 3).className).toContain(tones.alertMild)
    expect(cell(container, 2, 3).className).toContain(tones.alertStrong)
    expect(cell(container, 1, 3).className).not.toMatch(new RegExp(`${tones.alertMild}|${tones.alertStrong}`))
    expect(cell(container, 0, 3).querySelector('span')!.className).not.toContain(tones.alertMild)
  })
  it('CSS: tone classes set only color; alert classes set only background + outline', () => {
    const css = cssOf('tones.module.css')
    for (const t of ['positive', 'negative', 'dirUp', 'dirDown']) {
      const d = declsFor(css, new RegExp(`^\\s*\\.${t}\\s*$`))
      expect(d.map(x => x.split(':')[0].trim())).toEqual(['color'])
    }
    for (const a of ['alertMild', 'alertStrong']) {
      const props = declsFor(css, new RegExp(`^\\s*\\.${a}\\s*$`)).map(x => x.split(':')[0].trim())
      expect(props).not.toContain('color')
      expect(props).toContain('background')
      expect(props).toContain('outline')
    }
  })
  it('no heatmap fills and no zebra striping are available from the generic table', () => {
    for (const f of ['AcmDataTable.module.css', 'tones.module.css', 'AcmDataTable.tsx']) {
      const src = readFileSync(path.join(DIR, f), 'utf8')
      expect(src, f).not.toMatch(/--acm-heat-/)
      expect(src, f).not.toMatch(/nth-(child|of-type)\(\s*(even|odd|2n)/)
    }
    expect(declsFor(cssOf('AcmDataTable.module.css'), /\.td/).join(';')).toContain('var(--acm-border-hairline)')
  })
})

describe('AcmDataTable — sticky header option', () => {
  it('adds the sticky class only when asked', () => {
    expect(renderTable(true).container.querySelector('table')!.className).toContain(tableStyles.sticky)
    cleanup()
    expect(renderTable(false).container.querySelector('table')!.className).not.toContain(tableStyles.sticky)
    expect(declsFor(cssOf('AcmDataTable.module.css'), /\.sticky \.th/).join(';')).toContain('position: sticky')
  })
})

// ── Stat tile ───────────────────────────────────────────────────────────────

describe('AcmStatTile', () => {
  it('renders label, value, delta and as-of', () => {
    render(<AcmStatTile label="MOVE" value={98.4} format={v => v.toFixed(1)} delta={{ value: 2.1, format: v => `+${v.toFixed(1)}`, tone: 'dir-up', label: '1D' }} asOf="2026-10-12" />)
    expect(screen.getByText('MOVE')).toBeTruthy()
    expect(screen.getByText('98.4').className).toContain('acm-num')
    expect(screen.getByText('+2.1').className).toContain(tones.dirUp)
    expect(screen.getByText('1D')).toBeTruthy()
    expect(screen.getByText('2026-10-12')).toBeTruthy()
  })
  it('null value and null delta render the em dash, untoned', () => {
    const { container } = render(<AcmStatTile label="Premium" value={null} tone="negative" delta={{ value: undefined, tone: 'dir-down' }} />)
    const dashes = [...container.querySelectorAll('.acm-num')].filter(e => e.textContent === NULL_DASH)
    expect(dashes).toHaveLength(2)
    dashes.forEach(d => expect(d.className).not.toMatch(new RegExp(`${tones.negative}|${tones.dirDown}`)))
  })
  it('negatives render with ASCII "-"; alert tints the tile, not the value', () => {
    const { container } = render(<AcmStatTile label="z" value={-3.4} format={v => v.toFixed(1).replace('-', MINUS)} tone="negative" alert="strong" />)
    expect(screen.getByText('-3.4')).toBeTruthy()
    expect(container.textContent).not.toContain(MINUS)
    expect((container.firstElementChild as HTMLElement).className).toContain(tones.alertStrong)
    expect(screen.getByText('-3.4').className).not.toContain(tones.alertStrong)
  })
})

// ── Chart container ─────────────────────────────────────────────────────────

describe('AcmChartFrame', () => {
  it('renders title, subtitle, actions, legend swatches and sizes the plot', () => {
    const { container } = render(
      <AcmChartFrame title="Implied vs realized" subtitle="bp" actions={<button>1Y</button>} height={240}
        legend={[{ label: 'MOVE', color: COUNTRY_COLORS.US }, { label: 'Δ', color: 'var(--acm-dir-up)', dashed: true }]}>
        <svg data-testid="chart" />
      </AcmChartFrame>,
    )
    expect(screen.getByText('Implied vs realized')).toBeTruthy()
    expect(screen.getByRole('button', { name: '1Y' })).toBeTruthy()
    expect(screen.getByTestId('chart')).toBeTruthy()
    const swatches = container.querySelectorAll<HTMLElement>('li span[aria-hidden]')
    expect(swatches[0].style.getPropertyValue('--acm-swatch')).toBe(COUNTRY_COLORS.US)
    expect(swatches[1].style.getPropertyValue('--acm-swatch')).toBe('var(--acm-dir-up)')
    expect((container.querySelector('figure > div:last-child') as HTMLElement).style.height).toBe('240px')
  })
  it('legend toggles: hidden state and click handler', () => {
    const onClick = vi.fn()
    render(<AcmChartFrame title="T" height={100} legend={[{ label: 'VIX', color: '#ef4444', hidden: true, onClick }]}><div /></AcmChartFrame>)
    const btn = screen.getByRole('button', { name: 'VIX' })
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledOnce()
  })
  it('series colours must come from the identity registry or a sign token', () => {
    expect(isSeriesColor(COUNTRY_COLORS.JP)).toBe(true)
    expect(isSeriesColor('var(--acm-negative)')).toBe(true)
    expect(isSeriesColor('#123456')).toBe(false)
    expect(isSeriesColor('var(--acm-accent)')).toBe(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<AcmChartFrame title="T" height={100} legend={[{ label: 'rogue', color: '#123456' }]}><div /></AcmChartFrame>)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('#123456'))
    warn.mockRestore()
  })
})

// ── Collapsible ─────────────────────────────────────────────────────────────

describe('AcmCollapsible', () => {
  it('is closed by default and opens via defaultOpen', () => {
    const { container, rerender } = render(<AcmCollapsible title="Methodology">body</AcmCollapsible>)
    expect((container.firstElementChild as HTMLDetailsElement).open).toBe(false)
    expect(screen.getByText('Methodology').tagName).toBe('SUMMARY')
    cleanup()
    const r = render(<AcmCollapsible title="Methodology" defaultOpen>body</AcmCollapsible>)
    expect((r.container.firstElementChild as HTMLDetailsElement).open).toBe(true)
    void rerender
  })
  it('toggles when the summary is clicked', () => {
    const { container } = render(<AcmCollapsible title="Methodology">body</AcmCollapsible>)
    const details = container.firstElementChild as HTMLDetailsElement
    fireEvent.click(screen.getByText('Methodology'))
    expect(details.open).toBe(true)
  })
})

// ── Every primitive stylesheet is token-only ────────────────────────────────

describe('primitive CSS uses tokens only', () => {
  const files = readdirSync(DIR).filter(f => f.endsWith('.module.css'))
  it(`scans all ${files.length} primitive stylesheets`, () => expect(files.length).toBeGreaterThanOrEqual(8))
  for (const f of files) {
    it(`${f}: no colour literals, no raw lengths`, () => {
      const css = cssOf(f)
      expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(/i)
      const values = [...css.matchAll(/:\s*([^;{}]+);/g)].map(m => m[1])
      const rawLengths = values.flatMap(v => v.replace(/var\(--[\w-]+\)/g, '').match(/\b\d*\.?\d+(px|rem|em)\b/g) ?? [])
      expect(rawLengths, f).toEqual([])
    })
  }
})
