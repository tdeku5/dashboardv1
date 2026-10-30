# R5b — Approved. R5c: GLOBAL page, part 1.

R5b is accepted (`856d268`, pushed). The shared `fundamentalPanelParts.tsx`, the `.fvmNote` rule, the policy-rate toggles in chart headers, the evened CPI and MoM axes, and the extra US LABOR axis fix are all approved. The colour mapping matching the US panel is approved.

**Readings with no US equivalent: keep their existing registry colours.** That covers the AUS unemployment trend line (`auTrend`), the UK GROWTH tab's headline and MoM colours, the four BoC core measures and the RBA target band. These are series identities, not signs. Record them in the design notes alongside the identity registry entries.

---

## R5c — `GlobalRatesPage`, `GlobalPolicyPathRealRateSection`, `GlobalPolicyTermStructureSection`

Convert these three (about 177 literals), including the GLOBAL z-score grid.

- **Z-score grid:** keep it on the `--acm-heat-rate-*` red/blue scale (rule 6(b)), now driven by converted markup. Text is primary, the base is opaque, and there are no alerts. Confirm the computed minimum contrast in the browser and paste it.
- **Summary table and calendar spreads:** Terminal-OCR, ±OCR and every Δ column follow rule 6 (increase red, decrease green); levels are plain text. Move this page off the shared legacy `spreads*` / `ocrPositive/Negative` rules onto token-only classes. Leave the legacy rules for Z.
- **Policy paths and real policy rates:** these are levels plotted as lines, so they take identity colours from the registry (country map), not sign colours. If any element shows a change in a path or real rate, it follows rule 6. Report anything ambiguous; don't decide it.
- **Axes:** use `niceAxis` wherever the probe finds uneven or repeated ticks. `GlobalPolicyTermStructureSection` (36px) and `GlobalPolicyPathRealRateSection` (40px) are known Y-axis candidates; widen only those that clip.
- **Near-zero:** migrate signed formatters and list them.
- **Shared modules:** check every importer before editing a shared CSS module or helper; add new rules under new names.
- The GLOBAL grid takes about 12s to load. Make sure the probe waits for it rather than measuring the loading state.

Then commit (`R5c: GLOBAL page, summary, policy paths`) per the standing rule (green check, explicit paths, normal push), give the status block, and stop.

---

## Acceptance criteria

1. The three files are at zero TSX literals; the z-score grid is on the rate scale with a computed minimum contrast ≥ 4.5, pasted.
2. Summary-table and calendar-spread changes follow rule 6; levels are plain; the page no longer uses the legacy spread rules.
3. Path and real-rate lines use registry identity colours; ambiguities are reported.
4. All axes are even and non-repeating, widened axes are listed, formatters are migrated, and the probe (after the grid loads) is clean with no 4xx/5xx.
5. All suites, `tsc`, the harness and the smoke tests are green; R5c is committed and pushed with its hash pasted.

## What not to break

- Everything listed in the earlier prompt files' "What not to break."
- Every view converted in R1–R5b, including any that share the legacy spread rules.
- `main`, `origin/acm-revamp` history (no force-push), and every data-ingestion commit.
- Plotted data.

## Out of scope

- R5d (`GlobalForwardCurvesSection`, `Global2s10sRegimeSection`, `DailyChangeModal`, `lib/curveRegime.ts`).
- The RATES gate and the squash-merge.
- Deleting legacy CSS (Z).
