import { describe, it, expect } from 'vitest'
import {
  extractJsonArray,
  validateReleases,
  parseReleasesFromMarkdown,
} from './parseReleases'

describe('extractJsonArray', () => {
  it('parses a bare JSON array', () => {
    expect(extractJsonArray('[{"a":1}]')).toEqual([{ a: 1 }])
  })
  it('strips ``` fences', () => {
    expect(extractJsonArray('```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }])
  })
  it('extracts an array embedded in prose', () => {
    expect(extractJsonArray('Here you go:\n[1, 2, 3]\nDone.')).toEqual([1, 2, 3])
  })
  it('throws when there is no array', () => {
    expect(() => extractJsonArray('no json here')).toThrow()
  })
  it('throws when the JSON is not an array', () => {
    expect(() => extractJsonArray('{"a":1}')).toThrow()
  })
})

describe('validateReleases', () => {
  const scrapedAt = '2026-05-27T23:00:00Z'

  it('normalizes a well-formed row to the canonical schema', () => {
    const { releases, rejected } = validateReleases([{
      release_date: '2026-05-27', day_of_week: 'Wednesday', country: 'US',
      event: 'Core CPI', expected: '0.2% MoM', actual: '0.5% MoM', previous: '0.3% MoM',
      importance: 3,
    }], scrapedAt)

    expect(rejected).toBe(0)
    expect(releases).toHaveLength(1)
    expect(releases[0]).toEqual({
      release_date: '2026-05-27', day_of_week: 'Wednesday', country: 'United States',
      event: 'Core CPI', reference_period: null, expected: '0.2% MoM', actual: '0.5% MoM', previous: '0.3% MoM',
      importance: 3, scraped_at: scrapedAt,
    })
  })

  it('drops off-watchlist countries and malformed rows', () => {
    const { releases, rejected } = validateReleases([
      { release_date: '2026-05-27', country: 'Brazil', event: 'CPI', importance: 2 },     // off-watchlist
      { release_date: 'not-a-date', country: 'US', event: 'CPI', importance: 2 },          // bad date
      { release_date: '2026-05-27', country: 'US', event: '', importance: 2 },             // empty event
      { release_date: '2026-05-27', country: 'Japan', event: 'GDP', importance: 1 },       // valid
    ], scrapedAt)

    expect(releases).toHaveLength(1)
    expect(releases[0].country).toBe('Japan')
    expect(rejected).toBe(3)
  })

  it('clamps importance to 1–3 and defaults to 2 when missing', () => {
    const { releases } = validateReleases([
      { release_date: '2026-05-27', country: 'UK', event: 'A', importance: 9 },
      { release_date: '2026-05-27', country: 'UK', event: 'B' },
      { release_date: '2026-05-27', country: 'UK', event: 'C', importance: 0 },
    ], scrapedAt)
    expect(releases.map(r => r.importance)).toEqual([3, 2, 1])
  })

  it('derives day_of_week from the date when not provided', () => {
    const { releases } = validateReleases(
      [{ release_date: '2026-01-01', country: 'US', event: 'CPI', importance: 2 }],
      scrapedAt,
    )
    expect(releases[0].day_of_week).toBe('Thursday')   // 2026-01-01 is a Thursday
  })

  it('coerces blank/placeholder values to null', () => {
    const { releases } = validateReleases([{
      release_date: '2026-05-27', country: 'US', event: 'CPI',
      expected: '-', actual: '', previous: 'N/A', importance: 2,
    }], scrapedAt)
    expect(releases[0].expected).toBeNull()
    expect(releases[0].actual).toBeNull()
    expect(releases[0].previous).toBeNull()
  })
})

describe('parseReleasesFromMarkdown (Claude mocked)', () => {
  const SAMPLE_MARKDOWN = `
| Date | Country | Event | Actual | Forecast | Previous |
| Wed May 27 | US | Core CPI MoM | 0.5% | 0.2% | 0.3% |
| Wed May 27 | UK | GDP Growth Rate | | 0.4% | 0.7% |
`

  // Stub generator: returns canned model output (fenced) for any prompt.
  const fakeGenerate = (json: unknown) => async () => '```json\n' + JSON.stringify(json) + '\n```'

  it('returns validated releases matching the schema', async () => {
    const generate = fakeGenerate([
      { release_date: '2026-05-27', day_of_week: 'Wednesday', country: 'US', event: 'Core CPI MoM', actual: '0.5%', expected: '0.2%', previous: '0.3%', importance: 3 },
      { release_date: '2026-05-27', day_of_week: 'Wednesday', country: 'UK', event: 'GDP Growth Rate', actual: null, expected: '0.4%', previous: '0.7%', importance: 2 },
    ])

    const releases = await parseReleasesFromMarkdown(SAMPLE_MARKDOWN, { generate, scrapedAt: '2026-05-27T23:00:00Z' })

    expect(releases).toHaveLength(2)
    expect(releases[0].country).toBe('United States')
    expect(releases[1].country).toBe('United Kingdom')
    expect(releases[1].actual).toBeNull()
    for (const r of releases) {
      expect(r).toHaveProperty('release_date')
      expect(r).toHaveProperty('event')
      expect(r.scraped_at).toBe('2026-05-27T23:00:00Z')
      expect(r.importance).toBeGreaterThanOrEqual(1)
      expect(r.importance).toBeLessThanOrEqual(3)
    }
  })

  it('throws when the model returns zero valid releases', async () => {
    const generate = fakeGenerate([{ release_date: '2026-05-27', country: 'Brazil', event: 'X', importance: 2 }])
    await expect(parseReleasesFromMarkdown(SAMPLE_MARKDOWN, { generate })).rejects.toThrow()
  })
})
