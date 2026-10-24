"""Production collision/merger layer for the REBOUND simulation (SI units throughout).

Spec: context/PHYSICS_SPIKE.md ("Decision: GO WITH CUSTOM COLLISION LAYER"). REBOUND (`collision = "line"`) only
*detects* an overlap and calls `MergeResolver.resolve`; the resolver performs a perfectly inelastic merger:

- the heavier body keeps its id (ties: REBOUND's first particle `p1`); the other id is absorbed;
- mass and linear momentum are conserved; the remnant sits at the centre of mass with the centre-of-mass velocity;
- the remnant radius conserves volume (sum of cubes);
- translational kinetic energy 0.5*mu*v_rel^2 is lost (booked in `heat_J`, no internal-energy model exists), and the
  orbital angular momentum mu*(r_rel x v_rel) is booked as remnant `spin` (a bookkeeping vector only: no rotation
  or tidal model is implemented). Total kinetic+potential energy is NOT conserved by a merger.
- IAS15 is re-selected after every merge because its predictor state is stale once a particle changed
  (observed momentum error 5e-9 relative without it, ~1e-13 with it). `select_ias15` is the only place that selects it.

The merger arithmetic itself lives in `backend.impact.models.perfect_merge.merge_pair`, shared with the deferred-resolution
engine (mode "outcome-v1", backend/impact/engine.py) so both paths are bit-identical for the same input. This class is the
`legacy-merge` mode: it resolves inside the REBOUND callback exactly as before.

Exceptions inside a ctypes callback are swallowed by REBOUND, so `resolve` catches them, records the traceback in
`errors` and returns 0 (keep both bodies). The caller must treat a non-empty `errors` list as a failed step.
"""
import math
import traceback
from typing import Callable

from backend.impact.models.perfect_merge import PairBody, merge_pair

Vec = list[float]


SATELLITE_MASS_FRACTION = 0.1  # a body is a satellite when its strongest attractor is lighter than this x the heaviest


def has_satellites(sim) -> bool:
    """True when some body is dominated by an attractor that is not the system's main mass: a moon bound to its planet
    rather than to the star. Such a system has two very different dynamical timescales."""
    ps = [(q.m, q.x, q.y, q.z) for q in sim.particles]
    if len(ps) < 3:
        return False
    heaviest = max(m for m, *_ in ps)
    for i, (mi, xi, yi, zi) in enumerate(ps):
        best_a, best_m = 0.0, 0.0
        for j, (mj, xj, yj, zj) in enumerate(ps):
            if i == j:
                continue
            r2 = (xj - xi) ** 2 + (yj - yi) ** 2 + (zj - zi) ** 2
            if r2 > 0.0 and mj / r2 > best_a:
                best_a, best_m = mj / r2, mj
        if best_m and best_m < SATELLITE_MASS_FRACTION * heaviest and mi < best_m:
            return True
    return False


def select_ias15(sim) -> None:
    """(Re-)select IAS15 with the step-size criterion suited to the system.

    Re-selecting resets IAS15's predictor state, which is what a structural change needs.

    Default: the GLOBAL criterion (Rein & Spiegel 2015). REBOUND 5.2.2's default (PRS23) stalls forever when a body's
    net force cancels by symmetry (three equal masses at rest on a line: the middle body's acceleration is round-off
    noise ~1e-29, the step size collapses to ~1e-18 s and `integrate` never returns). GLOBAL scales the step by the
    largest acceleration of the whole system and completes the same scenarios in ~10 steps.
    Evidence: context/WORKLOG.md (2026-10-24 stabilization) and tests/test_step_guard.py.

    Exception: a system with satellites (see `has_satellites`) uses PRS23. GLOBAL's single scale makes the step collapse
    erratically in the Sun + planets + moons preset (a 215-day run reached steps of ~1 s and stopped making progress,
    while PRS23 covers 300 days with a minimum step of ~4,000 s); there every body has a well-defined acceleration, so
    PRS23's cancellation stall cannot occur. Evidence: context/DECISIONS.md D-030, tests/validation/test_preset_moons.py."""
    sim.integrator = "ias15"
    sim.integrator.adaptive_mode = "prs23" if has_satellites(sim) else "global"


def _sub(a: Vec, b: Vec) -> Vec:
    return [x - y for x, y in zip(a, b)]


def _add(a: Vec, b: Vec) -> Vec:
    return [x + y for x, y in zip(a, b)]


def _scale(a: Vec, s: float) -> Vec:
    return [x * s for x in a]


def _dot(a: Vec, b: Vec) -> float:
    return sum(x * y for x, y in zip(a, b))


def _cross(a: Vec, b: Vec) -> Vec:
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def _norm(a: Vec) -> float:
    return math.sqrt(_dot(a, a))


def _pos(p) -> Vec:
    return [p.x, p.y, p.z]


def _vel(p) -> Vec:
    return [p.vx, p.vy, p.vz]


def contact_time_estimate(t_end: float, dt_last: float, r_rel: Vec, u_rel: Vec, contact_dist: float) -> float | None:
    """Estimated time of first contact, from the state at the END of the last internal step.

    REBOUND reports a collision only at a step end. Assuming straight-line relative motion over that step, solve
    |r - u*tau| = R for tau >= 0 seconds before the end. Exact for gravity-free motion, otherwise accurate to the
    path curvature (~ a_rel*dt^2/8 in position). Returns None if there is no root inside the last step."""
    uu = _dot(u_rel, u_rel)
    if uu == 0.0:
        return None
    ru = _dot(r_rel, u_rel)
    disc = ru * ru - uu * (_dot(r_rel, r_rel) - contact_dist * contact_dist)
    if disc < 0.0:
        return None
    tau = (ru + math.sqrt(disc)) / uu
    if tau < -1e-12 or tau > dt_last * (1 + 1e-9):
        return None
    return t_end - tau


class MergeResolver:
    """REBOUND `collision_resolve` callback. Particle `name` is the public body id (never the array index)."""

    def __init__(self, on_merge: Callable[[dict], None]):
        self._on_merge = on_merge
        self.errors: list[str] = []
        self.stale = 0  # callbacks whose indices no longer exist after an earlier merge in the same step
        self.heat_J = 0.0
        self.spin: dict[str, Vec] = {}  # body id -> remnant spin [kg m^2/s]

    def resolve(self, sim_ptr, col) -> int:
        try:
            rc = self._resolve(sim_ptr.contents, col)
            if rc != 0:
                select_ias15(sim_ptr.contents)  # reset stale predictor state (see module docstring)
            return rc
        except Exception:  # noqa: BLE001 - ctypes would swallow it; surface via `errors`
            self.errors.append(traceback.format_exc())
            return 0

    def _resolve(self, sim, col) -> int:
        if col.p1 >= sim.N or col.p2 >= sim.N or col.p1 == col.p2:
            self.stale += 1
            return 0
        pa, pb = sim.particles[col.p1], sim.particles[col.p2]
        merged = merge_pair(PairBody(pa.name, pa.m, pa.r, tuple(_pos(pa)), tuple(_vel(pa))),
                            PairBody(pb.name, pb.m, pb.r, tuple(_pos(pb)), tuple(_vel(pb))),
                            sim.t, sim.dt_last_done, contact_time_estimate)
        surv = pa if merged.remove_code == 2 else pb
        gone_id = merged.absorbed_id
        for axis, value in zip(("x", "y", "z"), merged.position):
            setattr(surv, axis, value)
        for axis, value in zip(("vx", "vy", "vz"), merged.velocity):
            setattr(surv, axis, value)
        surv.m = merged.mass
        surv.r = merged.radius
        self.heat_J += merged.kinetic_energy_lost_j
        spin = _add(self.spin.pop(merged.survivor_id, [0.0] * 3), self.spin.pop(gone_id, [0.0] * 3))
        self.spin[merged.survivor_id] = _add(spin, merged.orbital_angular_momentum)
        self._on_merge(merged.event)
        return merged.remove_code
