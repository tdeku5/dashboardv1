export interface AuctionRecord {
  cusip: string
  auctionDate: string
  securityType: string
  securityTerm: string
  bidToCover: number | null
  highYield: number | null
  interestRate: number | null
  totalAccepted: number | null
  totalTendered: number | null
  offeringAmount: number | null
  directBidderAccepted: number | null
  directBidderTendered: number | null
  indirectBidderAccepted: number | null
  indirectBidderTendered: number | null
  reopening: string | null
}

export async function fetchAuctions(opts: {
  term?: string
  type?: string
  start?: string
  end?: string
}): Promise<AuctionRecord[]> {
  const params = new URLSearchParams()
  if (opts.term) params.set('term', opts.term)
  if (opts.type) params.set('type', opts.type)
  if (opts.start) params.set('start', opts.start)
  if (opts.end) params.set('end', opts.end)
  const res = await fetch(`/api/treasury/auctions?${params}`)
  if (!res.ok) throw new Error(`Treasury API error: ${res.status}`)
  const data = await res.json()
  return data.auctions
}

// ── Investor Class ──────────────────────────────────────────────────────────

export interface InvestorClassRecord {
  issueDate: string
  cusip: string
  securityType: string
  couponRate: number | null
  maturityDate: string | null
  totalIssueAmount: number | null
  federalReserve: number | null
  federalReservePct: number | null
  depositoryInstitutions: number | null
  depositoryInstitutionsPct: number | null
  individuals: number | null
  individualsPct: number | null
  dealersAndBrokers: number | null
  dealersAndBrokersPct: number | null
  pensionAndRetirement: number | null
  pensionAndRetirementPct: number | null
  investmentFunds: number | null
  investmentFundsPct: number | null
  foreignAndInternational: number | null
  foreignAndInternationalPct: number | null
  other: number | null
  otherPct: number | null
}

export async function fetchInvestorClassData(params: {
  securityType?: string
  term?: number
  startDate?: string
  endDate?: string
}): Promise<InvestorClassRecord[]> {
  const query = new URLSearchParams()
  if (params.securityType) query.set('securityType', params.securityType)
  if (params.term) query.set('term', String(params.term))
  if (params.startDate) query.set('startDate', params.startDate)
  if (params.endDate) query.set('endDate', params.endDate)
  const res = await fetch(`/api/treasury/investor-class?${query}`)
  if (!res.ok) throw new Error('Failed to fetch investor class data')
  const data = await res.json()
  return data.records
}
