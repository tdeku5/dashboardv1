import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useGlobalYieldCurves } from '../hooks/useGlobalYieldCurves'
import { useGlobalForwardCurves } from '../hooks/useGlobalForwardCurves'
import styles from './STIRDashboardPage.module.css'

const COUNTRY_COLORS: Record<string, string> = {
  US: '#60a5fa',
  UK: '#a78bfa',
  DE: '#facc15',
  FR: '#fb923c',
  IT: '#34d399',
  CA: '#f87171',
  JP: '#f472b6',
  AU: '#22d3ee',
}

const YIELD_COUNTRIES = ['US', 'UK', 'DE', 'FR', 'IT', 'CA', 'JP', 'AU'] as const
const FORWARD_COUNTRIES = ['US', 'UK', 'EU', 'CA', 'JP', 'AU'] as const

const FORWARD_COLORS: Record<string, string> = {
  US: '#60a5fa',
  UK: '#a78bfa',
  EU: '#facc15',
  CA: '#f87171',
  JP: '#f472b6',
  AU: '#22d3ee',
}

export function GlobalRatesPage() {
  const yieldData = useGlobalYieldCurves()
  const forwardData = useGlobalForwardCurves()
  const [compressed, setCompressed] = useState(false)

  const ycYDomain = useMemo((): [number, number] => {
    const vals = yieldData.tenors.flatMap(r =>
      YIELD_COUNTRIES.map(c => r[c] as number | undefined | null).filter((v): v is number => v != null)
    )
    if (vals.length === 0) return [0, 6]
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.1 || 0.3
    return [min - pad, max + pad]
  }, [yieldData.tenors])

  const fwdYDomain = useMemo((): [number, number] => {
    const vals = forwardData.contracts.flatMap(r =>
      FORWARD_COUNTRIES.map(c => r[c] as number | undefined | null).filter((v): v is number => v != null)
    )
    if (vals.length === 0) return [0, 6]
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.1 || 0.3
    return [min - pad, max + pad]
  }, [forwardData.contracts])

  const maxYears = useMemo(() => {
    if (yieldData.tenors.length === 0) return 30
    return yieldData.tenors[yieldData.tenors.length - 1].years
  }, [yieldData.tenors])

  return (
    <div className={styles.fullPanel}>
      {/* ═══ Global Yield Curves ═══ */}
      <div className={styles.ustDashboard}>
        <div className={styles.ustYcHeader}>
          <div className={styles.ustSectionLabel} style={{ color: '#60a5fa', padding: 0 }}>GLOBAL SOVEREIGN YIELD CURVES</div>
          <div className={styles.ustYcControls}>
            <button
              onClick={() => setCompressed(v => !v)}
              style={{
                background: compressed ? 'rgba(96, 165, 250, 0.08)' : 'transparent',
                border: `1px solid ${compressed ? '#60a5fa' : 'rgba(255, 255, 255, 0.12)'}`,
                color: compressed ? '#60a5fa' : '#728197',
                fontFamily: 'var(--font-mono)', fontSize: '0.65rem', fontWeight: 600,
                padding: '3px 10px', cursor: 'pointer', borderRadius: '2px',
              }}
            >
              COMPRESSED
            </button>
          </div>
        </div>
        <div className={styles.ustYcDates}>
          {'\u25CF'} AS OF: {yieldData.asOfDate || '—'}
        </div>

        {yieldData.loading ? (
          <div className={styles.loading}>Loading global yield curves…</div>
        ) : yieldData.error ? (
          <div className={styles.error}>{yieldData.error}</div>
        ) : (
          <ResponsiveContainer width="100%" height={450}>
            <LineChart data={yieldData.tenors} margin={{ top: 16, right: 24, left: 8, bottom: 16 }}>
              <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey={compressed ? 'years' : 'tenor'}
                type={compressed ? 'number' : 'category'}
                stroke="#728197"
                tick={{ fontSize: 11, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                {...(compressed ? {
                  domain: [0, maxYears] as [number, number],
                  ticks: yieldData.tenors.map(t => t.years),
                  tickFormatter: (v: number) => v < 1 ? `${Math.round(v * 12)}M` : `${v}Y`,
                } : {})}
              />
              <YAxis
                stroke="#728197"
                tick={{ fontSize: 11, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                tickFormatter={(v: number) => `${v.toFixed(2)}%`}
                domain={ycYDomain}
                allowDataOverflow
              />
              <Tooltip
                contentStyle={{ background: '#0d1520', border: '1px solid #334155', fontFamily: 'var(--font-mono)', fontSize: 11 }}
                formatter={(value: unknown, name: string | undefined) => [value != null && typeof value === 'number' ? `${value.toFixed(3)}%` : '—', name ?? '']}
                labelFormatter={(label: unknown) => {
                  if (compressed) {
                    const v = Number(label)
                    return v < 1 ? `${Math.round(v * 12)}M` : `${v}Y`
                  }
                  return String(label)
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} />
              {YIELD_COUNTRIES.map(c => (
                <Line
                  key={c}
                  type="monotone"
                  dataKey={c}
                  stroke={COUNTRY_COLORS[c]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ═══ Global Forward Curves ═══ */}
      <div className={styles.ustDashboard}>
        <div className={styles.ustYcHeader}>
          <div className={styles.ustSectionLabel} style={{ color: '#60a5fa', padding: 0 }}>GLOBAL FORWARD CURVES (STIR STRIPS)</div>
        </div>
        <div className={styles.ustYcDates}>
          {'\u25CF'} AS OF: {forwardData.asOfDate || '—'}
        </div>

        {forwardData.loading ? (
          <div className={styles.loading}>Loading global forward curves…</div>
        ) : forwardData.error ? (
          <div className={styles.error}>{forwardData.error}</div>
        ) : (
          <ResponsiveContainer width="100%" height={450}>
            <LineChart data={forwardData.contracts} margin={{ top: 16, right: 24, left: 8, bottom: 16 }}>
              <CartesianGrid stroke="#1e2433" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="expiryDisplay"
                stroke="#728197"
                tick={{ fontSize: 11, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
              />
              <YAxis
                stroke="#728197"
                tick={{ fontSize: 11, fontWeight: 600, fill: '#94A3B8', fontFamily: 'var(--font-mono)' }}
                tickFormatter={(v: number) => `${v.toFixed(2)}%`}
                domain={fwdYDomain}
                allowDataOverflow
              />
              <Tooltip
                contentStyle={{ background: '#0d1520', border: '1px solid #334155', fontFamily: 'var(--font-mono)', fontSize: 11 }}
                formatter={(value: unknown, name: string | undefined) => [value != null && typeof value === 'number' ? `${value.toFixed(3)}%` : '—', name ?? '']}
              />
              <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} />
              {FORWARD_COUNTRIES.map(c => (
                <Line
                  key={c}
                  type="monotone"
                  dataKey={c}
                  stroke={FORWARD_COLORS[c]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
