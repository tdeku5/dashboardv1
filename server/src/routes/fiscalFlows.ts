import { Router, Request, Response } from 'express'
import { db } from '../db'
import { getTaxReceiptsData } from '../dtsTaxDeposits'

export const fiscalFlowsRouter = Router()

interface FlowRow {
  record_date: string
  fiscal_year: number
  day_index: number
  cumulative_flow: number
}

// GET /api/fiscal-flows
fiscalFlowsRouter.get('/', (_req: Request, res: Response) => {
  try {
    const rows = db
      .prepare(
        `SELECT record_date, fiscal_year, day_index, cumulative_flow
         FROM dts_fiscal_flows
         ORDER BY fiscal_year, day_index`,
      )
      .all() as FlowRow[]

    const fiscalYears: Record<
      string,
      { record_date: string; day_index: number; cumulative_flow: number }[]
    > = {}

    for (const r of rows) {
      const fy = String(r.fiscal_year)
      if (!fiscalYears[fy]) fiscalYears[fy] = []
      fiscalYears[fy].push({
        record_date: r.record_date,
        day_index: r.day_index,
        cumulative_flow: r.cumulative_flow,
      })
    }

    const lastUpdated =
      (db.prepare('SELECT MAX(record_date) AS d FROM dts_fiscal_flows').get() as { d: string | null }).d

    res.json({ fiscalYears, lastUpdated })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[fiscal-flows] Route error:', msg)
    res.status(500).json({ error: msg })
  }
})

// GET /api/fiscal-flows/tax-receipts
fiscalFlowsRouter.get('/tax-receipts', (_req: Request, res: Response) => {
  try {
    const data = getTaxReceiptsData()
    if (!data) {
      res.status(404).json({ error: 'No withheld tax deposit data available' })
      return
    }
    res.json(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[tax-receipts] Route error:', msg)
    res.status(500).json({ error: msg })
  }
})
