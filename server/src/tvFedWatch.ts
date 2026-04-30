import { db } from './db'
import { getMarket, type StirMarket } from './stirRegistry'
import { CB_MEETINGS } from './cbMeetings'

// ── Types ────────────────────────────────────────────────────────────────────

export interface FedWatchMeeting {
  meetingDate: string
  meetingMonth: string
  monthContract: string
  impliedAvgRate: number
  effrStart: number
  effrEnd: number
  expectedChange: number
  daysBeforeMeeting: number
  daysAfterMeeting: number
  probabilities: Record<string, number>
  calcSource: string
}

export interface FedWatchCumulativeRow {
  meetingDate: string
  meetingLabel: string
  targetRanges: Record<string, number>
}

export interface TvFedWatchResponse {
  asOfDate: string
  currentEFFR: number
  currentTargetRange: string
  meetings: FedWatchMeeting[]
  cumulativeProbabilities: FedWatchCumulativeRow[]
  rangeColumns: string[]
}

// ── Constants ────────────────────────────────────────────────────────────────

const MONTH_CODES_BY_INDEX: Record<number, string> = {
  0: 'F', 1: 'G', 2: 'H', 3: 'J', 4: 'K', 5: 'M',
  6: 'N', 7: 'Q', 8: 'U', 9: 'V', 10: 'X', 11: 'Z',
}
const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const BPS_STEP = 0.0025 // 25bp in decimal
const QUARTERLY_MONTHS = new Set([2, 5, 8, 11]) // H=Mar, M=Jun, U=Sep, Z=Dec

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function parseDate(dateStr: string): { year: number; month: number; day: number } {
  const d = new Date(dateStr + 'T00:00:00Z')
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() }
}

function fmtRange(lower: number, upper: number): string {
  const lo = (lower * 100).toFixed(2)
  const hi = (upper * 100).toFixed(2)
  return `${lo}-${hi}`
}

function roundToGrid(rate: number): number {
  return Math.round(rate / BPS_STEP) * BPS_STEP
}

function tsToDate(ts: string): string {
  return new Date(parseInt(ts, 10) * 1000).toISOString().slice(0, 10)
}

function prevMonth(year: number, month: number): { year: number; month: number } {
  if (month === 0) return { year: year - 1, month: 11 }
  return { year, month: month - 1 }
}

function nextMonth(year: number, month: number): { year: number; month: number } {
  if (month === 11) return { year: year + 1, month: 0 }
  return { year, month: month + 1 }
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

// ── Data access ──────────────────────────────────────────────────────────────

function getAnchorRate(market: StirMarket): number | null {
  if (market.anchorSource.type === 'static') {
    return market.anchorSource.value / 100 // convert percent to decimal
  }
  const row = db.prepare(`
    SELECT value FROM series_observations
    WHERE series_id = ?
    ORDER BY date DESC
    LIMIT 1
  `).get(market.anchorSource.seriesId) as { value: number } | undefined
  return row ? row.value / 100 : null
}

function getContractPrice(symbol: string, asOfTs?: string): number | null {
  let row: { close: number } | undefined
  if (asOfTs) {
    row = db.prepare(`
      SELECT close FROM tv_series
      WHERE symbol = ? AND time = ?
      AND close IS NOT NULL AND close > 0
    `).get(symbol, asOfTs) as { close: number } | undefined
  } else {
    row = db.prepare(`
      SELECT close FROM tv_series
      WHERE symbol = ?
      AND close IS NOT NULL AND close > 0
      ORDER BY CAST(time AS INTEGER) DESC
      LIMIT 1
    `).get(symbol) as { close: number } | undefined
  }
  return row?.close ?? null
}

function getLatestTimestamp(prefix: string): string | null {
  const row = db.prepare(`
    SELECT MAX(CAST(time AS INTEGER)) AS latest FROM tv_series WHERE symbol LIKE ?
  `).get(`${prefix}%`) as { latest: number | null } | undefined
  return row?.latest != null ? String(row.latest) : null
}

function getTimestampForDate(prefix: string, targetDate: string): string | null {
  const endOfDay = new Date(targetDate + 'T23:59:59Z').getTime() / 1000
  const startOfDay = new Date(targetDate + 'T00:00:00Z').getTime() / 1000
  const row = db.prepare(`
    SELECT time FROM tv_series
    WHERE symbol LIKE ? AND CAST(time AS INTEGER) >= ? AND CAST(time AS INTEGER) <= ?
    LIMIT 1
  `).get(`${prefix}%`, startOfDay, endOfDay) as { time: string } | undefined
  return row?.time ?? null
}

// ── Contract symbol construction ─────────────────────────────────────────────

function buildSymbol(prefix: string, yearDigits: 1 | 2, year: number, month: number): string {
  const code = MONTH_CODES_BY_INDEX[month]
  const yearSuffix = yearDigits === 1 ? String(year % 10) : String(year).slice(-2)
  return `${prefix}${code}${yearSuffix}`
}

// For quarterly markets, find the next quarterly contract month on or after the given month
function nextQuarterlyMonth(year: number, month: number): { year: number; month: number } {
  const qMonths = [2, 5, 8, 11] // Mar, Jun, Sep, Dec
  for (const qm of qMonths) {
    if (qm >= month) return { year, month: qm }
  }
  return { year: year + 1, month: 2 } // wrap to next Mar
}

// ── Core FedWatch calculation ────────────────────────────────────────────────

export function getTvFedWatch(marketKey: string, asOfDate?: string): TvFedWatchResponse {
  const market = getMarket(marketKey)
  if (!market) {
    return emptyResponse()
  }

  const anchorRate = getAnchorRate(market)
  if (anchorRate === null) {
    return emptyResponse()
  }

  const meetings = CB_MEETINGS[market.centralBank]
  if (!meetings || meetings.length === 0) {
    return emptyResponse()
  }

  const prefix = market.tickerPrefix

  // Determine as-of timestamp
  let asOfTs: string | undefined
  let resolvedDate: string

  if (asOfDate) {
    const ts = getTimestampForDate(prefix, asOfDate)
    asOfTs = ts ?? undefined
    resolvedDate = asOfDate
  } else {
    const latestTs = getLatestTimestamp(prefix)
    if (!latestTs) {
      return {
        ...emptyResponse(),
        currentEFFR: +(anchorRate * 100).toFixed(4),
        currentTargetRange: fmtRange(roundToGrid(anchorRate), roundToGrid(anchorRate) + BPS_STEP),
      }
    }
    asOfTs = latestTs
    resolvedDate = tsToDate(latestTs)
  }

  const currentLower = roundToGrid(anchorRate)
  const currentTargetRange = fmtRange(currentLower, currentLower + BPS_STEP)

  const futureMeetings = meetings.filter(m => m > resolvedDate)

  // Helper to get implied rate for a contract
  const getImplied = (year: number, month: number): number | null => {
    const sym = buildSymbol(prefix, market.yearDigits, year, month)
    const price = getContractPrice(sym, asOfTs)
    if (price === null) return null
    return (100 - price) / 100
  }

  if (market.cadence === 'monthly') {
    return computeMonthlyFedWatch(market, futureMeetings, anchorRate, resolvedDate, getImplied)
  } else {
    return computeQuarterlyFedWatch(market, futureMeetings, anchorRate, resolvedDate, getImplied)
  }
}

// ── Monthly FedWatch (Fed Funds) ─────────────────────────────────────────────

function computeMonthlyFedWatch(
  market: StirMarket,
  futureMeetings: string[],
  anchorRate: number,
  resolvedDate: string,
  getImplied: (year: number, month: number) => number | null,
): TvFedWatchResponse {
  // Build set of months that contain a meeting
  const meetingMonthSet = new Set<string>()
  for (const m of futureMeetings) {
    const { year, month } = parseDate(m)
    meetingMonthSet.add(monthKey(year, month))
  }

  const result: FedWatchMeeting[] = []
  let prevEffrEnd = anchorRate

  for (let i = 0; i < futureMeetings.length; i++) {
    const meetingDate = futureMeetings[i]
    const { year, month, day } = parseDate(meetingDate)
    const totalDays = daysInMonth(year, month)
    const daysBeforeMeeting = day - 1
    const daysAfterMeeting = totalDays - daysBeforeMeeting

    const impliedAvgRate = getImplied(year, month)
    if (impliedAvgRate === null) continue

    const contractSymbol = buildSymbol(market.tickerPrefix, market.yearDigits, year, month)

    // Determine effrStart
    let effrStart: number
    if (i === 0) {
      effrStart = anchorRate
    } else {
      const pm = prevMonth(year, month)
      if (!meetingMonthSet.has(monthKey(pm.year, pm.month))) {
        const priorMonthRate = getImplied(pm.year, pm.month)
        effrStart = priorMonthRate ?? prevEffrEnd
      } else {
        effrStart = prevEffrEnd
      }
    }

    // Solve for effrEnd
    let effrEnd: number
    if (daysAfterMeeting === 0) {
      effrEnd = impliedAvgRate
    } else if (daysBeforeMeeting === 0) {
      effrEnd = impliedAvgRate
    } else if (daysAfterMeeting <= 5) {
      const nm = nextMonth(year, month)
      const nextMonthRate = getImplied(nm.year, nm.month)
      if (nextMonthRate !== null && !meetingMonthSet.has(monthKey(nm.year, nm.month))) {
        effrEnd = nextMonthRate
      } else {
        effrEnd = (impliedAvgRate * totalDays - daysBeforeMeeting * effrStart) / daysAfterMeeting
      }
    } else {
      effrEnd = (impliedAvgRate * totalDays - daysBeforeMeeting * effrStart) / daysAfterMeeting
    }

    const expectedChange = effrEnd - effrStart
    const probabilities = computeProbabilities(effrStart, effrEnd)

    result.push({
      meetingDate,
      meetingMonth: `${MONTH_NAMES[month]} ${year}`,
      monthContract: contractSymbol,
      impliedAvgRate: +(impliedAvgRate * 100).toFixed(4),
      effrStart: +(effrStart * 100).toFixed(4),
      effrEnd: +(effrEnd * 100).toFixed(4),
      expectedChange: +(expectedChange * 10000).toFixed(1),
      daysBeforeMeeting,
      daysAfterMeeting,
      probabilities,
      calcSource: 'tv_series',
    })

    prevEffrEnd = effrEnd
  }

  const { cumulativeProbabilities, rangeColumns } = computeCumulativeProbabilities(result, anchorRate)

  return {
    asOfDate: resolvedDate,
    currentEFFR: +(anchorRate * 100).toFixed(4),
    currentTargetRange: fmtRange(roundToGrid(anchorRate), roundToGrid(anchorRate) + BPS_STEP),
    meetings: result,
    cumulativeProbabilities,
    rangeColumns,
  }
}

// ── Quarterly FedWatch ───────────────────────────────────────────────────────
// Simplified model: each meeting maps to the next quarterly contract on or after
// the meeting month. The contract's implied rate is treated as the average rate
// over the quarter. For meetings within the quarter, we apply the same partial-
// period blending formula, treating the quarter (3 months ≈ 90 days) as the
// averaging window. This is an approximation that avoids the full multi-meeting
// quarterly blending complexity.

function computeQuarterlyFedWatch(
  market: StirMarket,
  futureMeetings: string[],
  anchorRate: number,
  resolvedDate: string,
  getImplied: (year: number, month: number) => number | null,
): TvFedWatchResponse {
  // Simplified quarterly model: for each meeting, map to the next quarterly
  // contract on or after the meeting month. Use the contract's implied rate
  // as the post-meeting rate estimate. This avoids the multi-meeting-per-quarter
  // blending complexity while producing smooth, reasonable output. The contract's
  // implied rate is a weighted average of pre- and post-meeting rates, so it
  // slightly understates the actual post-meeting level, but the error is small
  // when the rate change is moderate.
  const result: FedWatchMeeting[] = []
  let prevEffrEnd = anchorRate

  for (let i = 0; i < futureMeetings.length; i++) {
    const meetingDate = futureMeetings[i]
    const { year, month, day } = parseDate(meetingDate)

    // Find the quarterly contract covering this meeting
    const qm = nextQuarterlyMonth(year, month)
    const impliedRate = getImplied(qm.year, qm.month)
    if (impliedRate === null) continue

    const contractSymbol = buildSymbol(market.tickerPrefix, market.yearDigits, qm.year, qm.month)

    // effrStart: for first meeting in a new quarter, use prior quarter's contract
    // as a clean anchor; otherwise chain from prior meeting.
    let effrStart: number
    if (i === 0) {
      effrStart = anchorRate
    } else {
      const prevMtg = parseDate(futureMeetings[i - 1])
      const prevMtgQ = nextQuarterlyMonth(prevMtg.year, prevMtg.month)
      if (monthKey(prevMtgQ.year, prevMtgQ.month) !== monthKey(qm.year, qm.month)) {
        // New quarter — use prior quarter's contract rate as anchor
        const prevQm = prevQuarterlyMonth(qm.year, qm.month)
        const prevQRate = getImplied(prevQm.year, prevQm.month)
        effrStart = prevQRate ?? prevEffrEnd
      } else {
        effrStart = prevEffrEnd
      }
    }

    // Use contract implied rate directly as the post-meeting rate estimate
    const effrEnd = impliedRate
    const totalDays = daysInMonth(year, month)
    const daysBeforeMeeting = day - 1
    const daysAfterMeeting = totalDays - daysBeforeMeeting

    const expectedChange = effrEnd - effrStart
    const probabilities = computeProbabilities(effrStart, effrEnd)

    result.push({
      meetingDate,
      meetingMonth: `${MONTH_NAMES[month]} ${year}`,
      monthContract: contractSymbol,
      impliedAvgRate: +(impliedRate * 100).toFixed(4),
      effrStart: +(effrStart * 100).toFixed(4),
      effrEnd: +(effrEnd * 100).toFixed(4),
      expectedChange: +(expectedChange * 10000).toFixed(1),
      daysBeforeMeeting,
      daysAfterMeeting,
      probabilities,
      calcSource: 'tv_series',
    })

    prevEffrEnd = effrEnd
  }

  const { cumulativeProbabilities, rangeColumns } = computeCumulativeProbabilities(result, anchorRate)

  return {
    asOfDate: resolvedDate,
    currentEFFR: +(anchorRate * 100).toFixed(4),
    currentTargetRange: fmtRange(roundToGrid(anchorRate), roundToGrid(anchorRate) + BPS_STEP),
    meetings: result,
    cumulativeProbabilities,
    rangeColumns,
  }
}

function prevQuarterlyMonth(year: number, month: number): { year: number; month: number } {
  const qMonths = [2, 5, 8, 11]
  for (let i = qMonths.length - 1; i >= 0; i--) {
    if (qMonths[i] < month) return { year, month: qMonths[i] }
  }
  return { year: year - 1, month: 11 }
}

// ── Probability computation ──────────────────────────────────────────────────

function computeProbabilities(effrStart: number, effrEnd: number): Record<string, number> {
  const startGrid = roundToGrid(effrStart)
  const probs: Record<string, number> = {}

  const maxSteps = 3
  const candidates: number[] = []
  for (let i = -maxSteps; i <= maxSteps; i++) {
    const rate = startGrid + i * BPS_STEP
    if (rate >= 0) candidates.push(rate)
  }

  if (candidates.length === 0) return probs

  let lowerIdx = 0
  for (let i = 0; i < candidates.length - 1; i++) {
    if (effrEnd >= candidates[i]) lowerIdx = i
  }

  const lower = candidates[lowerIdx]
  const upper = candidates[Math.min(lowerIdx + 1, candidates.length - 1)]

  if (Math.abs(upper - lower) < 1e-8) {
    const rangeKey = fmtRange(lower, lower + BPS_STEP)
    probs[rangeKey] = 1.0
  } else {
    const pUpper = (effrEnd - lower) / (upper - lower)
    const pLower = 1 - pUpper

    const clampedLower = Math.max(0, Math.min(1, pLower))
    const clampedUpper = Math.max(0, Math.min(1, pUpper))

    const lowerRange = fmtRange(lower, lower + BPS_STEP)
    const upperRange = fmtRange(upper, upper + BPS_STEP)

    if (clampedLower > 0.001) probs[lowerRange] = +clampedLower.toFixed(4)
    if (clampedUpper > 0.001) probs[upperRange] = +clampedUpper.toFixed(4)
  }

  return probs
}

function computeCumulativeProbabilities(
  meetings: FedWatchMeeting[],
  anchorRate: number,
): { cumulativeProbabilities: FedWatchCumulativeRow[]; rangeColumns: string[] } {
  if (meetings.length === 0) return { cumulativeProbabilities: [], rangeColumns: [] }

  const allRanges = new Set<string>()
  const startGrid = roundToGrid(anchorRate)

  type Distribution = Map<string, number>
  let currentDist: Distribution = new Map()
  const currentRange = fmtRange(startGrid, startGrid + BPS_STEP)
  currentDist.set(currentRange, 1.0)

  const cumulativeProbabilities: FedWatchCumulativeRow[] = []

  for (const meeting of meetings) {
    const newDist: Distribution = new Map()

    for (const [_priorRange, priorProb] of currentDist) {
      for (const [outcomeRange, outcomeProb] of Object.entries(meeting.probabilities)) {
        const combined = priorProb * outcomeProb
        if (combined > 0.0001) {
          newDist.set(outcomeRange, (newDist.get(outcomeRange) ?? 0) + combined)
        }
      }
    }

    const total = Array.from(newDist.values()).reduce((s, v) => s + v, 0)
    if (total > 0) {
      for (const [k, v] of newDist) {
        newDist.set(k, v / total)
        allRanges.add(k)
      }
    }

    const { month, year } = parseDate(meeting.meetingDate)

    const targetRanges: Record<string, number> = {}
    for (const [range, prob] of newDist) {
      targetRanges[range] = +prob.toFixed(4)
    }

    cumulativeProbabilities.push({
      meetingDate: meeting.meetingDate,
      meetingLabel: `${MONTH_NAMES[month]} ${year}`,
      targetRanges,
    })

    currentDist = newDist
  }

  const rangeColumns = Array.from(allRanges).sort((a, b) => {
    const aLo = parseFloat(a.split('-')[0])
    const bLo = parseFloat(b.split('-')[0])
    return aLo - bLo
  })

  return { cumulativeProbabilities, rangeColumns }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function emptyResponse(): TvFedWatchResponse {
  return {
    asOfDate: '',
    currentEFFR: 0,
    currentTargetRange: '',
    meetings: [],
    cumulativeProbabilities: [],
    rangeColumns: [],
  }
}
