import { Router, Request, Response } from 'express'

const FUTURES_API_BASE = process.env.FUTURES_API_URL || 'http://localhost:3100/api'
const FUTURES_ROUTE_PREFIX = '/api/futures/'

const futuresRouter = Router()

futuresRouter.get('/*', async (req: Request, res: Response) => {
  const originalUrl = req.originalUrl || ''
  const pathStart = originalUrl.indexOf(FUTURES_ROUTE_PREFIX)
  const rawSuffix = pathStart >= 0
    ? originalUrl.slice(pathStart + FUTURES_ROUTE_PREFIX.length)
    : ''

  if (!rawSuffix) {
    res.status(400).json({ error: 'Missing futures API path' })
    return
  }

  const targetUrl = `${FUTURES_API_BASE}/${rawSuffix}`

  try {
    const upstream = await fetch(targetUrl)
    const body = await upstream.text()
    const contentType = upstream.headers.get('content-type')

    if (contentType) {
      res.setHeader('content-type', contentType)
    }

    res.status(upstream.status).send(body)
  } catch (err) {
    const cause = err instanceof Error && 'cause' in err ? (err as Error & { cause?: NodeJS.ErrnoException }).cause : undefined
    if (cause?.code === 'ECONNREFUSED') {
      res.status(503).json({
        error: 'Futures data service unavailable. Ensure the schwab collector is running on port 3100.',
      })
      return
    }

    const msg = err instanceof Error ? err.message : 'Unexpected futures proxy error'
    console.error('[futures] Proxy error:', msg)
    res.status(500).json({ error: msg })
  }
})

export default futuresRouter
