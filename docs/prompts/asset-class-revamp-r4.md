# R3b — Approved. Branch check, three changes, then R4.

R3b is accepted. The credit heatmap (US only, as no EU credit table exists), breakeven purple `#c084fc`, the shared `roundForDisplay` / `fmtSignedFixed` helpers, and MONEY MARKETS at zero literals are all approved. `STIRDashboardPage.tsx` at 0 is a milestone. Purple over amber for the breakeven, because the ambers failed against the alert tokens, was the right call.

---

## Step 0 — Explain the branch history (before any code)

The R3b report's log for `acm-revamp` was `5f61fce, 8a27d76, b45282e, 9210bcf, f37599e, 70ffa12`. The two rebased checkpoints are `9210bcf` and `b45282e`, so **two further commits, `8a27d76` and `5f61fce`, sit on the design branch** and haven't been explained. The report also says the rebase was done "in the earlier push step", which means the data session acted on the design branch.

Report, from command output:

1. `git log --format='%h %ad %s' --date=iso main..acm-revamp`: every commit on the design branch above `main`.
2. `git show --stat 8a27d76` and `git show --stat 5f61fce`.
3. `git branch -r`, and `git log --oneline origin/acm-revamp` if that remote branch exists. Has the design branch, or either checkpoint, been **pushed**?
4. `git status`.

Then classify each of the two commits as **design work**, **data work** or **other**.

- **If either is data work or anything else not part of the revamp:** stop, and tell me what it contains. It must end up on `main`, not inside the RATES squash. Don't move it yourself.
- **If `acm-revamp` has been pushed:** stop and tell me. The planned squash would then need a force-push, which I have to approve.
- **If both are design work and nothing is pushed:** say so and continue.

---

## Three changes

### 1. MONEY MARKETS reference lines — off red

- **SCARCITY WARNING** threshold line → `--acm-alert-strong` (pink). It flags a threshold, so it's an alert, not a rate move.
- **RDE median** line → the chart theme's neutral reference-line style, like the ±σ bands.
- Update the registry entries these came from (the scarcity-line key added in R3b, and RDE). Keep each line's legend entry matching its new colour.

### 2. MONEY MARKETS display fixes

- **Threshold line always visible.** The scarcity line isn't drawn when the data never reaches it, because the threshold falls outside the axis domain. Make the reference line extend the domain (Recharts `ifOverflow="extendDomain"`, or an explicit domain that includes the threshold) so it always draws and its legend entry is never orphaned.
- **No duplicate ticks.** The y-axis shows `-3bp` twice because ticks are rounded to whole bp. Choose ticks so labels never repeat: integer tick values when the range is small, or one decimal place. Don't change the plotted data.
- Re-run the probe on this chart. Report the domain and tick values before and after, and confirm zero duplicate labels.

### 3. Near-zero rule — fold into each remaining turn

From R4 onward, every page converted in a turn must route its signed formatters and tone helpers through `roundForDisplay` / `fmtSignedFixed`, so values that round to zero show as untoned `0.0`. List the formatters migrated in each status block. At Z, report any that remain anywhere in the section.

---

## R4 — POLICY RATE and TREASURY AUCTIONS

Convert `PolicyRatePage` and `TreasuryAuctionContent`. All Phase 3 rules, rule 6 and the near-zero rule apply.

- **Unskip the "PENDING PHASE 3" `TreasuryAuctionContent` cross-route test** and make it pass: the component resolves every `var(--acm-*)` with no `.acm-root` ancestor.
- Check the standalone `/treasury` route mounts and renders. Probe its charts too. Only `TreasuryAuctionContent`'s own content changes there; the `/treasury` page shell and `NavDropdown` stay untouched.
- **Colours:** policy-rate and auction yield changes follow rule 6 (increase = red); levels are plain. Auction metrics such as tail, bid-to-cover and allotment shares aren't yield changes; report how you'd classify each before colouring it, and don't decide anything ambiguous.
- Investor-class colours come from the registry (Individuals `#868D9B`, Other `#687385`).
- If R4 with the changes above looks like it'll run well past about 300 literals, split it (for example R4a POLICY RATE, R4b TREASURY AUCTIONS) and say so up front.
- Status block as specified, with counts from `scripts/acm-literals.py` and nav paths, including `/treasury`.

Stop at the end of R4, or at each sub-turn.

---

## Acceptance criteria

1. Every commit on `acm-revamp` above `main` is identified and classified, and the pushed state is reported. Any non-design commit or pushed branch stops the turn.
2. The scarcity line is alert-strong, the RDE median is neutral, and both legend entries match.
3. The scarcity line always draws, y-axis labels never repeat, and the probe shows the before and after domain and ticks.
4. Each R4 page uses the shared near-zero helpers, with migrated formatters listed.
5. `PolicyRatePage` and `TreasuryAuctionContent` are at zero literals; the cross-route test is unskipped and passing; `/treasury` renders and probes clean; auction-metric classifications are reported.
6. All suites, `tsc`, the harness and the smoke tests are green, from command output.

## What not to break

- Everything listed in the earlier prompt files' "What not to break."
- Every data-ingestion commit, and `main`'s history.
- The `/treasury` page shell and `NavDropdown`.
- Plotted data. Only the domain and tick choices change.

## Out of scope

- Moving or rewriting any commit (report only).
- Pushing.
- The near-zero sweep on pages not converted in this turn.
- R5 and later.
