#!/usr/bin/env python3
"""The canonical test entry point:  python scripts/run_tests.py

Runs, in this order, and stops at the first failure (exit status 1):

  required:  environment check -> backend pytest -> frontend typecheck -> vitest -> production build
             -> Playwright E2E (stubbed API) -> "no tracked file was modified by the run"
  extended (only with --extended): the two real-backend browser journeys (collision, Experiment 01)

Nothing is skipped silently: a stage that cannot start (missing interpreter version, packages that differ from
backend/constraints.txt, missing node_modules, missing browser) FAILS with the command that fixes it. The summary lists every
stage as PASS / FAIL / NOT RUN, and exit status 0 means every required stage ran and passed.

Prerequisites (see README "Test"):
  * Python == .python-version with `pip install -r backend/requirements.txt -c backend/constraints.txt` in the active environment
  * Node == .nvmrc (20) and `npm ci` in frontend/   (`--install` does both installs for you)
  * Playwright's Chromium (`npx playwright install chromium`) or an installed Chrome/Chromium in PW_CHROMIUM_PATH
    (the extended journeys read E2E_CHROMIUM instead; this script forwards PW_CHROMIUM_PATH to it when only that is set)

Options:  --install  install pinned dependencies first;  --only backend|frontend|e2e;  --extended;  --list
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import time
from importlib import metadata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


def pinned_python() -> str:
    """major.minor from .python-version (the single declaration; CI reads the same file)."""
    return (ROOT / ".python-version").read_text(encoding="utf-8").strip()


def pinned_node_major() -> int:
    """Node major from .nvmrc (the single declaration; CI reads the same file)."""
    return int((ROOT / ".nvmrc").read_text(encoding="utf-8").strip().lstrip("v").split(".")[0])


def node_major(output: str) -> int:
    """`node --version` output ("v20.20.2") -> 20."""
    return int(output.strip().lstrip("v").split(".")[0])


def python_matches(version: str, running: tuple = tuple(sys.version_info[:2])) -> bool:
    major, minor = (int(p) for p in version.split(".")[:2])
    return running == (major, minor)


def parse_constraints(text: str) -> dict:
    """`name==version` lines of a constraints file -> {normalised name: version}."""
    pins = {}
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        m = re.fullmatch(r"([A-Za-z0-9_.\-]+)==([^\s;]+)", line)
        if m:
            pins[re.sub(r"[-_.]+", "-", m.group(1)).lower()] = m.group(2)
    return pins


def constraint_mismatches(pins: dict, installed) -> list:
    """Installed packages whose version differs from the pin. A pinned package that is not installed is fine (platform extras
    such as uvloop); the check is about what IS installed, which is what runs the tests."""
    bad = []
    for name, want in sorted(pins.items()):
        have = installed(name)
        if have is not None and have != want:
            bad.append(f"{name}: installed {have}, constraints.txt pins {want}")
    return bad


def _installed(name: str):
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None


def tracked_changes(porcelain: str) -> set:
    """Paths of tracked files that `git status --porcelain` reports as modified/deleted/etc. (untracked '??' lines excluded)."""
    return {line[3:] for line in porcelain.splitlines() if line and not line.startswith("??")}


def _git_porcelain() -> str:
    return subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True, check=True).stdout


def _npm() -> str:
    return shutil.which("npm") or shutil.which("npm.cmd") or "npm"


class Stage:
    def __init__(self, name: str, group: str, run, required: bool = True):
        self.name, self.group, self.run, self.required = name, group, run, required
        self.status, self.seconds = "NOT RUN", 0.0


def _cmd(argv, cwd=ROOT, env=None):
    def go() -> bool:
        print(f"\n$ ({cwd.relative_to(ROOT) if cwd != ROOT else '.'}) {' '.join(argv)}", flush=True)
        return subprocess.run(argv, cwd=cwd, env=env).returncode == 0
    return go


def _env_check() -> bool:
    ok = True
    want = pinned_python()
    if not python_matches(want):
        print(f"FAIL: Python {sys.version_info[0]}.{sys.version_info[1]} is running, .python-version requires {want}.")
        ok = False
    bad = constraint_mismatches(parse_constraints((ROOT / "backend" / "constraints.txt").read_text(encoding="utf-8")), _installed)
    if bad:
        print("FAIL: installed packages differ from backend/constraints.txt:\n  " + "\n  ".join(bad))
        print("  fix: pip install -r backend/requirements.txt -c backend/constraints.txt")
        ok = False
    if not (FRONTEND / "node_modules").is_dir():
        print("FAIL: frontend/node_modules is missing.  fix: (cd frontend && npm ci)")
        ok = False
    if shutil.which("node") is None:
        print("FAIL: node is not on PATH.")
        ok = False
    else:
        have = node_major(subprocess.run(["node", "--version"], capture_output=True, text=True).stdout)
        if have != pinned_node_major():
            print(f"FAIL: Node {have} is running, .nvmrc requires {pinned_node_major()}.  fix: nvm use (or fnm/volta use 20)")
            ok = False
    if ok:
        print(f"environment ok: Python {want}, constrained packages match, frontend dependencies installed")
    return ok


def _tracked_clean_stage(before: set):
    def go() -> bool:
        changed = tracked_changes(_git_porcelain()) - before
        if changed:
            print("FAIL: the test run modified tracked files (tests must write artifacts to ignored paths):\n  " + "\n  ".join(sorted(changed)))
        else:
            print("no tracked file was modified by the run")
        return not changed
    return go


def build_stages(args) -> list:
    py = sys.executable
    npm = _npm()
    env = dict(os.environ)
    # The Node journeys read E2E_CHROMIUM, Playwright reads PW_CHROMIUM_PATH; one browser setting should serve both.
    if env.get("PW_CHROMIUM_PATH") and not env.get("E2E_CHROMIUM"):
        env["E2E_CHROMIUM"] = env["PW_CHROMIUM_PATH"]
    before = tracked_changes(_git_porcelain())
    stages = []
    if args.install:
        stages += [Stage("install backend dependencies", "setup", _cmd([py, "-m", "pip", "install", "-r", "backend/requirements.txt", "-c", "backend/constraints.txt"])),
                   Stage("install frontend dependencies (npm ci)", "setup", _cmd([npm, "ci"], FRONTEND))]
    stages.append(Stage("environment check", "setup", _env_check))
    stages += [
        Stage("backend: pytest", "backend", _cmd([py, "-m", "pytest", "-q", "-p", "no:cacheprovider"], env=env)),
        Stage("frontend: typecheck", "frontend", _cmd([npm, "run", "typecheck"], FRONTEND, env)),
        Stage("frontend: vitest", "frontend", _cmd([npm, "test"], FRONTEND, env)),
        Stage("frontend: production build", "frontend", _cmd([npm, "run", "build"], FRONTEND, env)),
        Stage("browser: Playwright E2E (stubbed API)", "e2e", _cmd([npm, "run", "test:e2e"], FRONTEND, env)),
    ]
    if args.extended:
        stages += [Stage("browser: real-backend collision journey", "e2e", _cmd([npm, "run", "e2e:collision"], FRONTEND, env)),
                   Stage("browser: Experiment 01 journey", "e2e", _cmd([npm, "run", "e2e"], FRONTEND, env))]
    stages.append(Stage("no tracked file modified by the run", "setup", _tracked_clean_stage(before)))
    if args.only:
        stages = [s for s in stages if s.group in (args.only, "setup")]
    return stages


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--install", action="store_true", help="install pinned backend and frontend dependencies first")
    ap.add_argument("--only", choices=["backend", "frontend", "e2e"], help="run one group (setup checks always run)")
    ap.add_argument("--extended", action="store_true", help="also run the two real-backend browser journeys")
    ap.add_argument("--list", action="store_true", help="print the stages and exit")
    args = ap.parse_args(argv)
    stages = build_stages(args)
    if args.list:
        for s in stages:
            print(f"{s.group:9s} {s.name}")
        return 0
    failed = False
    for s in stages:
        if failed:
            break
        t0 = time.time()
        try:
            ok = s.run()
        except Exception as exc:  # noqa: BLE001 -- a crashed stage is a failed stage, never a skipped one
            print(f"FAIL: {type(exc).__name__}: {exc}")
            ok = False
        s.seconds, s.status = time.time() - t0, "PASS" if ok else "FAIL"
        failed = not ok
    print("\n" + "=" * 70)
    for s in stages:
        print(f"{s.status:8s} {s.seconds:7.1f}s  {s.name}")
    print("=" * 70)
    not_run = [s for s in stages if s.status == "NOT RUN"]
    if failed or not_run:
        print("RESULT: FAILED" + (f" ({len(not_run)} stage(s) not run because an earlier stage failed)" if not_run else ""))
        return 1
    print("RESULT: all stages passed" + ("" if args.extended else " (extended real-backend journeys were not requested)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
