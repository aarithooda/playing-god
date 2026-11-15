"""Mission state and the evaluation of the ACTUAL outcome.

A mission is a spacecraft, a destination and an objective. Its status says exactly what is known:

  draft        nothing designed yet (or the proposed plan went out of date before it was committed)
  planned      a transfer has been designed; nothing has been executed (`committed` tells whether its nodes are scheduled)
  in_progress  the first burn has started; the objective is not yet established
  completed    the objective holds in the simulated state (see `checks`), not merely in the plan
  failed       the mission cannot meet its objective any more; `reasons` say why
  unsupported  the planner does not implement this kind of mission; `reasons` say what is missing

Reaching the destination is not success. For an "orbit" objective the spacecraft's ACTUAL osculating orbit about the destination must
be bound, clear of the surface, inside the sphere of influence and within the tolerance of the requested apsides, and must stay so
for one full revolution; a flyby must pass at the requested altitude. `agreement` compares the plan with the simulation at each
node (same instant): the state just before the burn as predicted on the planner's copy against the state the engine was in.
"""
import math
from dataclasses import replace
from typing import Optional

from backend.spaceflight import orbits
from backend.spaceflight.craft import Mission, SpaceflightBook
from backend.spaceflight.dynamics import Hierarchy

# Plan-versus-simulation agreement at a node (documented in docs/SPACE_MISSION_DESIGN.md): the planner and the engine integrate the
# same equations with the same integrator from the same state, so they differ only by round-off amplified along the trajectory.
POSITION_AGREEMENT_M = 1000.0
VELOCITY_AGREEMENT_M_PER_S = 1.0
SHORTFALL_REL = 1.0e-6  # a burn that delivered less than (1 - this) of its delta-v ran out of propellant


def fingerprint(book: SpaceflightBook, hierarchy: Hierarchy) -> tuple:
    return (book.physics_epoch, tuple(sorted(b.id for b in hierarchy.bodies)))


def _fail(mission: Mission, t: float, *reasons: str, outcome: Optional[dict] = None, checks: tuple = ()) -> Mission:
    return replace(mission, status="failed", phase="failed", reasons=tuple(reasons), updated_at_s=t,
                   outcome=outcome if outcome is not None else mission.outcome, checks=checks or mission.checks)


def _agreement(nodes: list) -> tuple:
    rows = []
    for n in nodes:
        if n.predicted_state is None or n.actual_state is None:
            continue
        dr = orbits.norm(orbits.sub(n.actual_state[0], n.predicted_state[0]))
        dv = orbits.norm(orbits.sub(n.actual_state[1], n.predicted_state[1]))
        rows.append({"maneuverId": n.id, "role": n.role, "epochS": n.started_at_s, "positionDifferenceM": dr, "velocityDifferenceMPerS": dv,
                     "positionToleranceM": POSITION_AGREEMENT_M, "velocityToleranceMPerS": VELOCITY_AGREEMENT_M_PER_S,
                     "ok": dr <= POSITION_AGREEMENT_M and dv <= VELOCITY_AGREEMENT_M_PER_S})
    return tuple(rows)


def orbit_checks(r, v, mu: float, body_radius: float, soi: float, objective: dict) -> tuple:
    """(checks, elements or None) for the "orbit" objective from a state relative to the destination."""
    try:
        el = orbits.state_to_elements(r, v, mu)
    except orbits.OrbitError:
        return ({"id": "bound", "label": "Bound orbit about the destination", "ok": False, "actual": None, "target": "e < 1", "unit": ""},), None
    tol = objective["toleranceM"]
    rp_target = body_radius + objective["periapsisAltitudeM"]
    ra_target = body_radius + (objective.get("apoapsisAltitudeM") or objective["periapsisAltitudeM"])
    bound = el.e < 1.0
    checks = [{"id": "bound", "label": "Bound orbit about the destination (eccentricity < 1)", "ok": bound, "actual": el.e, "target": "< 1", "unit": ""},
              {"id": "clear", "label": "Periapsis above the surface", "ok": el.periapsis > body_radius, "actual": el.periapsis - body_radius,
               "target": "> 0", "unit": "m"},
              {"id": "periapsis", "label": "Periapsis altitude within tolerance", "ok": abs(el.periapsis - rp_target) <= tol,
               "actual": el.periapsis - body_radius, "target": objective["periapsisAltitudeM"], "tolerance": tol, "unit": "m"}]
    if bound:
        checks.append({"id": "apoapsis", "label": "Apoapsis altitude within tolerance", "ok": abs(el.apoapsis - ra_target) <= tol,
                       "actual": el.apoapsis - body_radius, "target": ra_target - body_radius, "tolerance": tol, "unit": "m"})
        checks.append({"id": "soi", "label": "Apoapsis inside the destination's sphere of influence", "ok": el.apoapsis < soi,
                       "actual": el.apoapsis, "target": None if math.isinf(soi) else soi, "unit": "m"})
    else:
        checks.append({"id": "apoapsis", "label": "Apoapsis altitude within tolerance", "ok": False, "actual": None,
                       "target": ra_target - body_radius, "tolerance": tol, "unit": "m"})
    return tuple(checks), el


def _orbit_outcome(el, mu: float, body_radius: float, t: float) -> dict:
    bound = el.e < 1.0
    return {"evaluatedAtS": t, "semiMajorAxisM": el.a, "eccentricity": el.e, "periapsisAltitudeM": el.periapsis - body_radius,
            "apoapsisAltitudeM": (el.apoapsis - body_radius) if bound else None, "periodS": orbits.orbital_period(mu, el.a) if bound else None,
            "bound": bound}


def evaluate(mission: Mission, book: SpaceflightBook, t: float, hierarchy: Hierarchy, craft_state, g: float,
             names: Optional[dict] = None) -> Mission:
    """The mission as the present simulation state says it is. `craft_state`: (position, velocity) of its spacecraft, or None when
    the spacecraft no longer exists. `names`: body id -> display name for the texts. Pure: returns the same record when nothing
    changed."""
    names = names or {}
    if mission.status in ("completed", "failed", "unsupported"):
        return mission
    craft = book.craft.get(mission.craft_id)
    if craft is None or craft_state is None:
        return _fail(mission, t, "the spacecraft no longer exists")
    dest = hierarchy.by_id(mission.destination_body_id)
    if dest is None:
        return _fail(mission, t, "the destination body no longer exists (removed or merged)")
    if book.halt is not None and mission.craft_id in book.halt.body_ids:
        other = next((names.get(i, i) for i in book.halt.body_ids if i != mission.craft_id), "another body")
        return _fail(mission, t, f"the spacecraft collided with {other} at t = {book.halt.time_s:.0f} s "
                                 f"(relative speed {book.halt.relative_speed_m_per_s:.0f} m/s); the simulation stopped there")
    if not mission.committed:
        if mission.plan is None:
            return mission if mission.status == "draft" else replace(mission, status="draft", phase="not designed", updated_at_s=t)
        stale = []
        if mission.plan_fingerprint != fingerprint(book, hierarchy):
            stale.append("the universe or the spacecraft changed after the transfer was designed")
        if t > mission.plan["departure"]["ignitionS"]:
            stale.append("the simulation has passed the planned departure")
        if stale:
            return replace(mission, status="draft", phase="plan out of date", reasons=tuple(stale) + ("design the transfer again",), updated_at_s=t)
        return mission if mission.status == "planned" else replace(mission, status="planned", phase="proposed (not committed)", updated_at_s=t)

    nodes = [book.maneuvers.get(i) for i in mission.maneuver_ids]
    if any(n is None for n in nodes):
        return _fail(mission, t, "a manoeuvre node of the mission was removed before it executed")
    agreement = _agreement(nodes)
    for n in nodes:
        if n.status == "failed":
            return replace(_fail(mission, t, f"{n.label or n.role}: {n.failure}"), agreement=agreement)
        if n.status == "executed" and not n.is_observation and (n.delivered_dv or 0.0) < n.dv_magnitude * (1.0 - SHORTFALL_REL):
            return replace(_fail(mission, t, f"{n.label or n.role}: the propellant ran out; {n.delivered_dv or 0.0:.1f} of "
                                             f"{n.dv_magnitude:.1f} m/s were delivered"), agreement=agreement)
    notes = ()
    if mission.plan_fingerprint is not None and mission.plan_fingerprint != fingerprint(book, hierarchy):
        notes = ("the universe changed after the plan was committed: the planned trajectory no longer predicts this flight",)
    if all(n.status == "planned" for n in nodes):
        return replace(mission, status="planned", phase="awaiting departure", agreement=agreement, reasons=notes, updated_at_s=t)
    pending = [n for n in nodes if n.pending]
    if pending:
        current = pending[0]
        if current.status == "executing":
            phase = "departure burn" if current.role == "departure" else "insertion burn"
        else:
            phase = f"coasting to {names.get(dest.id, dest.id)}"
        return replace(mission, status="in_progress", phase=phase, agreement=agreement, reasons=notes, updated_at_s=t)

    # every node has executed: judge the actual state
    mu = g * (dest.mass_kg + craft.mass_kg)
    soi = hierarchy.soi.get(dest.id, math.inf)
    objective = mission.objective
    if objective["type"] == "flyby":
        observed = next((n for n in nodes if n.role == "observation"), None)
        state = observed.actual_state if observed is not None else None
        if state is None:
            return _fail(mission, t, "the closest approach was not observed")
        try:
            el = orbits.state_to_elements(state[0], state[1], mu)
        except orbits.OrbitError:
            return _fail(mission, t, "the state at the closest approach is degenerate")
        target = objective["periapsisAltitudeM"]
        altitude = el.periapsis - dest.radius_m
        checks = ({"id": "clear", "label": "Closest approach above the surface", "ok": altitude > 0.0, "actual": altitude, "target": "> 0", "unit": "m"},
                  {"id": "periapsis", "label": "Closest-approach altitude within tolerance", "ok": abs(altitude - target) <= objective["toleranceM"],
                   "actual": altitude, "target": target, "tolerance": objective["toleranceM"], "unit": "m"})
        outcome = {"evaluatedAtS": observed.started_at_s, "closestApproachAltitudeM": altitude, "eccentricity": el.e,
                   "speedAtClosestApproachMPerS": orbits.norm(state[1]), "distanceAtNodeM": orbits.norm(state[0])}
        if all(c["ok"] for c in checks):
            return replace(mission, status="completed", phase="flyby completed", checks=checks, agreement=agreement, outcome=outcome,
                           reasons=notes, updated_at_s=t)
        return replace(_fail(mission, t, "the closest approach missed the requested altitude: "
                                         f"{altitude / 1e3:.1f} km instead of {target / 1e3:.1f} km", outcome=outcome, checks=checks),
                       agreement=agreement)

    r, v = orbits.sub(craft_state[0], dest.position), orbits.sub(craft_state[1], dest.velocity)
    checks, el = orbit_checks(r, v, mu, dest.radius_m, soi, objective)
    if el is None:
        return replace(_fail(mission, t, "the state about the destination is degenerate", checks=checks), agreement=agreement)
    outcome = _orbit_outcome(el, mu, dest.radius_m, t)
    failed = [c for c in checks if not c["ok"]]
    if failed:
        what = "; ".join(c["label"].lower() + " not met" for c in failed)
        lead = ("the spacecraft reached the destination but was not captured into orbit" if not el.e < 1.0
                else "the spacecraft is in orbit about the destination, but not the intended one" if mission.capture_started_at_s is None
                else "the orbit did not stay within the intended conditions for one revolution")
        return replace(_fail(mission, t, f"{lead}: {what}", outcome=outcome, checks=checks), agreement=agreement)
    started = mission.capture_started_at_s if mission.capture_started_at_s is not None else t
    period = outcome["periodS"]
    if t - started >= period:
        return replace(mission, status="completed", phase="orbit verified", checks=checks, agreement=agreement, capture_started_at_s=started,
                       outcome={**outcome, "verifiedForS": t - started}, reasons=notes, updated_at_s=t)
    percent = int(100.0 * (t - started) / period)
    return replace(mission, status="in_progress", phase=f"verifying the orbit ({percent}% of one revolution)", checks=checks,
                   agreement=agreement, capture_started_at_s=started, outcome=outcome, reasons=notes, updated_at_s=t)
