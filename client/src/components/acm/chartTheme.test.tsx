// @vitest-environment happy-dom
//
// Shared chart theme (Asset Class Models revamp, Phase 1 Turn 3).
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts'
import { raw, resolved, SIGN_TOKENS } from '../../styles/acmTokenReader'
import { allIdentityColors } from '../../constants/identityColors'
import {
  chartTheme, CHART_TICK_FONT_SIZE, CHART_LABEL_FONT_SIZE, CHART_FONT_MONO, CHART_FONT_SANS, CHART_FONT_WEIGHT,
  gridProps, xAxisProps, yAxisProps, tooltipProps, axisLabelStyle, referenceLabelStyle, legendProps, tickStyle,
} from './chartTheme'

/** Non-colour structural strings, plus the measured-text font literals (pinned below). */
const STRUCTURAL = new Set(['3 3', '4 4', '2 4', 'tabular-nums', CHART_FONT_MONO, CHART_FONT_SANS])
const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|color-mix)\(|\b(?:white|black|red|green|blue|gray|grey|transparent)\b/i

function walk(node: unknown, at: string, out: Array<[string, unknown]>) {
  if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, `${at}.${k}`, out)
  else out.push([at, node])
}
const leaves: Array<[string, unknown]> = []
walk(chartTheme, 'chartTheme', leaves)

describe('chartTheme — values come only from --acm-* tokens', () => {
  it('every string is built from defined var(--acm-*) refs or is a structural value', () => {
    const bad: string[] = []
    for (const [p, v] of leaves) {
      if (typeof v !== 'string') continue
      if (STRUCTURAL.has(v)) continue
      if (COLOR_LITERAL.test(v)) { bad.push(`${p}: colour literal ${v}`); continue }
      const refs = [...v.matchAll(/var\(--(acm-[\w-]+)\)/g)].map(m => m[1])
      const rest = v.replace(/var\(--acm-[\w-]+\)/g, '').replace(/\bsolid\b/g, '').trim()
      if (refs.length === 0 || rest !== '') bad.push(`${p}: not token-built: ${v}`)
      refs.filter(r => !(r in raw)).forEach(r => bad.push(`${p}: --${r} undefined`))
    }
    expect(bad).toEqual([])
  })

  it('carries no series colour: no sign token and no identity-registry value', () => {
    const strings = leaves.map(([, v]) => String(v).toLowerCase())
    for (const t of SIGN_TOKENS) expect(strings.some(s => s.includes(`--${t})`)), t).toBe(false)
    const identity = new Set(allIdentityColors().map(([, v]) => v.toLowerCase()))
    expect(strings.filter(s => identity.has(s))).toEqual([])
  })

  it('the numeric font sizes and weight mirror their tokens exactly', () => {
    expect(`${CHART_TICK_FONT_SIZE}px`).toBe(raw['acm-fs-xs'])
    expect(`${CHART_LABEL_FONT_SIZE}px`).toBe(raw['acm-fs-sm'])
    expect(String(chartTheme.tick.fontWeight)).toBe(raw['acm-fw-regular'])
    expect(String(CHART_FONT_WEIGHT)).toBe(raw['acm-fw-regular'])
  })

  it('measured-text font families are literals equal to the resolved tokens', () => {
    expect(CHART_FONT_MONO).toBe(resolved('acm-font-mono'))
    expect(CHART_FONT_SANS).toBe(resolved('acm-font-sans'))
    console.log(`--acm-font-mono resolves to: ${resolved('acm-font-mono')}`)
    console.log(`--acm-font-sans resolves to: ${resolved('acm-font-sans')}`)
  })

  it('no font value on Recharts-measured text is a var() (ticks, <Label> styles, legend)', () => {
    const measured: Record<string, Record<string, unknown>> = {
      tick: tickStyle, axisLabel: axisLabelStyle as Record<string, unknown>,
      referenceLabel: referenceLabelStyle, legend: legendProps.wrapperStyle as Record<string, unknown>,
    }
    for (const [name, style] of Object.entries(measured)) {
      for (const key of ['fontFamily', 'fontSize', 'fontWeight']) {
        if (style[key] === undefined) continue
        expect(String(style[key]), `${name}.${key}`).not.toMatch(/var\(/)
      }
    }
    expect(tickStyle.fontFamily).toBe(CHART_FONT_MONO)
    expect(axisLabelStyle.fontFamily).toBe(CHART_FONT_SANS)
    expect(referenceLabelStyle.fontFamily).toBe(CHART_FONT_SANS)
    expect(legendProps.wrapperStyle?.fontFamily).toBe(CHART_FONT_SANS)
    expect(legendProps.wrapperStyle?.fontSize).toBe(CHART_LABEL_FONT_SIZE)
  })

  it('minTickGap 10 on both axes (measurement-gap compensation); Y axis is a fixed, unmeasured width', () => {
    expect(xAxisProps.minTickGap).toBe(10)
    expect(yAxisProps.minTickGap).toBe(10)
    expect(typeof yAxisProps.width).toBe('number')
    expect(yAxisProps.width).toBe(60)
    console.log(`axis defaults: minTickGap ${xAxisProps.minTickGap} (x) / ${yAxisProps.minTickGap} (y); yAxis width ${yAxisProps.width}px (fixed, not 'auto')`)
  })

  it('one treatment each: grid, axis stroke, tick, tooltip surface', () => {
    expect(xAxisProps.stroke).toBe(yAxisProps.stroke)
    expect(xAxisProps.tick).toBe(yAxisProps.tick)
    expect(gridProps).toEqual({ stroke: 'var(--acm-border-hairline)', strokeDasharray: '3 3' })
    expect(tooltipProps.contentStyle.background).toBe('var(--acm-surface-overlay)')
    console.log(`chartTheme leaves: ${leaves.length} (${leaves.filter(([, v]) => typeof v === 'string').length} strings, ${leaves.filter(([, v]) => typeof v === 'number').length} numbers)`)
  })
})

describe('chartTheme — Recharts accepts it and passes the tokens through to the SVG', () => {
  it('grid, axes and ticks render with var(--acm-*) attributes', () => {
    const data = [{ x: 'a', y: 1 }, { x: 'b', y: -2 }, { x: 'c', y: 3 }]
    const { container } = render(
      <div className="acm-root">
        <LineChart width={400} height={200} data={data}>
          <CartesianGrid {...chartTheme.grid} />
          <XAxis dataKey="x" {...chartTheme.xAxis} />
          <YAxis {...chartTheme.yAxis} />
          <Tooltip {...chartTheme.tooltip} />
          <Line dataKey="y" stroke="var(--acm-dir-up)" isAnimationActive={false} />
        </LineChart>
      </div>,
    )
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    const html = container.innerHTML
    expect(html).toContain('stroke="var(--acm-border-hairline)"')
    expect(html).toContain('stroke-dasharray="3 3"')
    expect(html).toContain('var(--acm-text-tertiary)')
    expect(html).toContain('var(--acm-text-secondary)')
    expect(html).toContain("IBM Plex Mono")
  })
})
