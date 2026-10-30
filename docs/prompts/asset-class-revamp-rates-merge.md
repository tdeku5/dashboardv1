# RATES approved — squash-merge to main

The RATES gate is approved. The two rulings and R5d are accepted (`d603235`), including the regime tint at alpha 0.36, the forward-curve Δ colour fix, and the `DailyChangeModal` backdrop carrying `acm-root`. The modal's **Mean** coloured by rule 6, like Latest, is approved: it's an average of yield changes.

Follow the squash-merge procedure in the design notes' Process section:

1. On `acm-revamp`: confirm a clean tree and that it's in sync with `origin/acm-revamp`. Run every suite, `tsc` on both packages, the harness and the smoke tests. Paste the results; all must be green.
2. `git switch main`, then `git pull --ff-only`, to confirm `main` is still at `f37599e` or has only fast-forwarded. If `main` has new commits, **stop and report** before merging.
3. `git merge --squash acm-revamp`.
4. Paste `git diff --cached --stat`. Confirm **nothing under `server/`** and no data-ingestion file. It should match the 73 files from the gate. If anything else appears, stop.
5. Re-run the client suite, `tsc` and the harness on the staged state, and paste.
6. Commit on `main` with this message: "Asset Class Models revamp: RATES (R1–R5)" (body as given), ending with the standing Co-Authored-By line.
7. `git push` (normal, no force). Paste the hash and `git log --oneline -3`.
8. Create the next working branch: `git switch -c acm-revamp-2`, then `git push -u origin acm-revamp-2`.
9. Leave `acm-revamp` untouched on GitHub as the archive.
10. Restart the dev server on `acm-revamp-2` and confirm it serves the converted RATES section.

Then stop. MACRO (M1) is the next prompt.

## What not to break
- `main`'s existing history and every data-ingestion commit.
- `origin/acm-revamp` (no force-push, no deletion).
- Untracked or ignored files (`docs/design-review/`, `.claude/settings.local.json`).

## Out of scope
- MACRO and later batches. Deleting legacy CSS (Z). Deleting any branch.
