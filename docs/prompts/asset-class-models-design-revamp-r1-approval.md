# R1 — Approved. Two answers, one turn-size rule, then R2.

R1 is accepted. All three nav tiers share a single active treatment that differs only in size, the section shell sits on navy, and `NavDropdown` and `FredRefreshButton` are untouched.

## Answers

1. **VOL page padding: remove it.** The pilot's own navy background, 16px padding and radius on the `UsRatesVolPage` wrapper made sense when it was the only navy page. Inside the navy shell it now insets that page 16px further than every other view. Remove the wrapper's background, padding and radius so VOL aligns with the rest of the section. Do it at the start of R2, and confirm the VOL demo test still passes 21/21.
2. **Prompt files: yes.** Include `docs/prompts/…-phase2-pilot.md` and the Phase 3 prompt in the RATES commit.

`AssetSubRibbon` converting in C1 is fine.

## Turn-size rule for R2 and R3

`STIRDashboardPage.tsx` still holds 607 color, 111 font-size and 64 spacing literals, and its CSS module 183 / 84 / 188. R2 and R3 together have to clear about 1,250 of them.

A turn that tries to clear all of that in one go is how Phase 1 lost a 7-hour turn to a dropped connection. So:

- **Split R2 and R3 by section if needed.** If clearing a turn's sections would mean converting more than about **300 literals**, do one section per turn (for example R2a STIR STRIPS, R2b FORWARD PRICING, R2c UST CURVE), each with its own status block and stop.
- **Say up front which split you're using,** in the first status block.
- **No chaining.** Every sub-turn ends with a stop, even when the next one looks trivial.

The file's literal counts can't reach zero until every section in it is converted. Report the per-section counts each turn, so progress is visible against the 607 / 111 / 64 and 183 / 84 / 188 starting points.

## Then R2

Proceed with R2 (STIR STRIPS, FORWARD PRICING, UST CURVE), split per the rule above, with everything else from the Phase 3 rollout file applying. The probe runs on every converted chart. `STIRDashboardPage:3172`, the 42px axis, is the known clipping candidate.

---

## Acceptance criteria

1. The VOL wrapper's background, padding and radius are removed; the VOL demo stays 21/21; VOL aligns with other views.
2. The R2/R3 split is declared up front, and no sub-turn converts more than about 300 literals.
3. Each status block reports per-section literal counts for `STIRDashboardPage.tsx` and its CSS module.
4. Every other Phase 3 rule and status-block item applies unchanged.

## What not to break

- Everything listed in the earlier prompt files' "What not to break."
- The nav tiers and shell as approved in R1.
- The VOL page's content and behavior. Only its outer wrapper styling changes.

## Out of scope

- Splitting `STIRDashboardPage.tsx` into separate files (turn splitting is about work size, not file structure).
- Any section beyond R2's three until I approve R2.
