import { db } from './db'
import { getMarket, type StirMarket } from './stirRegistry'
import { CB_MEETINGS } from './cbMeetings'
import {
  BPS_STEP,
  bucketRangeLabel,
  computeStepProbabilities,
  expandTree,
  stepProbabilitiesAsDeltas,
  type MeetingDeltaSet,
} from './lib/fedwatch'
import {
  decomposeAcrossContracts,
  decomposeContract,
  referenceQuarter,
  thirdWednesday,
  type ContractObservation,
} from './lib/sr3Settlement'

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
  // The proxy rate the tree operates on (EFFR for FF, SOFR for SR3, ESTR for
  // EUR, etc.). Shown in the "CURRENT {RATE}" banner at the top of the page.
  currentEFFR: number
  // The current policy lower bound (or proxy snapped to grid for markets that
  // don't translate). Used by the Summary table's Overnight Cash row when the
  // Summary table is in policy units (shift-tree alignment).
  currentPolicyRate: number
  currentTargetRange: string
  meetings: FedWatchMeeting[]
  cumulativeProbabilities: FedWatchCumulativeRow[]
  rangeColumns: string[]
  // Proxy-to-policy spread (in decimal) used to render policy-range labels.
  // For US FF currently 0 (EFFR is the proxy; bucket labels read directly).
  // For SR3 computed live as policy_lower − SOFR (typically negative).
  // For non-USD STIRs this is the (policy - proxy) offset — see stirRegistry.
  proxyToPolicySpread: number
  // Source label for the spread, e.g. "DFR - ESTR (live)" or "static fallback".
  // Surfaced in the UI subtitle so the user can monitor for regime shifts.
  proxyToPolicySpreadSource: string
}

// ── Constants ────────────────────────────────────────────────────────────────

const MONTH_CODES_BY_INDEX: Record<number, string> = {
  0: 'F', 1: 'G', 2: 'H', 3: 'J', 4: 'K', 5: 'M',
  6: 'N', 7: 'Q', 8: 'U', 9: 'V', 10: 'X', 11: 'Z',
}
const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
// BPS_STEP imported from ./lib/fedwatch
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

// Floor (not round) to identify the 25-bp bucket CONTAINING the rate. This
// matches the CME methodology: a 3.63% EFFR sits inside the [3.50, 3.75]
// Fed target band, not [3.75, 4.00]. Used for the "current target range"
// banner and for the start bucket of the cumulative probability tree.
function floorToGrid(rate: number): number {
  return Math.floor(rate / BPS_STEP) * BPS_STEP
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

// ── Core FedWatch calculation ────────────────────────────────────────────────

export function getTvFedWatch(marketKey: string, asOfDate?: string): TvFedWatchResponse {
  const market = getMarket(marketKey)
  if (!market) {
    return emptyResponse()
  }

  const rawAnchor = getAnchorRate(market)
  if (rawAnchor === null) {
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
        currentEFFR: +(rawAnchor * 100).toFixed(4),
        currentPolicyRate: +(rawAnchor * 100).toFixed(4),
        currentTargetRange: fmtRange(floorToGrid(rawAnchor), floorToGrid(rawAnchor) + BPS_STEP),
      }
    }
    asOfTs = latestTs
    resolvedDate = tsToDate(latestTs)
  }

  // Resolve the proxy-to-policy spread (internal sign: policy − proxy).
  const { spread, spreadSource } = resolveSpread(market)

  // SR3 (shift-tree) needs a policy-anchored tree, not a SOFR-anchored one.
  // SOFR can sit anywhere within the policy range on any given day; today
  // it's exactly at the lower bound (3.50%), which would skew the tree.
  // Use floor(EFFR, 25bp) as the policy lower bound directly, and translate
  // each SR3-implied SOFR into policy by adding the (negative) spread.
  const useShiftTree = market.policyAlignment === 'shift-tree'
  // anchorRate is what the tree starts from and what the Overnight Cash row
  // of the Summary table reports. For shift-tree we want policy units, so
  // override with floor(EFFR, 25bp) — the policy lower bound. For shift-label
  // we keep the proxy (rawAnchor).
  let anchorRate = rawAnchor
  if (useShiftTree) {
    const dffRow = db.prepare(`
      SELECT value FROM series_observations
      WHERE series_id = 'DFF' ORDER BY date DESC LIMIT 1
    `).get() as { value: number } | undefined
    if (dffRow) {
      anchorRate = Math.floor(dffRow.value / 100 / BPS_STEP) * BPS_STEP
    }
  }
  // Hold onto the proxy anchor for the "CURRENT {RATE}" banner. For shift-tree
  // (SR3), the banner should display the live SOFR rate, not the policy bucket.
  const proxyAnchor = rawAnchor

  const currentLower = useShiftTree
    ? floorToGrid(anchorRate)
    : floorToGrid(anchorRate + spread)
  const currentTargetRange = fmtRange(currentLower, currentLower + BPS_STEP)

  const futureMeetings = meetings.filter(m => m > resolvedDate)

  // Helper to get implied rate for a contract. For shift-tree, translate the
  // proxy-implied rate into policy units by adding the spread (= policy − proxy,
  // negative for SOFR). The downstream `compute*` paths then operate entirely
  // in policy units and don't need a separate shift step.
  const getImplied = (year: number, month: number): number | null => {
    const sym = buildSymbol(prefix, market.yearDigits, year, month)
    const price = getContractPrice(sym, asOfTs)
    if (price === null) return null
    const proxy = (100 - price) / 100
    return useShiftTree ? proxy + spread : proxy
  }

  if (market.cadence === 'monthly') {
    return computeMonthlyFedWatch(market, futureMeetings, anchorRate, proxyAnchor, resolvedDate, getImplied, spread, spreadSource, currentTargetRange)
  } else {
    return computeQuarterlyFedWatch(market, futureMeetings, anchorRate, proxyAnchor, resolvedDate, getImplied, spread, spreadSource, currentTargetRange)
  }
}

function resolveSpread(market: StirMarket): { spread: number; spreadSource: string } {
  // spreadSource is consumed by the client as a subtitle below the
  // probability-matrix header. Keep it compact: a short summary, optionally
  // with " · as of {date}" appended. When the spread is zero the client
  // omits the entire spread sentence and shows only an as-of label.
  const src = market.proxyToPolicySpreadSource
  if (src.type === 'zero') {
    return { spread: 0, spreadSource: '' }
  }
  if (src.type === 'static') {
    return {
      spread: src.bps / 10000,
      spreadSource: `Spread: ${src.bps >= 0 ? '+' : ''}${src.bps} bp (policy − proxy, static)`,
    }
  }
  // src.type === 'live-sofr-policy': spread = policy_lower − typical SOFR.
  // Internal convention is policy − proxy (negative when SOFR > policy_lower).
  //
  // We use the **median** of the last 20 trading days of (SOFR − policy_lower)
  // rather than today's spot. Reason: SOFR can sit unusually low on any given
  // day (today's print of 3.50% is exactly at the policy lower bound, an
  // outlier vs the typical 10-15 bp gap). The futures market prices the
  // *expected* forward SOFR spread, not today's spot — so we need a smoothed
  // estimate. Median is robust to quarter-end / month-end spikes.
  const sofrRows = db.prepare(`
    SELECT value, date FROM series_observations
    WHERE series_id = 'SOFR'
    ORDER BY date DESC LIMIT 20
  `).all() as { value: number; date: string }[]
  const dffRow = db.prepare(`
    SELECT value, date FROM series_observations
    WHERE series_id = 'DFF' ORDER BY date DESC LIMIT 1
  `).get() as { value: number; date: string } | undefined
  if (sofrRows.length === 0 || !dffRow) {
    return { spread: 0, spreadSource: '' }
  }
  const policyLower = Math.floor(dffRow.value / 100 / BPS_STEP) * BPS_STEP
  const spotSofr = sofrRows[0].value / 100
  const spotDiff = spotSofr - policyLower

  // Median diff over the window.
  const diffs = sofrRows.map(r => r.value / 100 - policyLower).sort((a, b) => a - b)
  const medianDiff = diffs.length % 2
    ? diffs[(diffs.length - 1) / 2]
    : (diffs[diffs.length / 2 - 1] + diffs[diffs.length / 2]) / 2

  // Internal sign: policy − proxy. Median diff is (proxy − policy), so negate.
  const spread = -medianDiff
  const medianDiffBp = medianDiff * 10000
  const spotDiffBp = spotDiff * 10000
  return {
    spread,
    spreadSource: `Spread: +${medianDiffBp.toFixed(1)} bp · 20d median of SOFR − policy (spot ${spotDiffBp >= 0 ? '+' : ''}${spotDiffBp.toFixed(1)} bp) · multi-meeting decomposition: cross-contract day-weighted LSQ · as of ${sofrRows[0].date}`,
  }
}

// ── Monthly FedWatch (Fed Funds) ─────────────────────────────────────────────

function computeMonthlyFedWatch(
  market: StirMarket,
  futureMeetings: string[],
  anchorRate: number,
  proxyAnchor: number,
  resolvedDate: string,
  getImplied: (year: number, month: number) => number | null,
  proxyToPolicySpread: number,
  proxyToPolicySpreadSource: string,
  currentTargetRange: string,
): TvFedWatchResponse {
  const alignment = market.policyAlignment
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
    const probabilities = computeProbabilities(effrStart, effrEnd, proxyToPolicySpread, alignment)

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

  const { cumulativeProbabilities, rangeColumns } = computeCumulativeProbabilities(
    result, anchorRate, proxyToPolicySpread, alignment,
  )

  return {
    asOfDate: resolvedDate,
    currentEFFR: +(proxyAnchor * 100).toFixed(4),
    currentPolicyRate: +(anchorRate * 100).toFixed(4),
    currentTargetRange,
    meetings: result,
    cumulativeProbabilities,
    rangeColumns,
    proxyToPolicySpread,
    proxyToPolicySpreadSource,
  }
}

// ── Quarterly FedWatch (proper SR3 reference-quarter + multi-meeting) ────────
//
// New (correct) model:
//   1. For each upcoming SR3 contract that hosts any future FOMC meeting,
//      compute its Reference Quarter: [3rdWed(deliveryMonth − 3) inclusive,
//      3rdWed(deliveryMonth) exclusive]. (CME spec — see lib/sr3Settlement.ts.)
//   2. Walk contracts chronologically. For each, identify the FOMC meetings
//      inside its ref quarter (0, 1, or 2+ meetings).
//   3. Decompose: given the contract's observed compounded R and the
//      pre-meeting-1 carry-forward rate, solve for the per-meeting outcomes
//      using equal-split (each meeting moves the rate by the same Δ).
//      [Strategy C-2; we can't use SR1-anchored C-1 because SR1 contracts for
//      the forward horizon aren't ingested.]
//   4. Each meeting then has a (preRate, postRate) pair in proxy units; apply
//      the SOFR-to-policy translation upstream-style by adding `spread` (=
//      policy − proxy, internal sign) when alignment is shift-tree.
//
// The previous implementation mapped meetings to the wrong contract (the
// delivery month containing the meeting, not the contract whose ref quarter
// contains the meeting) and treated the contract's implied rate as the
// post-meeting rate directly, ignoring the within-quarter pre-meeting period.
// That created a ~1-bucket bias at the front of the curve.

function computeQuarterlyFedWatch(
  market: StirMarket,
  futureMeetings: string[],
  anchorRate: number,
  proxyAnchor: number,
  resolvedDate: string,
  getImplied: (year: number, month: number) => number | null,
  proxyToPolicySpread: number,
  proxyToPolicySpreadSource: string,
  currentTargetRange: string,
): TvFedWatchResponse {
  const alignment = market.policyAlignment
  const result: FedWatchMeeting[] = []

  // Find the SR3 contract whose ref quarter contains `meetingDateUtc`. The
  // contract delivery month is the FIRST quarterly month (H/M/U/Z) in
  // chronological order whose 3rd Wednesday is strictly after the meeting
  // date — i.e., the contract whose ref quarter ENDS after the meeting (and
  // therefore the only one whose ref quarter can contain that meeting).
  const containingContract = (meetingDateUtc: Date): { year: number; month: number } => {
    const year = meetingDateUtc.getUTCFullYear()
    const month = meetingDateUtc.getUTCMonth()
    // Generate the next 8 quarterly delivery months from `year-month` forward.
    const quarterlyMonths = [2, 5, 8, 11]
    const candidates: Array<{ y: number; m: number }> = []
    for (let yr = year; yr <= year + 2; yr++) {
      for (const qm of quarterlyMonths) {
        if (yr === year && qm < month) continue
        candidates.push({ y: yr, m: qm })
      }
    }
    candidates.sort((a, b) => (a.y - b.y) || (a.m - b.m))
    for (const c of candidates) {
      const refQuarterEnd = thirdWednesday(c.y, c.m)
      if (refQuarterEnd.getTime() > meetingDateUtc.getTime()) {
        return { year: c.y, month: c.m }
      }
    }
    return { year: year + 1, month: 2 }
  }

  // Group meetings by containing contract (year, month index).
  const futureMeetingDates = futureMeetings.map((s) => ({
    iso: s,
    date: new Date(s + 'T00:00:00Z'),
  }))

  type ContractKey = string
  const key = (y: number, m: number) => `${y}-${m}`
  const meetingsByContract = new Map<ContractKey, { y: number; m: number; meetings: typeof futureMeetingDates }>()
  for (const md of futureMeetingDates) {
    const c = containingContract(md.date)
    const k = key(c.year, c.month)
    let entry = meetingsByContract.get(k)
    if (!entry) {
      entry = { y: c.year, m: c.month, meetings: [] }
      meetingsByContract.set(k, entry)
    }
    entry.meetings.push(md)
  }

  // Walk contracts in chronological order.
  const sortedContracts = Array.from(meetingsByContract.values()).sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y
    return a.m - b.m
  })

  const useShiftTree = alignment === 'shift-tree'

  // ── SR3 path: cross-contract day-weighted least-squares ────────────────
  // Each meeting's Δ_m appears in every subsequent contract's compounded R
  // weighted by (RQ_end_c − m) / D_c. Solve the whole system jointly so the
  // per-meeting Δs reflect real day-weights instead of equal splits within
  // a single contract. Non-USD (shift-label) markets fall through to the
  // per-contract equal-split path below — they use simpler STIR conventions
  // and the multi-meeting-per-quarter issue is less acute there.
  if (useShiftTree) {
    const observations: ContractObservation[] = []
    const meetingsAll: Date[] = []
    const meetingsAllIso: string[] = []
    for (const md of futureMeetingDates) {
      meetingsAll.push(md.date)
      meetingsAllIso.push(md.iso)
    }

    // Build the full set of SR3 contracts that overlap the visible window:
    // every quarterly delivery month whose RQ_end > today, up to the contract
    // whose RQ_end exceeds the last meeting in our list. Including contracts
    // with zero meetings in their RQ (e.g. the front contract whose RQ ends
    // just before the first future meeting) constrains r_0 directly and
    // stabilises the LSQ.
    const resolvedDateObj = new Date(resolvedDate + 'T00:00:00Z')
    const lastMeetingTime = meetingsAll.length > 0
      ? meetingsAll[meetingsAll.length - 1].getTime()
      : resolvedDateObj.getTime() + 365 * 86_400_000
    const quarterlyMonths = [2, 5, 8, 11]
    const allCandidates: Array<{ y: number; m: number }> = []
    const startYear = resolvedDateObj.getUTCFullYear()
    for (let yr = startYear; yr <= startYear + 3; yr++) {
      for (const qm of quarterlyMonths) {
        allCandidates.push({ y: yr, m: qm })
      }
    }
    const includedContracts: Array<{ y: number; m: number; rqStart: Date; rqEnd: Date }> = []
    for (const c of allCandidates) {
      const rq = referenceQuarter(c.y, c.m)
      if (rq.endExclusive.getTime() <= resolvedDateObj.getTime()) continue
      if (rq.start.getTime() > lastMeetingTime + 30 * 86_400_000) break
      includedContracts.push({ y: c.y, m: c.m, rqStart: rq.start, rqEnd: rq.endExclusive })
    }

    for (const c of includedContracts) {
      const impliedDecimal = getImplied(c.y, c.m)
      if (impliedDecimal === null) continue
      // getImplied for shift-tree returns policy-translated; strip the spread
      // back out to get the raw SR3-implied SOFR (proxy units) for the LSQ.
      const rObservedProxy = (impliedDecimal - proxyToPolicySpread) * 100
      observations.push({
        rqStart: c.rqStart,
        rqEnd: c.rqEnd,
        observedR: rObservedProxy,
      })
    }

    const lsq = decomposeAcrossContracts({
      contracts: observations,
      meetings: meetingsAll,
      lambda: 0.01, // small Tikhonov; stabilises back of curve without distorting front
    })

    // Walk meetings in order: preRate = previous postRate (or LSQ r_0 for the
    // first), postRate = LSQ output. Convert to decimal for the rest of the
    // pipeline.
    for (let i = 0; i < meetingsAllIso.length; i++) {
      const iso = meetingsAllIso[i]
      const date = futureMeetingDates[i].date
      const postRateProxy = lsq.postRates[i] / 100
      const preRateProxy = i === 0 ? lsq.r0 / 100 : lsq.postRates[i - 1] / 100

      const effrStart = preRateProxy + proxyToPolicySpread
      const effrEnd = postRateProxy + proxyToPolicySpread
      const expectedChange = effrEnd - effrStart
      const probabilities = computeProbabilities(effrStart, effrEnd, proxyToPolicySpread, alignment)

      const { month: mIdx, year: mYr } = parseDate(iso)
      const daysBeforeMeeting = date.getUTCDate() - 1
      const daysAfterMeeting = daysInMonth(mYr, mIdx) - daysBeforeMeeting

      // Attribute the meeting to its containing contract symbol for display.
      const containing = containingContract(date)
      const sym = buildSymbol(market.tickerPrefix, market.yearDigits, containing.year, containing.month)

      result.push({
        meetingDate: iso,
        meetingMonth: `${MONTH_NAMES[mIdx]} ${mYr}`,
        monthContract: sym,
        impliedAvgRate: +(postRateProxy * 100).toFixed(4),
        effrStart: +(effrStart * 100).toFixed(4),
        effrEnd: +(effrEnd * 100).toFixed(4),
        expectedChange: +(expectedChange * 10000).toFixed(1),
        daysBeforeMeeting,
        daysAfterMeeting,
        probabilities,
        calcSource: `sr3-lsq:day-weighted`,
      })
    }
  } else {
    // ── Non-USD path: per-contract equal-split (unchanged) ────────────────
    let carryRate = proxyAnchor

    for (const entry of sortedContracts) {
      const { y, m, meetings: cmeetings } = entry
      const impliedDecimal = getImplied(y, m)
      if (impliedDecimal === null) continue
      const rObservedProxy = impliedDecimal * 100 // shift-label: getImplied returns proxy

      const rq = referenceQuarter(y, m)
      const meetingDates = cmeetings.map((c) => c.date)

      const { postRates, strategy } = decomposeContract({
        rq,
        meetings: meetingDates,
        rPre: carryRate * 100,
        rObserved: rObservedProxy,
      })

      const contractSymbol = buildSymbol(market.tickerPrefix, market.yearDigits, y, m)

      let preRateProxy = carryRate
      for (let mi = 0; mi < cmeetings.length; mi++) {
        const { iso, date } = cmeetings[mi]
        const postRateProxy = postRates[mi] / 100

        const effrStart = preRateProxy
        const effrEnd = postRateProxy
        const expectedChange = effrEnd - effrStart
        const probabilities = computeProbabilities(effrStart, effrEnd, proxyToPolicySpread, alignment)

        const { month: mIdx, year: mYr } = parseDate(iso)
        const daysBeforeMeeting = date.getUTCDate() - 1
        const daysAfterMeeting = daysInMonth(mYr, mIdx) - daysBeforeMeeting

        result.push({
          meetingDate: iso,
          meetingMonth: `${MONTH_NAMES[mIdx]} ${mYr}`,
          monthContract: contractSymbol,
          impliedAvgRate: +(rObservedProxy).toFixed(4),
          effrStart: +(effrStart * 100).toFixed(4),
          effrEnd: +(effrEnd * 100).toFixed(4),
          expectedChange: +(expectedChange * 10000).toFixed(1),
          daysBeforeMeeting,
          daysAfterMeeting,
          probabilities,
          calcSource: `sr3-decompose:${strategy}`,
        })

        preRateProxy = postRateProxy
      }

      if (postRates.length > 0) {
        carryRate = postRates[postRates.length - 1] / 100
      }
    }
  }

  const { cumulativeProbabilities, rangeColumns } = computeCumulativeProbabilities(
    result, anchorRate, proxyToPolicySpread, alignment,
  )

  return {
    asOfDate: resolvedDate,
    currentEFFR: +(proxyAnchor * 100).toFixed(4),
    currentPolicyRate: +(anchorRate * 100).toFixed(4),
    currentTargetRange,
    meetings: result,
    cumulativeProbabilities,
    rangeColumns,
    proxyToPolicySpread,
    proxyToPolicySpreadSource,
  }
}

// ── Probability computation ──────────────────────────────────────────────────
//
// Single-meeting step probabilities — thin formatter around the lib's
// computeStepProbabilities, which implements the CME PDF's exact ΔR/25bp
// interpolation including the ZLB redirect.

function computeProbabilities(
  effrStart: number,
  effrEnd: number,
  proxyToPolicySpread: number,
  alignment: 'shift-label' | 'shift-tree' | undefined,
): Record<string, number> {
  // Inputs are already in display units: policy for shift-tree (translated
  // upstream in getImplied / anchorRate), proxy for shift-label.
  // shift-tree: bucket the policy rate directly; label offset = 0.
  // shift-label: bucket the proxy rate; bucketRangeLabel adds the spread to
  // approximate the policy range (preserves existing ECB/SONIA behavior).
  const labelOffset = alignment === 'shift-tree' ? 0 : proxyToPolicySpread

  const buckets = computeStepProbabilities({ effrStart, effrEnd })
  const probs: Record<string, number> = {}
  for (const { bucketCenter, prob } of buckets) {
    if (prob > 0.001) {
      const label = bucketRangeLabel(bucketCenter, labelOffset)
      probs[label] = (probs[label] ?? 0) + +prob.toFixed(4)
    }
  }
  return probs
}

// Path-aware cumulative tree expansion. Each meeting's deltas (P(-25), P(0),
// P(+25)) convolve onto the running rate distribution; ZLB redirect at the
// lower bound; renormalize for float drift. See ./lib/fedwatch.ts.

function computeCumulativeProbabilities(
  meetings: FedWatchMeeting[],
  anchorRate: number,
  proxyToPolicySpread: number,
  alignment: 'shift-label' | 'shift-tree' | undefined,
): { cumulativeProbabilities: FedWatchCumulativeRow[]; rangeColumns: string[] } {
  if (meetings.length === 0) return { cumulativeProbabilities: [], rangeColumns: [] }

  // Inputs (anchor + meeting rates) already in display units. For shift-tree
  // that means policy units; for shift-label that means proxy units (and
  // bucketRangeLabel adds the spread to approximate the policy range).
  const meetingDeltaSets: MeetingDeltaSet[] = meetings.map((m) => {
    const start = m.effrStart / 100
    const end = m.effrEnd / 100
    return {
      impliedEndRate: end,
      deltas: stepProbabilitiesAsDeltas({ effrStart: start, effrEnd: end }),
    }
  })

  const startingRate = anchorRate
  const labelOffset = alignment === 'shift-tree' ? 0 : proxyToPolicySpread

  const treeRows = expandTree({
    startingRate,
    meetings: meetingDeltaSets,
  })

  const allRanges = new Set<string>()
  const cumulativeProbabilities: FedWatchCumulativeRow[] = meetings.map((m, i) => {
    const { month, year } = parseDate(m.meetingDate)
    const targetRanges: Record<string, number> = {}
    for (const [bucketCenter, prob] of treeRows[i].bucketProbabilities) {
      if (prob < 0.0001) continue
      const label = bucketRangeLabel(bucketCenter, labelOffset)
      targetRanges[label] = (targetRanges[label] ?? 0) + +prob.toFixed(4)
      allRanges.add(label)
    }
    return {
      meetingDate: m.meetingDate,
      meetingLabel: `${MONTH_NAMES[month]} ${year}`,
      targetRanges,
    }
  })

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
    currentPolicyRate: 0,
    currentTargetRange: '',
    meetings: [],
    cumulativeProbabilities: [],
    rangeColumns: [],
    proxyToPolicySpread: 0,
    proxyToPolicySpreadSource: 'unavailable',
  }
}
