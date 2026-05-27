import { useEffect, useMemo, useState } from 'react'
import { ReturnsHeatmap } from '../components/ReturnsHeatmap'
import { CrudeCurvePanel, OFFSET1_COLOR, OFFSET2_COLOR } from '../components/CrudeCurvePanel'
import { MetalBasisChart } from '../components/MetalBasisChart'
import { useMetalsReturns, type MetalReturnsRow } from '../hooks/useMetalsReturns'
import { useMetalCurves } from '../hooks/useMetalCurves'
import type { LookbackKey } from '../hooks/useSectorAttribution'
import styles from './CrudeOilPage.module.css'

const MIN_OFFSET = 1
const MAX_OFFSET = 1260
const DEBOUNCE_MS = 300

function clampOffset(raw: string, fallback: number): number {
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, n))
}

const returnsAccessor = (row: MetalReturnsRow, lb: LookbackKey): number | null =>
  row.returns[lb] ?? null

export function MetalsPage() {
  // ── Section 1: returns heatmap ──
  const returns = useMetalsReturns()
  const heatmapRows = returns.data?.metals ?? []
  const asOf = returns.data?.asOfDate ?? '—'

  // ── Section 2: futures curves controls (mirrors CrudeOilPage) ──
  const [offset1Input, setOffset1Input] = useState('5')
  const [offset2Input, setOffset2Input] = useState('30')
  const [offset1, setOffset1] = useState(5)
  const [offset2, setOffset2] = useState(30)
  const [showOffset1, setShowOffset1] = useState(true)
  const [showOffset2, setShowOffset2] = useState(true)
  const [deltaUnit, setDeltaUnit] = useState<'$' | '%'>('$')

  useEffect(() => {
    const t = setTimeout(() => setOffset1(clampOffset(offset1Input, offset1)), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [offset1Input])
  useEffect(() => {
    const t = setTimeout(() => setOffset2(clampOffset(offset2Input, offset2)), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [offset2Input])

  const curves = useMetalCurves(offset1, offset2)

  const heatmapSubtitle = useMemo(
    () => (returns.error ? returns.error : `as of ${asOf}`),
    [returns.error, asOf],
  )

  return (
    <div className={styles.shell}>
      <div className={styles.headerRow}>
        <div className={styles.title}>Metals</div>
      </div>

      {/* ── Section 1: Returns heatmap ── */}
      <ReturnsHeatmap
        title="METALS RETURNS"
        subtitle={heatmapSubtitle}
        rows={heatmapRows}
        valueAccessor={returnsAccessor}
        missingTickers={returns.data?.missingTickers}
        rowHeaderLabel="Metal"
        gradientMode="column"
      />

      {/* ── Section 2: Gold & Silver futures curves ── */}
      <div className={styles.headerRow}>
        <div className={styles.title}>Futures Curves</div>
      </div>

      <div className={styles.controlBar}>
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel} style={{ color: OFFSET1_COLOR }}>Offset 1</span>
          <input
            type="number"
            className={styles.controlInput}
            min={MIN_OFFSET}
            max={MAX_OFFSET}
            step={1}
            value={offset1Input}
            onChange={(e) => setOffset1Input(e.target.value)}
          />
          <span className={styles.controlLabel} style={{ color: OFFSET1_COLOR }}>days</span>
        </div>

        <div className={styles.controlGroup}>
          <span className={styles.controlLabel} style={{ color: OFFSET2_COLOR }}>Offset 2</span>
          <input
            type="number"
            className={styles.controlInput}
            min={MIN_OFFSET}
            max={MAX_OFFSET}
            step={1}
            value={offset2Input}
            onChange={(e) => setOffset2Input(e.target.value)}
          />
          <span className={styles.controlLabel} style={{ color: OFFSET2_COLOR }}>days</span>
        </div>

        <label className={styles.controlCheckLabel} style={{ color: OFFSET1_COLOR }}>
          <input type="checkbox" checked={showOffset1} onChange={(e) => setShowOffset1(e.target.checked)} />
          Show Offset 1
        </label>

        <label className={styles.controlCheckLabel} style={{ color: OFFSET2_COLOR }}>
          <input type="checkbox" checked={showOffset2} onChange={(e) => setShowOffset2(e.target.checked)} />
          Show Offset 2
        </label>

        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Delta</span>
          <div className={styles.unitToggle}>
            <button
              type="button"
              className={`${styles.unitBtn} ${deltaUnit === '$' ? styles.unitBtnActive : ''}`}
              onClick={() => setDeltaUnit('$')}
            >
              $
            </button>
            <button
              type="button"
              className={`${styles.unitBtn} ${deltaUnit === '%' ? styles.unitBtnActive : ''}`}
              onClick={() => setDeltaUnit('%')}
            >
              %
            </button>
          </div>
        </div>
      </div>

      <div className={styles.panelGrid}>
        <CrudeCurvePanel
          title="Gold (GC) Forward Curve"
          data={curves.data?.gold ?? null}
          loading={curves.loading}
          error={curves.error}
          showOffset1={showOffset1}
          showOffset2={showOffset2}
          deltaUnit={deltaUnit}
          priceUnit="oz"
        />
        <CrudeCurvePanel
          title="Silver (SI) Forward Curve"
          data={curves.data?.silver ?? null}
          loading={curves.loading}
          error={curves.error}
          showOffset1={showOffset1}
          showOffset2={showOffset2}
          deltaUnit={deltaUnit}
          priceUnit="oz"
        />
      </div>

      {/* ── Section 3: Spot − front month basis ── */}
      <div className={styles.headerRow}>
        <div className={styles.title}>Spot − Front Month Basis</div>
      </div>

      <div className={styles.panelGrid}>
        <MetalBasisChart metal="gold" />
        <MetalBasisChart metal="silver" />
      </div>
    </div>
  )
}
