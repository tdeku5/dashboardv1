// Position Sizing calculation module — a faithful port of position_sizing.xlsx
// (sheets: Setup, Instruments, Sizing Grid). Every formula here was read out of
// the workbook; implement-as-specified, do not "improve" the math. Percentages
// are fractions (0.0025 = 0.25%), matching the sheet. All grid computation
// happens here, client-side — the API serves inputs only.
//
// Null semantics: `initial_margin` is nullable ("no fabricated data"). A null
// margin makes every margin-dependent output null (rendered `–`), and null must
// never coerce to 0 — `$0` in a margin cell reads as "requires no funding",
// the inverse of "funding requirement unknown". Grids 1 and 3 depend on
// tick_value, not margin, and are unaffected by a null margin.

/**
 * Excel ROUNDDOWN(x, 0): truncate toward zero.
 *
 * The value is normalized to 15 significant digits before truncating — the
 * same cosmetic rounding Excel applies — to reproduce the workbook under
 * binary floating point: ROUNDDOWN(0.003/0.001, 0) is 3 in the sheet even
 * though the raw double quotient is 2.9999999999999996. Without this, ladder
 * lengths and grid cells can come out one unit short of the workbook for
 * perfectly ordinary user-entered percentages. Exactly 15 digits, not fewer:
 * a genuine 4.9999999999 must stay below 5 (as it does in Excel), which a
 * stricter normalization would wrongly promote.
 */
export function roundDownToInt(x: number): number {
  if (!Number.isFinite(x)) return 0
  return Math.trunc(Number(x.toPrecision(15)))
}

// ── Setup derivations (Setup sheet) ──────────────────────────────────────────

export interface PsSettingsValues {
  principle: number
  currentPortfolioValue: number
  marketMoneyPct: number
  maxDrawdownPct: number
  unitRiskPct: number
  maxUnitsRiskPct: number
}

export interface SetupDerived {
  /** B6 = B5-B4 — can go NEGATIVE in a drawdown; intentionally not clamped. */
  additionalRiskFromMarketMoney: number
  /** B8 = B6*B7 */
  additionalRiskBudget: number
  /** B9 = B4+B8 */
  currentRiskBudget: number
  /** B11 = B9*B10 */
  maxDrawdownDollars: number
  /** B13 = B9*B12 */
  dollarBudgetPerUnit: number
  /** B15 = B9*B14 */
  maxRiskBudget: number
}

export function deriveSetup(s: PsSettingsValues): SetupDerived {
  const additionalRiskFromMarketMoney = s.currentPortfolioValue - s.principle
  const additionalRiskBudget = additionalRiskFromMarketMoney * s.marketMoneyPct
  const currentRiskBudget = s.principle + additionalRiskBudget
  return {
    additionalRiskFromMarketMoney,
    additionalRiskBudget,
    currentRiskBudget,
    maxDrawdownDollars: currentRiskBudget * s.maxDrawdownPct,
    dollarBudgetPerUnit: currentRiskBudget * s.unitRiskPct,
    maxRiskBudget: currentRiskBudget * s.maxUnitsRiskPct,
  }
}

// ── Risk unit ladder (Setup!E3:F11) ──────────────────────────────────────────

/**
 * Derived, never hardcoded: the sheet's own note says the ladder tops out at 8
 * because 2.00% / 0.25% = 8. Guard: unitRiskPct <= 0 returns 0 (the caller
 * shows a validation message instead of dividing by zero); a maxUnitsRiskPct
 * below unitRiskPct legitimately yields 0.
 */
export function deriveUnitCount(unitRiskPct: number, maxUnitsRiskPct: number): number {
  if (unitRiskPct <= 0) return 0
  const n = roundDownToInt(maxUnitsRiskPct / unitRiskPct)
  return n > 0 ? n : 0
}

/** riskBudget[u] = dollarBudgetPerUnit * u for u = 1 .. unitCount. */
export function riskBudgetLadder(dollarBudgetPerUnit: number, unitCount: number): number[] {
  const out: number[] = []
  for (let u = 1; u <= unitCount; u++) out.push(dollarBudgetPerUnit * u)
  return out
}

// ── Selected-instrument lookups ──────────────────────────────────────────────

/** Instruments!G = tick_value / tick_size_decimal. Null when unknowable. */
export function dollarPerPoint(tickValue: number | null, tickSizeDecimal: number): number | null {
  if (tickValue === null || tickSizeDecimal <= 0) return null
  return tickValue / tickSizeDecimal
}

/**
 * Instruments!H = ROUNDDOWN(capital / initial_margin). A funding ceiling, not
 * a sizing recommendation — it ignores risk entirely. Null margin (or 0, which
 * would divide by zero) → null, rendered `–`.
 */
export function maxContractsOnCapital(
  currentPortfolioValue: number,
  initialMargin: number | null,
): number | null {
  if (initialMargin === null || initialMargin <= 0) return null
  return roundDownToInt(currentPortfolioValue / initialMargin)
}

// ── Grid 1 — Contracts (Sizing Grid!D16:K23) ─────────────────────────────────

export interface ContractsGridRow {
  stopTicks: number
  /** B16 = A16*$B$6 */
  stopPrice: number
  /** C16 = A16*$B$7 — 0 when tick_value is null/0, which zeroes the row. */
  riskPerContract: number
  /** D16 = ROUNDDOWN(budget / riskPerContract); 0 when riskPerContract <= 0. */
  contracts: number[]
}

export function computeContractsGrid(
  stopLadder: number[],
  tickSizeDecimal: number,
  tickValue: number | null,
  riskBudgets: number[],
): ContractsGridRow[] {
  return stopLadder.map(stopTicks => {
    const riskPerContract = stopTicks * (tickValue ?? 0)
    return {
      stopTicks,
      stopPrice: stopTicks * tickSizeDecimal,
      riskPerContract,
      contracts: riskBudgets.map(budget =>
        riskPerContract <= 0 ? 0 : roundDownToInt(budget / riskPerContract),
      ),
    }
  })
}

// ── Grid 2 — Initial margin required (Sizing Grid!D31:K38) ───────────────────

export interface MarginGridRow {
  stopTicks: number
  stopPrice: number
  riskPerContract: number
  /** D31 = D16*$B$9. Null margin → null cells (unknown, NOT free — and NOT red). */
  marginRequired: Array<number | null>
}

export function computeMarginGrid(
  contractsGrid: ContractsGridRow[],
  initialMargin: number | null,
): MarginGridRow[] {
  return contractsGrid.map(row => ({
    stopTicks: row.stopTicks,
    stopPrice: row.stopPrice,
    riskPerContract: row.riskPerContract,
    marginRequired: row.contracts.map(c =>
      initialMargin === null ? null : c * initialMargin,
    ),
  }))
}

// ── Grid 3 — Actual $ at risk (Sizing Grid!D46:K53) ──────────────────────────

export interface ActualRiskGridRow {
  stopTicks: number
  stopPrice: number
  riskPerContract: number
  /** D46 = D16*$C46 — what a full stop-out really costs after rounding down. */
  actualRisk: number[]
}

export function computeActualRiskGrid(contractsGrid: ContractsGridRow[]): ActualRiskGridRow[] {
  return contractsGrid.map(row => ({
    stopTicks: row.stopTicks,
    stopPrice: row.stopPrice,
    riskPerContract: row.riskPerContract,
    actualRisk: row.contracts.map(c => c * row.riskPerContract),
  }))
}

// ── Grid 4 — Inverse: max stop width in ticks (Sizing Grid!D61:K70) ──────────

export interface InverseGridRow {
  contracts: number
  /** B61 = A61*$B$9. Null margin → null (unknown funding, rendered `–`). */
  marginUsed: number | null
  /** C61 = A61*$B$7 — 0 when tick_value is null/0. */
  riskPerTick: number
  /** D61 = ROUNDDOWN(budget / riskPerTick); 0 when riskPerTick <= 0. */
  maxStopTicks: number[]
}

export function computeInverseGrid(
  contractLadder: number[],
  tickValue: number | null,
  initialMargin: number | null,
  riskBudgets: number[],
): InverseGridRow[] {
  return contractLadder.map(contracts => {
    const riskPerTick = contracts * (tickValue ?? 0)
    return {
      contracts,
      marginUsed: initialMargin === null ? null : contracts * initialMargin,
      riskPerTick,
      maxStopTicks: riskBudgets.map(budget =>
        riskPerTick <= 0 ? 0 : roundDownToInt(budget / riskPerTick),
      ),
    }
  })
}
