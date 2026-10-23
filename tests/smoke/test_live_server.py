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


@pytest.fixture(scope="module")
def server():
    port = free_port()
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", str(port),
         "--log-level", "warning"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                pytest.fail(f"server exited early: {proc.stdout.read()}")
            try:
                if httpx.get(f"{base}/healthz", timeout=1).status_code == 200:
                    break
            except httpx.HTTPError:
                time.sleep(0.1)
        else:
            pytest.fail("server did not become healthy within 30 s")
        yield base
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


def body(name, m, r, x, vx=0.0):
    return {"name": name, "massKg": m, "radiusM": r, "positionM": {"x": x, "y": 0.0, "z": 0.0},
            "velocityMPerS": {"x": vx, "y": 0.0, "z": 0.0}, "colorHex": "#44aaff"}


def test_full_api_journey_over_http(server):
    with httpx.Client(base_url=server, timeout=30) as c:
        assert c.get("/health").json() == {"status": "ok"}
        c.post("/api/v1/simulation/reset")
        state = c.get("/api/v1/simulation/state").json()
        assert state == {"status": "paused", "simulationTimeS": 0.0, "bodies": []}

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
