"""API-only end-to-end smoke test against a REAL uvicorn process over real HTTP.

What this is: the backend started exactly as documented (`python -m uvicorn backend.main:app`), driven with httpx
through the user-visible journey: health, create bodies, inspect, step, merger + events, edit, delete, reset, error
statuses. What it is NOT: a browser test. It does not load the React app, the Vite proxy or Three.js; those are
covered by vitest (component/unit level) and by the manual browser journey recorded in context/STATUS.md.
"""
import socket
import subprocess
import sys
import time

import httpx
import pytest


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def launch(port: int | None = None):
    """Starts the backend exactly as documented; returns (process, base url) once /healthz answers."""
    port = port or free_port()
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", str(port),
         "--log-level", "warning"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    base = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            pytest.fail(f"server exited early: {proc.stdout.read()}")
        try:
            if httpx.get(f"{base}/healthz", timeout=1).status_code == 200:
                return proc, base
        except httpx.HTTPError:
            time.sleep(0.1)
    proc.kill()
    pytest.fail("server did not become healthy within 30 s")


def stop(proc) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


@pytest.fixture(scope="module")
def server():
    proc, base = launch()
    try:
        yield base
    finally:
        stop(proc)


def body(name, m, r, x, vx=0.0):
    return {"name": name, "massKg": m, "radiusM": r, "positionM": {"x": x, "y": 0.0, "z": 0.0},
            "velocityMPerS": {"x": vx, "y": 0.0, "z": 0.0}, "colorHex": "#44aaff"}


EMPTY_DIAGNOSTICS = {"version": 1, "totalMassKg": 0.0, "totalMomentumKgMPerS": {"x": 0.0, "y": 0.0, "z": 0.0}, "kineticEnergyJ": 0.0, "potentialEnergyJ": 0.0,
         "angularMomentumAboutOriginKgM2PerS": {"x": 0.0, "y": 0.0, "z": 0.0}, "bookedSpinKgM2PerS": {"x": 0.0, "y": 0.0, "z": 0.0}}


def test_full_api_journey_over_http(server):
    with httpx.Client(base_url=server, timeout=30) as c:
        assert c.get("/health").json() == {"status": "ok"}
        c.post("/api/v1/simulation/reset")
        state = c.get("/api/v1/simulation/state").json()
        assert state == {"status": "paused", "simulationTimeS": 0.0, "bodies": [], "diagnostics": EMPTY_DIAGNOSTICS}

        a = c.post("/api/v1/bodies", json=body("A", 2000.0, 1.0, -100.0, 1.0))
        b = c.post("/api/v1/bodies", json=body("B", 1000.0, 0.8, 100.0, -1.0))
        assert a.status_code == b.status_code == 201
        a, b = a.json(), b.json()
        assert c.post("/api/v1/bodies", json=body("overlap", 1.0, 1.0, -100.0)).status_code == 409
        assert c.post("/api/v1/bodies", json={**body("bad", 1.0, 1.0, 0.0), "massKg": -1}).status_code == 422

        out = c.post("/api/v1/simulation/step", json={"dtS": 50.0}).json()
        assert out["simulationTimeS"] == 50.0 and out["events"] == [] and len(out["bodies"]) == 2
        assert c.patch(f"/api/v1/bodies/{a['id']}", json={"name": "Alpha"}).json()["name"] == "Alpha"

        out = c.post("/api/v1/simulation/step", json={"dtS": 60.0}).json()  # contact at ~99 s
        assert [e["type"] for e in out["events"]] == ["merger"] and len(out["bodies"]) == 1
        assert out["bodies"][0]["id"] == a["id"] and out["bodies"][0]["massKg"] == 3000.0
        assert c.get("/api/v1/events").json() == {"events": out["events"]}
        assert c.delete(f"/api/v1/bodies/{b['id']}").status_code == 404  # absorbed

        assert c.post("/api/v1/simulation/step", json={"dtS": 0}).status_code == 422
        assert c.delete(f"/api/v1/bodies/{a['id']}").status_code == 204
        assert c.post("/api/v1/simulation/reset").json()["bodies"] == []
        assert c.get("/api/v1/events").json() == {"events": []}


def test_symmetric_three_body_line_does_not_hang_the_server(server):
    """Regression for the REBOUND PRS23 stall: three equal masses at rest on a line used to block the process
    forever. The request must come back promptly and the server must keep answering afterwards."""
    with httpx.Client(base_url=server, timeout=30) as c:
        c.post("/api/v1/simulation/reset")
        for i in range(3):
            assert c.post("/api/v1/bodies", json={**body(f"q{i}", 3e12, 1.0, 0.0),
                                                  "positionM": {"x": 0.0, "y": 1000.0 * i, "z": 0.0}}).status_code == 201
        started = time.monotonic()
        r = c.post("/api/v1/simulation/step", json={"dtS": 300.0})
        assert r.status_code == 200 and time.monotonic() - started < 10
        assert c.get("/healthz").status_code == 200
        c.post("/api/v1/simulation/reset")


# ---------- Simulation Lab / Experiment 01 over real HTTP ----------
DAY = 86400.0
SOLAR = {"source": {"kind": "preset", "presetId": "solar-system-j2000"}, "activate": True}


def epoch(c) -> int:
    return c.get("/api/v1/universes").json()["activationEpoch"]


def test_universe_isolation_over_http(server):
    with httpx.Client(base_url=server, timeout=60) as c:
        c.post("/api/v1/universes/uni-default/activate")
        c.post("/api/v1/simulation/reset")
        c.post("/api/v1/bodies", json=body("A", 1e10, 1.0, 0.0))
        c.post("/api/v1/bodies", json=body("B", 1.0, 1.0, 1e5, 1.0))
        c.post("/api/v1/simulation/step", json={"dtS": 100.0})
        default_before = c.get("/api/v1/universes/uni-default/state").json()

        solar = c.post("/api/v1/universes", json=SOLAR)
        assert solar.status_code == 201
        sid = solar.json()["id"]
        e = epoch(c)
        for _ in range(3):
            assert c.post(f"/api/v1/universes/{sid}/step?activationEpoch={e}", json={"dtS": 432000.0}).status_code == 200
        solar_time = c.get(f"/api/v1/universes/{sid}/state").json()["simulationTimeS"]
        assert solar_time == 3 * 432000.0
        assert c.get("/api/v1/universes/uni-default/state").json() == default_before  # untouched while Solar advanced
        # the legacy routes act on the default universe and refuse while another one is active
        assert c.post("/api/v1/simulation/step", json={"dtS": 1.0}).status_code == 409

        c.post("/api/v1/universes/uni-default/activate")
        stale = c.post(f"/api/v1/universes/{sid}/step?activationEpoch={e}", json={"dtS": 1.0})
        assert stale.status_code == 409 and stale.json()["code"] in ("universe_not_active", "stale_activation")
        assert c.get(f"/api/v1/universes/{sid}/state").json()["simulationTimeS"] == solar_time  # retained exactly
        assert c.post("/api/v1/simulation/step", json={"dtS": 100.0}).status_code == 200  # legacy works again
        c.post(f"/api/v1/universes/{sid}/activate")
        assert c.get(f"/api/v1/universes/{sid}/state").json()["simulationTimeS"] == solar_time  # resumes at the same instant
        c.post("/api/v1/universes/uni-default/activate")
        assert c.delete(f"/api/v1/universes/{sid}").status_code == 204
        c.post("/api/v1/simulation/reset")


def test_history_over_http(server):
    with httpx.Client(base_url=server, timeout=60) as c:
        c.post("/api/v1/universes/uni-default/activate")
        solar = c.post("/api/v1/universes", json=SOLAR).json()
        sid, e = solar["id"], epoch(c)
        first = c.get(f"/api/v1/universes/{sid}/history").json()
        assert first["mode"] == "grid" and first["sampleIntervalS"] == 432000.0 and first["nextIndex"] == 1
        c.post(f"/api/v1/universes/{sid}/step?activationEpoch={e}", json={"dtS": 5 * 432000.0})
        gen = first["generation"]
        page = c.get(f"/api/v1/universes/{sid}/history?generation={gen}&fromIndex=1").json()
        assert [s["index"] for s in page["samples"]] == [1, 2, 3, 4, 5] and page["generation"] == gen
        assert [s["simulationTimeS"] for s in page["samples"]] == [k * 432000.0 for k in range(1, 6)]
        assert set(page["samples"][0]["positionsM"]) == set(page["bodies"]) and len(page["bodies"]) == 9
        c.post(f"/api/v1/universes/{sid}/reset?activationEpoch={e}")
        after = c.get(f"/api/v1/universes/{sid}/history?generation={gen}&fromIndex=3").json()
        assert after["generation"] != gen and after["firstIndex"] == 0 and after["nextIndex"] == 1  # a reset starts a new history
        c.post("/api/v1/universes/uni-default/activate")
        c.delete(f"/api/v1/universes/{sid}")


def test_orbit_lab_journey_over_http(server):
    with httpx.Client(base_url=server, timeout=120) as c:
        c.post("/api/v1/universes/uni-default/activate")
        exp = c.post("/api/v1/orbit-lab/experiments", json={"systemId": "exp01-sun-emb-j2000"}).json()
        eid, bid = exp["id"], exp["baselineUniverseId"]
        mod = c.post(f"/api/v1/orbit-lab/experiments/{eid}/modified-run", json={"bodyId": "body-earth", "speedFactor": 1.05}).json()
        mid = mod["modifiedUniverseId"]
        diffs = c.get(f"/api/v1/orbit-lab/experiments/{eid}/initial-differences").json()
        assert [d["field"] for d in diffs["differences"]] == ["velocityMPerS"] and diffs["configEqual"]
        for uid in (bid, mid):
            c.post(f"/api/v1/universes/{uid}/activate")
            e = epoch(c)
            for _ in range(60):
                assert c.post(f"/api/v1/universes/{uid}/step?activationEpoch={e}", json={"dtS": DAY}).status_code == 200
        cmp_ = c.get(f"/api/v1/orbit-lab/experiments/{eid}/comparison?bodyId=body-earth").json()
        assert cmp_["commonSampleCount"] == 61 and cmp_["timesDiffer"] is False and cmp_["controlled"] is True
        assert cmp_["timesS"] == [k * DAY for k in range(61)] and cmp_["separationM"][0] < 1e-6 and cmp_["separationM"][60] > 1e9
        # edit the modified run: uncontrolled; reset: controlled again; the baseline never changes
        base_state = c.get(f"/api/v1/universes/{bid}/state").json()
        e = epoch(c)
        assert c.patch(f"/api/v1/universes/{mid}/bodies/body-earth?activationEpoch={e}", json={"massKg": 7.0e24}).status_code == 200
        assert c.get(f"/api/v1/universes/{mid}/provenance").json()["controlled"] is False
        assert c.post(f"/api/v1/universes/{mid}/reset?activationEpoch={e}").status_code == 200
        assert c.get(f"/api/v1/universes/{mid}/provenance").json()["controlled"] is True
        assert c.get(f"/api/v1/universes/{bid}/state").json() == base_state
        refused = c.post(f"/api/v1/universes/{bid}/bodies?activationEpoch={e}", json=body("x", 1.0, 1.0, 1e12))
        assert refused.status_code == 409  # the baseline is not the active universe (and is immutable anyway)
        c.post("/api/v1/universes/uni-default/activate")
        assert c.delete(f"/api/v1/orbit-lab/experiments/{eid}").status_code == 204
        assert [u["id"] for u in c.get("/api/v1/universes").json()["universes"]] == ["uni-default"]


def test_restart_loses_universes_and_default_is_recreated():
    """Universes live in memory only (OD-5): after a restart the old ids are gone and a fresh default exists."""
    proc, base = launch()
    port = int(base.rsplit(":", 1)[1])
    try:
        with httpx.Client(base_url=base, timeout=60) as c:
            solar = c.post("/api/v1/universes", json=SOLAR).json()
            assert epoch(c) == 2
            before = solar["id"]
    finally:
        stop(proc)
    proc, base = launch(port)
    try:
        with httpx.Client(base_url=base, timeout=60) as c:
            j = c.get("/api/v1/universes").json()
            assert [u["id"] for u in j["universes"]] == ["uni-default"] and j["activeUniverseId"] == "uni-default" and j["activationEpoch"] == 1
            gone = c.get(f"/api/v1/universes/{before}/state")
            assert gone.status_code == 404 and gone.json()["code"] == "universe_not_found"
            assert c.post(f"/api/v1/universes/{before}/step?activationEpoch=2", json={"dtS": 1.0}).status_code == 404
    finally:
        stop(proc)
