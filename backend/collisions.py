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
  (observed momentum error 5e-9 relative without it, ~1e-13 with it).

Exceptions inside a ctypes callback are swallowed by REBOUND, so `resolve` catches them, records the traceback in
`errors` and returns 0 (keep both bodies). The caller must treat a non-empty `errors` list as a failed step.
"""
import math
import traceback
from typing import Callable

Vec = list[float]


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
                sim_ptr.contents.integrator = "ias15"  # reset stale predictor state (see module docstring)
            return rc
        except Exception:  # noqa: BLE001 - ctypes would swallow it; surface via `errors`
            self.errors.append(traceback.format_exc())
            return 0

    def _resolve(self, sim, col) -> int:
        if col.p1 >= sim.N or col.p2 >= sim.N or col.p1 == col.p2:
            self.stale += 1
            return 0
        pa, pb = sim.particles[col.p1], sim.particles[col.p2]
        if pa.m >= pb.m:
            surv, gone, remove = pa, pb, 2
        else:
            surv, gone, remove = pb, pa, 1
        ms, mg = surv.m, gone.m
        total_m = ms + mg
        xs, xg, vs, vg = _pos(surv), _pos(gone), _vel(surv), _vel(gone)
        r_rel, v_rel = _sub(xs, xg), _sub(vs, vg)
        mu = ms * mg / total_m
        p_tot = _add(_scale(vs, ms), _scale(vg, mg))
        v_com = _scale(p_tot, 1.0 / total_m)
        x_com = _scale(_add(_scale(xs, ms), _scale(xg, mg)), 1.0 / total_m)
        ke_lost = 0.5 * mu * _dot(v_rel, v_rel)
        l_orb = _scale(_cross(r_rel, v_rel), mu)
        surv_id, gone_id = surv.name, gone.name
        event = {
            "simulationTimeS": sim.t,
            "estimatedContactTimeS": contact_time_estimate(
                sim.t, sim.dt_last_done, r_rel, v_rel, surv.r + gone.r),
            "bodyIds": [surv_id, gone_id],
            "resultBodyId": surv_id,
            "resultMassKg": total_m,
            "relativeSpeedMPerS": _norm(v_rel),
            "kineticEnergyLostJ": ke_lost,
            "spinAddedKgM2PerS": l_orb,
        }
        for axis, value in zip(("x", "y", "z"), x_com):
            setattr(surv, axis, value)
        for axis, value in zip(("vx", "vy", "vz"), v_com):
            setattr(surv, axis, value)
        surv.m = total_m
        surv.r = (surv.r ** 3 + gone.r ** 3) ** (1.0 / 3.0)
        self.heat_J += ke_lost
        spin = _add(self.spin.pop(surv_id, [0.0] * 3), self.spin.pop(gone_id, [0.0] * 3))
        self.spin[surv_id] = _add(spin, l_orb)
        self._on_merge(event)
        return remove
