import { fetchBoeSeries } from './boeApi'
import { isBoeSeriesStale } from './db'

// All BoE series to pre-fetch, grouped by topic
export const ALL_BOE_SERIES = {
  // ─── Policy Rates ───
  rates: [
    'IUDBEDR',   // Bank Rate (daily)
    'IUDSOIA',   // SONIA (daily)
    'IUDAMIH',   // Monthly avg Bank Rate
  ],

  // ─── Gilt Yields — Nominal Par Yields (daily) ───
  gilts_nominal: [
    'IUDSNPY',   // Nominal par yield 5yr
    'IUDMNPY',   // Nominal par yield 10yr
    'IUDLNPY',   // Nominal par yield 20yr
  ],

  // ─── Gilt Yields — Zero Coupon (Nominal, daily) ───
  gilts_zero: [
    'IUDSIZC',   // Zero coupon nominal 5yr
    'IUDMIZC',   // Zero coupon nominal 10yr
    'IUDLIZC',   // Zero coupon nominal 20yr
  ],

  // ─── Gilt Yields — Implied Inflation (daily) ───
  gilts_real: [
    'IUDSIIF',   // Implied inflation forward 5yr
    'IUDMIIF',   // Implied inflation forward 10yr
    'IUDLIIF',   // Implied inflation forward 20yr
  ],

  // ─── OIS Rates (daily) ───
  ois: [
    'IUDWRLN',   // OIS instantaneous forward 1yr
    'IUDAJUR',   // OIS instantaneous forward 2yr
    'IUDEBEN',   // OIS instantaneous forward 3yr
    'IUDAJLT',   // OIS instantaneous forward 5yr
    'IUDBK58',   // OIS instantaneous forward 10yr
    'IUDAJLW',   // OIS instantaneous forward 25yr
  ],

  // ─── Exchange Rates ───
  fx: [
    'XUDLUSS',   // GBP/USD spot (daily)
    'XUDLERS',   // GBP/EUR spot (daily)
    'XUDLJYS',   // GBP/JPY spot (daily)
    'XUDLGPS',   // Sterling ERI (daily)
  ],

  // ─── Money Supply (monthly) ───
  // NOTE 2026-07: 'LPMAUYL' (M4 lending) and 'LPMAUZD' (M4 annual growth) were
  // invalid IADB codes — the IADB errors the ENTIRE request when any code is
  // unknown, which silently blocked every monthly series in this config since
  // inception. Removed; LPMVQJW covers M4 12m growth. M4-lending replacement
  // is deferred (needs a verified code).
  money: [
    'LPMAUYN',   // M4 SA £m
    'LPMVQJW',   // M4 12-month growth rate % SA
  ],

  // ─── Lending to Individuals — Mortgages (monthly) ───
  // NOTE 2026-07: comments below corrected against live IADB titles — several
  // codes were valid but mislabeled. Removed invalid 'LPMVQCO'; 'LPMVTXK'
  // (previously mislabeled "net lending to PNFCs") is the secured-lending-
  // outstanding series and now lives here. Net mortgage lending FLOW series:
  // deferred (needs a verified code). 'LPMBI2O'/'LPMBI2P' are consumer-credit
  // series — moved to consumer_credit.
  mortgages: [
    'LPMVTVX',   // Mortgage approvals for house purchase (number, SA)
    'LPMVTVF',   // Mortgage approvals for house purchase (000s, SA)
    'LPMVTVR',   // Mortgage approvals for remortgaging (000s)
    'LPMVTXK',   // Net secured lending to individuals, amounts outstanding £m SA
    'LPMVTXN',   // Building societies' approvals for secured lending, outstanding £m SA
  ],

  // ─── Lending to Individuals — Consumer Credit (monthly) ───
  // NOTE 2026-07: removed invalid codes 'LPMBL3A', 'LPMVQCG', 'LPMVQCJ',
  // 'LPMVTXR', 'LPMVTXS' (credit-card/other-credit splits — replacements
  // deferred, need verified codes). LPMBI2O covers total outstanding.
  consumer_credit: [
    'LPMVTXY',   // 12m growth rate, net lending to individuals % NSA
    'LPMBI2O',   // Consumer credit (ex SLC) amounts outstanding £m SA
    'LPMBI2P',   // Net unsecured lending (ex SLC) amounts outstanding £m NSA
    'LPMB3PS',   // Net consumer credit (ex SLC) monthly flow £m SA
    'LPMB4TC',   // Consumer credit (ex SLC) 12-month growth rate % SA
  ],

  // ─── Lending to Businesses (monthly) ───
  // NOTE 2026-07: removed invalid 'LPMBC47'; 'LPMVTXK' turned out to be the
  // secured-lending-outstanding series (moved to mortgages). PNFC lending
  // codes: deferred (need verified codes).
  business_lending: [],

  // ─── Mortgage Interest Rates (monthly) ───
  mortgage_rates: [
    'IUMBV34',   // Fixed 2yr 75% LTV
    'IUMBV37',   // Fixed 3yr 75% LTV
    'IUMBV42',   // Fixed 5yr 75% LTV
    'IUMBV45',   // Fixed 10yr 75% LTV
    'IUM2WTL',   // SVR
  ],

  // ─── Effective Interest Rates (monthly) ───
  effective_rates: [
    'CFMHSDE',   // Weighted avg rate, loans secured on dwellings (stock)
    'IUMTLMV',   // Effective rate on new mortgages
    'IUMBX67',   // Effective rate on outstanding mortgages
    'IUMHPTL',   // Effective rate on new HH time deposits
    'IUMCCTL',   // Effective rate on credit cards
    'IUMODTL',   // Effective rate on new other consumer credit
  ],

  // ─── Household Deposits (monthly) ───
  // NOTE 2026-07: removed invalid codes 'LPMVQCP' and 'LPMBI3I' (household
  // deposits — replacements deferred, need verified codes).
  deposits: [],
} as const

// Daily series that should be fetched from 2000 (not 1960)
const DAILY_GROUPS = new Set(['rates', 'gilts_nominal', 'gilts_zero', 'gilts_real', 'ois', 'fx'])

export function getAllBoeSeriesCodes(): string[] {
  return Object.values(ALL_BOE_SERIES).flat() as string[]
}

export async function syncAllBoeSeries(): Promise<void> {
  // Check which series are stale
  const allCodes = getAllBoeSeriesCodes()
  const staleCodes = allCodes.filter(c => isBoeSeriesStale(c, 12))

  if (staleCodes.length === 0) {
    console.log(`[BoE] All ${allCodes.length} series are current.`)
    return
  }

  console.log(`[BoE] Starting sync of ${staleCodes.length}/${allCodes.length} stale series...`)
  const start = Date.now()

  // Group stale codes by frequency for appropriate date ranges
  const dailyCodes: string[] = []
  const monthlyCodes: string[] = []

  const dailySet = new Set<string>()
  for (const [group, codes] of Object.entries(ALL_BOE_SERIES)) {
    if (DAILY_GROUPS.has(group)) {
      for (const c of codes) dailySet.add(c)
    }
  }

  for (const code of staleCodes) {
    if (dailySet.has(code)) {
      dailyCodes.push(code)
    } else {
      monthlyCodes.push(code)
    }
  }

  // Batch into groups of 50
  const batchSize = 50

  // Fetch monthly series (from 1980 — the IADB errors the ENTIRE request when
  // Datefrom predates its floor; 01/Jan/1960 always failed, which silently
  // blocked every monthly series until 2026-07. 1980 verified working for the
  // full monthly batch.)
  for (let i = 0; i < monthlyCodes.length; i += batchSize) {
    const batch = monthlyCodes.slice(i, i + batchSize)
    try {
      await fetchBoeSeries(batch, { dateFrom: '01/Jan/1980' })
    } catch (err) {
      console.error(`[BoE] Monthly batch error:`, err)
    }
    if (i + batchSize < monthlyCodes.length) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  // Fetch daily series (from 2000)
  for (let i = 0; i < dailyCodes.length; i += batchSize) {
    const batch = dailyCodes.slice(i, i + batchSize)
    try {
      await fetchBoeSeries(batch, { dateFrom: '01/Jan/2000' })
    } catch (err) {
      console.error(`[BoE] Daily batch error:`, err)
    }
    if (i + batchSize < dailyCodes.length) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`[BoE] Sync complete in ${elapsed}s`)
}
