// @vitest-environment happy-dom
// E1 — EQUITIES › US (INDEX COMPARISON, SECTOR ATTRIBUTION, BREADTH, VOL).
// Pins the non-rates colour rules (design notes rule 7) on these pages:
//  • returns: valence — the named ReturnsHeatmap fills up from heat-positive,
//    down from heat-negative, 4 quartile steps, no fill at 0.00%, text primary;
//  • INDEX tile (SPY return): valence text; contribution tiles: plain
//    (classification pending the user's ruling);
//  • levels / vol / breadth: registry identity colours only, no sign colour;
//  • ASCII '-' everywhere (no U+2212), near-zero prints unsigned.
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render, cleanup } from '@testing-library/react'
import { ReturnsHeatmap, returnsHeatClass } from '../components/ReturnsHeatmap'
import { SectorStatTiles } from '../components/SectorStatTiles'
import { sectorLegendItems } from '../components/SectorLegendToggle'
import { fmtSignedPct, returnTone } from './equitiesShared'
import { SECTOR_COLORS, INDEX_COLOR } from '../constants/sectorColors'
import { US_INDEX_COLORS } from '../constants/usIndices'
import {
  BREADTH_MA_COLORS, SECTOR_COLORS as REG_SECTOR, SECTOR_INDEX_COLOR, US_INDEX_COLORS as REG_US_INDEX,
  VOL_INDEX_COLORS, CURVE_OFFSET_COLORS,
} from '../constants/identityColors'
import { CURRENT_COLOR, OFFSET1_COLOR, OFFSET2_COLOR } from '../components/CrudeCurvePanel'
import { contrast } from '../lib/paletteCheck'

afterEach(() => cleanup())

const SRC = path.resolve(__dirname, '..')
const read = (f: string) => readFileSync(path.join(SRC, f), 'utf8')

describe('returns formatting + tone (near-zero rule)', () => {
  it('signed percent with ASCII minus, unsigned at zero', () => {
    expect(fmtSignedPct(1.234)).toBe('+1.23%')
    expect(fmtSignedPct(-0.4)).toBe('-0.40%')
    expect(fmtSignedPct(-0.004)).toBe('0.00%')
    expect(fmtSignedPct(null)).toBe('—')
  })
  it('valence tone: up positive, down negative, none when it prints as zero', () => {
    expect(returnTone(0.5)).toBe('positive')
    expect(returnTone(-0.5)).toBe('negative')
    expect(returnTone(0.004)).toBeUndefined()
    expect(returnTone(-0.004)).toBeUndefined()
    expect(returnTone(null)).toBeUndefined()
  })
})

describe('ReturnsHeatmap (named heatmap, valence)', () => {
  it('quartile-of-max steps on the valence scale; no fill at 0.00% or null', () => {
    const cls = (v: number | null) => returnsHeatClass(v, 10) ?? ''
    expect(cls(2.5)).toMatch(/rhHeatPositive1/)   // 25% of max → step 1
    expect(cls(2.6)).toMatch(/rhHeatPositive2/)
    expect(cls(5.1)).toMatch(/rhHeatPositive3/)
    expect(cls(7.6)).toMatch(/rhHeatPositive4/)
    expect(cls(10)).toMatch(/rhHeatPositive4/)
    expect(cls(-0.1)).toMatch(/rhHeatNegative1/)
    expect(cls(-9)).toMatch(/rhHeatNegative4/)
    expect(cls(0.004)).toBe('')
    expect(cls(-0.004)).toBe('')
    expect(cls(null)).toBe('')
    expect(returnsHeatClass(1, 0)).toBeUndefined()
  })

  it('renders fills on data cells only, primary text, ASCII minus, inside its own acm-root', () => {
    const rows = [
      { ticker: 'SPX', name: 'S&P 500', r: { '5d': 1.2, '1m': -3.4, '3m': 0.001, '6m': 8, ytd: -12 } },
      { ticker: 'NDX', name: 'Nasdaq 100', r: { '5d': -0.6, '1m': 2, '3m': -5, '6m': null, ytd: 15 } },
    ]
    const { container } = render(
      <ReturnsHeatmap title="INDEX RETURNS" subtitle="as of 2026-11-04" rows={rows}
        valueAccessor={(row, lb) => (row as typeof rows[number]).r[lb]} gradientMode="column" rowHeaderLabel="Index" />,
    )
    expect(container.firstElementChild?.classList.contains('acm-root')).toBe(true)
    const cells = [...container.querySelectorAll('[data-heat-cell]')]
    expect(cells).toHaveLength(10)
    const text = cells.map(c => c.textContent)
    expect(text).toEqual(['+1.20%', '-3.40%', '0.00%', '+8.00%', '-12.00%', '-0.60%', '+2.00%', '-5.00%', '—', '+15.00%'])
    // 3M SPX prints 0.00% → no fill; 6M NDX null → no fill
    expect(cells[2].className).not.toMatch(/rhHeat/)
    expect(cells[8].className).not.toMatch(/rhHeat/)
    expect(cells[0].className).toMatch(/rhHeatPositive/)
    expect(cells[1].className).toMatch(/rhHeatNegative/)
    // text never toned (rule 3), no alert treatment
    // (case-sensitive: the heat classes are rhHeatPositive* / rhHeatNegative*)
    for (const c of cells) expect(c.className).not.toMatch(/positive|negative|alertMild|alertStrong/)
    expect(container.textContent).not.toContain('−')
    // the old blue / red inline fills are gone
    for (const c of cells) expect((c as HTMLElement).style.background).toBe('')
  })
})

describe('SECTOR ATTRIBUTION tiles + legend', () => {
  const tiles = [
    { ticker: 'XLK', return_: 2, contribution: 0.62, weight: 0.31 },
    { ticker: 'XLE', return_: -3, contribution: -0.12, weight: 0.04 },
    { ticker: 'XLF', return_: 0, contribution: 0.001, weight: 0.13 },
  ]
  it('INDEX tile is valence; contribution tiles render plain; ASCII minus', () => {
    const { container, rerender } = render(<SectorStatTiles indexReturn={-1.5} sectorTiles={tiles} />)
    const values = [...container.querySelectorAll('[class*="value"]')]
    expect(values[0].textContent).toBe('-1.50%')
    expect(values[0].className).toMatch(/negative/)
    for (const v of values.slice(1)) expect(v.className).not.toMatch(/positive|negative/)
    expect(values.map(v => v.textContent)).toEqual(['-1.50%', '+0.62%', '-0.12%', '0.00%'])
    expect(container.textContent).not.toContain('−')
    rerender(<SectorStatTiles indexReturn={0.004} sectorTiles={tiles} />)
    const idx = container.querySelectorAll('[class*="value"]')[0]
    expect(idx.textContent).toBe('0.00%')
    expect(idx.className).not.toMatch(/positive|negative/)
    rerender(<SectorStatTiles indexReturn={2} sectorTiles={tiles} />)
    expect(container.querySelectorAll('[class*="value"]')[0].className).toMatch(/positive/)
  })

  it('legend: INDEX then the 11 sectors, all registry identity colours', () => {
    const items = sectorLegendItems({ hiddenSectors: new Set(['XLE']), hideIndex: false, onToggleSector: () => {}, onToggleIndex: () => {} })
    expect(items).toHaveLength(12)
    expect(items[0]).toMatchObject({ label: 'INDEX', color: SECTOR_INDEX_COLOR, hidden: false })
    expect(items.find(i => i.label === 'Energy')?.hidden).toBe(true)
    for (const i of items.slice(1)) expect(Object.values(REG_SECTOR)).toContain(i.color)
  })
})

describe('identity colours come from the registry', () => {
  it('sector / index / US index / curve-offset maps are the registry objects', () => {
    expect(SECTOR_COLORS).toBe(REG_SECTOR)
    expect(SECTOR_COLORS.XLB).toBe('#A3640D') // lifted in Phase 1
    expect(INDEX_COLOR).toBe(SECTOR_INDEX_COLOR)
    expect(US_INDEX_COLORS).toBe(REG_US_INDEX)
    expect([CURRENT_COLOR, OFFSET1_COLOR, OFFSET2_COLOR]).toEqual([CURVE_OFFSET_COLORS.current, CURVE_OFFSET_COLORS.offset1, CURVE_OFFSET_COLORS.offset2])
  })

  it('breadth: d200 stays darker than d50 (and d50 than d20)', () => {
    const lum = (h: string) => contrast(h, '#000000')
    expect(lum(BREADTH_MA_COLORS.d200)).toBeLessThan(lum(BREADTH_MA_COLORS.d50))
    expect(lum(BREADTH_MA_COLORS.d50)).toBeLessThan(lum(BREADTH_MA_COLORS.d20))
    expect(read('components/BreadthChart.tsx')).toMatch(/SERIES_COLOR[^=]*=\s*BREADTH_MA_COLORS/)
  })

  it('Equities VOL draws VIX in the unified VOL_INDEX_COLORS.vix, no amber, no sign tokens', () => {
    const src = read('pages/VolPage.tsx')
    expect(VOL_INDEX_COLORS.vix).toBe('#ef4444')
    expect(src).toMatch(/VIX_COLOR = VOL_INDEX_COLORS\.vix/)
    expect(src).not.toMatch(/#f59e0b/i)
    expect(src).not.toMatch(/acm-(positive|negative|dir-up|dir-down)|signColor|toneColor/)
  })

  it('E1 TSX files carry no hex / rgb literals (U+2212 in numbers: the minusSign ratchet)', () => {
    for (const f of [
      'pages/IndexComparisonPage.tsx', 'pages/SectorAttributionPage.tsx', 'pages/BreadthPage.tsx', 'pages/VolPage.tsx',
      'pages/equitiesShared.tsx', 'components/ReturnsHeatmap.tsx', 'components/SectorContributionChart.tsx',
      'components/SectorStatTiles.tsx', 'components/SectorLegendToggle.tsx', 'components/BreadthChart.tsx',
      'components/CrudeCurvePanel.tsx', 'constants/sectorColors.ts', 'constants/usIndices.ts',
    ]) {
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
      expect(code, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/)
    }
  })
})
