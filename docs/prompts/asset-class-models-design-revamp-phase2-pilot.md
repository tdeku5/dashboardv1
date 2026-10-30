# Phase 1 — Approved and commit authorized. Phase 2: VOL pilot.

## Commit Phase 1

The Phase 1 gate is accepted. Commit as proposed:

- One commit, client and docs only (no server files changed).
- Stage exactly the 47 listed paths. No `git add -A`. Confirm `.claude/settings.local.json` is **not** staged.
- Before committing, paste `git diff --cached --stat`, so the staged set can be checked against the proposed list.
- Then paste the commit hash and `git status`.

A verification note for the record: the borderline identity color `#AB47BC` measures **3.0029:1** on overlay `#1E2A3C`. It's a true pass, not a rounding artifact like the earlier `4.49907`.

---

## Phase 2 — convert the US Rates VOL page

Convert exactly one page, `UsRatesVolPage` and its components, to the token layer, primitives, chart theme and identity registry. Then stop for my visual review. Phase 3 page lists don't start until I respond.

### What the page should use

| Element | Becomes |
|---|---|
| Page title / as-of | `AcmPageHeader` |
| Stat strip | `AcmStatStrip` / `AcmStatTile` |
| Four charts | `AcmChartFrame` + chart theme |
| Contribution table | `AcmDataTable` |
| Methodology | `AcmCollapsible` (closed by default, as now) |
| Data-quality note | status-warning treatment |
| Local refresh button | tokens only (it stays page-local) |

### Color families on this page

- **Implied vol premium (`MOVE − RMOVE`)** and its sign: **direction** family (`--acm-dir-up` / `--acm-dir-down`) on the value text. A positive or negative premium is not good or bad.
- **Premium z-score:** the number is primary text. If `|z| > 2`, the tile gets the **alert-mild** tint; if `|z| > 3`, **alert-strong**. Tint only, never the text.
- **±1σ / ±2σ bands** on the premium chart: the theme's reference-line and band treatment, not sign colors.
- **MOVE and RMOVE lines:** a registry or accent color for MOVE, and a distinct one for RMOVE. Report which keys you used.
- **Per-tenor realized vol lines:** the merged tenor map from the registry.

### Formatting

- Convert the page's U+2212 `−1σ`/`−2σ` labels to ASCII. Its ratchet entry must shrink accordingly.
- Nulls stay `—`. Negatives use ASCII `-`.
- No hardcoded color, font size or spacing literal may remain in the page's TSX or CSS. Report the before/after count for this page against the Phase 0 baseline.

### What must not change

Data, calculations, routes, the refresh behavior, chart data series, and the methodology wording. Markup may change to adopt primitives; behavior may not.

---

## Screenshots — before and after

Your real-browser test proves headless Chromium works here, so produce screenshots for me rather than leaving review to the live page alone.

- Use Playwright against the dev server, with the data API live.
- Navigate the real nav to RATES → US → VOL.
- Take full-page PNGs at **1440px** and **1920px** wide: one set from `HEAD` (Phase 1 commit, before conversion) and one after conversion.
- Also capture one close-up of each chart's axes and one of the contribution table at 2× device scale.
- Save to `docs/design-review/phase2-vol/` as `before-1440.png`, `after-1440.png` and so on. These are review artifacts; **don't commit them** unless I say so.

Report file paths only. Don't describe how the page looks or judge it. That's my call.

### Pilot watch list — confirm each is visible in the screenshots

Point me at where each appears; I'll judge them:

1. Tick crowding or overlap on the date axes (`minTickGap: 10`).
2. The dashed both-ways grid vs. a horizontal-only alternative. Also produce a single extra after-screenshot with horizontal-only grid, using a temporary local override that you revert immediately.
3. Alert tint visibility (8–16% alphas): if no tile currently breaches `|z| > 2`, render one with a fixture value in the screenshot only.
4. The merged tenor colors on the per-tenor chart.
5. The 10px smallest type size (tick labels, tile labels).
6. Y-axis labels on this page's three 52px axes: any clipping.
7. The header seam between the untouched `NavDropdown` and the navy section.

---

## Gate

Stop with:

- the file list and diff stat for the conversion (uncommitted)
- `tsc` for both packages, both suites, and the 55-view harness, all pasted from command output
- the literal-count before/after for this page
- the U+2212 ratchet entry for this page, before and after
- the screenshot paths and the watch-list locations

Then wait for my review. Don't commit the conversion and don't start Phase 3.

---

## Acceptance criteria

1. The Phase 1 commit contains exactly the 47 proposed paths, verified by the pasted `git diff --cached --stat`; `settings.local.json` stays uncommitted.
2. `UsRatesVolPage` uses the listed primitives, the chart theme and the registry, with zero remaining color, size or spacing literals in its TSX and CSS.
3. Premium values use the direction family on text; z-score extremes use alert tints only; σ bands use the theme.
4. The page's U+2212 ratchet entry is reduced by the converted labels; nulls and negatives follow the conventions.
5. All 55 views still mount, and every suite is green, from command output.
6. Before/after screenshots at 1440 and 1920 plus close-ups exist under `docs/design-review/phase2-vol/`, uncommitted.
7. The report locates every watch-list item and contains no aesthetic judgement.

## What not to break

- Everything listed in the earlier prompt files' "What not to break."
- The VOL page's data, calculations, refresh behavior and methodology text.
- Every other page. Only the VOL page and its own components change.
- The horizontal-grid experiment must be reverted, with no trace in the diff.

## Out of scope

- Converting any other page, including `STIRDashboardPage` and its 42px Y-axis (Phase 3).
- Restyling `NavDropdown`.
- Committing the conversion or the screenshots before my review.
