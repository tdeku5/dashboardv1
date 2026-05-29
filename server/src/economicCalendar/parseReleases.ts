// Parser for the Economic Data Log. The scraped Trading Economics markdown is
// handed to Claude (claude-opus-4-7) with a structured-output prompt; the JSON
// it returns is validated against the canonical schema before anything is
// persisted. This LLM step is the resilience layer — it survives TE DOM/markup
// changes that would break CSS selectors, so there is deliberately NO selector
// fallback. Validation failures throw; the orchestrator logs the raw scrape for
// debugging (see index.ts).
//
// extractJsonArray + validateReleases are pure and unit-tested directly;
// parseReleasesFromMarkdown takes the Anthropic client by injection so tests can
// stub it without hitting the live API.

import Anthropic from '@anthropic-ai/sdk'
import { normalizeCountry } from './countries'
import { WATCHLIST_COUNTRIES, type EconomicRelease } from './types'

export const PARSE_MODEL = 'claude-opus-4-7'

// The parse depends on a single text-generation function rather than the raw
// Anthropic client. Production streams from claude-opus-4-7 (a full week of the
// calendar can exceed the SDK's 10-minute non-streaming ceiling); tests inject a
// stub that returns canned JSON. `prompt` in → assistant text out.
export type GenerateFn = (prompt: string) => Promise<string>

// Default generator: streams the completion and returns the assembled text.
// Streaming is required because the large max_tokens needed for a full calendar
// trips the SDK's non-streaming long-request guard.
async function streamWithClaude(prompt: string, model: string): Promise<string> {
  const anthropic = new Anthropic()   // reads ANTHROPIC_API_KEY from env
  const stream = anthropic.messages.stream({
    model,
    // A full month of medium+high watchlist releases is several hundred rows;
    // the JSON array runs long, so give it generous headroom. Truncation leaves
    // an unterminated array and fails extraction loudly (caught upstream).
    max_tokens: 64000,
    messages: [{ role: 'user', content: prompt }],
  })
  const msg = await stream.finalMessage()
  const block = msg.content.find(b => b.type === 'text')
  return block && block.type === 'text' ? block.text : ''
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function buildParsePrompt(markdown: string): string {
  return `You are a precise data extraction engine for an economic research terminal. Below is the scraped markdown of the Trading Economics economic calendar. Extract EVERY economic data release into a JSON array.

Return ONLY a JSON array (no prose, no markdown fences). Each element must be an object with exactly these keys:
- "release_date": ISO date "YYYY-MM-DD"
- "day_of_week": full weekday name, e.g. "Monday"
- "country": normalized to EXACTLY one of: ${WATCHLIST_COUNTRIES.map(c => `"${c}"`).join(', ')}. Map abbreviations (US→"United States", UK→"United Kingdom", EA/Euro Area→"Eurozone", etc.). If a release is for a country NOT in this list, OMIT it entirely.
- "event": the release name as shown, e.g. "Core Inflation Rate MoM"
- "expected": the consensus/forecast value exactly as shown (string), or null if blank
- "actual": the actual released value exactly as shown (string), or null if not yet released
- "previous": the prior value exactly as shown (string), or null if blank
- "importance": integer 1, 2, or 3 (low, medium, high — infer from the importance/star indicator; default 2 if ambiguous)

Rules:
- Preserve values verbatim including units (e.g. "0.2%", "200K", "2.8%"). If a row shows multiple figures (MoM and YoY), join them: "0.2% MoM, 2.8% YoY".
- Use null (not "" or "-") for missing expected/actual/previous.
- Only include rows that are actual data releases (skip holidays, headers, and section labels).
- Return ONLY the JSON array.

CALENDAR MARKDOWN:
${markdown}`
}

// Strips optional ``` fences and parses the first top-level JSON array in the
// text. Throws if no array is found or it isn't valid JSON.
export function extractJsonArray(text: string): unknown[] {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON array found in model output')
  }
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown
  if (!Array.isArray(parsed)) throw new Error('Parsed JSON is not an array')
  return parsed
}

function dayOfWeekFor(isoDate: string, provided: unknown): string {
  if (typeof provided === 'string' && provided.trim() !== '') return provided.trim()
  const d = new Date(`${isoDate}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? '' : DAY_NAMES[d.getUTCDay()]
}

function cleanNullable(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (s === '' || s === '-' || s === '—' || s.toLowerCase() === 'n/a' || s.toLowerCase() === 'null') return null
  return s
}

export interface ValidationResult {
  releases: EconomicRelease[]
  rejected: number   // rows dropped: malformed, or country off-watchlist
}

// Pure schema validation + normalization. Drops rows that are malformed
// (missing date/event) or off-watchlist. Clamps importance to 1–3. Does NOT
// filter by importance — that's the orchestrator's configurable concern.
export function validateReleases(raw: unknown[], scrapedAt: string): ValidationResult {
  const releases: EconomicRelease[] = []
  let rejected = 0

  for (const item of raw) {
    if (item == null || typeof item !== 'object') { rejected++; continue }
    const r = item as Record<string, unknown>

    const release_date = typeof r.release_date === 'string' ? r.release_date.trim() : ''
    if (!ISO_DATE_RE.test(release_date)) { rejected++; continue }

    const country = normalizeCountry(typeof r.country === 'string' ? r.country : null)
    if (!country) { rejected++; continue }   // off-watchlist or unparseable

    const event = typeof r.event === 'string' ? r.event.trim() : ''
    if (event === '') { rejected++; continue }

    let importance = Math.round(Number(r.importance))
    if (!Number.isFinite(importance)) importance = 2
    importance = Math.min(3, Math.max(1, importance))

    releases.push({
      release_date,
      day_of_week: dayOfWeekFor(release_date, r.day_of_week),
      country,
      event,                       // raw TE name; orchestrator splits off the
      reference_period: null,      // reference-period suffix before upsert
      expected: cleanNullable(r.expected),
      actual: cleanNullable(r.actual),
      previous: cleanNullable(r.previous),
      importance,
      scraped_at: scrapedAt,
    })
  }

  return { releases, rejected }
}

export interface ParseDeps {
  generate?: GenerateFn
  scrapedAt?: string
  model?: string
}

// Full markdown → validated releases. Generates the JSON via Claude, extracts
// the array, validates it. Throws on extract/validation failure so the caller
// can log the raw scrape and exit.
export async function parseReleasesFromMarkdown(markdown: string, deps: ParseDeps = {}): Promise<EconomicRelease[]> {
  const scrapedAt = deps.scrapedAt ?? new Date().toISOString()
  const model = deps.model ?? PARSE_MODEL
  const generate = deps.generate ?? ((prompt: string) => streamWithClaude(prompt, model))

  const text = await generate(buildParsePrompt(markdown))
  const rawArray = extractJsonArray(text)
  const { releases, rejected } = validateReleases(rawArray, scrapedAt)

  if (releases.length === 0) {
    throw new Error(`Parse produced 0 valid releases (${rejected} rejected) — likely a scrape/markup problem`)
  }
  console.log(`[econ-calendar] Parsed ${releases.length} releases (${rejected} rejected)`)
  return releases
}
