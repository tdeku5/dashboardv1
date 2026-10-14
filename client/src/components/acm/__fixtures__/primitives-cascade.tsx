// Fixture for primitivesCascade.browser.test.ts — see primitives-cascade.html.
// Each case carries data-case; reference swatches paint the token directly so
// the test compares computed values, not class names.
import { createRoot } from 'react-dom/client'
import '../../../styles/globals.css'
import '../../../styles/acm-tokens.css'
import { AcmStatTile, AcmDataTable, AcmNavTier, type AcmColumn } from '../index'

const REFS = ['acm-positive', 'acm-negative', 'acm-dir-up', 'acm-dir-down', 'acm-text-primary',
  'acm-alert-mild', 'acm-alert-strong', 'acm-alert-mild-tint', 'acm-alert-strong-tint', 'acm-accent-hover', 'acm-accent-muted']

interface R { k: string; v: number; tone?: 'positive' | 'negative' | 'dir-up' | 'dir-down'; alert?: 'mild' | 'strong' }
const rows: R[] = [
  { k: 'pos', v: 1, tone: 'positive' }, { k: 'neg', v: -1, tone: 'negative' },
  { k: 'up', v: 2, tone: 'dir-up', alert: 'mild' }, { k: 'down', v: -2, tone: 'dir-down', alert: 'strong' },
]
const cols: AcmColumn<R>[] = [
  { key: 'k', header: 'K', kind: 'label', value: r => r.k },
  { key: 'v', header: 'V', kind: 'num', value: r => r.v, tone: r => r.tone, alert: r => r.alert },
]

createRoot(document.getElementById('root')!).render(
  <div className="acm-root" style={{ background: 'var(--acm-surface-bg)' }}>
    {REFS.map(t => (
      <span key={t} data-ref={t} style={{ color: `var(--${t})`, background: `var(--${t})`, outlineColor: `var(--${t})` }} />
    ))}
    <div data-case="tile-dir-up"><AcmStatTile label="A" value="+11.37" tone="dir-up" /></div>
    <div data-case="tile-negative"><AcmStatTile label="B" value="-3.00" tone="negative" /></div>
    <div data-case="tile-alert-mild"><AcmStatTile label="C" value="+2.50σ" alert="mild" /></div>
    <div data-case="tile-alert-strong"><AcmStatTile label="D" value="+3.50σ" alert="strong" /></div>
    <div data-case="table"><AcmDataTable columns={cols} rows={rows} rowKey={r => r.k} /></div>
    <div data-case="nav"><AcmNavTier tier="section" label="n" items={[{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]} value="b" onChange={() => {}} /></div>
  </div>,
)
