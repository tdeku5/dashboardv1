// US FX page — the home for the dollar-centric FX views.
//
//   • Pair Returns dashboards (DM + EM) — relocated from the previous FX
//     Global tab. Since the dollar is the reference currency for every cross
//     in the heatmaps, hosting them here is the natural fit.
//   • DXY vs US−foreign 2Y spread — dollar level alongside its carry edge
//     (US 2Y minus equal-weighted CA/FR/DE/IT/GB/JP 2Y mean).
//   • DM USD-strength crosses — every DM cross normalized so up = stronger
//     USD (EUR/GBP/AUD/NZD inverted), with index-100 / cumulative-% toggle.
//
// The two rate-driven panels sit side by side in a 50/50 row below the pair
// returns dashboards; the inline grid keeps the layout primitive local rather
// than carving a new CSS class for one place. Each chart owns its own height
// so the cells don't depend on the grid's intrinsic sizing.

import { PairReturnsPage } from './PairReturnsPage'
import { DxyForeignYieldsChart } from '../components/DxyForeignYieldsChart'
import { DmCrossesUsdStrengthChart } from '../components/DmCrossesUsdStrengthChart'
import styles from './VolPage.module.css'

export function UsFxPage() {
  return (
    <div className={styles.shell}>
      <PairReturnsPage />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <DxyForeignYieldsChart />
        <DmCrossesUsdStrengthChart />
      </div>
    </div>
  )
}
