/**
 * One-time migration: re-tag all existing news articles using the updated
 * Claude prompt. Reads every article from the DB, classifies with Haiku,
 * and writes back the new topics + tag.
 *
 * Run from project root:
 *   npx tsx server/src/scripts/retagArticles.ts
 */

import dotenv from 'dotenv'
import path from 'path'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '../db'

dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') })

// ── Config ────────────────────────────────────────────────────────────────────

const TOPIC_LIST = [
  'AI', 'Federal Reserve', 'Geopolitics', 'Tariffs',
  'Markets', 'Regulation', 'Energy', 'Labor',
] as const

type Topic = typeof TOPIC_LIST[number]

const anthropic = new Anthropic()  // reads ANTHROPIC_API_KEY from env

// ── Classifier (new prompt) ───────────────────────────────────────────────────

async function classifyTopics(title: string, description: string): Promise<string[]> {
  try {
    const response = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{
        role:    'user',
        content: `You are a strict news categorization assistant for a financial and macroeconomic terminal. Categorize the following article into one or more of these topics ONLY if the article is explicitly and primarily about that topic:

- AI: artificial intelligence, machine learning, LLMs, AI models, AI companies, AI policy
- Federal Reserve: the US Federal Reserve, FOMC, Jerome Powell, US interest rates, US monetary policy. NOTE: "Fed" must refer to the Federal Reserve specifically — do NOT tag articles mentioning "FedEx", "fed up", or other unrelated uses of the word "fed"
- Geopolitics: international relations, wars, sanctions, diplomatic relations, national security, cross-border conflict
- Tariffs: import/export tariffs, trade wars, customs duties, trade agreements
- Markets: stock markets, equity markets, bond markets, commodities, market indices, trading
- Regulation: government regulation, antitrust, legislation, regulatory agencies (SEC, FTC, FCA etc.)
- Energy: oil, gas, renewable energy, power grids, energy policy, OPEC
- Labor: employment, unemployment, layoffs, wages, strikes, workforce trends

Rules:
- Only assign a topic if the article is clearly and directly about it — do not infer loosely
- An article can have multiple topics if it genuinely covers multiple areas
- If the article does not clearly fit any topic, return an empty array — it will be tagged General automatically
- Return ONLY a JSON array of matching topic names, no explanation or other text

Title: ${title}
Description: ${description}`,
      }],
    })

    const raw  = response.content[0].type === 'text' ? response.content[0].text.trim() : '[]'
    // Strip markdown code fences that Haiku sometimes wraps around the JSON
    const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) return []

    return (parsed as unknown[]).filter(
      (t): t is Topic => typeof t === 'string' && (TOPIC_LIST as readonly string[]).includes(t)
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 80) : String(err)
    console.warn(`  [warn] Claude error: ${msg}`)
    return []
  }
}

// ── Migration ─────────────────────────────────────────────────────────────────

interface ArticleRow {
  id:          number
  title:       string
  description: string
}

async function run() {
  const articles = db.prepare(
    'SELECT id, title, description FROM news_articles ORDER BY published_at DESC'
  ).all() as ArticleRow[]

  const total = articles.length
  console.log(`[retag] Starting re-tagging of ${total} articles…`)

  const updateStmt = db.prepare(
    'UPDATE news_articles SET topics = ?, tag = ? WHERE id = ?'
  )

  let done = 0, errors = 0

  for (const article of articles) {
    const rawTopics = await classifyTopics(article.title, article.description ?? '')
    const topics    = rawTopics.length > 0 ? rawTopics : ['General']
    const tag       = topics[0]

    updateStmt.run(JSON.stringify(topics), tag, article.id)
    done++

    if (done % 10 === 0 || done === total) {
      process.stdout.write(`\r[retag] ${done}/${total} done (${errors} errors)`)
    }

    // Brief pause to respect Haiku rate limits
    await new Promise<void>(r => setTimeout(r, 150))
  }

  console.log(`\n[retag] Complete — ${done} articles re-tagged, ${errors} errors`)
}

run().catch(err => {
  console.error('[retag] Fatal error:', err)
  process.exit(1)
})
