import {
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { CrudeCurveData } from '../hooks/useCrudeCurves'
import styles from '../pages/CrudeOilPage.module.css'

export const OFFSET1_COLOR = '#60a5fa' // blue
export const OFFSET2_COLOR = '#f59e0b' // amber
export const CURRENT_COLOR = '#e2e8f0' // light

interface Props {
  title: string
  data: CrudeCurveData | null
  loading: boolean
  error: string | null
  showOffset1: boolean
  showOffset2: boolean
  deltaUnit: '$' | '%'
}

interface DeltaRow {
  code: string
  d1: number | null
  d2: number | null
}

function buildDeltaRows(
  data: CrudeCurveData | null,
  unit: '$' | '%',
  showOffset1: boolean,
  showOffset2: boolean,
): DeltaRow[] {
  if (!data) return []
  return data.contracts.map((c) => {
    const calc = (off: number | null): number | null => {
      if (c.current == null || off == null) return null
      if (unit === '$') return c.current - off
      if (off === 0) return null
      return ((c.current - off) / off) * 100
    }
    return {
      code: c.code,
      d1: showOffset1 ? calc(c.offset1) : null,
      d2: showOffset2 ? calc(c.offset2) : null,
    }
  })
}

interface CurveTooltipPayloadEntry {
  dataKey?: string | number
  name?: string
  value?: number | null
  color?: string
}

function CurveTooltip({ active, payload, label }: {
  active?: boolean
  payload?: CurveTooltipPayloadEntry[]
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTitle}>{label}</div>
      {payload.map((entry) => {
        if (entry.value == null) return null
        return (
          <div key={String(entry.dataKey ?? entry.name)} className={styles.tooltipRow}>
            <span className={styles.tooltipDot} style={{ background: entry.color }} />
            <span className={styles.tooltipName}>{entry.name}</span>
            <span className={styles.tooltipVal}>${(entry.value as number).toFixed(2)}</span>
          </div>
        )
      })}
    </div>
  )
}

function DeltaTooltip({ active, payload, label, unit }: {
  active?: boolean
  payload?: CurveTooltipPayloadEntry[]
  label?: string
  unit: '$' | '%'
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTitle}>{label}</div>
      {payload.map((entry) => {
        if (entry.value == null) return null
        const v = entry.value as number
        const text = unit === '$'
          ? `${v >= 0 ? '+' : ''}$${v.toFixed(2)}`
          : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
        return (
          <div key={String(entry.dataKey ?? entry.name)} className={styles.tooltipRow}>
            <span className={styles.tooltipDot} style={{ background: entry.color }} />
            <span className={styles.tooltipName}>{entry.name}</span>
            <span className={styles.tooltipVal}>{text}</span>
          </div>
        )
      })}
    </div>
  )
}

interface SubtitleSegment { text: string; color?: string }

function buildSubtitleSegments(
  data: CrudeCurveData,
  showOffset1: boolean,
  showOffset2: boolean,
): SubtitleSegment[] {
  const segs: SubtitleSegment[] = [{ text: `as of ${data.asOf || '—'}` }]
  if (showOffset1 && data.offset1Date) {
    segs.push({ text: `vs ${data.offset1Date} (${data.offset1Days}d)`, color: OFFSET1_COLOR })
  }
  if (showOffset2 && data.offset2Date) {
    segs.push({ text: `vs ${data.offset2Date} (${data.offset2Days}d)`, color: OFFSET2_COLOR })
  }
  return segs
}

function computeCurveYDomain(data: CrudeCurveData | null, showOffset1: boolean, showOffset2: boolean): [number, number] | undefined {
  if (!data || data.contracts.length === 0) return undefined
  const vals: number[] = []
  for (const c of data.contracts) {
    if (c.current != null) vals.push(c.current)
    if (showOffset1 && c.offset1 != null) vals.push(c.offset1)
    if (showOffset2 && c.offset2 != null) vals.push(c.offset2)
  }
  if (vals.length === 0) return undefined
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const pad = Math.max(0.5, (max - min) * 0.08)
  return [min - pad, max + pad]
}

export function CrudeCurvePanel({
  title,
  data,
  loading,
  error,
  showOffset1,
  showOffset2,
  deltaUnit,
}: Props) {
  if (error) {
    return (
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitle}>{title}</div>
        </div>
        <div className={styles.panelEmpty}>Error: {error}</div>
      </div>
    )
  }

  if (loading && !data) {
    return (
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitle}>{title}</div>
        </div>
        <div className={styles.panelEmpty}>Loading…</div>
      </div>
    )
  }

  if (!data || data.contracts.length === 0) {
    return (
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitle}>{title}</div>
        </div>
        <div className={styles.panelEmpty}>No data available — check ingestion</div>
      </div>
    )
  }

  const subtitleSegments = buildSubtitleSegments(data, showOffset1, showOffset2)
  const curveDomain = computeCurveYDomain(data, showOffset1, showOffset2)
  const deltaRows = buildDeltaRows(data, deltaUnit, showOffset1, showOffset2)
  const deltaTickFormatter = (v: number) =>
    deltaUnit === '$' ? v.toFixed(2) : `${v.toFixed(1)}%`
  const deltaAxisLabel = deltaUnit === '$' ? '$/bbl' : '%'

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>{title}</div>
        <div className={styles.panelSubtitle}>
          {subtitleSegments.map((seg, i) => (
            <span key={i}>
              {i > 0 && <span className={styles.subtitleSep}> · </span>}
              <span style={seg.color ? { color: seg.color } : undefined}>{seg.text}</span>
            </span>
          ))}
        </div>
      </div>

      <div className={styles.chartBlock}>
        <ResponsiveContainer width="100%" height={480}>
          <LineChart data={data.contracts} margin={{ top: 16, right: 24, left: 8, bottom: 4 }}>
            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" />
            <XAxis
              dataKey="code"
              stroke="#728197"
              tick={{ fontSize: 11, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
            />
            <YAxis
              stroke="#728197"
              tick={{ fontSize: 12, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
              tickFormatter={(v: number) => `$${v.toFixed(2)}`}
              domain={curveDomain ?? ['auto', 'auto']}
              allowDataOverflow
              label={{
                value: '$/bbl',
                position: 'top',
                offset: 10,
                style: { fill: '#94A3B8', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)' },
              }}
            />
            <Tooltip content={<CurveTooltip />} />
            <Line
              type="monotone"
              dataKey="current"
              name="Current"
              stroke={CURRENT_COLOR}
              strokeWidth={2.5}
              dot={{ r: 2.5 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            {showOffset1 && (
              <Line
                type="monotone"
                dataKey="offset1"
                name={`Offset 1 (${data.offset1Days}d)`}
                stroke={OFFSET1_COLOR}
                strokeWidth={1.8}
                strokeDasharray="6 3"
                dot={{ r: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
            {showOffset2 && (
              <Line
                type="monotone"
                dataKey="offset2"
                name={`Offset 2 (${data.offset2Days}d)`}
                stroke={OFFSET2_COLOR}
                strokeWidth={1.8}
                strokeDasharray="2 3"
                dot={{ r: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className={styles.chartBlock}>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={deltaRows} margin={{ top: 16, right: 24, left: 8, bottom: 16 }}>
            <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="code"
              stroke="#728197"
              tick={{ fontSize: 11, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
            />
            <YAxis
              stroke="#728197"
              tick={{ fontSize: 11, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
              tickFormatter={deltaTickFormatter}
              label={{
                value: deltaAxisLabel,
                position: 'top',
                offset: 10,
                style: { fill: '#94A3B8', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)' },
              }}
            />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
            <Tooltip content={<DeltaTooltip unit={deltaUnit} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            {showOffset1 && (
              <Bar dataKey="d1" name={`vs Offset 1 (${data.offset1Days}d)`} radius={[2, 2, 0, 0]}>
                {deltaRows.map((r) => (
                  <Cell key={`d1-${r.code}`} fill={OFFSET1_COLOR} />
                ))}
              </Bar>
            )}
            {showOffset2 && (
              <Bar dataKey="d2" name={`vs Offset 2 (${data.offset2Days}d)`} radius={[2, 2, 0, 0]}>
                {deltaRows.map((r) => (
                  <Cell key={`d2-${r.code}`} fill={OFFSET2_COLOR} />
                ))}
              </Bar>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
