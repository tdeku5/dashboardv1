# Phase 0 — Approved. Spec corrections + decisions. Proceed to Phase 1.

The audit is accepted. It found four defects in the spec, all on the spec side. This file **supersedes the original spec wherever the two conflict**.

First, save the original spec and this file to disk so later gates can re-read them:

- `docs/prompts/asset-class-models-design-revamp.md` (the original, verbatim from the session)
- `docs/prompts/asset-class-models-design-revamp-phase0-decisions.md` (this file)

---

## Spec corrections

1. **The prerequisite was already met.** The Hephaestus typography work was committed in `421dd67` on Jul 9. Ignore any wording that calls it open.
2. **Null and negative conventions.** The spec's `–` blank-value dash and bracketed negatives don't exist in this section. They came from a different build; drop every reference to them. The section's real conventions are:
   - **Nulls render as an em dash `—`.** Keep exactly as is, all 179 instances.
   - **Negatives use a leading minus sign.** Unify per Decision 3 below.
3. **Remove "surprise shading" and "country column dots" from the semantic catalogue.** Neither exists here. Phase 0-F's real catalogue replaces the spec's list.
4. **Drop the single "ordered series palette" requirement.** It conflicts with identity colors. Replace it with the chart section below.

---

## Decision 1 — Literal scope covers TSX and Recharts props

Count TSX inline styles and Recharts props toward the zero-literal target, not just CSS. That is where 1,531 of the 2,054 color literals live and where all chart configuration sits. A CSS-only pass would leave most of the sprawl in place.

Acceptance #9 now reads: *hardcoded color literals, font sizes, and spacing values remaining in Asset Class Models CSS **and TSX** (inline `style` props and Recharts props), counted against the Phase 0-D baseline for both columns.*

## Decision 2 — Sign colors: direction is not the same as good or bad

Unify the whole section on one rule. Colors fall into four families, each defined once in the token layer:

| Family | Use when | Tokens |
|---|---|---|
| **Valence** | Up is genuinely good: equity/FX/commodity returns, P&L | `--positive` (green), `--negative` (red) |
| **Direction** | Up is neither good nor bad: yield and rate changes, spread changes, hike/cut, calendar-spread Δ, credit widening/tightening | `--dir-up`, `--dir-down`, a neutral diverging pair (blue / orange family). **Not** green or red. |
| **Alert** | Magnitude or extremeness, regardless of sign: z-score thresholds (`\|z\|>2`, `\|z\|>3`), IV rank/percentile intensity, scarcity warnings | `--alert-mild` (amber), `--alert-strong` (red) |
| **Status** | Data-quality and stale notes | `--status-warning` (amber) |

Specific consequences, to apply consistently:

- **Hike = `--dir-up`, cut = `--dir-down`** everywhere: the summary badge, the NEXT MOVE box, GlobalRates, the ±OCR column. This replaces the three current mappings.
- **Yield/rate Δ**: up = `--dir-up`, down = `--dir-down` everywhere. That covers GlobalRates Δ, CountryCurvePage, UST/pricing Δ bars, GlobalForwardCurves, DailyChangeModal and the STIR strip `heatStyle`.
- **The `cellColor` red-blue heatmap** becomes the direction diverging scale. Remove the unused brown-teal scale.
- **Calendar-spread Δ**: the class names are currently inverted (`v>0 → .changeNegative`). Fix the mapping so the color follows the direction rule. Report this as a bug fix in the gate report.
- **Returns heatmaps** (ReturnsHeatmap, equities/FX): currently blue = up, red = down. Change to `--positive` / `--negative`. Returns are valence.
- **VolSummaryTable z-scores**: high z uses the **alert** family, not valence. This is consistent with the rule, not an exception to it.
- **Shade sprawl** (four greens and four reds used for sign) collapses into these tokens. No sign literal survives.
- **`--alert-strong` red must be visibly distinct from `--negative` red** so a breach never reads as a down move. If they can't be told apart on navy, shift one hue and report the final values.
- **Curve-regime colors** (`lib/curveRegime.ts`, 7 colors) are identity colors. They are not sign colors; treat them under the identity registry below.

Every color in all four families must pass the contrast requirement on every surface it sits on. Name the final hue choices for `--dir-up` and `--dir-down` in the gate report; I'll judge them at the pilot.

## Decision 3 — Negatives: ASCII `-` everywhere

Unify all displayed negatives to ASCII hyphen-minus, including UsRatesVol, CrossAssetVol and the heatmaps. Values copied from the terminal must paste into Excel as numbers, and U+2212 pastes as text. In a monospace face the hyphen is already digit-width, so column alignment doesn't suffer.

This is a display-formatting change only. Route data and computed values are untouched. Add a test asserting no U+2212 is emitted by the section's formatters.

## Decision 4 — Leave `NavDropdown` untouched

Do not restyle `NavDropdown` in this pass. It reaches 41 routes including Hephaestus. Style only the section's own three nav tiers.

The section will go navy while the dropdown keeps its current treatment, which may leave a visible seam in the header. That's acceptable for now. I'll decide at the pilot review whether the dropdown follows.

The same rule applies to `FredRefreshButton` (32 routes) and to `TreasuryAuctionPage` as mounted at the standalone `/treasury` route: verify them at every gate, and don't restyle them for this section's benefit.

---

## Other direction for Phase 1

**The old global secondary-text color fails contrast and must not survive.** Measured contrast:

| Color | Background | Ratio |
|---|---|---|
| `#4e6070` (old global `--text-secondary`) | `#0E1621` page background | **2.80** |
| `#4e6070` | `#1B2637` raised panel | **2.23** |
| `#4e6070` | today's `#070b10` background | **3.04** |

It already sits at 3.04 on today's background. On navy it falls below even the 3:1 floor for faint text. Every use inside the section must move to a section text token that passes. Don't change the global value; that reaches every page. Additive only.

**Hephaestus's faint text also fails on raised panels.** `#5C6B80` passes on the page background (3.35) but fails on `#1B2637` raised (2.81) and `#1E2A3C` bubble (2.67). The section's tertiary text token must pass 3:1 on every surface it appears on. If that means a lighter value than Hephaestus's faint color, use the lighter value. Copy the look, not the defect.

For the record, the remaining Hephaestus text colors pass comfortably: main text 11.3–14.2, prose 9.1–11.4, dim 4.75–6.0, accent 5.0–6.3. Recompute them yourself anyway and paste the full matrix at the gate.

**Fonts, all additive.**

- Self-host **IBM Plex Mono** (latin subset, regular and medium weights) as the numeric face. It is built as a companion to IBM Plex Sans, so the two sit together cleanly, and loading it fixes the problem where nobody has the stack's first two faces installed.
- Expose Plex Mono through a **new section-scoped token**, not by changing the global `--font-mono`. That variable is read by every page.
- Declare Plex Sans's `@font-face` in the token layer as well. **Leave the existing declaration in `HephaestusPage.module.css` where it is.** A duplicate `@font-face` with the same source is harmless, and moving it means editing Hephaestus. Note the duplication as cleanup for the terminal-wide pass.

**Token layer is additive.** New tokens go in a new file or a new block. Change no existing `:root` variable in `globals.css`.

### Charts

Replace the "ordered series palette" requirement with:

1. **One shared chart theme for everything that isn't a series color:** grid (consolidate the 3 variants), axis stroke, ticks (consolidate the 22 variants), and tooltip surface/border/type (consolidate the 7 variants). Custom tooltip components keep their content but take the theme's surface, border and type.
2. **One identity-color registry module.** Each map is defined exactly once and imported everywhere it's used: country (merge the four rates literal maps and normalize the key mismatches like CA/CAD/CRA and JP/JPY/TOA3 into one canonical key), FX currency, tenor, sector (`SECTOR_COLORS`), curve regime, STIR pack, and the rest of the Phase 0-G arrays. Keep existing values unless a value fails contrast on navy. Adjust only the failing ones and report each.
3. **Resolve the collisions found in Phase 0-F:**
   - **VIX** gets one color across CrossAssetVol and Equities VOL.
   - **Tenor vs country** reuse the same hex values. Report every chart where both maps appear together. Where they never share a chart, leave them. Where they do, re-hue the tenor map.
   - **STIR pack names** (Reds/Greens/…) are CME naming. Keep the pack identity colors, but no pack color may equal a valence or direction token value.
4. **GDPNow quarter palette — fix the color drift.** It assigns colors by array index, so a quarter's color changes when the date range changes. Key the color to the quarter itself, so each quarter keeps the same color under any range. This changes which color a series gets, not what data shows. Report it as a fix.
5. **A short ordered palette** stays allowed, but only for genuinely anonymous series where no identity map applies. If no such series exists in the section, don't create one.

### Per-view mount harness

Build the per-view mount harness for all 55 views that acceptance #5 needs: every asset class × country × section reachable through the React-state nav, including the 8 placeholders. It verifies more than this revamp needs, so build it as a permanent test, not a one-off.

---

## Phase 1 scope, restated

Additive token layer (colors per the four families above, contrast-checked; type scale ≤6 sizes, ≤3 weights; 4px spacing; radii; focus ring), font self-hosting, shared primitives, the shared chart theme, the identity-color registry, and the 55-view mount harness. **No page converted yet.** The section should look the same as now. The one exception is the mount harness, which is test-only.

At the gate, paste from command output:

- the full contrast matrix: every text-family, sign-family and identity token against every surface it sits on
- the final hex values for `--dir-up`, `--dir-down`, `--alert-strong` and `--negative`, plus the `--alert-strong` vs `--negative` contrast
- the 55-view harness result
- `tsc --noEmit` for both packages, and both suite counts

Re-read both prompt files from disk and attest line by line.

---

## Acceptance criteria

Additions to the original list. Where these conflict with it, these win.

1. Both prompt files are saved under `docs/prompts/` before any Phase 1 code is written.
2. Every sign-coloured element in the section is mapped to exactly one of the four families (valence, direction, alert, status). Report the mapping per file. No sign color literal remains.
3. The hike/cut, yield Δ, calendar-spread, returns-heatmap and z-score mappings follow Decision 2 on every page. The calendar-spread inversion is fixed and reported.
4. No U+2212 is emitted by any formatter in the section; a test enforces this. All 179 em dashes `—` used as null placeholders are unchanged.
5. `NavDropdown`, `FredRefreshButton`, the standalone `/treasury` route and every `:root` variable in `globals.css` are unchanged, confirmed by diff.
6. No text token used in the section scores below 4.5:1 (primary/secondary) or 3:1 (tertiary/disabled) on any surface it appears on. `#4e6070` appears nowhere in section styles.
7. Every identity map is defined once in the registry. The GDPNow quarter colors are stable when the date range changes, verified by test.
8. The 55-view mount harness passes, counts pasted from command output.

## What not to break

- Everything listed in the original spec's "What not to break."
- **Hephaestus.** No file under it is edited. That includes `HephaestusPage.module.css`, where the Plex Sans `@font-face` stays.
- The 41 other routes that share `NavDropdown`, and the 32 that share `FredRefreshButton`.
- The global `--font-mono` and every other existing `:root` variable.
- The em dash null convention.
- The informational content of identity colors. A country, currency, sector or regime keeps its color unless contrast forces a change, and any forced change is reported.

## Out of scope

- Everything in the original spec's "Out of scope."
- Restyling `NavDropdown` (deferred to the pilot review).
- Changing global `:root` variables, global `--font-mono`, or the Hephaestus `@font-face` location (deferred to a future terminal-wide pass).
- Bracketed negatives and the `–` dash (never part of this section).
- Splitting the 5,495-line `STIRDashboardPage.tsx`. It's a real maintenance problem, but restructuring it is not a styling task. Convert it in place.
