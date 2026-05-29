// Trading Economics appends a reference-period suffix to event names mid-cycle
// (e.g. "Core PCE Price Index MoM" → "Core PCE Price Index MoM APR" once the
// April reference month is published, "Initial Jobless Claims" → "Initial
// Jobless Claims MAY/23" for the week ending May 23, "Current Account" →
// "Current Account Q1"). The suffix is metadata about which period the print
// covers, not a distinct event. If we treat it as part of the event identity
// our upsert key breaks: the same event ends up on two rows (one blank, one
// with the actual). splitReferencePeriod() peels the suffix off so the base
// name can serve as the stable identity key, and the suffix can still be shown
// in the UI for context.
//
// Conservative on purpose — false MERGES (two genuinely different events
// collapsed) are worse than false NON-merges (a suffix left attached). We only
// strip ALL-UPPERCASE trailing tokens that match a known reference-period
// shape, anchored at the end of the string. No `i` flag, no looping.

const MONTH = '(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)'

// Order matters: try the most specific patterns first so e.g. "MAY/23" is
// captured as the whole week-ending token, not stripped down to just "MAY".
const PATTERNS: RegExp[] = [
  new RegExp(`\\s+${MONTH}\\/\\d{1,2}$`),        // " MAY/23" — week-ending date
  new RegExp(`\\s+Q[1-4](\\s+20\\d{2})?$`),       // " Q1" or " Q1 2026"
  new RegExp(`\\s+${MONTH}(\\s+20\\d{2})?$`),     // " APR" or " APR 2026"
]

export interface SplitEvent {
  baseEvent: string
  referencePeriod: string | null
}

export function splitReferencePeriod(event: string): SplitEvent {
  const trimmed = event.trim()
  for (const re of PATTERNS) {
    const m = trimmed.match(re)
    if (m && m.index != null) {
      return {
        baseEvent: trimmed.slice(0, m.index).trimEnd(),
        referencePeriod: m[0].trim(),
      }
    }
  }
  return { baseEvent: trimmed, referencePeriod: null }
}
