import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { classifyRelease } from './classifySurprise'
import type { EconomicRelease, SurpriseRule } from './types'

const ABSOLUTE_RULE: SurpriseRule = {
  in_line_threshold: 0.5, warm_threshold: 1.5, hot_threshold: 3, direction: 1, unit: 'absolute',
}

const chicagoPmi: EconomicRelease = {
  release_date: '2026-05-29', day_of_week: 'Friday', country: 'United States',
  event: 'Chicago PMI', reference_period: null, expected: '50', actual: '55', previous: '49',
  importance: 2, scraped_at: '2026-05-29T23:00:00Z',
}

describe('classifyRelease — injected rule lookup', () => {
  it('is unclassified when the lookup returns no rule', () => {
    expect(classifyRelease(chicagoPmi, () => null)).toBe('unclassified')
  })
  it('classifies using a lookup-supplied rule', () => {
    expect(classifyRelease(chicagoPmi, () => ABSOLUTE_RULE)).toBe('hot') // 55−50 = 5 ≥ 3
  })
})

describe('buildRuleLookup — merges TS seeds with DB rules', () => {
  let tmpPath: string
  let buildRuleLookup: typeof import('./ruleLookup').buildRuleLookup
  let upsertSurpriseRule: typeof import('../db').upsertSurpriseRule

  beforeAll(async () => {
    tmpPath = path.join(os.tmpdir(), `econ-rules-test-${process.pid}-${Date.now()}.db`)
    process.env.DB_PATH = tmpPath
    ;({ upsertSurpriseRule } = await import('../db'))
    ;({ buildRuleLookup } = await import('./ruleLookup'))
  })

  afterAll(() => {
    for (const f of [tmpPath, `${tmpPath}-wal`, `${tmpPath}-shm`]) {
      try { fs.rmSync(f, { force: true }) } catch { /* ignore */ }
    }
  })

  it('resolves a seeded event (case/punctuation-insensitive)', () => {
    const lookup = buildRuleLookup()
    expect(lookup('core cpi')).not.toBeNull()
    expect(lookup('Unknown Event XYZ')).toBeNull()
  })

  it('resolves a DB-added rule that the seeds do not cover', () => {
    upsertSurpriseRule('Chicago PMI', ABSOLUTE_RULE)
    const lookup = buildRuleLookup()
    expect(lookup('Chicago PMI')).toEqual(ABSOLUTE_RULE)
    // and the classifier now labels it via the merged lookup
    expect(classifyRelease(chicagoPmi, lookup)).toBe('hot')
  })

  it('lets a DB rule override a seed rule on key collision', () => {
    const overridden: SurpriseRule = { in_line_threshold: 9, warm_threshold: 9, hot_threshold: 9, direction: 1, unit: 'percent' }
    upsertSurpriseRule('Core CPI', overridden)
    expect(buildRuleLookup()('Core CPI')).toEqual(overridden)
  })
})
