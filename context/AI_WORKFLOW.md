# AI Workflow Protocol (mandatory)
Applies to every AI model and every person using one. Team-level rules (ownership, branches, PRs): `TEAM_WORKFLOW.md`. Current milestone: M0 in `TASKS.md` / `PHYSICS_SPIKE.md`.

## Start of session
1. Read `context/HANDOFF.md`, `STATUS.md`, `TASKS.md`.
2. Read relevant parts of `PROJECT_BRIEF.md`, `ARCHITECTURE.md`, `DECISIONS.md`.
3. Inspect the actual repo and `git status` before changing anything.
4. Identify the task, acceptance criteria and relevant tests.
5. Check for others' uncommitted changes; never overwrite or discard them.

## During the session
- Work only on the agreed task; make small, understandable changes.
- Follow accepted decisions/contracts; if one must change, explain why and update the docs.
- Run relevant tests and read the real results. Never claim a test passed unless it ran successfully.
- Don't silently broaden scope or rewrite unrelated files.

## End of session
1. Inspect the diff; run tests/checks.
2. Update every materially affected context file.
3. Update `STATUS.md` (actual state) and `TASKS.md`.
4. Append a concise entry to `WORKLOG.md` (never rewrite old entries).
5. Rewrite the top of `HANDOFF.md` for the next person.
6. Record newly accepted decisions in `DECISIONS.md` (append-only).
7. Check the docs agree with the code and test results.
8. Report files changed, test outcomes, risks and a suggested next action.

If the session ends unexpectedly, leave the best handoff and mark anything unverified.

## Git rules
- Never commit secrets, keys, tokens, credentials or `.env`.
- Never overwrite another person's work; never force-push or rewrite shared history without explicit authorization.
- Commit only verified, coherent milestones; don't push untested work.
- If GitHub is unavailable, keep the local repo intact and report what remains.

Context files are shared memory, not a substitute for tests or review.
