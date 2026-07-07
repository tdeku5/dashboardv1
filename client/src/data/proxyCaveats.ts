// Shared shape for country PROXY-series disclosures (badge tooltips).
// One registry file per country (ukProxyCaveats.ts, caProxyCaveats.ts, …),
// each entry keyed by concept; text sourced from that country's mapping doc
// (docs/<country>-models-mapping.md). Never hardcode caveat copy in pages.

export interface ProxyCaveat {
  /** What the US series measures */
  us: string
  /** What the local-country substitute measures */
  local: string
  /** The key difference the reader must know */
  caveat: string
  /** Country tag shown in the tooltip, e.g. 'UK', 'CA' */
  localTag: string
}
