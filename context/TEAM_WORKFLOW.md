# Team Workflow
Working agreement for four humans using different AI models/accounts. Complements `AI_WORKFLOW.md` (the per-session protocol).

## Ownership (initial; anyone may review anywhere)
| Area | Owner | Primary paths |
|---|---|---|
| Engine integration, API contracts, numerical validation | Project lead | `backend/` engine/API code, `context/DECISIONS.md` |
| Collision, merger, conservation, tidal physics + validation tests | Vaibhav | physics tests/derivations under `tests/`, `context/PHYSICS_SPIKE.md` results |
| Three.js scene, camera, controls, UI | Frontend dev | `frontend/` |
| Test infra, events/checkpoints, integration, docs, demo | Integration/testing dev | `tests/` infrastructure, CI, `README.md`, `context/` hygiene |

## Avoiding conflicting edits
- One owner per file at a time. Before editing a file you don't own, tell the owner (chat) or work through a PR they review.
- Shared files (`STATUS.md`, `HANDOFF.md`, `TASKS.md`, `WORKLOG.md`): edit only your own section/row/entry, pull right before editing, keep edits small. `WORKLOG.md` is append-only; `DECISIONS.md` is append-only.
- Prefer new files per experiment (e.g. `tests/spike/test_two_body.py`) over editing someone else's.

## Git
- `main` must always be runnable and its tests passing. Don't push directly to `main` for code; docs-only fixes to context files may go direct if tests are unaffected.
- Branches: `<area>/<short-topic>`, e.g. `physics/m0-harness`, `validation/m0-two-body`, `frontend/scene-skeleton`.
- Small commits, imperative messages with a prefix (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- Pull/rebase your own branch on `main` before opening a PR. Pull requests need one reviewer from another area and passing tests (`pytest`, `npm run build`).
- Never force-push shared branches or rewrite shared history; never discard others' changes. Not every AI session needs a commit; every meaningful session needs updated context files and a handoff.

## Interface changes
Changes to API shapes, units, coordinate conventions, or engine interface: (1) propose in `DECISIONS.md` with status `proposed`, (2) notify everyone who consumes it, (3) mark `accepted` only after the consumers agree, (4) update `ARCHITECTURE.md`. Breaking changes land in a PR that updates all consumers or clearly lists what's left.

## Review and testing
- Physics changes need an independent check (different person re-derives or re-runs the expected values). Do not tune parameters or tolerances just to make a test pass; investigate and record discrepancies.
- AI-written code is reviewed like any other. Every claim of "passes" must come from a test run you saw.

## Updating shared context
At the end of each meaningful session follow `AI_WORKFLOW.md`: update `STATUS.md`/`TASKS.md`, append `WORKLOG.md`, refresh `HANDOFF.md`, record decisions. If two people's handoffs conflict, the latest merged `main` plus the test results win; reconcile in the PR.

## When blocked or the AI is wrong
- Blocked: set the task to `blocked` in `TASKS.md` with the reason and who can unblock it; message them; switch to another task.
- AI output seems wrong: reproduce with a minimal test, check against a hand calculation or a second person/model, and log the discrepancy in `WORKLOG.md`. If it affects a decision, reopen it in `DECISIONS.md`. Do not paper over it.
