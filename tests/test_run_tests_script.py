"""scripts/run_tests.py: the pure decision helpers (no subprocess is started). The runner is the canonical entry point, so a
mistake here would let a bad environment or a dirtied tree look like a pass."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("run_tests", ROOT / "scripts" / "run_tests.py")
rt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rt)


def test_python_version_is_declared_once_and_matches_ci():
    assert rt.pinned_python() == "3.11"
    ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    assert "python-version-file: .python-version" in ci and 'python-version: "' not in ci


def test_python_matches_compares_major_minor_only():
    assert rt.python_matches("3.11", (3, 11)) and not rt.python_matches("3.11", (3, 12)) and not rt.python_matches("3.11", (3, 10))


def test_constraints_are_parsed_and_names_normalised():
    pins = rt.parse_constraints("# c\nPyYAML==6.0.3\npydantic-core==2.50.1  # x\n\nnot-a-pin>=1\n")
    assert pins == {"pyyaml": "6.0.3", "pydantic-core": "2.50.1"}


def test_mismatch_is_reported_but_a_missing_platform_extra_is_not():
    pins = {"fastapi": "0.162.0", "uvloop": "0.23.0", "rebound": "5.2.2"}
    installed = {"fastapi": "0.111.0", "rebound": "5.2.2"}.get
    assert rt.constraint_mismatches(pins, installed) == ["fastapi: installed 0.111.0, constraints.txt pins 0.162.0"]


def test_repository_constraints_file_parses_and_pins_the_core_packages():
    pins = rt.parse_constraints((ROOT / "backend" / "constraints.txt").read_text(encoding="utf-8"))
    assert {"fastapi", "pydantic", "starlette", "rebound", "uvicorn", "httpx", "pytest"} <= set(pins)


def test_only_tracked_changes_count_as_dirty():
    out = " M context/evidence/stage9-webgl/mark-identity.png\n?? scratch.txt\nA  new.py\n"
    assert rt.tracked_changes(out) == {"context/evidence/stage9-webgl/mark-identity.png", "new.py"}


def test_browser_spec_does_not_write_tracked_evidence_by_default():
    spec_text = (ROOT / "frontend" / "e2e" / "collision-effects.spec.ts").read_text(encoding="utf-8")
    assert "PG_UPDATE_EVIDENCE" in spec_text and "outputPath(" in spec_text
    assert "page.screenshot({ path: file" not in spec_text
