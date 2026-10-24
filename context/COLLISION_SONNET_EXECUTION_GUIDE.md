# Collision Engine — Sonnet Execution Guide (one stage per session)

**Read first, in this order:** this guide §1 → `COLLISION_ENGINE_PLAN.md` (the stage you run, plus §2–§4 and §9) → the rows of `COLLISION_REQUIREMENT_TRACEABILITY.md` for that stage → `COLLISION_SCIENTIFIC_MODELS.md` for any model you touch → `COLLISION_RISK_REGISTER.md` §3 for open decisions → `context/AI_WORKFLOW.md`, `TEAM_WORKFLOW.md`, `HANDOFF.md`, `STATUS.md`, `TASKS.md`.
**Specification:** `context/specs/COLLISION_PARTICLE_ENGINE_SPEC.md` (verbatim). If the plan and the specification disagree, **stop and report** (spec §16 rule 14).

## 1. Global rules (apply to every stage; not optional)
1. Run exactly one stage per session. Do not start the next stage, even if time remains.
2. Before editing: `git status`, `git worktree list`, `git branch -vv`, `git log --oneline -5`. If anything is uncommitted that you did not create, **stop and report**; never stash, reset, clean, rebase or force-push; never delete branches or worktrees.
3. Work on a dedicated branch `collision/stage-<n>-<topic>` created from the branch named in the stage's prerequisite (normally the previous stage's merged result). Prefer a separate worktree. Never commit to `main`, `feature/moons-system` or another person's branch. Do not merge or open a PR unless the owner tells you to in that session.
4. Inspect the actual code before editing a subsystem (spec §16 rule 1). Symbols cited in the plan were verified at `f2c2da3`; re-verify them — if one moved or changed meaning, stop and report.
5. **Never weaken a requirement or a model.** If a constant, equation or expected value cannot be sourced, mark it `incomplete`/[VERIFY] and stop at the checkpoint. Do not invent expected values; do not tune tolerances to pass (TEAM_WORKFLOW).
6. Existing tests may change only if the stage explicitly lists the change as an approved contract change. Any other existing-test failure is a regression: fix the code, or stop and report.
7. No new dependency unless the stage says so (none do; numpy is DQ-5). No hydrodynamics code or dependency, ever, unless the owner changes scope.
8. Keep physics, integration, persistence, rendering and performance tests in separate test modules (spec §10.7).
9. Every claim of "passes" comes from a run you saw; report exact counts, failures, skips. Distinguish baseline failures (plan §0: Playwright browsers missing locally) from new ones.
10. End of session per `AI_WORKFLOW.md`: update `STATUS.md`, `TASKS.md`, append `WORKLOG.md`, rewrite top of `HANDOFF.md`, append `DECISIONS.md` for any accepted decision, update the traceability status column (`VERIFIED <test id>` only for tests you ran).

**Standard verification commands** (from the repository root of your worktree; use the project venv interpreter):
```bash
python -m pytest -q
```
```bash
cd frontend && npm run typecheck && npx vitest run && npm run build
```
```bash
cd frontend && npx playwright test
```
(Playwright needs browsers; if they are missing locally, say so and rely on CI — do not install them without the owner's approval.)

**Evidence every stage returns** (template):
```
Stage: <n> <name>   Branch: <branch> @ <sha>   Base: <sha>
Files changed: <list, new vs modified>
Tests: pytest <passed>/<failed>/<skipped> (baseline 567 passed); vitest <n> (baseline 433); build <ok/fail>; playwright <result or "not run: browsers missing">
New tests: <names>  Stage acceptance criteria: <each criterion → evidence>
Traceability rows moved to VERIFIED: <ids>
Decisions used / still open: <DQ ids>
Deviations from plan: <none | list with reason>   Known limitations: <list>
Docs updated: <list>   Not done: <list>
```

## 2. Stage instruction blocks
Each block is self-contained: paste it as the session prompt together with "Follow COLLISION_SONNET_EXECUTION_GUIDE.md §1".

---
### Stage 0 — Governance, contracts and configuration
```
Implement Stage 0 of context/COLLISION_ENGINE_PLAN.md (§6 Stage 0, contracts §4).
Prerequisites (check, else stop): owner answers to DQ-1, DQ-2, DQ-12, DQ-14 recorded in this session or in DECISIONS.md.
Scope: new backend/impact/{__init__,contracts,config}.py; tests/impact/__init__.py, tests/impact/test_contracts.py;
docs: DECISIONS.md (append D-033 collision-engine architecture, status as approved by owner), ARCHITECTURE.md ([Proposed] section),
API_CONTRACT.md ("Planned: collision engine" subsection), PROJECT_BRIEF.md only if DQ-1 approved.
Do NOT import backend.impact from any existing module. No behaviour change.
Tasks: frozen dataclasses for every schema in plan §4 with schemaVersion, to_json/from_json (canonical, sorted keys),
validation (finite floats, positive masses, unit quaternions ±1e-12, layer fractions sum 1±1e-12), fidelity enum,
CollisionConfig with defaults of plan §4.1, canonical SHA-256 digest helper.
Tests: JSON round trip identical for every contract; invalid inputs rejected; digest of a fixed object equals a
hard-coded hex computed independently in the test (hashlib on the literal canonical string).
Acceptance: pytest = 567 + new, all passing; vitest 433; build OK; `git grep "backend.impact" backend/ | grep -v backend/impact` empty.
```

---
### Stage 1 — Deferred resolution, impact capture, event identity (legacy outcome only)
```
Implement Stage 1 of context/COLLISION_ENGINE_PLAN.md (§3.4, §3.5, §6 Stage 1).
Prerequisites: Stage 0 merged. Before changing simulation.py, record GOLDEN values: run the unchanged code on the
P-003 stress scenarios (tests/test_stress_p003.py setups) and the spike sweep; store event fields
(simulationTimeS, resultMassKg, relativeSpeedMPerS, kineticEnergyLostJ, spinAddedKgM2PerS) as literals in
tests/impact/test_deferred_equivalence.py with a comment naming the commit that produced them.
Scope: new backend/impact/{detection,geometry,records,engine}.py, models/{base,perfect_merge}.py;
modify backend/simulation.py (_init_state, _advance_to, _capture/_restore, _checkpoint/_rollback, _record_merge,
_new_sim/_adopt_sim) and backend/collisions.py (docstring + legacy wrapper only).
Rules: the REBOUND callback only records and calls stop(); NEVER add/remove particles inside it (probe P3).
Every candidate is resolved before integrate resumes (probe P2). Resolution order: sort by
(estimatedContactTimeS, min id, max id). Merger Event shape and values unchanged.
Tests: T/eqv golden equality ≤1e-12 rel (if an internal-step shift moves simulationTimeS, STOP at CP-1 and report
the measured differences — do not loosen silently); T/geo analytic straight-line fixtures (contact distance 1e-9 rel,
b = 0/0.5/0.9, contact point on both surfaces); T/det fast impact detected once, 4 simultaneous pairs deterministic over
20 insertion orders, pause/resume and time-scale equivalence, injected resolver failure rolls back.
Performance: collision-free step(1e5 s) at N=50/100/200 within +10% of 0.034/0.121/0.339 s (same machine; report numbers).
Acceptance: all 567 existing tests pass unchanged; new tests pass; CP-1 evidence table returned. STOP after CP-1 report.
```

---
### Stage 2 — Materials, spin, orientation
```
Implement Stage 2 of context/COLLISION_ENGINE_PLAN.md (§4.2–4.4, §6 Stage 2).
Prerequisites: Stage 1 merged and CP-1 accepted.
Scope: new backend/impact/{materials,rotation}.py, material_profiles.json, backend/api_collisions.py (GET /api/v1/materials);
modify backend/models.py (optional fields only), backend/simulation.py (side tables + every capture/restore/snapshot/derive path,
_digest includes new fields ONLY when non-default), backend/diagnostics.py (v2 additive; v1 fields identical),
backend/api_universes.py, backend/main.py; frontend api/types.ts, api/parse.ts (optional fields) + tests; API_CONTRACT.md.
Material numbers: ONLY values with a citation from COLLISION_SCIENTIFIC_MODELS.md §2/§5; anything else → profile marked
incomplete. No profile is derived from bodyType.
Tests: T/mat (validation, provenance required, 422 material_invalid via API); T/rot (unit quaternion after 1e6 updates 1e-12,
round trip 1e-12, site returns after one period 1e-9); persistence of new state through _capture/_restore, _checkpoint/_rollback,
snapshot restore, reset, from_snapshot (bitwise); digests of existing presets/universes unchanged vs values computed at f2c2da3.
Acceptance: REG green; new tests pass; frontend still parses old and new state.
```

---
### Stage 3 — Outcome models and selector (pure)
```
Implement Stage 3 of context/COLLISION_ENGINE_PLAN.md (§3.6, §6 Stage 3) using COLLISION_SCIENTIFIC_MODELS.md §4.
Prerequisites: Stage 0 merged; owner answers to DQ-7 (c* class rule), DQ-8 (gas-giant handling, envelope threshold) and
DQ-9 (strength regime) — else STOP.
Prerequisite CP-SCI-1: before coding any constant, transcribe each equation/constant marked [VERIFY] from the primary paper
(equation number + page) into COLLISION_SCIENTIFIC_MODELS.md, and obtain an independent re-derivation (DQ-14 reviewer or a
second model, logged in WORKLOG.md). Resolve: LS12 worked example (5.3 vs ≈3.35 J/kg), b_crit check value (0.66 vs 0.683),
Q'*_RD exponent form, Genda 2012 coefficients, HH11 Table 3, BA99 constants (only if DQ-9 = include). If any item cannot be
resolved: STOP and report; do not code around it.
Scope: new backend/impact/models/{ls12,cratering,envelope}.py, backend/impact/selector.py, tests/impact/{test_ls12,test_cratering,
test_envelope,test_selector}.py, tests/impact/reference_values.py (values typed from the papers with citations; authored or checked
by the independent reviewer). Pure functions only: no REBOUND, no SimulationService import.
Tests: universal-law identities; super-catastrophic continuity/documented step at 1.8; mass-ratio correction table;
G12 boundary points; α limits; HH11 examples; monotonicity; c* sensitivity; selector branch coverage incl. Unsupported and
gas targets never reaching LS12; a dummy OutcomeModel passes through the selector API unchanged (extension test).
Acceptance: all reference reproductions within stated precision; CP-SCI-1 sign-off recorded; REG green.
May run in parallel with Stages 1–2 (new files only).
```

---
### Stage 4 — Atomic application and conservation
```
Implement Stage 4 of context/COLLISION_ENGINE_PLAN.md (§3.7, §4.6–4.9, §9, §6 Stage 4).
Prerequisites: Stages 1–3 merged; CP-1 and CP-SCI-1 accepted; DQ-2 and DQ-13 answered.
Scope: new backend/impact/{applier,conservation}.py; modify engine.py, backend/simulation.py (outcome-v1 wiring),
backend/models.py (Event union merger|collision), backend/errors.py; frontend api/types.ts, api/parse.ts, sim/viewModel.ts,
components/ui/EventTimeline.tsx in the SAME branch (the UI must accept the new event type before the backend emits it).
In this stage debris mass goes into ONE parcel per event (full fragmentation is Stage 5).
Rules: validate the entire result before any mutation; identity table plan §3.7; failure table plan §9.3 row by row;
legacy-merge mode stays bit-for-bit.
Tests: T/app scenarios per outcome class (regime asserted from the model, never hard-coded); T/cons tolerances plan §9.2;
injected invalid result → state byte-identical (helpers.dump); id uniqueness over 1,000 events; hit-and-run then 10 orbits
without spurious contact; parse.ts accepts collision events and still rejects unknown types.
Acceptance: REG green (legacy events unchanged); new tests pass.
```

---
### Stage 5 — Fragmentation and bounded debris
```
Implement Stage 5 of context/COLLISION_ENGINE_PLAN.md (§3.9, §6 Stage 5).
Prerequisites: Stage 4 merged; DQ-4, DQ-5, DQ-6 answered (CP-2).
Scope: new backend/impact/fragments.py; modify engine.py, applier.py, backend/simulation.py (parcel meta, body-cap reserve),
backend/models.py (representation, debris fields), tests.
Rules: masses from the LS12 power law, largest first, budgets of plan §4.1/§9.4; never identical fragments with uniformly
random motion; non-overlapping placement; one momentum closure on the largest remnant (reject if its relative size exceeds
the momentum tolerance scale); seeds per plan §3.9; overflow chain parcels → nearest parcel → remnant with warning.
Tests: T/frag (sum exactness, power-law recovery, no overlap, speed range, determinism same/different seed, overflow at
MAX_BODIES), T/scn D within envelope with conservation.
Acceptance: REG green; new tests pass; budgets visible in diagnostics.
```

---
### Stage 6 — Localized damage and propagation
```
Implement Stage 6 of context/COLLISION_ENGINE_PLAN.md (§3.8, §4.7, §6 Stage 6), model per COLLISION_SCIENTIFIC_MODELS.md §4.8.
Prerequisites: Stages 2 and 4 (and 5 for ejecta parcels) merged.
Scope: new backend/impact/damage.py; modify engine.py, applier.py, backend/simulation.py (surface table in all state paths),
backend/api_collisions.py (GET /api/v1/universes/{uid}/bodies/{id}/surface); API_CONTRACT.md.
Rules: sites in body-local coordinates; propagation changes NO mass/momentum; labelled approximation, never "shock";
disruption supersedes sites. Missing wave speed → static site (documented fallback).
Tests: T/dmg south-pole fixture (latitude −90° ±1e-6°, half-rotation alignment 1e-9, antipode arrival πR/c_eff ±1e-9 rel,
zero antipodal intensity before arrival, exact mass/momentum invariance); T/scn A backend part.
Acceptance: REG green; new tests pass.
```

---
### Stage 7 — Debris lifecycle, reaccretion, secondary impacts
```
Implement Stage 7 of context/COLLISION_ENGINE_PLAN.md (§3.10, §6 Stage 7).
Prerequisites: Stages 5–6 merged; DQ-10 answered.
Scope: new backend/impact/lifecycle.py; modify engine.py, records.py (parent/root/generation), backend/simulation.py
(post-commit classification, escape ledger), backend/diagnostics.py (ledger in totals); API_CONTRACT.md (advancedS note if DQ-10=a).
Tests: T/life (bound/escape by exact two-body energy sign; reaccretion produces child event with parent link; cascade stops at
maxFragmentingGeneration; maxResolutionsPerStep behaviour; escape removal keeps represented mass to 1e-15 rel);
T/scn E with the solar-system-moons-j2000 preset (structural assertions + conservation; no hand-tuned trajectory).
Acceptance: REG green (moons preset validation unchanged); new tests pass.
```

---
### Stage 8 — Records API, inspection, replay
```
Implement Stage 8 of context/COLLISION_ENGINE_PLAN.md (§3.11, §4.9–4.10, §6 Stage 8).
Prerequisites: Stage 7 merged.
Scope: backend/api_collisions.py (GET collisions list/detail, POST {id}/replay dry-run), records.py, visual.py;
frontend components/ui/CollisionInspector.tsx (new), sim/collision/describe.ts (new), EventTimeline.tsx, api/{client,parse,types}.ts.
Rules: replay never mutates state; UI text only from API fields; fidelity labels always shown.
Tests: T/rec (every §10.2 field present; replay digest identical for 50 events; replay after restore identical; revision and
dump unchanged after replay); vitest for describe/inspector.
Acceptance: REG green; new tests pass.
```

---
### Stage 9 — Particle engine and event visualization
```
Implement Stage 9 of context/COLLISION_ENGINE_PLAN.md (§3.12, §6 Stage 9).
Prerequisites: Stage 8 merged; CP-3 (owner approves the UI-0 boundary change; DECISIONS entry) and DQ-12 answered.
Scope: frontend render/contract.ts (CollisionEffectInput, SurfaceMarkInput), components/canvas/UniverseCanvas.tsx (two optional
props, conditional layers), canvasBoundary.test.ts (pinned list updated — the ONLY approved existing-test change),
CelestialBody.tsx (orientation only when present), new CollisionEffectsLayer.tsx, DebrisParticles.tsx, SurfaceMarks.tsx,
new pure sim/collision/{effectTimeline,debrisSampling,materialAppearance,effectBudget}.ts + tests, UniverseWorkspace.tsx wiring,
e2e/collision-effects.spec.ts (stubbed API via e2e/universeLayer.ts pattern).
Rules: renderer reads only VisualEventDescription + body states; mass-bearing visuals keyed to displayed simulation time;
visual particles carry no mass; caps ≤8 sequences, ≤20,000 particles; LOD never changes any displayed physical number.
Tests: vitest (cratering never shows disruption phases; pause freezes; time scale; history seek replays; caps; determinism);
E2E stub sequence; manual WebGL check of Scenario A alignment recorded with screenshots.
Acceptance: REG green; boundary test updated only as approved; new tests pass.
```

---
### Stage 10 — Persistence, isolation, determinism hardening
```
Implement Stage 10 of context/COLLISION_ENGINE_PLAN.md (§3.13, §9.5, §6 Stage 10).
Prerequisites: Stage 9 merged (or Stage 8 if frontend runs separately); DQ-11 answered.
Scope: backend/simulation.py (CollisionState serialisation with schemaVersion), backend/orbit_lab.py (derive copies state),
tests/impact/{test_persistence,test_isolation}.py.
Tests: snapshot→collisions→restore→bitwise continuation; two universes share nothing (is not on every side table; dumps
unchanged); Orbit Lab derive; JSON round trip; pre-stage-2-shaped snapshot restores with empty state.
Acceptance: REG green; new tests pass.
```

---
### Stage 11 — Sourced material annotation of presets (only if DQ-3 = yes)
```
Implement Stage 11 of context/COLLISION_ENGINE_PLAN.md. Prerequisite: DQ-3 = yes, reviewer named.
Scope: backend/presets/data/*.json (optional material per body), backend/presets/loader.py (validation), context/PRESETS.md,
tests/validation additions. Every value cited; no value inferred from bodyType or name.
Acceptance: tests/validation/* trajectories bit-identical (materials do not affect gravity); new provenance tests pass.
If DQ-3 = no: do nothing; record the skip in TASKS.md.
```

---
### Stage 12 — Scenarios A–H, performance, Definition of Done
```
Implement Stage 12 of context/COLLISION_ENGINE_PLAN.md (§7, §6 Stage 12).
Prerequisites: Stages 0–10 (and 11 or its recorded skip) merged.
Scope: tests/impact/test_scenarios_e2e.py, tests/impact/test_performance.py, frontend e2e specs; every context doc;
traceability status column.
Tests: Scenarios A–H per plan §7; performance criteria of Stage 12; full regression; report baseline-vs-new failures separately.
Acceptance (CP-5): every traceability row VERIFIED with a test id or listed as an owner-approved limitation; DoD §17 items
each with evidence. Then report; do not open a PR unless told to.
```

## 3. Stop conditions (any stage)
Stop and report immediately if: uncommitted work you did not create exists; a cited symbol/file does not match the plan; a constant or expected value cannot be sourced; an existing test fails for a reason other than an approved contract change; a requirement in the specification conflicts with the plan; a needed decision (DQ-n) is unanswered; the stage would need a new dependency; any change would touch hydrodynamics.
