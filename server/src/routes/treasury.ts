import { Router, Request, Response } from 'express'
import { getAuctions, getAuctionDbStatus, getInvestorClassData, getInvestorClassCount } from '../db'
import { syncTreasuryAuctions } from '../treasuryAuctions'
import { syncInvestorClassData } from '../investorClassData'

export const treasuryRouter = Router()

// GET /api/treasury/auctions?term=10-Year&type=Note&start=2020-01-01&end=2025-12-31
treasuryRouter.get('/auctions', (req: Request, res: Response) => {
  const { term, type, start, end } = req.query
  const rows = getAuctions({
    securityTerm: term ? String(term) : undefined,
    securityType: type ? String(type) : undefined,
    startDate:    start ? String(start) : undefined,
    endDate:      end ? String(end) : undefined,
  })
  res.json({ auctions: rows })
})

// GET /api/treasury/status
treasuryRouter.get('/status', (_req: Request, res: Response) => {
  res.json(getAuctionDbStatus())
})

// POST /api/treasury/refresh — force full re-sync
let refreshInProgress = false

treasuryRouter.post('/refresh', async (_req: Request, res: Response) => {
  if (refreshInProgress) {
    res.status(409).json({ error: 'Refresh already in progress' })
    return
  }
  refreshInProgress = true
  try {
    await syncTreasuryAuctions({ force: true })
    res.json({ success: true, ...getAuctionDbStatus() })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Refresh failed' })
  } finally {
    refreshInProgress = false
  }
})

// ── Investor Class endpoints ──────────────────────────────────────────────────

// GET /api/treasury/investor-class?securityType=Note&term=10&startDate=2020-01-01&endDate=2025-12-31
treasuryRouter.get('/investor-class', (req: Request, res: Response) => {
  const { securityType, startDate, endDate, term } = req.query
  const termNum = term ? parseInt(String(term)) : undefined
  const rows = getInvestorClassData({
    securityType: securityType ? String(securityType) : undefined,
    startDate:    startDate ? String(startDate) : undefined,
    endDate:      endDate ? String(endDate) : undefined,
    term:         termNum && !isNaN(termNum) ? termNum : undefined,
  })

  // Compute percentage fields on the fly
  const withPct = rows.map(r => {
    const total = r.totalIssueAmount
    const pct = (v: number | null) => (v != null && total ? (v / total) * 100 : null)
    return {
      ...r,
      federalReservePct:          pct(r.federalReserve),
      depositoryInstitutionsPct:  pct(r.depositoryInstitutions),
      individualsPct:             pct(r.individuals),
      dealersAndBrokersPct:       pct(r.dealersAndBrokers),
      pensionAndRetirementPct:    pct(r.pensionAndRetirement),
      investmentFundsPct:         pct(r.investmentFunds),
      foreignAndInternationalPct: pct(r.foreignAndInternational),
      otherPct:                   pct(r.other),
    }
  })

  res.json({ records: withPct, count: withPct.length })
})

// POST /api/treasury/investor-class/refresh
let icRefreshInProgress = false

treasuryRouter.post('/investor-class/refresh', async (_req: Request, res: Response) => {
  if (icRefreshInProgress) {
    res.status(409).json({ error: 'Investor class refresh already in progress' })
    return
  }
  icRefreshInProgress = true
  try {
    await syncInvestorClassData()
    res.json({ success: true, count: getInvestorClassCount() })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Refresh failed' })
  } finally {
    icRefreshInProgress = false
  }
})
