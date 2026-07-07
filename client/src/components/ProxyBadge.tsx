import type { ProxyCaveat } from '../data/ukProxyCaveats'
import styles from './charts/ChartKit.module.css'

/**
 * PROXY-series disclosure chip. Rendered next to any panel title whose data is
 * a PROXY substitute rather than a DIRECT equivalent of the US series it
 * mirrors. Tooltip text comes from the caveat registry
 * (client/src/data/ukProxyCaveats.ts) — never hardcode caveat copy in pages.
 */
export function ProxyBadge({ caveat }: { caveat: ProxyCaveat }) {
  return (
    <span className={styles.proxyBadge}>
      <span className={styles.proxyChip} tabIndex={0}>Proxy</span>
      <span className={styles.proxyTip} role="tooltip">
        <span className={styles.proxyTipRow} style={{ display: 'block' }}>
          <span className={styles.proxyTipTag}>US</span>{caveat.us}
        </span>
        <span className={styles.proxyTipRow} style={{ display: 'block' }}>
          <span className={styles.proxyTipTag}>UK</span>{caveat.uk}
        </span>
        <span className={styles.proxyTipRow} style={{ display: 'block' }}>
          <span className={styles.proxyTipTag}>&#9888;</span>{caveat.caveat}
        </span>
      </span>
    </span>
  )
}
