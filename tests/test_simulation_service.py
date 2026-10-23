"""Physics tests for the production service (backend/simulation.py + backend/collisions.py), SI units.

Expectations are derived independently of REBOUND from the initial conditions (tolerance reasoning inline).
Round-off tolerances: 1e-12 relative. Integration error (IAS15): 1e-9 or tighter, observed ~1e-13 in M0.
"""
import math

import pytest

from backend import simulation
from backend.models import BodyCreate, BodyUpdate
from backend.simulation import ConflictError, NotFoundError, SimulationFailure, SimulationService

G = 6.67430e-11
M_SUN, M_EARTH, M_MOON = 1.98847e30, 5.9722e24, 7.342e22
AU = 1.495978707e11


def make(name="b", m=1.0, r=1.0, x=(0.0, 0.0, 0.0), v=(0.0, 0.0, 0.0), color="#ffffff") -> BodyCreate:
    return BodyCreate(name=name, massKg=m, radiusM=r, positionM=dict(zip("xyz", x)),
                      velocityMPerS=dict(zip("xyz", v)), colorHex=color)


def vec(d):
    return [d.x, d.y, d.z]


def totals(state):
    mass = sum(b.massKg for b in state.bodies)
    mom = [sum(b.massKg * vec(b.velocityMPerS)[k] for b in state.bodies) for k in range(3)]
    return mass, mom


def mom_scale(state):
    return sum(b.massKg * math.sqrt(sum(c * c for c in vec(b.velocityMPerS))) for b in state.bodies)


@pytest.fixture
def svc():
    return SimulationService()


# ---------- constants and basic gravity ----------
def test_engine_uses_project_G_and_ias15(svc):
    assert svc._sim.G == G
    assert svc._sim.integrator == "ias15"
    assert svc._sim.collision == "line"


def test_two_body_acceleration_matches_newton(svc):
    """Earth-Moon pair at rest, 10 s step: dv = G m_other / r^2 * dt. Second-order change of r is ~1e-9 relative;
    using REBOUND's own SI G (6.67408e-11) would be off by 3.3e-5, so 1e-6 also pins the project constant."""
    r = 3.844e8
    earth = svc.add_body(make("Earth", M_EARTH, 6.371e6))
    moon = svc.add_body(make("Moon", M_MOON, 1.7374e6, x=(r, 0, 0)))
    s = svc.step(10.0)
    by_id = {b.id: b for b in s.bodies}
    assert by_id[earth.id].velocityMPerS.x == pytest.approx(G * M_MOON / r ** 2 * 10.0, rel=1e-6)
    assert by_id[moon.id].velocityMPerS.x == pytest.approx(-G * M_EARTH / r ** 2 * 10.0, rel=1e-6)
    assert s.simulationTimeS == 10.0 and s.advancedS == pytest.approx(10.0, abs=1e-9)


def test_free_body_moves_in_a_straight_line_and_time_accumulates(svc):
    b = svc.add_body(make(v=(3.0, -4.0, 12.0)))
    svc.step(100.0)
    s = svc.step(50.5)
    assert s.simulationTimeS == pytest.approx(150.5, abs=1e-9)
    assert vec(s.bodies[0].positionM) == pytest.approx([3.0 * 150.5, -4.0 * 150.5, 12.0 * 150.5], rel=1e-12)
    assert s.bodies[0].id == b.id and s.status == "paused" and s.events == []


def test_empty_simulation_step_advances_time(svc):
    s = svc.step(10.0)
    assert s.simulationTimeS == 10.0 and s.bodies == []


def test_circular_orbit_returns_to_start_and_conserves_energy(svc):
    """Sun + Earth on a circular orbit: after one period T = 2 pi sqrt(a^3 / G(M+m)) the relative position returns to
    its start. M0 measured 5e-14 relative for IAS15; 1e-9 leaves headroom for 10 chunked calls."""
    a = AU
    T = 2 * math.pi * math.sqrt(a ** 3 / (G * (M_SUN + M_EARTH)))
    v_rel = math.sqrt(G * (M_SUN + M_EARTH) / a)
    sun = svc.add_body(make("Sun", M_SUN, 6.957e8))
    earth = svc.add_body(make("Earth", M_EARTH, 6.371e6, x=(a, 0, 0), v=(0, v_rel, 0)))

    def energy(s):
        by = {b.id: b for b in s.bodies}
        ke = sum(0.5 * b.massKg * sum(c * c for c in vec(b.velocityMPerS)) for b in s.bodies)
        d = math.dist(vec(by[sun.id].positionM), vec(by[earth.id].positionM))
        return ke - G * M_SUN * M_EARTH / d

    e0 = energy(svc.snapshot())
    for _ in range(10):
        s = svc.step(T / 10)
    assert s.simulationTimeS == pytest.approx(T, rel=1e-12)
    by = {b.id: b for b in s.bodies}
    rel = [p - q for p, q in zip(vec(by[earth.id].positionM), vec(by[sun.id].positionM))]
    assert rel == pytest.approx([a, 0.0, 0.0], abs=1e-9 * a)
    assert abs(energy(s) - e0) / abs(e0) < 1e-10
    assert s.events == []


# ---------- merger: conservation, events, continued stepping ----------
def spheres(sep=200.037, v_rel=2.0, b=0.5, drift=(0.3, -0.2, 0.1)):
    """M0 fixture: A 2000 kg r=1.0, B 1000 kg r=0.8, approach along x in the CM frame plus a common drift."""
    mA, mB = 2000.0, 1000.0
    M = mA + mB
    va, vb = v_rel * mB / M, -v_rel * mA / M
    return (make("A", mA, 1.0, x=(-sep / 2, b / 2, 0), v=(va + drift[0], drift[1], drift[2])),
            make("B", mB, 0.8, x=(sep / 2, -b / 2, 0), v=(vb + drift[0], drift[1], drift[2])))


@pytest.mark.parametrize("n_calls", [1, 24])
def test_merger_conserves_mass_and_momentum_and_keeps_stepping(svc, n_calls):
    a_in, b_in = spheres()
    A, B = svc.add_body(a_in), svc.add_body(b_in)
    s0 = svc.snapshot()
    mass0, mom0 = totals(s0)
    events = []
    for _ in range(n_calls):
        s = svc.step(140.0 / n_calls)  # contact at ~99 s
        events += s.events
    assert len(events) == 1
    ev = events[0]
    assert ev.type == "merger" and ev.bodyIds == [A.id, B.id] and ev.resultBodyId == A.id  # heavier keeps its id
    assert [b.id for b in s.bodies] == [A.id]
    mass1, mom1 = totals(s)
    assert mass1 == mass0 == 3000.0
    assert mom1 == pytest.approx(mom0, abs=1e-12 * mom_scale(s0))
    # remnant: centre-of-mass velocity, volume-conserving radius
    assert vec(s.bodies[0].velocityMPerS) == pytest.approx([0.3, -0.2, 0.1], abs=1e-12)
    assert s.bodies[0].radiusM == pytest.approx((1.0 + 0.8 ** 3) ** (1 / 3), rel=1e-12)
    # event numbers vs closed forms from the initial conditions (gravity speed-up is ~5.6e-8 relative -> 1e-6)
    mu = 2000.0 * 1000.0 / 3000.0
    assert ev.kineticEnergyLostJ == pytest.approx(0.5 * mu * 2.0 ** 2, rel=1e-6)
    assert ev.relativeSpeedMPerS == pytest.approx(2.0, rel=1e-6)
    assert ev.spinAddedKgM2PerS.z == pytest.approx(-mu * 2.0 * 0.5, rel=1e-6)
    # contact time: straight-line estimate vs analytic; detection time is at/after contact, never before
    t_contact = (200.037 - math.sqrt(1.8 ** 2 - 0.5 ** 2)) / 2.0
    assert ev.estimatedContactTimeS == pytest.approx(t_contact, abs=1e-5)
    assert ev.simulationTimeS >= t_contact - 1e-9
    # the engine stays usable: remnant coasts at v_com, a new body can be added and gravity still acts
    x_before, t_before = vec(s.bodies[0].positionM), s.simulationTimeS
    s2 = svc.step(40.0)
    assert vec(s2.bodies[0].positionM) == pytest.approx(
        [x_before[0] + 0.3 * 40, x_before[1] - 0.2 * 40, x_before[2] + 0.1 * 40], abs=1e-6)
    assert s2.simulationTimeS == pytest.approx(t_before + 40.0)
    assert svc.events() == events


def test_fast_head_on_collision_is_not_tunnelled(svc):
    """M0 F2: with 'direct' detection a 2000 m/s pair crossing in one step is missed. 'line' must catch it."""
    svc.add_body(make("A", 2000.0, 1.0, x=(-10003.5, 0, 0), v=(1000.0, 0, 0)))
    svc.add_body(make("B", 1000.0, 0.8, x=(10003.5, 0, 0), v=(-1000.0, 0, 0)))
    s = svc.step(12.0)  # centres cross at t=10.0035 s, deep inside one engine step
    assert len(s.events) == 1 and len(s.bodies) == 1
    assert s.bodies[0].massKg == 3000.0
    assert vec(s.bodies[0].velocityMPerS) == pytest.approx([(2000 - 1000) * 1000 / 3000, 0, 0], abs=1e-9)


def test_centres_crossing_exactly_mid_step_stays_finite(svc):
    """M0 limitation: centres coinciding exactly mid-step made REBOUND return NaN. Either a merge or a clean
    rollback is acceptable; non-finite state is not."""
    svc.add_body(make("P", 1.0, 1.0, x=(-50, 0, 0), v=(500, 0, 0)))
    svc.add_body(make("Q", 1.0, 1.0, x=(50, 0, 0), v=(-500, 0, 0)))
    try:
        s = svc.step(0.1)  # crossing at exactly 0.1 s
    except SimulationFailure:
        s = svc.snapshot()
        assert s.simulationTimeS == 0.0 and len(s.bodies) == 2
    for b in s.bodies:
        assert all(math.isfinite(c) for c in vec(b.positionM) + vec(b.velocityMPerS))


def test_three_body_merger_keeps_momentum_with_heavy_neighbour(svc):
    """M0 F7: without the IAS15 reset the momentum error was 5e-9 relative with a 1e11 kg neighbour."""
    a_in, b_in = spheres(b=0.0)
    svc.add_body(a_in), svc.add_body(b_in)
    svc.add_body(make("C", 1.0e11, 5.0, x=(0, 30.0, 0)))
    s0 = svc.snapshot()
    _, mom0 = totals(s0)
    s = svc.step(160.0)
    assert len(s.events) == 1
    _, mom1 = totals(s)
    # M0 measured 4.5e-13 kg m/s here; 1e-9 kg m/s is ~4 orders better than the unfixed 9.3e-6
    assert mom1 == pytest.approx(mom0, abs=1e-9)


def test_two_simultaneous_pairs_and_chain(svc):
    for body in spheres():
        svc.add_body(body)
    c = make("C", 3000.0, 1.2, x=(-100.0, 1000.0, 50.0), v=(1.0, 0, 0))
    d = make("D", 1000.0, 0.9, x=(100.0, 1000.0, 50.0), v=(-1.0, 0, 0))
    svc.add_body(c), svc.add_body(d)
    s0 = svc.snapshot()
    mass0, mom0 = totals(s0)
    s = svc.step(150.0)
    assert len(s.events) == 2 and len(s.bodies) == 2
    mass1, mom1 = totals(s)
    assert mass1 == mass0
    assert mom1 == pytest.approx(mom0, abs=1e-12 * mom_scale(s0))


def test_chain_collision_merges_all_three_over_time(svc):
    d = 101.037
    svc.add_body(make("A", 2000.0, 1.0, x=(-d, 0, 0), v=(2.0, 0, 0)))
    svc.add_body(make("B", 1000.0, 0.8))
    svc.add_body(make("C", 1500.0, 0.9, x=(d, 0, 0), v=(-2.0, 0, 0)))
    s0 = svc.snapshot()
    s = svc.step(80.0)
    assert len(s.bodies) == 1 and s.bodies[0].massKg == 4500.0
    assert svc._resolver.errors == []
    assert totals(s)[1] == pytest.approx(totals(s0)[1], abs=1e-12 * mom_scale(s0))


# ---------- ids, CRUD, order, reset ----------
def test_ids_and_creation_order_survive_merge_and_delete(svc):
    x = svc.add_body(make("X", 1.0, 0.5, x=(0, 5000.0, 0)))
    a_in, b_in = spheres(b=0.2)
    light_first = b_in, a_in  # lighter body is REBOUND's first colliding particle
    p1, p2 = svc.add_body(light_first[0]), svc.add_body(light_first[1])
    z = svc.add_body(make("Z", 1.0, 0.5, x=(0, -5000.0, 0), v=(0.5, 0.25, 0)))
    s = svc.step(140.0)
    assert [b.id for b in s.bodies] == [x.id, p2.id, z.id]  # p2 (heavier "A") survived; creation order kept
    zb = s.bodies[2]
    assert vec(zb.positionM) == pytest.approx([0.5 * 140.0, -5000.0 + 0.25 * 140.0, 0.0], abs=1e-6)
    svc.delete_body(x.id)
    assert [b.id for b in svc.snapshot().bodies] == [p2.id, z.id]
    with pytest.raises(NotFoundError):
        svc.delete_body(p1.id)  # absorbed id no longer exists
    with pytest.raises(NotFoundError):
        svc.update_body(p1.id, BodyUpdate(massKg=1.0))


def test_patch_changes_dynamics_and_unknown_id_fails(svc):
    b = svc.add_body(make(v=(1.0, 0, 0)))
    svc.step(10.0)
    out = svc.update_body(b.id, BodyUpdate(velocityMPerS=dict(x=0.0, y=2.0, z=0.0), name="Renamed", colorHex="#123456"))
    assert out.name == "Renamed" and out.colorHex == "#123456" and out.positionM.x == pytest.approx(10.0)
    s = svc.step(10.0)
    assert vec(s.bodies[0].positionM) == pytest.approx([10.0, 20.0, 0.0], abs=1e-9)
    with pytest.raises(NotFoundError):
        svc.update_body("body-nope", BodyUpdate(massKg=2.0))


def test_patch_mass_changes_force(svc):
    r = 1.0e6
    a = svc.add_body(make("a", 1.0e20, 10.0))
    svc.add_body(make("b", 1.0, 1.0, x=(r, 0, 0)))
    svc.update_body(a.id, BodyUpdate(massKg=4.0e20))
    s = svc.step(1.0)
    assert s.bodies[1].velocityMPerS.x == pytest.approx(-G * 4.0e20 / r ** 2, rel=1e-6)


def test_overlap_is_rejected_on_create_and_patch_without_mutation(svc):
    a = svc.add_body(make("a", 1.0, 1.0))
    with pytest.raises(ConflictError):
        svc.add_body(make("b", 1.0, 1.0, x=(1.5, 0, 0)))
    b = svc.add_body(make("b", 1.0, 1.0, x=(10.0, 0, 0)))
    for patch in (BodyUpdate(positionM=dict(x=1.5, y=0.0, z=0.0)), BodyUpdate(radiusM=20.0)):
        with pytest.raises(ConflictError):
            svc.update_body(b.id, patch)
    s = svc.snapshot()
    assert [bb.id for bb in s.bodies] == [a.id, b.id] and s.bodies[1].positionM.x == 10.0 and s.bodies[1].radiusM == 1.0


def test_reset_clears_state_but_event_ids_are_not_reused(svc):
    for body in spheres():
        svc.add_body(body)
    first = svc.step(140.0).events[0]
    s = svc.reset()
    assert s.bodies == [] and s.simulationTimeS == 0.0 and svc.events() == []
    for body in spheres():
        svc.add_body(body)
    second = svc.step(140.0).events[0]
    assert second.id != first.id
    # reset is deterministic: same inputs after reset give the same result as a fresh service
    fresh = SimulationService()
    for body in spheres():
        fresh.add_body(body)
    f = fresh.step(140.0)
    assert [vec(b.positionM) for b in svc.snapshot().bodies] == [vec(b.positionM) for b in f.bodies]


def test_body_limit(svc, monkeypatch):
    monkeypatch.setattr(simulation, "MAX_BODIES", 2)
    svc.add_body(make("a", x=(0, 0, 0)))
    svc.add_body(make("b", x=(10, 0, 0)))
    with pytest.raises(ConflictError):
        svc.add_body(make("c", x=(20, 0, 0)))


# ---------- transactional steps ----------
def test_failed_step_is_rolled_back_and_engine_stays_usable(svc, monkeypatch):
    for body in spheres():
        svc.add_body(body)
    before = svc.snapshot()
    monkeypatch.setattr(svc, "_verify_finite", lambda: (_ for _ in ()).throw(ArithmeticError("injected")))
    with pytest.raises(SimulationFailure):
        svc.step(140.0)  # would merge; the merge must be undone as well
    monkeypatch.undo()
    after = svc.snapshot()
    assert after == before and svc.events() == []
    s = svc.step(140.0)  # resolver re-registered on the rebuilt engine
    assert len(s.events) == 1 and len(s.bodies) == 1


def test_resolver_exception_fails_step_and_rolls_back(svc, monkeypatch):
    for body in spheres():
        svc.add_body(body)
    before = svc.snapshot()

    def boom(ev):
        raise RuntimeError("callback failure")

    monkeypatch.setattr(svc._resolver, "_on_merge", boom)
    with pytest.raises(SimulationFailure):
        svc.step(140.0)
    assert svc.snapshot() == before


# ---------- step-cap policy and robustness ----------
def test_chunk_limit_matches_curvature_criterion(svc):
    """Two bodies at distance d: a_rel = G(m1+m2)/d^2, limit = sqrt(8 * 0.01 * (r1+r2) / a_rel)."""
    d = 1.0e7
    svc.add_body(make("a", 1.0e24, 1.0e5))
    svc.add_body(make("b", 1.0e22, 1.0e4, x=(d, 0, 0)))
    a_rel = G * (1.0e24 + 1.0e22) / d ** 2
    assert svc._chunk_limit() == pytest.approx(math.sqrt(0.08 * 1.1e5 / a_rel), rel=1e-12)


def test_radial_infall_through_one_large_step_merges_exactly_once(svc):
    """A probe released from rest 1e8 m from a 1e24 kg body falls radially (free-fall time ~1.4e5 s, strongly curved
    path) inside a single 3e5 s request. The pair must merge once, conserving mass and momentum."""
    svc.add_body(make("planet", 1.0e24, 1.0e6))
    svc.add_body(make("probe", 1.0, 1.0, x=(1.0e8, 0, 0)))
    s = svc.step(3.0e5)
    assert len(s.events) == 1 and len(s.bodies) == 1
    assert s.bodies[0].massKg == 1.0e24 + 1.0
    assert s.events[0].simulationTimeS == pytest.approx(
        math.pi / 2 * math.sqrt(1.0e8 ** 3 / (2 * G * 1.0e24)) * 0.99, rel=0.05)  # near free-fall time, <= 5%
    assert abs(totals(s)[1][0]) < 1e-9 * 1.0e24  # initial total momentum is zero


def test_concurrent_requests_are_serialized(svc):
    import threading
    svc.add_body(make("a", 1.0e20, 10.0))
    svc.add_body(make("b", 1.0, 1.0, x=(1.0e6, 0, 0), v=(0, 100.0, 0)))
    errors = []

    def worker():
        try:
            for _ in range(10):
                svc.step(1.0)
                svc.snapshot()
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert errors == [] and svc.snapshot().simulationTimeS == pytest.approx(40.0)
