# TV Completed Bars — Resume Phase 2 After the Dropped Connection

The session lost its connection mid-response during Phase 2. Re-read all three spec files from `docs/prompts/` and this file from disk. Then confirm the state below and continue Phase 2 with one amendment.

---

## 1. Confirm the state before continuing

Paste the output of each:

- `git log --oneline -3`: Commit 1 (the Phase 1 work plus R1/R2) must be at HEAD.
- `git show --stat HEAD`: this was required by the Phase 1 rulings and hasn't been pasted yet.
- `git status --short`: reader code must not be modified yet. List any harness or scratch files.
- The "1 shell still running" process. Identify what it is (dev server, harness server, or something else). If it is a harness server mounted on a **temp copy** of the database, it may keep running. If anything is pointed at the **real** `fred_data.db` other than the normal dev server, stop it and report.
- That the baseline captures (76 responses, all 200, byte-identical across runs) are still on disk. If they are lost, re-capture them before changing any reader.

---

## 2. Amendment: intraday capture time = Tue 20 Oct **12:00 CT**, not 00:00 CT

An `mtime` of 00:00 CT doesn't exercise per-market completeness: at midnight no Tuesday session in the registry has closed, so every symbol simply shows Monday. The verification has to show markets **diverging**.

For database copy C, re-ingest both 20 Oct files with `mtime` overridden to **2026-10-20 12:00 America/Chicago**. At that time:

- `EZ_YIELDS` (closed 11:00 CT), `JP_YIELDS`, and `AU_YIELDS` → Tuesday is **complete**.
- `US_YIELDS` and `CME_RATES` (16:30 CT) → Tuesday is **incomplete**.

Required evidence, before vs after the reader changes, on copy C:

1. **Single-group views:** a DE yield-curve view and a JGB view return **Tue 20 Oct** as their latest date. A US yield-curve view and an SR3 strip view return **Mon 19 Oct**.
2. **Multi-group view:** the Global Rates Summary returns **Mon 19 Oct** for every row, including DE/FR/IT and JP, with all strip `curveDate`s on Mon 19 Oct.
3. **Before** (unfiltered readers) shows Tuesday values for US and CME; **after** shows Monday. Paste the latest-bar date per view for both.

Also run the same check with the **real** capture time (16:10 CT, both files' true `mtime`) as a second case. The expected result is the same as at 12:00 CT, because CME and US yields close at 16:30 CT.

---

## 3. Then complete Phase 2 as specified

Follow the original Phase 2, the Phase 0 decisions document, and the Phase 1 rulings (R1 `viewAsOf` definition). **STOP after Phase 2.** The gate report includes:

- The state confirmation from section 1.
- The section 2 evidence, for both capture times.
- The all-`NULL` identity diff: all 76 baseline responses byte-identical after the reader changes, on the frozen copy.
- The single- vs multi-group classification for all 18 readers, and the cross-request alignment list.
- Before/after timings for the three heaviest readers.
- The guard test, and server `tsc`/test output.

The harness and scratch files are throwaway. Keep them out of the repo, or delete them after use, and never stage them.

---

## Acceptance criteria

- The state is confirmed: Commit 1 is at HEAD, reader code is untouched before Phase 2 edits, and nothing besides the dev server touches the real database.
- At a 12:00 CT capture, single-group EZ and JP views show Tue 20 Oct, single-group US and CME views show Mon 19 Oct, and the Global Rates Summary shows Mon 19 Oct throughout.
- The 16:10 CT real-capture case gives the same result.
- All 76 baseline responses are byte-identical with all-`NULL` `captured_at`.
- All Phase 2 criteria from the earlier spec files hold, and every number is pasted from actual output.

## What not to break

- Commit 1. Do not amend or rewrite it.
- The real `fred_data.db`. All verification runs on temp copies only.
- The frozen baseline captures.
- Everything listed under "What not to break" in the earlier spec files.

## Out of scope

- Changing close times, the `viewAsOf` definition, or any Phase 1 code. If a Phase 2 finding seems to require it, stop and report.
- Committing harness or scratch files.
- Aligning across separate client requests (report only).
- UI changes and new dependencies.
