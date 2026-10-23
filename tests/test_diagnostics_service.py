"""Diagnostics as served by SimulationService (merge, reset, edit, rollback, non-mutation, self-consistency).

Physical correctness of the formulas is in test_diagnostics_physics.py; here the question is whether the service feeds
them the right state at the right time. Expected values come from the initial conditions and the event records,
not from the code under test. SI units. Tolerances: round-off 1e-12 of the quantity's scale; merger angular momentum
bookkeeping 1e-6 (gravity acts for ~100 s between the snapshots; the validation suite measures 2e-6 for grazing).
"""
import json
import math
from fractions import Fraction

import pytest

from backend import simulation
from backend.models import BodyCreate, BodyUpdate
from backend.simulation import SimulationFailure, SimulationService

ZERO3 = {"x": 0.0, "y": 0.0, "z": 0.0}


def make(name, m, r, x, v):
    return BodyCreate(name=name, massKg=m, radiusM=r, positionM=dict(zip("xyz", x)),
                      velocityMPerS=dict(zip("xyz", v)), colorHex="#ffffff")


def spheres():
    """A 2000 kg r=1 and B 1000 kg r=0.8 approaching at 2 m/s with impact parameter 0.5 m (contact at ~99 s)."""
    mA, mB, M, v_rel, sep, b = 2000.0, 1000.0, 3000.0, 2.0, 200.037, 0.5
    drift = (0.3, -0.2, 0.1)
    return (make("A", mA, 1.0, (-sep / 2, b / 2, 0), (v_rel * mB / M + drift[0], drift[1], drift[2])),
            make("B", mB, 0.8, (sep / 2, -b / 2, 0), (-v_rel * mA / M + drift[0], drift[1], drift[2])))


def vec(d):
    return [d.x, d.y, d.z]


def diag(state):
    return state.diagnostics


def p_scale(state):
    return sum(b.massKg * math.hypot(*vec(b.velocityMPerS)) for b in state.bodies)


def exact(state):
    """Exact (Fraction) M, P, K, L of the bodies in a response, computed from nothing but those bodies."""
    f = Fraction
    m = [f(b.massKg) for b in state.bodies]
    r = [[f(c) for c in vec(b.positionM)] for b in state.bodies]
    v = [[f(c) for c in vec(b.velocityMPerS)] for b in state.bodies]
    cr = lambda a, b: [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]  # noqa: E731
    mass = sum(m, f(0))
    mom = [float(sum((m[i] * v[i][k] for i in range(len(m))), f(0))) for k in range(3)]
    ke = float(sum((m[i] * sum(c * c for c in v[i]) / 2 for i in range(len(m))), f(0)))
    ang = [float(sum((m[i] * cr(r[i], v[i])[k] for i in range(len(m))), f(0))) for k in range(3)]
    return float(mass), mom, ke, ang


@pytest.fixture
def svc():
    return SimulationService()


def merged(svc):
    for b in spheres():
        svc.add_body(b)
    before = svc.snapshot()
    out = svc.step(140.0)
    assert len(out.events) == 1
    return before, out


# ---------- merger ----------
def test_merger_conserves_mass_momentum_and_orbital_plus_booked_angular_momentum(svc):
    before, after = merged(svc)
    d0, d1 = diag(before), diag(after)
    assert d1.totalMassKg == d0.totalMassKg == 3000.0
    for a, b in zip(vec(d1.totalMomentumKgMPerS), vec(d0.totalMomentumKgMPerS)):
        assert a == pytest.approx(b, abs=1e-12 * p_scale(before))
    ev = after.events[0]
    # orbital L fell by exactly what the event booked as spin; their sum is what it was
    assert vec(d1.bookedSpinKgM2PerS) == pytest.approx(vec(ev.spinAddedKgM2PerS), rel=1e-12, abs=1e-12)
    assert vec(d0.bookedSpinKgM2PerS) == [0.0, 0.0, 0.0]
    total0 = vec(d0.angularMomentumAboutOriginKgM2PerS)
    total1 = [a + s for a, s in zip(vec(d1.angularMomentumAboutOriginKgM2PerS), vec(d1.bookedSpinKgM2PerS))]
    assert total1 == pytest.approx(total0, rel=1e-6, abs=1e-6 * abs(vec(ev.spinAddedKgM2PerS)[2]))
    assert d1.angularMomentumAboutOriginKgM2PerS.z != pytest.approx(total0[2], rel=1e-6)  # orbital L alone is NOT conserved


def test_merger_removes_translational_kinetic_energy_and_the_pair_potential(svc):
    before, after = merged(svc)
    q = after.events[0].kineticEnergyLostJ
    d0, d1 = diag(before), diag(after)
    assert d1.potentialEnergyJ == 0.0  # one remnant: no pair left
    # K falls by Q (measured at detection); gravity sped the pair up by its potential drop to contact,
    # G*mA*mB/1.8 m ~ 7.4e-5 J = 5.6e-8 Q, which is the only difference between the snapshots' K and Q
    assert d1.kineticEnergyJ - d0.kineticEnergyJ == pytest.approx(-q, rel=1e-7)
    assert d1.potentialEnergyJ - d0.potentialEnergyJ > 0.0  # mutual potential is negative and disappears
    e0, e1 = d0.kineticEnergyJ + d0.potentialEnergyJ, d1.kineticEnergyJ + d1.potentialEnergyJ
    assert e1 < e0  # total K+U is not conserved by a merger


def test_cascade_accumulates_booked_spin_on_the_survivor(svc):
    # A and C converge on B from opposite sides with different impact parameters; gravity is negligible.
    svc.add_body(make("A", 1000.0, 1.0, (-60.0, 0.4, 0), (20.0, 0, 0)))
    svc.add_body(make("B", 1000.0, 1.0, (0.0, 0.0, 0), (0, 0, 0)))
    svc.add_body(make("C", 1000.0, 1.0, (100.0, -0.7, 0), (-20.0, 0, 0)))
    before = svc.snapshot()
    out = svc.step(20.0)
    assert len(out.events) == 2 and len(out.bodies) == 1
    spin = vec(out.diagnostics.bookedSpinKgM2PerS)
    expected = [sum(vec(e.spinAddedKgM2PerS)[k] for e in out.events) for k in range(3)]
    assert spin == pytest.approx(expected, rel=1e-9, abs=1e-9)
    assert abs(spin[2]) > 1.0  # non-trivial spin, not an all-zero pass
    total0 = vec(before.diagnostics.angularMomentumAboutOriginKgM2PerS)
    total1 = [a + s for a, s in zip(vec(out.diagnostics.angularMomentumAboutOriginKgM2PerS), spin)]
    assert total1 == pytest.approx(total0, abs=1e-6 * abs(spin[2]))
    assert out.diagnostics.totalMassKg == 3000.0


# ---------- reset, edits ----------
def test_reset_zeroes_every_diagnostic_including_booked_spin(svc):
    merged(svc)
    s = svc.reset()
    d = diag(s)
    assert d.totalMassKg == 0.0 and d.kineticEnergyJ == 0.0 and d.potentialEnergyJ == 0.0
    assert d.bookedSpinKgM2PerS.model_dump() == ZERO3 and d.totalMomentumKgMPerS.model_dump() == ZERO3
    svc.add_body(make("X", 1.0, 1.0, (0, 0, 0), (0, 0, 0)))
    assert diag(svc.snapshot()).bookedSpinKgM2PerS.model_dump() == ZERO3  # old spin does not resurface


def test_deleting_the_remnant_removes_its_booked_spin(svc):
    _, out = merged(svc)
    assert diag(out).bookedSpinKgM2PerS.z != 0.0
    svc.add_body(make("bystander", 5.0, 1.0, (5000.0, 0, 0), (0, 0, 0)))  # deleting the LAST particle makes REBOUND warn
    svc.delete_body(out.bodies[0].id)
    d = diag(svc.snapshot())
    assert d.totalMassKg == 5.0 and d.bookedSpinKgM2PerS.model_dump() == ZERO3


def test_deleting_the_last_body_warns_in_rebound_but_leaves_a_clean_empty_usable_system(svc):
    """REBOUND emits RuntimeWarning "Last particle removed." from remove(). It is a notice only (a supported UI path,
    exercised over real HTTP in tests/smoke): the state is empty, diagnostics are the empty-system zeros, and the
    engine accepts new bodies and steps afterwards. The warning is asserted, not silenced, so the policy stays strict."""
    _, out = merged(svc)
    with pytest.warns(RuntimeWarning, match="Last particle removed"):
        svc.delete_body(out.bodies[0].id)
    s = svc.snapshot()
    assert s.bodies == [] and s.diagnostics.totalMassKg == 0.0 and s.diagnostics.bookedSpinKgM2PerS.model_dump() == ZERO3
    svc.add_body(make("n1", 3.0, 1.0, (0, 0, 0), (1.0, 0, 0)))
    svc.add_body(make("n2", 3.0, 1.0, (1.0e4, 0, 0), (0, 0, 0)))
    out = svc.step(5.0)
    assert out.advancedS == pytest.approx(5.0) and len(out.bodies) == 2 and out.diagnostics.totalMassKg == 6.0


def test_patch_and_add_change_diagnostics_as_defined(svc):
    a = svc.add_body(make("A", 10.0, 1.0, (0, 0, 0), (1.0, 0, 0)))
    svc.add_body(make("B", 30.0, 1.0, (100.0, 0, 0), (0, 2.0, 0)))
    d = diag(svc.snapshot())
    assert d.totalMassKg == 40.0 and d.kineticEnergyJ == 0.5 * 10 * 1 + 0.5 * 30 * 4
    svc.update_body(a.id, BodyUpdate(massKg=20.0))
    d = diag(svc.snapshot())
    assert d.totalMassKg == 50.0 and vec(d.totalMomentumKgMPerS) == [20.0, 60.0, 0.0]
    assert d.potentialEnergyJ == pytest.approx(-simulation.G_SI * 20.0 * 30.0 / 100.0, rel=1e-15)


# ---------- rollback ----------
def test_failed_step_leaves_diagnostics_bitwise_unchanged_including_booked_spin(svc, monkeypatch):
    merged(svc)
    svc.add_body(make("C", 5.0, 1.0, (5000.0, 0, 0), (0, 1.0, 0)))
    before = svc.snapshot()
    assert before.diagnostics.bookedSpinKgM2PerS.z != 0.0
    monkeypatch.setattr(svc, "_verify_finite", lambda: (_ for _ in ()).throw(ArithmeticError("injected")))
    with pytest.raises(SimulationFailure):
        svc.step(50.0)
    monkeypatch.undo()
    after = svc.snapshot()
    assert after == before
    assert json.dumps(after.model_dump()) == json.dumps(before.model_dump())  # bit-for-bit, not approx


def test_timed_out_step_leaves_diagnostics_unchanged(svc):
    for b in spheres():
        svc.add_body(b)
    before = svc.snapshot()
    svc.step_time_limit_s = -1.0
    with pytest.raises(simulation.StepTimeoutError):
        svc.step(140.0)
    assert svc.snapshot() == before and svc.snapshot().diagnostics == before.diagnostics


# ---------- reading does not mutate ----------
def test_reading_diagnostics_does_not_change_the_trajectory():
    probed, twin = SimulationService(), SimulationService()
    for s in (probed, twin):
        for b in spheres():
            s.add_body(b)
    # ids are random per service, so compare physical content by creation order
    def content(state):
        return ([(b.massKg, vec(b.positionM), vec(b.velocityMPerS)) for b in state.bodies],
                state.diagnostics.model_dump(), state.simulationTimeS)

    for _ in range(14):
        for _ in range(100):
            probed.snapshot()
        a, b = probed.step(10.0), twin.step(10.0)
        assert content(a) == content(b)  # bitwise: same inputs, same engine path, reads in between changed nothing
    assert len(a.bodies) == 1  # the merger happened along the way


# ---------- self-consistency: diagnostics describe the bodies in the same response ----------
def test_every_response_is_consistent_with_its_own_bodies(svc):
    for b in spheres():
        svc.add_body(b)
    svc.add_body(make("far", 50.0, 1.0, (3.0e4, 1.0e4, -2.0e3), (0.01, -0.02, 0.03)))
    responses = [svc.snapshot()] + [svc.step(10.0) for _ in range(14)] + [svc.snapshot()]
    assert any(getattr(r, "events", None) for r in responses)
    for r in responses:
        mass, mom, ke, ang = exact(r)
        d = r.diagnostics
        scale = max(p_scale(r), 1e-300)
        assert d.totalMassKg == pytest.approx(mass, rel=1e-15)
        assert d.kineticEnergyJ == pytest.approx(ke, rel=1e-14)
        assert vec(d.totalMomentumKgMPerS) == pytest.approx(mom, abs=1e-15 * scale)
        l_scale = sum(b.massKg * math.hypot(*vec(b.positionM)) * math.hypot(*vec(b.velocityMPerS)) for b in r.bodies)
        assert vec(d.angularMomentumAboutOriginKgM2PerS) == pytest.approx(ang, abs=1e-15 * l_scale)
