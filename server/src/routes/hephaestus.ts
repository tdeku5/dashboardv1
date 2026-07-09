// Hephaestus routes — AI charting agent (Phase 1, backend).
//   POST /api/hephaestus/chat        — natural language → validated ChartSpecV1
//   POST /api/hephaestus/render      — ChartSpecV1 → chart data (the ONE render path)
//   GET/POST /api/hephaestus/charts  — saved charts list / create
//   PATCH /api/hephaestus/charts/:id — rename ONLY (v1: spec editing out of scope)
//   DELETE /api/hephaestus/charts/:id

import { Router, Request, Response } from 'express'
import { validateSpecStructure, validateSpecCatalog, type ChartSpecV1 } from '../hephaestus/chartSpec'
import { lookupCatalog, listParams } from '../hephaestus/catalogSearch'
import { renderSpec } from '../hephaestus/render'
import { runHephaestusChat, type ChatTurn } from '../hephaestus/chat'
import { HEPHAESTUS_DEFAULT_MODEL, HEPHAESTUS_MODELS } from '../hephaestus/claudeClient'
import { listSavedCharts, getSavedChart, insertSavedChart, renameSavedChart, deleteSavedChart } from '../db'

export const hephaestusRouter = Router()

function validateFullSpec(input: unknown): { ok: true; spec: ChartSpecV1 } | { ok: false; errors: string[] } {
  const structural = validateSpecStructure(input)
  if (!structural.ok) return structural
  return validateSpecCatalog(structural.spec, { lookup: lookupCatalog, listParams })
}

// ── Chat ─────────────────────────────────────────────────────────────────────

hephaestusRouter.post('/chat', async (req: Request, res: Response) => {
  try {
    const body = req.body as { messages?: unknown; model?: unknown }

    const model = body.model === undefined ? HEPHAESTUS_DEFAULT_MODEL : String(body.model)
    if (!HEPHAESTUS_MODELS.includes(model)) {
      res.status(400).json({ error: `model must be one of: ${HEPHAESTUS_MODELS.join(', ')}` })
      return
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      res.status(400).json({ error: 'messages must be a non-empty array of {role, content}' })
      return
    }
    const messages: ChatTurn[] = []
    for (const m of body.messages) {
      const t = m as { role?: unknown; content?: unknown }
      if ((t.role !== 'user' && t.role !== 'assistant') || typeof t.content !== 'string' || t.content.trim() === '') {
        res.status(400).json({ error: 'each message must be {role: "user"|"assistant", content: non-empty string}' })
        return
      }
      messages.push({ role: t.role, content: t.content })
    }
    if (messages[messages.length - 1].role !== 'user') {
      res.status(400).json({ error: 'the last message must be from the user' })
      return
    }

    const result = await runHephaestusChat({ messages, model })
    res.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected chat error'
    console.error('[hephaestus] chat error:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── Render ───────────────────────────────────────────────────────────────────

hephaestusRouter.post('/render', async (req: Request, res: Response) => {
  try {
    const v = validateFullSpec(req.body)
    if (!v.ok) {
      res.status(400).json({ error: 'invalid chart spec', validation_errors: v.errors })
      return
    }
    const result = await renderSpec(v.spec)
    res.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected render error'
    console.error('[hephaestus] render error:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── Saved charts CRUD (edit = rename only in v1) ─────────────────────────────

hephaestusRouter.get('/charts', (_req: Request, res: Response) => {
  const charts = listSavedCharts().map(r => ({
    id: r.id, name: r.name, spec: JSON.parse(r.spec_json) as ChartSpecV1,
    created_at: r.created_at, updated_at: r.updated_at,
  }))
  res.json({ count: charts.length, charts })
})

hephaestusRouter.post('/charts', (req: Request, res: Response) => {
  const body = req.body as { name?: unknown; spec?: unknown }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (name === '' || name.length > 120) {
    res.status(400).json({ error: 'name must be a non-empty string (max 120 chars)' })
    return
  }
  const v = validateFullSpec(body.spec)
  if (!v.ok) {
    res.status(400).json({ error: 'invalid chart spec', validation_errors: v.errors })
    return
  }
  const row = insertSavedChart(name, JSON.stringify(v.spec))
  res.status(201).json({ id: row.id, name: row.name, spec: v.spec, created_at: row.created_at, updated_at: row.updated_at })
})

hephaestusRouter.patch('/charts/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'invalid id' }); return }
  const body = req.body as { name?: unknown; spec?: unknown }
  if (body.spec !== undefined) {
    res.status(400).json({ error: 'spec editing is out of scope in v1 — only rename is supported' })
    return
  }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (name === '' || name.length > 120) {
    res.status(400).json({ error: 'name must be a non-empty string (max 120 chars)' })
    return
  }
  if (!renameSavedChart(id, name)) { res.status(404).json({ error: `no saved chart with id ${id}` }); return }
  const row = getSavedChart(id)
  res.json({ id, name: row?.name, updated_at: row?.updated_at })
})

hephaestusRouter.delete('/charts/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'invalid id' }); return }
  if (!deleteSavedChart(id)) { res.status(404).json({ error: `no saved chart with id ${id}` }); return }
  res.json({ deleted: id })
})
