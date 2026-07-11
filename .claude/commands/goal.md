---
description: Execute the VNG grand plan (all phases, or specific ones like "phase-2" / "2,3")
argument-hint: [phase(s) to run, e.g. "1" or "2,3" — empty = all in order]
---

Read `VNG_GRAND_PLAN.md` at the repo root and execute it.

Scope: $ARGUMENTS
- If no arguments were given: execute ALL phases in the "Suggested execution order" —
  phases whose contracts are independent may run as parallel subagents, but respect the
  stated dependencies (adapters need Phase 2's endpoints; Phase 6 is always last).
- If phase numbers were given: execute exactly those phases.

Rules of engagement:
1. The plan's **contracts (API shapes, TS interfaces, file paths) are binding.** If
   reality forces a deviation, update `VNG_GRAND_PLAN.md` in the same commit and note it.
2. A phase is done only when **every acceptance-criteria checkbox passes** — run the
   listed commands/tests and show their output. Tick the boxes in the plan file as you go.
3. Respect the non-negotiables section (LLM never computes stats; everything demos with
   MiroShark down; MiroShark contract-first conventions; `~/mirovenv` python on Windows).
4. Costly steps (real simulation runs, ~$1–2 each): run the Phase-1 validation run and
   the Phase-6 hero bake at most once each without asking; ask before any additional
   paid runs.
5. Work on a feature branch per repo (`feat/vng-experiments-api` in MiroShark,
   `feat/agent-world` in AABW), commit per completed phase with conventional-commit
   messages. Do not push unless asked.
6. Before starting, read `MiroShark/docs/VNG_AB_STATUS.md` and `MiroShark/CLAUDE.md` for
   current state and conventions; check `git log --oneline -5` in both repos in case
   work has progressed since the plan was written.
7. Finish with a status report: per-phase checklist state, what's demo-ready, what's
   blocked and why, and exact commands to launch the demo.
