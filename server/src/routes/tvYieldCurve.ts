import { Router, Request, Response } from 'express'
import { db } from '../db'
import { getYieldCurveCountry } from '../yieldCurveRegistry'

export const tvYieldCurveRouter = Router()

function tsToDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

interface RawRow {
  time: string
  close: number
}

tvYieldCurveRouter.get('/:pageKey', (req: Request, res: Response) => {
  try {
    const pageKey = String(req.params.pageKey).toLowerCase()
    const config = getYieldCurveCountry(pageKey)
    if (!config) {
      res.status(400).json({ error: `Unknown yield curve page key: ${pageKey}` })
      return
    }

    const tenors = config.tenors.map(tenor => {
      const rows = db.prepare(`
        SELECT time, close FROM tv_series
        WHERE symbol = ?
        AND close IS NOT NULL
        ORDER BY CAST(time AS INTEGER) ASC
      `).all(tenor.key) as RawRow[]

      const data = rows.map(r => ({
        date: tsToDate(parseInt(r.time, 10)),
        value: r.close,
      }))

      return {
        key: tenor.key,
        label: tenor.label,
        years: tenor.years,
        data,
      }
    })

    res.json({
      country: config.country,
      displayName: config.displayName,
      tenors,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected yield curve error'
    console.error('[tv-yield-curve] Error:', msg)
    res.status(500).json({ error: msg })
  }
})
