# Recovery accepted. Three decisions, a checkpoint commit, then R2c.

The recovery is accepted. The tree was clean of mutations, all five checks failed then restored exactly, the snapshot-and-`cmp` restore was the right call over `git checkout -p`, and catching and restoring design-notes rules 4 and 5 was good work. Parts 2 and 3 are approved as reported.

---

## Decision 1 — Rates heatmap grid (`cellColor`) keeps a red/blue gradient

By my decision, the `cellColor` grid keeps its current red/blue shading. It does **not** move to red/green. It's a named exception to the rates colour rule.

- Increase (yield/rate/spread up) → red, using the `--acm-heat-negative-*` steps.
- Decrease → blue, using the `--acm-heat-dir-down-*` steps.
- Same 4 steps per side, no-fill neutral, primary text and opaque panel base as the other heatmaps. Both of these scales already have text-over-fill contrast tests; confirm the grid's cells are covered.
- **Timing:** convert the grid to these tokens when its pages convert (R2d for UST CURVE, R5 for the country and GLOBAL pages). Don't touch it now. The direction heat tokens therefore stay in use; they aren't dead at Z.
- **GLOBAL z-score grid:** the same red/blue grid applies there too. It shows signed z-scores of rate changes, so it's a heatmap of change, not an alert flag. Alert tints remain only for unsigned extremeness flags such as the VOL stat tile.

## Decision 2 — VOL premium stays orange/blue

The VOL page's implied-vol premium (MOVE − RMOVE) stays on the direction family. It's a spread between volatilities, not yields.

## Docs and tests for 1 and 2

- Update colour rule 6 in `docs/asset-class-models-design-notes.md`. Its exceptions are now (a) the VOL premium, on direction, and (b) the `cellColor` grid: red for increase, blue for decrease, using the negative and direction-down heat steps. **Edit only rule 6.** Re-read the whole file afterwards and confirm, by diff against `1cfa75e`, that rules 1–5 are unchanged. The lost turn overwrote rules 4 and 5 once; don't repeat it.
- Update the Rule 2 comment in `acm-tokens.css` to match.
- `ratesColour` test: name both exceptions explicitly. The `cellColor` grid's allowance should become active when R2d converts it; add it now as a clearly labelled pending case if needed.

---

## Checkpoint commit — do this before R2c

About a week of uncommitted work has now survived two dropped connections and a laptop restart. Save it.

1. Run the client suite, `tsc` on both packages and the harness; all must be green. Paste the results.
2. Stage **explicit paths only**: every tracked change since `1cfa75e` plus the new tests and the untracked prompt files under `docs/prompts/`. Paste `git diff --cached --stat`. Confirm `.claude/settings.local.json` and `docs/design-review/` are not staged.
3. Commit with the message: `WIP checkpoint: RATES R1–R2b + rates colour rule (to be squashed into RATES commit)`.
4. **Don't push.** Paste the hash and `git status`.

At the RATES commit after R5, fold this checkpoint in with `git reset --soft 1cfa75e`, then make the single RATES commit as planned. Only do that if the checkpoint was never pushed; if it was, stop and ask me.

> **Superseded (2026-10-28):** no `reset --soft` and no force-push. RATES lands on `main` by `git merge --squash acm-revamp`; see the commit-rules amendment in `asset-class-models-design-revamp-phase3-rollout.md` and "Process" in `docs/asset-class-models-design-notes.md`.

---

## R2c — US FUNDAMENTAL MODEL panel

Convert the US FUNDAMENTAL MODEL panel (the right panel on STRIPS and PRICING, about 210 literals, including the GDPNow quarter palette via `gdpnowQuarterColor`). All Phase 3 rules apply, plus:

- **Colours:** any yield, rate or spread change follows rule 6, so increases are red and decreases green. Growth, inflation or labour readings that aren't yield or spread changes keep their existing family. Report anything ambiguous; don't decide it.
- **Size:** if it looks like going well past about 300 literals or a long turn, split it and say so up front.
- **Probe** every converted chart; report clipped labels and overlaps.
- **Status block** as specified in the Phase 3 rollout file, including nav paths and the remaining direction-token users (expected: the VOL premium only, until R2d).

Stop at the end of R2c.

---

## Acceptance criteria

1. Colour rule 6 lists both exceptions. Rules 1–5 are proven unchanged by diff, and the token comment and `ratesColour` test are updated.
2. The `cellColor` grid is unchanged in this turn, and its red/blue token mapping is documented for R2d and R5.
3. A checkpoint commit exists with the exact message above, made from a green tree with an explicit staged list. It isn't pushed; the hash and `git status` are pasted.
4. The US FUNDAMENTAL MODEL panel is converted to zero literals, colours follow rule 6 with ambiguities reported, the probe is clean, and the status block is complete.
5. All suites, `tsc` and the harness are green after R2c, from command output.

## What not to break

- Everything listed in the earlier prompt files' "What not to break."
- Design-notes rules 1–5.
- The `cellColor` grid's current appearance until R2d and R5.
- The VOL premium's orange/blue.
- Every R1–R2b result, including the recovery's restored state.

## Out of scope

- Converting the `cellColor` grid or its pages (R2d and R5).
- Pushing the checkpoint commit, or any history rewrite other than the planned soft reset at the RATES commit.
- UST CURVE (R2d) and later turns.
