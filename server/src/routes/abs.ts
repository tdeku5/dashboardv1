import { Router } from 'express'
import { getAbsObservations } from '../db'

// Generic ABS series getter — /api/abs?code=AU_GDP_R
// Serves any series_code in au_macro_series (the AU econ-model codes from
// fetchAllAbsSeries.ts and the rates-side AU_CPI_*/AU_UNRATE_* codes).
// Observations include obs_status (TVD p/r preliminary/revised flags).
export const absRouter = Router()

absRouter.get('/', (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : ''
  if (!code) {
    res.status(400).json({ error: 'code query param required' })
    return
  }
  res.json({ code, observations: getAbsObservations(code) })
})
