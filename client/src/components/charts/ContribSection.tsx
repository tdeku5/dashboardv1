import { useState, useEffect, useMemo, useCallback, useRef, useId, type ReactNode } from 'react'
import { ResponsiveContainer, ComposedChart, Brush, XAxis, YAxis } from 'recharts'
import {
  type ContribRow, type QuickPeriod,
  fmtAxisDate, fmtFullDate, contribNiceTicks,
  BRUSH_STYLE, QUICK_PERIODS_CONTRIB,
} from '../../lib/seriesTransforms'
import { QuickSelectRow } from './QuickSelectRow'
import styles from './ChartKit.module.css'

// Diverging stacked-bar contribution chart (custom SVG) with parent-line
// overlay, toggleable legend, brush and range quick-select. Extracted from
// RetailSalesDashboardPage.tsx (RetailContribChart + tooltip + section JSX);
// rendering and math identical, series list/labels parameterized.

export interface ContribItem {
  id: string
  label: string
  color: string
}

const CONTRIB_CM = { top: 8, right: 16, bottom: 28, left: 62 } as const

function ContribTooltip({
  row, activeSeries, mouseX, mouseY, isRightHalf, seriesItems, lineKey, lineLabel,
}: {
  row: ContribRow
  activeSeries: Set<string>
  mouseX: number
  mouseY: number
  isRightHalf: boolean
  seriesItems: readonly ContribItem[]
  lineKey: string
  lineLabel: string
}) {
  const activeItems = seriesItems.filter(s => activeSeries.has(s.id))
  const items = activeItems
    .map(s => ({ ...s, value: row[s.id] as number | null }))
    .filter(s => s.value != null)
    .sort((a, b) => Math.abs(b.value!) - Math.abs(a.value!))

  const horizPos = isRightHalf
    ? { right: window.innerWidth - mouseX + 14 }
    : { left: mouseX + 14 }

  const showLine = activeSeries.has(lineKey)
  const lineVal = row[lineKey] as number | null

  return (
    <div style={{
      position: 'fixed',
      ...horizPos,
      top: mouseY - 24,
      background: '#090e15',
      border: '1px solid rgba(255,255,255,0.13)',
      borderRadius: 2,
      padding: '8px 12px',
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      maxWidth: 300,
      pointerEvents: 'none',
      zIndex: 1000,
    }}>
      <div style={{ color: '#94A3B8', marginBottom: 6, letterSpacing: '0.05em' }}>
        {fmtFullDate(row.date)}
      </div>
      {items.map(item => (
        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{
            width: 8, height: 8, borderRadius: 1,
            background: item.color, display: 'inline-block', flexShrink: 0,
          }} />
          <span style={{ color: '#64748B', flex: 1, marginRight: 8 }}>{item.label}</span>
          <span style={{ color: item.value! >= 0 ? '#4ade80' : '#f87171' }}>
            {item.value! >= 0 ? '+' : ''}{item.value!.toFixed(2)} pp
          </span>
        </div>
      ))}
      {showLine && lineVal != null && (
        <div style={{
          marginTop: 5, paddingTop: 5,
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ width: 14, height: 2, background: '#fff', display: 'inline-block', flexShrink: 0 }} />
          <span style={{ color: '#94A3B8', flex: 1 }}>{lineLabel}</span>
          <span style={{ color: lineVal >= 0 ? '#4ade80' : '#f87171' }}>
            {lineVal >= 0 ? '+' : ''}{lineVal.toFixed(2)}%
          </span>
        </div>
      )}
    </div>
  )
}

export function ContribBarChart({
  data, visibleStart, visibleEnd, activeSeries,
  lineWidth = 1.5, clipPrefix = 'contrib', seriesItems, lineKey, lineLabel,
}: {
  data: ContribRow[]
  visibleStart: number
  visibleEnd: number
  activeSeries: Set<string>
  lineWidth?: number
  clipPrefix?: string
  seriesItems: readonly ContribItem[]
  lineKey: string
  lineLabel: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 600, height: 400 })
  const [hovered, setHovered] = useState<number | null>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const visible = useMemo(
    () => data.slice(Math.max(0, visibleStart), Math.min(data.length, visibleEnd + 1)),
    [data, visibleStart, visibleEnd]
  )

  const { width, height } = size
  const innerW = Math.max(0, width - CONTRIB_CM.left - CONTRIB_CM.right)
  const innerH = Math.max(0, height - CONTRIB_CM.top - CONTRIB_CM.bottom)
  const n = visible.length
  const colW = n > 0 ? innerW / n : 0
  const barW = Math.min(28, colW * 0.82)

  const activeItems = useMemo(
    () => seriesItems.filter(s => activeSeries.has(s.id)),
    [activeSeries, seriesItems]
  )
  const showLine = activeSeries.has(lineKey)

  const yDomain = useMemo((): [number, number] => {
    let min = 0, max = 0
    for (const row of visible) {
      let posStack = 0, negStack = 0
      for (const s of activeItems) {
        const v = row[s.id] as number | null
        if (v == null || v === 0) continue
        if (v > 0) posStack += v; else negStack += v
      }
      if (showLine && row[lineKey] != null) {
        posStack = Math.max(posStack, row[lineKey] as number)
        negStack = Math.min(negStack, row[lineKey] as number)
      }
      if (posStack > max) max = posStack
      if (negStack < min) min = negStack
    }
    const pad = (max - min) * 0.08 || 0.5
    return [min - pad, max + pad]
  }, [visible, activeItems, showLine, lineKey])

  const [yMin, yMax] = yDomain
  const yRange = yMax - yMin || 1
  const y0 = CONTRIB_CM.top + (1 - (0 - yMin) / yRange) * innerH

  const { columns, linePts } = useMemo(() => {
    const toY = (v: number) => CONTRIB_CM.top + (1 - (v - yMin) / yRange) * innerH
    type Rect = { y: number; h: number; color: string; id: string; value: number }

    const cols = visible.map((row, i) => {
      const cx = CONTRIB_CM.left + (i + 0.5) * colW
      const rects: Rect[] = []
      let posStack = 0
      let negStack = 0

      for (const s of activeItems) {
        const value = row[s.id] as number | null
        if (value == null || value === 0) continue

        if (value > 0) {
          const yTop = toY(posStack + value)
          const yBot = toY(posStack)
          const h = yBot - yTop
          if (h > 0.1) rects.push({ y: yTop, h, color: s.color, id: s.id, value })
          posStack += value
        } else {
          const yTop = toY(negStack)
          const yBot = toY(negStack + value)
          const h = yBot - yTop
          if (h > 0.1) rects.push({ y: yTop, h, color: s.color, id: s.id, value })
          negStack += value
        }
      }

      return { cx, rects, row }
    })

    const pts = showLine
      ? cols.filter(c => (c.row[lineKey] as number | null) != null).map(c => ({ cx: c.cx, cy: toY(c.row[lineKey] as number) }))
      : []

    return { columns: cols, linePts: pts }
  }, [visible, activeItems, showLine, colW, yMin, yRange, innerH, lineKey])

  const yTicks = useMemo(() => contribNiceTicks(yMin, yMax, 6), [yMin, yMax])

  const xTicks = useMemo(() => {
    const ticks: { label: string; cx: number }[] = []
    let lastX = -Infinity
    visible.forEach((row, i) => {
      const cx = CONTRIB_CM.left + (i + 0.5) * colW
      if (cx - lastX >= 60) {
        ticks.push({ label: fmtAxisDate(row.date), cx })
        lastX = cx
      }
    })
    return ticks
  }, [visible, colW])

  const linePath = linePts.length > 1
    ? `M${linePts.map(p => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join('L')}`
    : ''

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left - CONTRIB_CM.left
    setMousePos({ x: e.clientX, y: e.clientY })
    if (n > 0 && mx >= 0 && mx <= innerW) {
      setHovered(Math.min(n - 1, Math.floor(mx / colW)))
    } else {
      setHovered(null)
    }
  }, [n, innerW, colW])

  const handleMouseLeave = useCallback(() => setHovered(null), [])

  const uid = useId()
  const hovCol = hovered != null ? columns[hovered] : null
  const isRightHalf = hovered != null && hovered >= n / 2
  const clipId = `${clipPrefix}${uid.replace(/[^a-zA-Z0-9]/g, '')}`

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg
        width={width}
        height={height}
        style={{ display: 'block' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={CONTRIB_CM.left} y={CONTRIB_CM.top} width={innerW} height={innerH} />
          </clipPath>
        </defs>

        {yTicks.map(t => {
          const ty = CONTRIB_CM.top + (1 - (t - yMin) / yRange) * innerH
          return (
            <line key={t}
              x1={CONTRIB_CM.left} x2={CONTRIB_CM.left + innerW}
              y1={ty} y2={ty}
              stroke="rgba(255,255,255,0.04)" strokeWidth={1}
            />
          )
        })}

        <line
          x1={CONTRIB_CM.left} x2={CONTRIB_CM.left + innerW}
          y1={y0} y2={y0}
          stroke="rgba(255,255,255,0.25)" strokeWidth={1}
        />

        {hovCol && (
          <rect
            x={hovCol.cx - colW / 2} y={CONTRIB_CM.top}
            width={colW} height={innerH}
            fill="rgba(255,255,255,0.04)"
            pointerEvents="none"
            clipPath={`url(#${clipId})`}
          />
        )}

        <g clipPath={`url(#${clipId})`}>
          {columns.map(col =>
            col.rects.map(r => (
              <rect
                key={`${col.row.date}-${r.id}`}
                x={col.cx - barW / 2}
                y={r.y}
                width={barW}
                height={r.h}
                fill={r.color}
                fillOpacity={0.8}
              />
            ))
          )}
        </g>

        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="#ffffff"
            strokeWidth={lineWidth}
            strokeLinejoin="round"
            strokeLinecap="round"
            clipPath={`url(#${clipId})`}
          />
        )}

        {yTicks.map(t => {
          const ty = CONTRIB_CM.top + (1 - (t - yMin) / yRange) * innerH
          return (
            <text key={t}
              x={CONTRIB_CM.left - 6} y={ty + 4}
              textAnchor="end"
              fontSize={11} fontFamily="var(--font-mono)" fill="#64748B"
            >
              {t.toFixed(2)}
            </text>
          )
        })}

        {xTicks.map(t => (
          <text key={t.label}
            x={t.cx} y={height - CONTRIB_CM.bottom + 14}
            textAnchor="middle"
            fontSize={11} fontFamily="var(--font-mono)" fill="#64748B"
          >
            {t.label}
          </text>
        ))}
      </svg>

      {hovCol && (
        <ContribTooltip
          row={hovCol.row}
          activeSeries={activeSeries}
          mouseX={mousePos.x}
          mouseY={mousePos.y}
          isRightHalf={isRightHalf}
          seriesItems={seriesItems}
          lineKey={lineKey}
          lineLabel={lineLabel}
        />
      )}
    </div>
  )
}

/** Full contribution section card: header + toggleable legend + SVG chart + brush + range row. */
export function ContribSection({
  title,
  subtitle,
  badge,
  data,
  items,
  lineKey = 'line',
  lineLabel,
  clipPrefix = 'contrib',
  periods = QUICK_PERIODS_CONTRIB,
  defaultCount = 60,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  data: ContribRow[]
  items: readonly ContribItem[]
  lineKey?: string
  lineLabel: string
  clipPrefix?: string
  periods?: readonly QuickPeriod[]
  defaultCount?: number
}) {
  const [visible, setVisible] = useState<Set<string>>(() => {
    const all = new Set(items.map(s => s.id))
    all.add(lineKey)
    return all
  })

  const toggle = (id: string) => setVisible(prev => {
    const n = new Set(prev)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  const [brush, setBrush] = useState<{ start: number; end: number; period: string }>({ start: 0, end: 0, period: '' })

  useEffect(() => {
    if (data.length === 0) return
    const end = data.length - 1
    setBrush({ start: Math.max(0, end - (defaultCount - 1)), end, period: periods[0]?.label ?? '' })
  }, [data.length, defaultCount, periods])

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionTitle}>{title}{badge}</div>
          {subtitle && <div className={styles.sectionSubtitle}>{subtitle}</div>}
        </div>
      </div>
      <div className={styles.legendRow}>
        <div className={styles.legend}>
          {items.map(s => (
            <button key={s.id} type="button"
              className={`${styles.legendItem} ${visible.has(s.id) ? '' : styles.legendItemOff}`}
              onClick={() => toggle(s.id)}>
              <span className={styles.legendSwatch} style={{ background: s.color }} />
              {s.label}
            </button>
          ))}
          <button type="button"
            className={`${styles.legendItem} ${visible.has(lineKey) ? '' : styles.legendItemOff}`}
            onClick={() => toggle(lineKey)}>
            <span className={styles.legendLine} style={{ background: '#fff' }} />
            {lineLabel}
          </button>
        </div>
      </div>
      <div className={styles.chartWrap}>
        <ContribBarChart
          data={data}
          visibleStart={brush.start}
          visibleEnd={brush.end}
          activeSeries={visible}
          clipPrefix={clipPrefix}
          seriesItems={items}
          lineKey={lineKey}
          lineLabel={lineLabel}
        />
      </div>
      <div className={styles.brushWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
            <XAxis dataKey="date" hide />
            <YAxis hide />
            <Brush dataKey="date"
              startIndex={brush.start}
              endIndex={brush.end}
              onChange={({ startIndex, endIndex }) =>
                setBrush(prev => ({ period: '', start: startIndex ?? prev.start, end: endIndex ?? prev.end }))}
              {...BRUSH_STYLE} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <QuickSelectRow
        period={brush.period}
        onSelect={(label, count) => {
          const end = data.length - 1
          setBrush({ start: isFinite(count) ? Math.max(0, end - count + 1) : 0, end, period: label })
        }}
        periods={periods}
      />
    </div>
  )
}
