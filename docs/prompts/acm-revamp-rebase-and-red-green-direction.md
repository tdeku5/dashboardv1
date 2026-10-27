# Push `main`, Rebase `acm-revamp`, Apply the Red/Green Direction Convention

## Context

The TV completed-bars change is committed on `main` (`70ffa12`, `f37599e`). `main` is 4 commits ahead of `origin/main`. The Asset Class Models design revamp lives on `acm-revamp`, which needs rebasing onto `main` before design work resumes.

The revamp plan also contradicts a standing convention. **Decision: the convention wins.**

| Meaning | Colour |
|---|---|
| Yield / rate / spread **up** | **red** |
| Yield / rate / spread **down** | **green** |
| Futures price **down** | **red** |
| Futures price **up** | **green** |
| Hike | **red** |
| Cut | **green** |
| Returns / P&L up | green (unchanged) |
| Returns / P&L down | red (unchanged) |
| Alerts | amber → red (unchanged) |

The revamp's **blue/orange "direction" pair is removed** from every direction meaning above. Blue and orange used for anything else (chart series lines, accents, the navy/steel-blue chrome) are untouched.

Standing rules apply: TypeScript strict, no `any`, explicit path staging only (`git add -A` prohibited), every verification number pasted from actual command output, and re-read this file from disk at each phase boundary. Save this file to `docs/prompts/` on `acm-revamp` once the rebase lands, not on `main`.

---

## Phase 1 — Push `main`, then rebase `acm-revamp`

### 1a. Push `main`
1. Run `git status --short`, which must be empty. Make sure you are on `main`.
2. Run server and client `tsc --noEmit` and both test suites; all must be green.
3. Run `git fetch origin`, then confirm `origin/main` is an ancestor of `main` (`git merge-base --is-ancestor origin/main main`), so the push is a fast-forward.
4. Run `git push origin main`. **Never force-push `main`.** If the push is rejected, or `origin/main` has diverged, stop and report.
5. Paste `git log --oneline origin/main -5` after the push.

### 1b. Inspect `acm-revamp` before touching it
Report:
- `git log --oneline main..acm-revamp`: the commits to be replayed.
- `git merge-base main acm-revamp`, and `git log --oneline acm-revamp..main`: what the branch is missing.
- Whether `acm-revamp` exists on the remote (`git ls-remote --heads origin acm-revamp`).
- The files touched on both sides since the merge base (`git diff --name-only <merge-base> main` intersected with `git diff --name-only <merge-base> acm-revamp`). These are the likely conflicts.

### 1c. Rebase
1. Create a safety ref first: `git branch acm-revamp-pre-rebase acm-revamp`. Paste its hash.
2. Run `git checkout acm-revamp`, then `git rebase main`.
3. **Conflict resolution rules:**
   - **Data and reader logic: `main` wins.** This covers anything involving `tvVisible`, `viewAsOf`, `captured_at`, `tvRead.ts`, reader SQL, the market registry, and the Global Rates Summary server payload. The branch must never reintroduce raw TV queries or drop the completeness filter.
   - **Presentation: the branch wins.** This covers markup, CSS modules, design tokens, typography, and layout.
   - **A conflict mixing both inside one hunk:** keep `main`'s data logic and the branch's presentation, and combine them by hand.
   - **Ambiguous cases** (you can't tell which side's intent should win): `git rebase --abort`, then stop and report the file and hunk. Do not guess.
4. Never use `-X ours`/`-X theirs` or any blanket strategy.
5. After the rebase, run server and client `tsc --noEmit` and both test suites, including the TV guard test.
   - If the guard test fails because a branch commit added a raw TradingView query, route that query through `tvVisible`, and through `viewAsOf` if it is a multi-group view. Put the fix in **one new commit** on `acm-revamp`, with explicit paths. Do not edit the replayed commits.
   - Fix any other failure only if it is a mechanical consequence of the rebase (e.g. a renamed import). Anything else: stop and report.
6. **Do not push `acm-revamp`.** If it exists on the remote, the rebased branch would need a force-push, and that is my call.

### Phase 1 gate
Paste:
- the push result and `origin/main` log,
- the 1b inspection,
- every conflict, with file, hunk summary, which rule you applied, and the resolution,
- the guard-test fix commit (if any) with its `git show --stat`,
- `git log --oneline main..acm-revamp` after the rebase,
- both `tsc` results and both test-suite results,
- `git status --short`.

**STOP after Phase 1.**

---

## Phase 2 — Apply the red/green direction convention on `acm-revamp`

### 2a. Inventory (read before editing)
List **every** place on `acm-revamp` where blue/orange (or tokens derived from them) carries a direction meaning, covering design tokens, CSS variables, CSS modules, colour helpers and class-name helpers, chart props, and any design-system or `CLAUDE.md` text that states the blue/orange rule. For each site give the file, the line, the current colour or token, its meaning (yield up, spread down, hike, and so on), and the new colour per the table above.

Also list blue/orange uses you are **leaving alone** because they aren't direction (series lines, accents, chrome), with a one-line reason each.

Include the US Rates VOL pilot (`1cfa75e`): check whether it uses the blue/orange pair for direction.

### 2b. Apply
- Repoint direction meanings to the existing red/green tokens. Reuse the same red/green tokens the revamp already uses for returns/P&L; do not invent new shades. If the revamp defines a direction-token pair (e.g. `--dir-up` / `--dir-down`), re-point it to red/green at the token level rather than editing every call site, so the meaning stays named in one place.
- **Sign mapping is per meaning, not per number.** For yields, rates, and spreads, a positive change is red. For futures prices, a positive change is green. Hike is red. Where a single helper colours both kinds of value, split it or pass the meaning explicitly. Never infer the meaning from the sign alone.
- Update the design-system doc and any `CLAUDE.md` text so the stated rule matches the table above. Remove the blue/orange direction rule wherever it is written.
- Remove any token or helper the change leaves unused.

### 2c. Verify
1. Run server and client `tsc --noEmit` and both test suites. Update tests that assert blue/orange direction colours so they assert the new mapping. Paste the output.
2. Add a test (or extend an existing one) that pins the mapping: yield up → red token, futures price up → green token, hike → red token.
3. Use the Playwright Chromium already available in this environment to screenshot the Global Rates Summary, the US Rates VOL pilot, and one STIR strip page. Confirm the colours of a yield increase, a futures price increase, and HIKE in each. Paste the screenshot paths and what each shows.
4. **One commit** on `acm-revamp` with explicit paths, e.g. `Revamp: direction colours follow red/green bond-price convention`. Paste `git show --stat HEAD` and `git status --short`.
5. Do not push.

**STOP after Phase 2.**

---

## Acceptance criteria

- `main` is pushed by fast-forward, with no force, and `origin/main` equals local `main`.
- `acm-revamp` is rebased onto `main`, with a pre-rebase safety ref kept, and every conflict reported along with the rule applied.
- `main`'s completed-bars data logic survives the rebase intact, and the TV guard test passes on `acm-revamp`.
- No direction meaning on `acm-revamp` uses blue/orange. Yields, rates, and spreads up are red; futures price up is green; hike is red; returns are unchanged. A test pins the mapping.
- The design-system doc and `CLAUDE.md` state the red/green rule and no longer mention blue/orange for direction.
- Both packages typecheck and pass tests on `acm-revamp`, and the screenshots confirm the three pages.
- Nothing on `acm-revamp` is pushed, and every number is pasted from actual output.

## What not to break

- `main`. Don't commit to it after the push, and never rewrite or force-push it.
- The completed-bars change: `tvVisible`, `viewAsOf`, `captured_at`, the registry, the guard test, and all 18 readers.
- The revamp's non-direction design: the navy/steel-blue chrome, typography, layout, alert colours, and returns/P&L colours.
- The `acm-revamp-pre-rebase` safety ref. Leave it in place.
- The real `fred_data.db` and the running dev server.

## Out of scope

- Force-pushing `acm-revamp` or deleting the safety ref.
- Any new revamp design work beyond the colour mapping.
- Aligning views built from separate requests, and the slow-endpoint follow-ups.
- Changing the shared `NavDropdown`.
- New dependencies.
