import { Router } from 'express'
import { getHmrcReceipts, getHmrcTaxHeads } from '../db'

// HMRC monthly tax receipts by tax head — /api/hmrc-receipts
export const hmrcReceiptsRouter = Router()

// GET /api/hmrc-receipts/heads
hmrcReceiptsRouter.get('/heads', (_req, res) => {
  res.json({ taxHeads: getHmrcTaxHeads() })
})

// GET /api/hmrc-receipts?tax_head=Income%20Tax  (omit tax_head for all series)
hmrcReceiptsRouter.get('/', (req, res) => {
  const taxHead = typeof req.query.tax_head === 'string' && req.query.tax_head !== ''
    ? req.query.tax_head
    : undefined
  res.json({ taxHead: taxHead ?? null, observations: getHmrcReceipts(taxHead) })
})
