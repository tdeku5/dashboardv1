// Hephaestus Claude client — its OWN module by design: the economic-calendar
// client (economicCalendar/parseReleases.ts, pinned to claude-opus-4-7) is a
// separate concern and is never touched by Hephaestus model choices.
//
// Model constraints (verified live against GET /v1/models on 2026-07-09 with
// the project key; both IDs served, 1M input / 128K output):
//   - NO temperature/top_p/top_k — both models reject sampling params (400).
//   - NO thinking config — omitted entirely. Sonnet 5 runs adaptive thinking
//     by default; Opus 4.8 runs without thinking when omitted. Passing any
//     explicit budget_tokens shape would 400 on both.
//   - max_tokens 8192 per turn (tool-loop turns are short; spec + prose fit
//     comfortably).
//
// The chat loop depends on ChatFn rather than the SDK client directly (same
// dependency-injection pattern as parseReleases.ts's GenerateFn) so tests can
// script model turns without hitting the API.

import Anthropic from '@anthropic-ai/sdk'

export const HEPHAESTUS_DEFAULT_MODEL = 'claude-sonnet-5'
export const HEPHAESTUS_ALT_MODEL = 'claude-opus-4-8'
export const HEPHAESTUS_MODELS: readonly string[] = [HEPHAESTUS_DEFAULT_MODEL, HEPHAESTUS_ALT_MODEL]

export const HEPHAESTUS_MAX_TOKENS = 8192

export interface ChatRequest {
  model: string
  system: string
  messages: Anthropic.MessageParam[]
  tools: Anthropic.Tool[]
}

export type ChatFn = (req: ChatRequest) => Promise<Anthropic.Message>

export function makeChatFn(): ChatFn {
  const client = new Anthropic()   // reads ANTHROPIC_API_KEY from env (root .env via dotenv in index.ts)
  return req => client.messages.create({
    model: req.model,
    max_tokens: HEPHAESTUS_MAX_TOKENS,
    system: req.system,
    messages: req.messages,
    tools: req.tools,
  })
}
