# R2c — Approved. Four answers, then R2d.

R2c is accepted. The panel is at zero literals, the probe is clean (18 renders), GDPNow colours are verified stable across ranges, rule 6 lists both exceptions, rules 1, 2, 4 and 5 are byte-identical, and the checkpoint `91f02a8` is in and unpushed. The visible markup changes (legends in frames, chart titles, toggles and refresh in chart headers, accent active buttons) are approved.

## Answers

1. **Payroll MoM bars: accepted** as valence (gain green, loss red). It's a labour reading, not a yield change.

2. **Make the `cellColor` grid symmetric.** An equal rise and fall must shade identically. Add grid-specific tokens:
   - `--acm-heat-rate-up-1…4`: the `--acm-negative` colour at the **direction scale's alphas** (12 / 23 / 35 / 46%)
   - `--acm-heat-rate-down-1…4`: identical to `--acm-heat-dir-down-1…4`

   The red side gets lighter than `heat-negative`, so primary-text contrast can only improve. Prove it by adding both new scales to the contrast test on both surfaces. Point rule 6(b), the `ratesColour` test's grid allowance and the pending R2d test at the new tokens. `--acm-heat-negative-*` stays as it is for the strip and FF heatmaps.

3. **Rule 3: you may now edit it.** Replace its statement that the grid "moves to the valence scale" with a pointer to rule 6(b). Change nothing else in rule 3, and re-confirm by diff against `1cfa75e` that rules 1, 2, 4 and 5 are still byte-identical.

4. **Make the literal counter a committed tool and re-baseline with it.** Final Z deltas must be measured with one instrument at both ends.
   - Move `literals.py` out of the gitignored `docs/design-review/` to `scripts/acm-literals.py`, with a short header explaining what it counts: colour, font-size and spacing, plus radius, and how TSX inline styles and Recharts props are detected.
   - Run it against the **Phase 0 baseline commit `7512e85`** (use a temporary worktree or `git show` into a scratch dir; don't check out over the working tree) and against `1cfa75e`, and paste both.
   - From now on, report every whole-file and section figure from this script only. At Z, the deltas run from the re-measured `7512e85` baseline, not from Phase 0's original numbers. Note the change of instrument in the design notes.

**`.comingSoon` check.** It now uses tokens and lives in `STIRDashboardPage.module.css`, which is imported by 12 files. Confirm no page **outside** Asset Class Models renders `.comingSoon`. If one does, report it before R2d continues.

---

## R2d — UST CURVE

Convert UST CURVE (about 290 literals), including both `cellColor` grids on the new symmetric `--acm-heat-rate-*` scales. Unskip the "PENDING R2d" test and make it pass. If the work, including the four answers above, looks like it'll run well past about 300 literals or a long turn, split it and say so up front.

All Phase 3 rules and rule 6 apply. Report anything ambiguous; don't decide it. Probe every converted chart, and give the status block as specified, including nav paths. Note that the `cellColor` grid change also shows on the country and GLOBAL pages as soon as `cellColor.ts` changes. Say whether it does, and list those nav paths too.

Stop at the end of R2d.

---

## Acceptance criteria

1. The `cellColor` grid uses `--acm-heat-rate-up/down-*` with identical alphas per step; contrast is tested for both scales on both surfaces; rule 6(b) and the tests point at the new tokens.
2. Rule 3 points to rule 6(b); rules 1, 2, 4 and 5 are byte-identical to `1cfa75e`.
3. `scripts/acm-literals.py` is committed-ready, with a header; its counts at `7512e85` and `1cfa75e` are pasted; the instrument change is noted in the design notes.
4. No out-of-section page renders `.comingSoon`, or any that do are reported.
5. UST CURVE is at zero literals, the R2d pending test is unskipped and passing, the probe is clean, and the status block is complete, all from command output.

## What not to break

- Everything listed in the earlier prompt files' "What not to break."
- The `--acm-heat-negative-*` values used by the strip and FF heatmaps.
- Checkpoint `91f02a8`. No amending, no pushing.
- The working tree when measuring the old baseline. Use a worktree or scratch copy.

## Out of scope

- YIELD ATTRIBUTION, CREDIT and MONEY MARKETS (R3) and later turns.
- Retuning any other heat scale.
- Pushing commits.
