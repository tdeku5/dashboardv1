// Single-function event categorizer for the Economic Data Log. Maps a Trading
// Economics event name to one of the CATEGORIES. Applied at ingestion; the
// result is stored on the row. Unknown events fall back to 'Other' and are
// logged (once per name per process) so the rule table can be extended.
//
// Rules are an ORDERED list — first match wins — so more specific patterns sit
// above more general ones (e.g. "GDP Price Index" → Inflation before the
// generic GDP → Growth; "Manufacturing PMI" → Surveys before Production).
// Single-category call per event (no multi-tagging), per spec.

import type { Category } from './types'

const RULES: Array<{ category: Category; re: RegExp }> = [
  // Central-bank speeches, decisions, minutes, and monetary/financial reports.
  { category: 'CB Speeches', re: /\b(fed|fomc|ecb|boe|boc|boj|rba|rbnz|snb|pboc)\b|bank of (england|canada|japan|korea)|\b(powell|lagarde|bailey|macklem|ueda|bullock)\b|speech|speaks|testimony|press conference|monetary policy|financial stability|rate decision|interest rate decision|meeting (minutes|accounts)|\bminutes\b|\bbulletin\b|policy report|mpr\b/i },

  // Soft-survey / sentiment data (PMI, ISM, regional Fed, sentiment indices).
  // Note: "Consumer Confidence" is intentionally Consumption (below), not here.
  { category: 'Surveys', re: /\bpmi\b|\bism\b|sentiment|business confidence|economic optimism|empire state|philadelphia fed|philly fed|\bzew\b|\bifo\b|sentix|tankan|nfib|business climate|consumer climate|\bgfk\b|business survey|economic survey|\bcbi\b/i },

  // Price gauges (all stages/variants). Includes GDP/PCE *price* indexes.
  { category: 'Inflation', re: /\bcpi\b|consumer price|core inflation|inflation rate|\bppi\b|producer price|\bhicp\b|pce price|core pce|gdp price|price index|\binflation\b|deflator/i },

  // Labor market.
  { category: 'Labor', re: /unemploy|payrolls|non.?farm|jobless claims|initial claims|continuing claims|\badp\b|\bjolts\b|job openings|employment|labou?r force|participation rate|\bwages?\b|earnings|challenger|jobs report|claimant count/i },

  // Housing & construction.
  { category: 'Housing', re: /housing|home sales|mortgage|building permits|construction|house price|\bhpi\b|case.?shiller|\bfhfa\b|nationwide|rightmove|halifax|home loans|residential/i },

  // External sector.
  { category: 'Trade', re: /trade balance|balance of trade|current account|\bexports?\b|\bimports?\b|goods trade|trade deficit|terms of trade/i },

  // Household spending & confidence (PCE *spending*, not the price index).
  { category: 'Consumption', re: /retail sales|personal spending|personal consumption|personal income|consumer confidence|consumer credit|vehicle sales|car registrations|household spending/i },

  // Output / activity growth (GDP volume, industrial & manufacturing output).
  { category: 'Growth', re: /\bgdp\b|gross domestic|industrial production|manufacturing production|economic growth|business investment|capital spending|capital expenditure/i },

  // Hard manufacturing / orders data.
  { category: 'Production', re: /durable goods|factory orders|manufacturing orders|machine tool|capacity utilization|construction output|manufacturing sales|new orders|industrial orders/i },
]

const warned = new Set<string>()

export function classifyCategory(event: string): Category {
  const name = (event ?? '').trim()
  for (const { category, re } of RULES) {
    if (re.test(name)) return category
  }
  if (name && !warned.has(name)) {
    warned.add(name)
    console.warn(`[econ-calendar] Uncategorized event → 'Other': "${name}"`)
  }
  return 'Other'
}
