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
  money: [
    'LPMAUYN',   // M4 SA £m
    'LPMAUYL',   // M4 lending SA £m
    'LPMAUZD',   // M4 annual growth rate % SA
  ],

  // ─── Lending to Individuals — Mortgages (monthly) ───
  mortgages: [
    'LPMVTVF',   // Mortgage approvals for house purchase (000s, SA)
    'LPMVTXN',   // Net mortgage lending £m SA
    'LPMVTVR',   // Mortgage approvals for remortgaging (000s)
    'LPMBI2O',   // Gross mortgage lending £m
    'LPMBI2P',   // Gross mortgage repayments £m
    'LPMVQCO',   // Total secured lending outstanding £m
  ],

  // ─── Lending to Individuals — Consumer Credit (monthly) ───
  consumer_credit: [
    'LPMVTXY',   // Net consumer credit £m SA
    'LPMBL3A',   // Consumer credit outstanding £m
    'LPMVQCG',   // Credit card lending outstanding £m
    'LPMVQCJ',   // Other consumer credit outstanding £m
    'LPMVTXR',   // Net credit card lending £m
    'LPMVTXS',   // Net other consumer credit £m
  ],

  // ─── Lending to Businesses (monthly) ───
  business_lending: [
    'LPMVTXK',   // Net lending to PNFCs £m
    'LPMBC47',   // Total lending to PNFCs outstanding £m
  ],

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
    'IUMTLMV',   // Effective rate on new mortgages
    'IUMBX67',   // Effective rate on outstanding mortgages
    'IUMHPTL',   // Effective rate on new HH time deposits
    'IUMCCTL',   // Effective rate on credit cards
    'IUMODTL',   // Effective rate on new other consumer credit
  ],

  // ─── Household Deposits (monthly) ───
  deposits: [
    'LPMVQCP',   // HH deposits with banks & building societies £m
    'LPMBI3I',   // HH deposits net flow £m
  ],
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

  // Fetch monthly series (from 1960)
  for (let i = 0; i < monthlyCodes.length; i += batchSize) {
    const batch = monthlyCodes.slice(i, i + batchSize)
    try {
      await fetchBoeSeries(batch, { dateFrom: '01/Jan/1960' })
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
