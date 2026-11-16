"""Spaceflight inside the universe's own engine: `SimulationService` inherits this mixin.

A spacecraft is a particle of the universe's REBOUND simulation (id `craft-...`), integrated by the same IAS15 run as every other
body: there is no second simulation. This mixin adds what a spacecraft needs beyond gravity:

- propulsion: manoeuvre nodes are integration targets, so the engine lands EXACTLY on each one (like the history grid): an impulse
  changes the velocity there; a finite burn switches the thrust force on at ignition and off at cutoff (dynamics.py);
- state: the spaceflight book (craft.py) is copied with every checkpoint, capture, snapshot and reset, so a failed step, Reset and
  Restore treat spacecraft, nodes and missions exactly like bodies;
- the collision policy of this phase: a contact that involves a spacecraft (any universe), or any contact in a universe whose
  collision mode is "stop-on-contact", STOPS the simulation: the whole system is put back to the instant of first contact
  (the contact refinement of the collision package), a `contact` event reports it and stepping is refused until the contact is removed. Nothing merges,
  breaks or bounces;
- missions: evaluated from the actual state after every committed step (missions.py).

Methods prefixed `_flight` are called by SimulationService under its lock.
"""
import math
import traceback
import uuid
from contextlib import contextmanager
from dataclasses import replace
from typing import Optional

from backend.collisions import SPACECRAFT_NAME_PREFIX, add_named_particle, contact_time_estimate, select_ias15
from backend.models import MAX_BODIES, Body, Position3
from backend.spaceflight import missions as mission_rules
from backend.spaceflight import orbits
from backend.spaceflight.craft import Halt, Maneuver, Mission, Spacecraft
from backend.spaceflight.dynamics import (ActiveBurn, Hierarchy, build_hierarchy, burn_vector, burn_window, gravitators, plan_impulse,
                                          relative_state)
from backend.spaceflight.planner import TransferRequest, design_transfer
from backend.spaceflight.propulsion import delta_v_capacity, exhaust_velocity, mass_flow
from backend.spaceflight.requests import ManeuverCreate, MissionCreate, MissionPlanRequest, OrbitSpec, SpacecraftCreate, SpacecraftUpdate
from backend.spaceflight.schemas import (V3, ContactEvent, HaltOut, ManeuverEvent, ManeuverOut, ManeuverPreviewOut, MissionOut, OrbitOut,
                                         OrbitPreviewOut, SpaceflightOut, SpacecraftOut, TrajectoryOut)

MAX_SPACECRAFT = 32
MAX_PENDING_MANEUVERS = 64
MAX_MISSIONS = 16
MAX_MANEUVER_RECORDS = 256  # executed / failed nodes kept for inspection
TOUCHING_REL = 4.0e-9  # centre distance within this fraction of the contact distance counts as touching (contact refinement: 1e-9)


class SpaceflightError(Exception):
    """A refused spaceflight request: nothing was changed. Carries an error code for the client."""

    def __init__(self, detail: str, *, code: str, status: int = 409):
        super().__init__(detail)
        self.detail = detail
        self.code = code
        self.status = status


def _due(when: float, now: float) -> bool:
    return when <= now or math.isclose(when, now, rel_tol=1.0e-14, abs_tol=1.0e-9)


def _before(when: float, now: float) -> bool:
    """Strictly earlier than `now` (beyond round-off)."""
    return when < now and not math.isclose(when, now, rel_tol=1.0e-14, abs_tol=1.0e-9)


def _deg(x: float) -> float:
    return math.degrees(x)


def orbit_summary(position, velocity, mass_kg: float, hierarchy: Hierarchy, g: float, names: dict) -> Optional[OrbitOut]:
    """The osculating orbit of a craft about the body whose sphere of influence it is in."""
    ref = hierarchy.reference_for(position)
    if ref is None:
        return None
    return orbit_about(position, velocity, mass_kg, ref, hierarchy, g, names)


def orbit_about(position, velocity, mass_kg: float, ref, hierarchy: Hierarchy, g: float, names: dict) -> OrbitOut:
    r, v = orbits.sub(position, ref.position), orbits.sub(velocity, ref.velocity)
    mu = g * (ref.mass_kg + mass_kg)
    rn, vn = orbits.norm(r), orbits.norm(v)
    soi = hierarchy.soi.get(ref.id, math.inf)
    base = dict(referenceBodyId=ref.id, referenceBodyName=names.get(ref.id, ref.id), radiusM=rn, altitudeM=rn - ref.radius_m, speedMPerS=vn,
                specificEnergyJPerKg=0.5 * vn * vn - mu / rn, circularSpeedMPerS=orbits.circular_speed(mu, rn),
                escapeSpeedMPerS=orbits.escape_speed(mu, rn), sphereOfInfluenceM=None if math.isinf(soi) else soi,
                gravitationalParameterM3PerS2=mu)
    # This runs while a state is being published (after the change it describes is committed), so it must never raise: an orbit
    # whose elements or timings cannot be computed (purely radial, on the edge of parabolic, on an asymptote) is "degenerate".
    try:
        el = orbits.state_to_elements(r, v, mu)
        bound = el.e < 1.0
        regime = "escape" if not bound else "suborbital" if el.periapsis <= ref.radius_m else "bound"
        to_peri = orbits.time_to_true_anomaly(el, mu, 0.0)
        out = OrbitOut(
            regime=regime, semiMajorAxisM=el.a, eccentricity=el.e, inclinationDeg=_deg(el.i), raanDeg=_deg(el.raan), argPeriapsisDeg=_deg(el.argp),
            trueAnomalyDeg=_deg(el.nu), periapsisRadiusM=el.periapsis, apoapsisRadiusM=el.apoapsis if bound else None,
            periapsisAltitudeM=el.periapsis - ref.radius_m, apoapsisAltitudeM=(el.apoapsis - ref.radius_m) if bound else None,
            periodS=orbits.orbital_period(mu, el.a) if bound else None, timeToPeriapsisS=to_peri if (bound or to_peri >= 0.0) else None,
            timeToApoapsisS=orbits.time_to_true_anomaly(el, mu, math.pi) if bound else None, **base)
    except (orbits.OrbitError, ArithmeticError, ValueError):  # ArithmeticError: overflow / division by zero; ValueError: math domain
        return OrbitOut(regime="degenerate", **base)
    numbers = (out.semiMajorAxisM, out.eccentricity, out.periapsisRadiusM, out.apoapsisRadiusM, out.periodS, out.timeToPeriapsisS, out.timeToApoapsisS)
    if any(x is not None and not math.isfinite(x) for x in numbers):
        return OrbitOut(regime="degenerate", **base)
    return out


class SpaceflightMixin:
    # ------------------------------------------------------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------------------------------------------------------
    def _flight_hierarchy(self) -> Hierarchy:
        return build_hierarchy(gravitators(self._sim, set(self._flight.craft)))

    def _flight_names(self) -> dict:
        return {i: m.name for i, m in self._meta.items()}

    def _flight_refuse(self, detail: str, code: str, status: int = 409) -> SpaceflightError:
        return SpaceflightError(detail, code=code, status=status)

    def _flight_craft(self, craft_id: str) -> Spacecraft:
        craft = self._flight.craft.get(craft_id)
        if craft is None or craft_id not in self._meta:
            raise self._flight_refuse(f"unknown spacecraft: {craft_id}", "spacecraft_not_found", 404)
        return craft

    def _flight_body_particle(self, body_id: str, what: str):
        """A gravitating body (not a spacecraft) by id."""
        if body_id not in self._meta or body_id in self._flight.craft:
            raise self._flight_refuse(f"{what} {body_id} is not a body of this universe", "body_not_found", 404)
        return self._particle(body_id)

    def _flight_event_id(self, prefix: str) -> str:
        self._event_seq += 1
        return f"{prefix}-{self._event_seq}"

    # ------------------------------------------------------------------------------------------------------------------
    # reads (called under the lock while a state is published)
    # ------------------------------------------------------------------------------------------------------------------
    def _flight_spacecraft_out(self, body_id: str, p, hierarchy: Hierarchy, names: dict) -> SpacecraftOut:
        craft = self._flight.craft[body_id]
        thrusting = any(m.craft_id == body_id for m in self._flight.executing())
        return SpacecraftOut(
            dryMassKg=craft.dry_mass_kg, propellantKg=craft.propellant_kg, propellantCapacityKg=craft.propellant_capacity_kg,
            thrustN=craft.thrust_n, ispS=craft.isp_s, massFlowKgPerS=mass_flow(craft.thrust_n, craft.isp_s),
            deltaVRemainingMPerS=delta_v_capacity(craft.dry_mass_kg, craft.propellant_kg, craft.isp_s), thrusting=thrusting,
            homeBodyId=craft.home_body_id,
            orbit=orbit_summary((p.x, p.y, p.z), (p.vx, p.vy, p.vz), craft.mass_kg, hierarchy, self._sim.G, names))

    @staticmethod
    def _flight_maneuver_out(m: Maneuver) -> ManeuverOut:
        vnb = m.frame == "vnb"
        return ManeuverOut(
            id=m.id, spacecraftId=m.craft_id, epochS=m.epoch_s, mode=m.mode, frame=m.frame, referenceBodyId=m.reference_body_id,
            progradeMPerS=m.dv[0] if vnb else None, normalMPerS=m.dv[1] if vnb else None, radialMPerS=m.dv[2] if vnb else None,
            deltaVMPerS=None if vnb else V3(x=m.dv[0], y=m.dv[1], z=m.dv[2]), deltaVMagnitudeMPerS=m.dv_magnitude, label=m.label,
            centered=m.centered, missionId=m.mission_id, role=m.role, status=m.status, startS=m.start_s, endS=m.end_s,
            plannedPropellantKg=m.planned_propellant_kg, feasible=m.feasible, startedAtS=m.started_at_s, endedAtS=m.ended_at_s,
            deliveredDeltaVMPerS=m.delivered_dv, propellantUsedKg=m.propellant_used_kg, failure=m.failure)

    def _flight_mission_out(self, mission: Mission, stale: bool) -> MissionOut:
        return MissionOut(
            id=mission.id, name=mission.name, spacecraftId=mission.craft_id, originBodyId=mission.origin_body_id,
            destinationBodyId=mission.destination_body_id, objective=dict(mission.objective), status=mission.status, phase=mission.phase,
            reasons=list(mission.reasons), committed=mission.committed, planRevision=mission.plan_revision, planStale=stale,
            plan=mission.plan, maneuverIds=list(mission.maneuver_ids), checks=list(mission.checks), agreement=list(mission.agreement),
            outcome=mission.outcome, createdAtS=mission.created_at_s, updatedAtS=mission.updated_at_s)

    def _flight_state_out(self, hierarchy: Optional[Hierarchy]) -> Optional[SpaceflightOut]:
        book = self._flight
        if not (book.maneuvers or book.missions):
            return None
        fp = mission_rules.fingerprint(book, hierarchy) if hierarchy is not None else None
        return SpaceflightOut(
            maneuvers=[self._flight_maneuver_out(m) for m in book.maneuvers.values()],
            missions=[self._flight_mission_out(m, m.plan is not None and m.plan_fingerprint != fp) for m in book.missions.values()])

    def _flight_halt_out(self) -> Optional[HaltOut]:
        halt = self._flight.halt
        if halt is None:
            return None
        names = [self._meta[i].name if i in self._meta else i for i in halt.body_ids]
        return HaltOut(eventId=halt.event_id, reason="collision", bodyIds=list(halt.body_ids), simulationTimeS=halt.time_s,
                       relativeSpeedMPerS=halt.relative_speed_m_per_s, refined=halt.refined,
                       message=(f"{names[0]} and {names[1]} collided at t = {halt.time_s:.0f} s (relative speed "
                                f"{halt.relative_speed_m_per_s:.0f} m/s). The simulation is stopped at the contact. Reset, restore a "
                                "snapshot, or move or delete one of the two bodies to continue."))

    def mission_trajectory(self, mission_id: str) -> TrajectoryOut:
        """The planned trajectory of a mission (read from the last committed book; never waits for a step)."""
        mission = self._pub_flight.missions.get(mission_id)
        if mission is None:
            raise self._flight_refuse(f"unknown mission: {mission_id}", "mission_not_found", 404)
        rows = mission.trajectory
        return TrajectoryOut(
            missionId=mission.id, planRevision=mission.plan_revision,
            frame="inertial axes and origin of the universe; a prediction made when the transfer was designed",
            timesS=[r[0] for r in rows], spacecraftM=[list(r[1]) for r in rows], originM=[list(r[2]) for r in rows],
            destinationM=[list(r[3]) for r in rows])

    # ------------------------------------------------------------------------------------------------------------------
    # orbit placement
    # ------------------------------------------------------------------------------------------------------------------
    def _flight_orbit_state(self, spec: OrbitSpec, craft_mass: float, craft_radius: float) -> tuple:
        """(absolute position, absolute velocity, warnings) of an orbit request; raises SpaceflightError(422) when it is not physical."""
        central = self._flight_body_particle(spec.centralBodyId, "the central body")
        mu = self._sim.G * (central.m + craft_mass)
        inclination, raan = math.radians(spec.inclinationDeg), math.radians(spec.raanDeg)
        if spec.matchPlaneOfBodyId is not None:
            if spec.matchPlaneOfBodyId == spec.centralBodyId:
                raise self._flight_refuse("matchPlaneOfBodyId must be another body than the central body", "orbit_invalid", 422)
            other = self._flight_body_particle(spec.matchPlaneOfBodyId, "the plane reference body")
            r_o, v_o = relative_state(other, central)
            h = orbits.cross(r_o, v_o)
            if orbits.norm(h) == 0.0:
                raise self._flight_refuse("the plane reference body moves radially with respect to the central body: it defines no orbit plane",
                                          "orbit_invalid", 422)
            inclination, raan = orbits.plane_of(h)
        e = spec.eccentricity
        if abs(e - 1.0) < orbits.PARABOLIC_TOL:
            raise self._flight_refuse("a parabolic orbit (eccentricity exactly 1) is not supported; use e < 1 or e > 1", "orbit_invalid", 422)
        if spec.periapsisAltitudeM is not None:
            periapsis = central.r + spec.periapsisAltitudeM
            a = periapsis / (1.0 - e)
        else:
            a = spec.semiMajorAxisM
            if (e < 1.0) != (a > 0.0):
                raise self._flight_refuse("the semi-major axis must be positive for e < 1 and negative for e > 1", "orbit_invalid", 422)
            periapsis = a * (1.0 - e)
        if not periapsis > central.r + craft_radius:
            raise self._flight_refuse(
                f"the periapsis ({periapsis:.6g} m from the centre) is not above the surface of the central body (radius {central.r:.6g} m)",
                "orbit_invalid", 422)
        try:
            el = orbits.Elements(a, e, inclination, orbits.wrap(raan), orbits.wrap(math.radians(spec.argPeriapsisDeg)),
                                 orbits.wrap(math.radians(spec.trueAnomalyDeg)))
            r, v = orbits.elements_to_state(el, mu)
        except orbits.OrbitError as exc:
            raise self._flight_refuse(str(exc), "orbit_invalid", 422) from exc
        warnings = []
        hierarchy = self._flight_hierarchy()
        soi = hierarchy.soi.get(spec.centralBodyId, math.inf)
        if e > 1.0:
            warnings.append("escape_trajectory")
        elif el.apoapsis >= soi:
            warnings.append("apoapsis_outside_sphere_of_influence")
        position = (central.x + r[0], central.y + r[1], central.z + r[2])
        velocity = (central.vx + v[0], central.vy + v[1], central.vz + v[2])
        return position, velocity, warnings

    @contextmanager
    def _flight_reading(self):
        """The lock for a preview. A preview needs the live simulation (a body's present state), so unlike the published reads it
        waits while a step runs; but it changes nothing, so giving up is not recorded as a failure of the universe."""
        wait = self.lock_wait_s if self.lock_wait_s is not None else self.step_time_limit_s
        if not self._lock.acquire(timeout=max(wait, 0.0)):
            from backend.simulation import SimulationBusyError  # local: simulation imports this module

            raise SimulationBusyError("the simulation is busy (a step is still running); try the preview again shortly")
        try:
            yield
        finally:
            self._lock.release()

    def preview_orbit(self, spec: OrbitSpec, mass_kg: float, radius_m: float) -> OrbitPreviewOut:
        """What an orbit request would give, without creating anything."""
        with self._flight_reading():
            position, velocity, warnings = self._flight_orbit_state(spec, mass_kg, radius_m)
            hierarchy = self._flight_hierarchy()
            ref = hierarchy.by_id(spec.centralBodyId)
            orbit = orbit_about(position, velocity, mass_kg, ref, hierarchy, self._sim.G, self._flight_names())
            return OrbitPreviewOut(positionM=V3(x=position[0], y=position[1], z=position[2]),
                                   velocityMPerS=V3(x=velocity[0], y=velocity[1], z=velocity[2]), orbit=orbit, warnings=warnings)

    # ------------------------------------------------------------------------------------------------------------------
    # spacecraft CRUD
    # ------------------------------------------------------------------------------------------------------------------
    def add_spacecraft(self, data: SpacecraftCreate, guard=None) -> tuple[Body, list[str]]:
        with self._mutation(guard):
            if len(self._meta) >= MAX_BODIES:
                raise self._flight_refuse(f"body limit reached ({MAX_BODIES})", "body_limit")
            if len(self._flight.craft) >= MAX_SPACECRAFT:
                raise self._flight_refuse(f"spacecraft limit reached ({MAX_SPACECRAFT})", "spacecraft_limit")
            mass = data.dryMassKg + data.propellantKg
            warnings: list[str] = []
            home = None
            if data.orbit is not None:
                position, velocity, warnings = self._flight_orbit_state(data.orbit, mass, data.radiusM)
                home = data.orbit.centralBodyId
            else:
                position = (data.state.positionM.x, data.state.positionM.y, data.state.positionM.z)
                velocity = (data.state.velocityMPerS.x, data.state.velocityMPerS.y, data.state.velocityMPerS.z)
                if data.state.relativeToBodyId is not None:
                    ref = self._flight_body_particle(data.state.relativeToBodyId, "the reference body")
                    position = (ref.x + position[0], ref.y + position[1], ref.z + position[2])
                    velocity = (ref.vx + velocity[0], ref.vy + velocity[1], ref.vz + velocity[2])
                    home = data.state.relativeToBodyId
            self._require_free(Position3(x=position[0], y=position[1], z=position[2]), data.radiusM, ignore_id=None)
            body_id = f"{SPACECRAFT_NAME_PREFIX}{uuid.uuid4().hex[:12]}"
            while body_id in self._meta:
                body_id = f"{SPACECRAFT_NAME_PREFIX}{uuid.uuid4().hex[:12]}"
            add_named_particle(self._sim, body_id, m=mass, r=data.radiusM, x=position[0], y=position[1], z=position[2],
                               vx=velocity[0], vy=velocity[1], vz=velocity[2])
            self._meta[body_id] = self._flight_meta(data.name, data.colorHex)
            self._flight.put(Spacecraft(id=body_id, dry_mass_kg=data.dryMassKg, propellant_kg=data.propellantKg,
                                        propellant_capacity_kg=data.propellantKg, thrust_n=data.thrustN, isp_s=data.ispS,
                                        home_body_id=home, created_at_s=self._sim.t))
            self._sim.collision_resolve = self._collision_callback()  # contacts of a spacecraft stop the simulation in every mode
            select_ias15(self._sim)
            self._history.bump_segment()
            self._audit("add", body_id, {"name": data.name, "massKg": mass, "radiusM": data.radiusM, "positionM": list(position),
                                          "velocityMPerS": list(velocity), "kind": "spacecraft"}, True)
        return self._flight_body(body_id), warnings

    @staticmethod
    def _flight_meta(name: str, color: str):
        from backend.simulation import BodyMeta  # local: simulation imports this module

        return BodyMeta(name, color, "spacecraft", None, "spacecraft", None, None)

    def _flight_body(self, body_id: str) -> Body:
        return self._body(body_id, self._particle(body_id), flight=(self._flight_hierarchy(), self._flight_names()))

    def update_spacecraft(self, craft_id: str, patch: SpacecraftUpdate, guard=None) -> Body:
        with self._mutation(guard):
            craft = self._flight_craft(craft_id)
            if any(m.craft_id == craft_id for m in self._flight.executing()):
                raise self._flight_refuse("the spacecraft is burning: its propulsion cannot be edited until the burn ends", "burn_in_progress")
            fields = patch.model_fields_set
            dry = patch.dryMassKg if "dryMassKg" in fields else craft.dry_mass_kg
            propellant = patch.propellantKg if "propellantKg" in fields else craft.propellant_kg
            updated = replace(craft, dry_mass_kg=dry, propellant_kg=propellant,
                              propellant_capacity_kg=max(craft.propellant_capacity_kg, propellant),
                              thrust_n=patch.thrustN if "thrustN" in fields else craft.thrust_n,
                              isp_s=patch.ispS if "ispS" in fields else craft.isp_s)
            self._flight.put(updated)
            self._flight_reschedule(craft_id)  # raises before anything else changed if the new engine cannot fly the pending nodes
            p = self._particle(craft_id)
            changes = {k: [getattr(craft, a), getattr(updated, a)] for k, a in (("dryMassKg", "dry_mass_kg"), ("propellantKg", "propellant_kg"),
                                                                              ("thrustN", "thrust_n"), ("ispS", "isp_s")) if k in fields}
            if p.m != updated.mass_kg:
                p.m = updated.mass_kg
                select_ias15(self._sim)
            self._flight.physics_epoch += 1
            self._audit("update", craft_id, changes, True)
        return self._flight_body(craft_id)

    def _flight_body_removed(self, body_id: str) -> None:
        """A body left the universe (deleted by the user): drop what referred to it. Missions notice on their next evaluation."""
        book = self._flight
        was_craft = book.craft.pop(body_id, None) is not None
        for m in list(book.maneuvers.values()):
            if m.pending and (m.craft_id == body_id or m.reference_body_id == body_id):
                book.amend(m, status="failed", failure="the spacecraft was removed" if m.craft_id == body_id else "the reference body was removed",
                           ended_at_s=self._sim.t)
        if book.halt is not None and body_id in book.halt.body_ids:
            book.halt = None
        book.physics_epoch += 1
        if was_craft:
            self._sim.collision_resolve = self._collision_callback()

    def _flight_body_edited(self, body_id: str) -> None:
        """A body's mass, radius, position or velocity was edited by hand."""
        book = self._flight
        if book.halt is not None and body_id in book.halt.body_ids:
            book.halt = None  # the contact was changed by the user; if the bodies still touch the next step stops again
        book.physics_epoch += 1

    # ------------------------------------------------------------------------------------------------------------------
    # manoeuvre nodes
    # ------------------------------------------------------------------------------------------------------------------
    def _flight_reschedule(self, craft_id: str, lenient: bool = False) -> None:
        """Recompute the burn windows of a craft's planned nodes from the mass predicted at each ignition, in time order. Raises
        (before the caller commits) when a window would start in the past or overlap another burn."""
        book = self._flight
        craft = book.craft.get(craft_id)
        if craft is None:
            return
        now = self._sim.t
        mass, propellant, busy_until = craft.mass_kg, craft.propellant_kg, -math.inf
        for m in book.executing():
            if m.craft_id == craft_id:  # a burn in progress ends at its own cutoff
                spent = m.mass_flow_kg_per_s * (m.end_s - now)
                mass, propellant, busy_until = mass - spent, propellant - spent, m.end_s
        planned = sorted((m for m in book.maneuvers.values() if m.craft_id == craft_id and m.status == "planned"), key=lambda m: m.epoch_s)
        for m in planned:
            dv = m.dv_magnitude
            if m.mode == "finite" and dv > 0.0:
                window = burn_window(dv, m.epoch_s, m.centered, mass, propellant, craft.thrust_n, craft.isp_s)
                start, end, used, feasible = window.start_s, window.end_s, window.propellant_kg, window.feasible
            else:
                impulse = plan_impulse((dv, 0.0, 0.0), mass, propellant, craft.isp_s)
                start = end = m.epoch_s
                used, feasible = impulse.propellant_used_kg, impulse.shortfall <= dv * mission_rules.SHORTFALL_REL
            earliest = max(now, busy_until)
            if lenient and _before(start, earliest):
                # removing a node must never be refused because of ANOTHER node: with more mass on board a later centred burn is
                # longer and would have to start earlier; it then starts as early as it can instead (the node says when)
                start, end = earliest, earliest + (end - start)
            if _before(start, now):
                raise self._flight_refuse(
                    f"the burn of node {m.label or m.id} would have to start at t = {start:.3f} s, before the present time {now:.3f} s "
                    "(a centred finite burn starts half its duration before the node)", "maneuver_in_past", 422)
            if _before(start, busy_until):
                raise self._flight_refuse(f"the burn of node {m.label or m.id} overlaps another burn of the same spacecraft", "maneuver_overlap", 422)
            book.amend(m, start_s=start, end_s=end, planned_propellant_kg=used, feasible=feasible)
            mass, propellant, busy_until = mass - used, propellant - used, end

    def _flight_node_epoch(self, craft_id: str, data: ManeuverCreate, reference_id: Optional[str]) -> float:
        now = self._sim.t
        if data.at == "epoch":
            return data.epochS
        if data.at == "now":
            return now + data.delayS
        if reference_id is None:
            raise self._flight_refuse("an apsis needs a reference body", "maneuver_invalid", 422)
        p, q = self._particle(craft_id), self._particle(reference_id)
        r, v = relative_state(p, q)
        mu = self._sim.G * (p.m + q.m)
        try:
            el = orbits.state_to_elements(r, v, mu)
        except orbits.OrbitError as exc:
            raise self._flight_refuse(f"the orbit about {reference_id} has no apsides: {exc}", "maneuver_invalid", 422) from exc
        if data.at == "apoapsis":
            if not el.e < 1.0:
                raise self._flight_refuse("an escape trajectory has no apoapsis", "maneuver_invalid", 422)
            wait = orbits.time_to_true_anomaly(el, mu, math.pi)
        else:
            wait = orbits.time_to_true_anomaly(el, mu, 0.0)
            if wait < 0.0:
                raise self._flight_refuse("the periapsis of this escape trajectory has already passed", "maneuver_invalid", 422)
        return now + wait + data.delayS

    def _flight_new_node(self, craft_id: str, data: ManeuverCreate) -> Maneuver:
        craft = self._flight_craft(craft_id)
        components = data.components()
        magnitude = math.sqrt(sum(c * c for c in components))
        if not magnitude > 0.0:
            raise self._flight_refuse("a manoeuvre needs a non-zero delta-v", "maneuver_invalid", 422)
        if not craft.has_engine:
            raise self._flight_refuse("this spacecraft has no engine (specific impulse 0): it cannot manoeuvre", "no_propulsion")
        if data.mode == "finite" and not craft.thrust_n > 0.0:
            raise self._flight_refuse("a finite burn needs a thrust above zero", "no_propulsion")
        reference_id = None
        if data.frame == "vnb" or data.at in ("periapsis", "apoapsis"):
            reference_id = data.referenceBodyId
            if reference_id is None:
                p = self._particle(craft_id)
                ref = self._flight_hierarchy().reference_for((p.x, p.y, p.z))
                if ref is None:
                    raise self._flight_refuse("there is no body to define the manoeuvre frame; use the inertial frame", "maneuver_invalid", 422)
                reference_id = ref.id
            self._flight_body_particle(reference_id, "the reference body")
        epoch = self._flight_node_epoch(craft_id, data, reference_id)
        if _before(epoch, self._sim.t):
            raise self._flight_refuse(f"the node time {epoch:.3f} s is before the present time {self._sim.t:.3f} s", "maneuver_in_past", 422)
        if len(self._flight.pending_maneuvers()) >= MAX_PENDING_MANEUVERS:
            raise self._flight_refuse(f"too many pending manoeuvre nodes ({MAX_PENDING_MANEUVERS})", "maneuver_limit")
        return Maneuver(id=self._flight.next_id("mnv"), craft_id=craft_id, epoch_s=max(epoch, self._sim.t), mode=data.mode, frame=data.frame,
                        reference_body_id=reference_id if data.frame == "vnb" else None, dv=components, label=data.label,
                        centered=data.centered and not (data.at == "now" and data.delayS == 0.0),  # "now": ignition now
                        start_s=epoch, end_s=epoch)

    def add_maneuver(self, craft_id: str, data: ManeuverCreate, guard=None) -> ManeuverOut:
        """Schedule a node. An impulsive node at the present time executes at once (the state changes in this request)."""
        with self._mutation(guard):
            if self._flight.halt is not None:
                raise self._flight_refuse(self._flight_halt_out().message, "simulation_halted")
            node = self._flight_new_node(craft_id, data)
            before = self._flight.copy()
            try:
                self._flight.put(node)
                self._flight_reschedule(craft_id)
            except SpaceflightError:
                self._flight = before
                raise
            self._flight.physics_epoch += 1
            node = self._flight.maneuvers[node.id]
            if node.mode == "impulsive" and _due(node.epoch_s, self._sim.t):
                self._pending = []
                self._flight_events_due()
                self._events.extend(self._pending)
                self._pending = []
                self._flight_evaluate()
            self._flight_trim()
            return self._flight_maneuver_out(self._flight.maneuvers[node.id])

    def preview_maneuver(self, craft_id: str, data: ManeuverCreate) -> ManeuverPreviewOut:
        """The orbit an impulsive version of this node would give. The state at a future node is a TWO-BODY propagation of the present
        osculating orbit about the reference body (an estimate: exact only without perturbations); nothing is changed."""
        with self._flight_reading():
            craft = self._flight_craft(craft_id)
            before_book = self._flight.copy()
            try:
                node = self._flight_new_node(craft_id, data)
            finally:
                self._flight = before_book
            hierarchy, names, g = self._flight_hierarchy(), self._flight_names(), self._sim.G
            p = self._particle(craft_id)
            ref = hierarchy.by_id(node.reference_body_id) if node.reference_body_id else hierarchy.reference_for((p.x, p.y, p.z))
            if ref is None:
                raise self._flight_refuse("there is no body to describe an orbit about", "maneuver_invalid", 422)
            r, v = orbits.sub((p.x, p.y, p.z), ref.position), orbits.sub((p.vx, p.vy, p.vz), ref.velocity)
            mu = g * (ref.mass_kg + craft.mass_kg)
            wait = node.epoch_s - self._sim.t
            basis = "present state"
            if wait > 0.0:
                try:
                    r, v = orbits.propagate_kepler(r, v, mu, wait)
                    basis = "two-body propagation of the present osculating orbit to the node (an estimate)"
                except (orbits.OrbitError, ArithmeticError, ValueError) as exc:
                    raise self._flight_refuse(f"the orbit cannot be propagated to the node: {exc}", "maneuver_invalid", 422) from exc
            still = replace(ref, position=(0.0, 0.0, 0.0), velocity=(0.0, 0.0, 0.0))
            frame = Hierarchy((still,), {still.id: None}, {still.id: hierarchy.soi.get(ref.id, math.inf)})
            try:
                dv = burn_vector(node.frame, node.dv, r, v)
            except orbits.OrbitError as exc:
                raise self._flight_refuse(str(exc), "maneuver_invalid", 422) from exc
            impulse = plan_impulse(dv, craft.mass_kg, craft.propellant_kg, craft.isp_s)
            window = burn_window(node.dv_magnitude, node.epoch_s, node.centered, craft.mass_kg, craft.propellant_kg, craft.thrust_n, craft.isp_s)
            after_v = orbits.add(v, impulse.delta_v)
            return ManeuverPreviewOut(
                epochS=node.epoch_s, basis=basis, deltaVMagnitudeMPerS=node.dv_magnitude, propellantKg=impulse.propellant_used_kg,
                burnDurationS=(window.end_s - window.start_s) if node.mode == "finite" else 0.0,
                feasible=impulse.shortfall <= node.dv_magnitude * mission_rules.SHORTFALL_REL,
                before=orbit_about(r, v, craft.mass_kg, still, frame, g, names),
                after=orbit_about(r, after_v, craft.mass_kg - impulse.propellant_used_kg, still, frame, g, names))

    def delete_maneuver(self, maneuver_id: str, guard=None) -> None:
        with self._mutation(guard):
            node = self._flight.maneuvers.get(maneuver_id)
            if node is None:
                raise self._flight_refuse(f"unknown manoeuvre node: {maneuver_id}", "maneuver_not_found", 404)
            if node.status == "executing":
                raise self._flight_refuse("this burn is in progress and cannot be removed", "burn_in_progress")
            del self._flight.maneuvers[maneuver_id]
            if node.status == "planned":
                self._flight_reschedule(node.craft_id, lenient=True)
                self._flight.physics_epoch += 1
            self._flight_evaluate()

    def _flight_trim(self) -> None:
        """Keep every pending node and node of a live mission; drop the oldest finished ones beyond the record limit."""
        book = self._flight
        finished = [m for m in book.maneuvers.values() if not m.pending]
        keep = {i for mission in book.missions.values() for i in mission.maneuver_ids}
        for m in finished[:max(0, len(finished) - MAX_MANEUVER_RECORDS)]:
            if m.id not in keep:
                del book.maneuvers[m.id]

    # ------------------------------------------------------------------------------------------------------------------
    # executing nodes (under the step lock, the simulation exactly at the node time)
    # ------------------------------------------------------------------------------------------------------------------
    def _flight_emit(self, node: Maneuver, phase: str, delivered: float, used: float) -> None:
        self._pending.append(ManeuverEvent(
            id=self._flight_event_id("burn"), type="maneuver", simulationTimeS=self._sim.t, bodyIds=[node.craft_id], maneuverId=node.id,
            phase=phase, mode=node.mode, referenceBodyId=node.reference_body_id, commandedDeltaVMPerS=node.dv_magnitude,
            deliveredDeltaVMPerS=delivered, propellantUsedKg=used, missionId=node.mission_id, label=node.label))

    def _flight_node_frame(self, node: Maneuver):
        """(craft, particle, relative state or None, failure text or None) for a node about to execute."""
        craft = self._flight.craft.get(node.craft_id)
        if craft is None or node.craft_id not in self._meta:
            return None, None, None, "the spacecraft no longer exists"
        p = self._particle(node.craft_id)
        if node.reference_body_id is None:
            return craft, p, None, None
        if node.reference_body_id not in self._meta:
            return craft, p, None, "the reference body no longer exists"
        return craft, p, relative_state(p, self._particle(node.reference_body_id)), None

    def _flight_engine_busy(self, node: Maneuver) -> Optional[str]:
        """One engine per craft. The schedule keeps a craft's burns apart, but a burn re-timed at ignition (the mass on board was
        not the predicted one) can run into the next node: that node fails instead of two burns sharing one propellant account."""
        other = next((m for m in self._flight.executing() if m.craft_id == node.craft_id and m.id != node.id), None)
        return None if other is None else f"the engine was still burning for {other.label or other.id} when this node came due"

    def _flight_execute(self, node: Maneuver) -> None:
        """An impulsive node (or an observation) whose time has come."""
        book, t = self._flight, self._sim.t
        craft, p, state, failure = self._flight_node_frame(node)
        if failure is None and not node.is_observation:
            failure = self._flight_engine_busy(node)
        if failure is not None:
            book.amend(node, status="failed", failure=failure, ended_at_s=t)
            return
        if node.is_observation:
            book.amend(node, status="executed", started_at_s=t, ended_at_s=t, actual_state=state, actual_state_after=state,
                       delivered_dv=0.0, propellant_used_kg=0.0)
            return
        try:
            vector = burn_vector(node.frame, node.dv, None if state is None else state[0], None if state is None else state[1])
        except orbits.OrbitError as exc:
            book.amend(node, status="failed", failure=f"the manoeuvre frame is undefined: {exc}", ended_at_s=t)
            return
        impulse = plan_impulse(vector, craft.mass_kg, craft.propellant_kg, craft.isp_s)
        if impulse.delivered <= 0.0:
            book.amend(node, status="failed", failure="no propellant on board", started_at_s=t, ended_at_s=t, actual_state=state,
                       delivered_dv=0.0, propellant_used_kg=0.0)
            return
        p.vx, p.vy, p.vz = p.vx + impulse.delta_v[0], p.vy + impulse.delta_v[1], p.vz + impulse.delta_v[2]
        updated = book.amend(craft, propellant_kg=max(craft.propellant_kg - impulse.propellant_used_kg, 0.0))
        p.m = updated.mass_kg
        after = None if node.reference_body_id is None else relative_state(p, self._particle(node.reference_body_id))
        short = impulse.shortfall > node.dv_magnitude * mission_rules.SHORTFALL_REL
        book.amend(node, status="executed", started_at_s=t, ended_at_s=t, actual_state=state, actual_state_after=after,
                   delivered_dv=impulse.delivered, propellant_used_kg=impulse.propellant_used_kg,
                   failure=f"the propellant ran out: {impulse.delivered:.3f} of {node.dv_magnitude:.3f} m/s delivered" if short else None)
        select_ias15(self._sim)  # the velocity jumped: IAS15's predictor is stale
        self._flight_emit(node, "impulse", impulse.delivered, impulse.propellant_used_kg)

    def _flight_ignite(self, node: Maneuver) -> None:
        book, t = self._flight, self._sim.t
        craft, p, state, failure = self._flight_node_frame(node)
        if failure is None:
            failure = self._flight_engine_busy(node)
        if failure is None and not (craft.thrust_n > 0.0 and craft.has_engine):
            failure = "the spacecraft has no engine"
        if failure is None and not craft.propellant_kg > 0.0:
            failure = "no propellant on board"
        direction = None
        if failure is None and node.frame == "inertial":
            direction = orbits.unit(node.dv)
        if failure is None and node.frame == "vnb":
            try:
                orbits.vnb_axes(state[0], state[1])
            except orbits.OrbitError as exc:
                failure = f"the manoeuvre frame is undefined: {exc}"
        if failure is not None:
            book.amend(node, status="failed", failure=failure, ended_at_s=t)
            return
        window = burn_window(node.dv_magnitude, t, False, craft.mass_kg, craft.propellant_kg, craft.thrust_n, craft.isp_s)
        book.amend(node, status="executing", started_at_s=t, start_s=t, end_s=window.end_s, ignition_mass_kg=craft.mass_kg,
                   mass_flow_kg_per_s=mass_flow(craft.thrust_n, craft.isp_s), burn_direction=direction, actual_state=state,
                   planned_propellant_kg=window.propellant_kg, feasible=window.feasible)
        select_ias15(self._sim)  # the force changes discontinuously at ignition
        self._flight_emit(node, "ignition", 0.0, 0.0)

    def _flight_burn_progress(self, node: Maneuver, t: float) -> tuple[float, float]:
        """(mass now, propellant used so far) of a burning node at time t (clamped to its cutoff)."""
        if _due(node.end_s, t):
            used = node.planned_propellant_kg  # exact: flow x (end - start) loses digits when the times are large and the burn short
        else:
            used = min(max(node.mass_flow_kg_per_s * (t - node.started_at_s), 0.0), node.planned_propellant_kg)
        return node.ignition_mass_kg - used, used

    def _flight_sync_masses(self) -> None:
        """Bring the mass of every burning craft (book and particle) to the present time."""
        book, t = self._flight, self._sim.t
        for node in book.executing():
            craft = book.craft.get(node.craft_id)
            if craft is None or node.craft_id not in self._meta:
                continue
            mass, _ = self._flight_burn_progress(node, t)
            updated = book.amend(craft, propellant_kg=max(mass - craft.dry_mass_kg, 0.0))
            self._particle(node.craft_id).m = updated.mass_kg

    def _flight_cutoff(self, node: Maneuver) -> None:
        book, t = self._flight, self._sim.t
        craft = book.craft.get(node.craft_id)
        if craft is None or node.craft_id not in self._meta:
            book.amend(node, status="failed", failure="the spacecraft no longer exists", ended_at_s=t)
            return
        self._flight_end_burn(node, node.end_s, None)

    def _flight_end_burn(self, node: Maneuver, burned_until: float, failure: Optional[str]) -> None:
        """Close a burning node whose engine pushed until `burned_until`: book the propellant and the delta-v actually delivered.
        `failure`: why it ended before its cutoff (None: the regular cutoff)."""
        book, t = self._flight, self._sim.t
        craft = book.craft[node.craft_id]
        mass, used = self._flight_burn_progress(node, burned_until)
        updated = book.amend(craft, propellant_kg=max(mass - craft.dry_mass_kg, 0.0))
        p = self._particle(node.craft_id)
        p.m = updated.mass_kg
        delivered = exhaust_velocity(craft.isp_s) * math.log(node.ignition_mass_kg / mass) if mass > 0.0 else math.inf
        after = None
        if node.reference_body_id is not None and any(q.name == node.reference_body_id for q in self._sim.particles):
            after = relative_state(p, self._particle(node.reference_body_id))
        short = delivered < node.dv_magnitude * (1.0 - mission_rules.SHORTFALL_REL)
        if failure is not None:
            book.amend(node, status="failed", ended_at_s=t, end_s=burned_until, delivered_dv=delivered, propellant_used_kg=used, actual_state_after=after,
                       failure=f"{failure}: {delivered:.3f} of {node.dv_magnitude:.3f} m/s delivered")
        else:
            book.amend(node, status="executed", ended_at_s=t, delivered_dv=delivered, propellant_used_kg=used, actual_state_after=after,
                       failure=f"the propellant ran out: {delivered:.3f} of {node.dv_magnitude:.3f} m/s delivered" if short else None)
        select_ias15(self._sim)
        self._flight_emit(node, "cutoff", delivered, used)

    def _flight_check_burns(self, lost: Optional[dict] = None) -> None:
        """A VNB burn whose reference body no longer exists (merged away) has no frame to point in: the engine is shut down and the
        node fails with what it delivered. `lost`: craft id -> the time the thrust force stopped pushing (inside an integration)."""
        burning = [m for m in self._flight.executing() if m.frame == "vnb"]
        if not burning:
            return
        present = {p.name for p in self._sim.particles}  # not `_meta`: a merge inside the integration is booked there only later
        for node in burning:
            if node.craft_id not in self._flight.craft or node.craft_id not in present:
                continue  # the craft itself is gone: its cutoff says so
            if node.reference_body_id not in present:
                until = (lost or {}).get(node.craft_id, self._sim.t)
                self._flight_end_burn(node, until, "the reference body of the burn no longer exists (it merged with another body); the engine was shut down")

    def _flight_events_due(self) -> None:
        """Everything scheduled at (or before) the present time: cutoffs first, then impulses, observations and ignitions in time order."""
        book, t = self._flight, self._sim.t
        while True:
            for node in list(book.executing()):
                if _due(node.end_s, t):
                    self._flight_cutoff(node)
            due = sorted((m for m in book.maneuvers.values() if m.status == "planned" and _due(m.start_s, t)), key=lambda m: (m.start_s, m.epoch_s))
            if not due:
                return
            for node in due:  # each leaves the "planned" state, so the loop ends
                if node.mode == "finite" and not node.is_observation:
                    self._flight_ignite(node)
                else:
                    self._flight_execute(node)
            # again: a burn shorter than the time resolution (almost no propellant left) is already due for its cutoff, and
            # `_flight_next_boundary` would never stop at a boundary that is not in the future: the engine would keep thrusting

    def _flight_next_boundary(self, t: float) -> float:
        nxt = math.inf
        for m in self._flight.maneuvers.values():
            when = m.end_s if m.status == "executing" else m.start_s if m.status == "planned" else None
            if when is not None and not _due(when, t) and when < nxt:
                nxt = when
        return nxt

    def _flight_active_burns(self) -> list[ActiveBurn]:
        burns = []
        for node in self._flight.executing():
            craft = self._flight.craft.get(node.craft_id)
            if craft is None or node.craft_id not in self._meta:
                continue
            if node.frame == "vnb":
                reference, components = node.reference_body_id, orbits.unit(node.dv)
            else:
                reference, components = None, node.burn_direction
            burns.append(ActiveBurn(node.craft_id, reference, components, craft.thrust_n, node.mass_flow_kg_per_s, node.ignition_mass_kg,
                                    node.started_at_s))
        return burns

    def _flight_integrate(self, target: float) -> None:
        """`sim.integrate(target)` with the thrust of every burning engine."""
        self._step_guard.arm(self._sim)  # a collapsed PRS23 step is handed to GLOBAL from the heartbeat (backend/collisions.py)
        try:
            self._flight_integrate_guarded(target)
        finally:
            self._step_guard.release(self._sim)

    def _flight_integrate_guarded(self, target: float) -> None:
        sim = self._sim
        if not (self._flight.maneuvers and self._flight.executing()):
            sim.integrate(target)
            return
        self._flight_check_burns()  # a reference body removed between integrations (deferred collision resolution)
        burns = self._flight_active_burns()
        if not burns:
            sim.integrate(target)
            return
        self._thrust.bind(sim, burns)
        try:
            sim.integrate(target)
        finally:
            lost = self._thrust.release(sim)
        if self._thrust.errors:
            error = self._thrust.errors[-1]
            self._thrust.errors.clear()
            raise RuntimeError("thrust force failed:\n" + error)
        self._flight_check_burns(lost)  # a reference body merged away inside this integration (legacy merge in the callback)

    def _flight_advance(self, target: float) -> None:
        """Advance to `target`, landing exactly on every manoeuvre boundary on the way (the grid-history analogue for burns)."""
        if not self._flight.has_pending():
            self._advance_to(target)
            return
        while True:
            self._flight_events_due()
            t = self._sim.t
            if t >= target or self._budget_hit or self._halted_now:
                break
            nxt = min(target, self._flight_next_boundary(t))
            self._advance_to(nxt)
            self._flight_sync_masses()
            if self._sim.t < nxt:
                break  # the step ended early (collision budget or a halt)

    # ------------------------------------------------------------------------------------------------------------------
    # stop-on-contact
    # ------------------------------------------------------------------------------------------------------------------
    def _flight_legacy_callback(self, sim_ptr, col) -> int:
        """`legacy-merge` universes that hold a spacecraft: a pair with a spacecraft is recorded (and integration stopped), every
        other pair goes to the unchanged merge resolver."""
        try:
            sim = sim_ptr.contents
            if col.p1 < sim.N and col.p2 < sim.N and col.p1 != col.p2:
                craft = self._flight.craft
                if sim.particles[col.p1].name in craft or sim.particles[col.p2].name in craft:
                    return self._recorder.resolve(sim_ptr, col)
        except Exception:  # noqa: BLE001 - ctypes would swallow it
            self._recorder.errors.append(traceback.format_exc())
            return 0
        return self._resolver.resolve(sim_ptr, col)

    def _flight_stops(self) -> bool:
        """Does this universe have any contact that must stop the simulation?"""
        return self._stop_mode or bool(self._flight.craft)

    def _flight_halt_contacts(self) -> bool:
        """After an `integrate`: if a recorded contact must stop the simulation, stop it (True). Pairs that do not are left to
        the universe's own resolver."""
        if not self._flight_stops():
            return False
        if self._recorder.errors:
            if self._deferred:
                return False  # outcome-v1 reports a detection failure through its own path (_resolve_contacts)
            raise RuntimeError("contact detection failed:\n" + self._recorder.errors[-1])
        craft = self._flight.craft
        pairs = [c for c in self._recorder.pending if self._stop_mode or c.first_id in craft or c.second_id in craft]
        if not pairs:
            return False
        self._recorder.pending = []  # anything else recorded in this pass is still touching: it is detected again after the halt is cleared
        return self._flight_halt_on(pairs)

    def _flight_touching(self) -> bool:
        """Before a step integrates anything: a pair that must stop the simulation and is ALREADY in contact and closing (a halt
        that was cleared without separating the bodies) stops it at once, with the state exactly as it is. Without this the swept
        test would report the pair only at the end of the first internal step, well inside the other body."""
        if not self._flight_stops():
            return False
        ps = list(self._sim.particles)
        craft = self._flight.craft
        for i, a in enumerate(ps):
            for b in ps[i + 1:]:
                if not (self._stop_mode or a.name in craft or b.name in craft):
                    continue
                r = (b.x - a.x, b.y - a.y, b.z - a.z)
                contact = a.r + b.r
                if orbits.dot(r, r) > (contact * (1.0 + TOUCHING_REL)) ** 2:
                    continue
                v = (b.vx - a.vx, b.vy - a.vy, b.vz - a.vz)
                if orbits.dot(r, v) >= 0.0:
                    continue  # touching but separating: let it go
                speed = orbits.norm(v)
                ids = tuple(sorted((a.name, b.name), key=lambda k: (k not in craft, k)))
                event = ContactEvent(id=self._flight_event_id("halt"), type="contact", simulationTimeS=self._sim.t,
                                     estimatedContactTimeS=self._sim.t, bodyIds=list(ids), relativeSpeedMPerS=speed, refined=True,
                                     involvesSpacecraft=ids[0] in craft or ids[1] in craft)
                self._pending.append(event)
                self._flight.halt = Halt(event_id=event.id, body_ids=ids, time_s=self._sim.t, relative_speed_m_per_s=speed, refined=True)
                self._halted_now = True
                return True
        return False

    def _flight_halt_on(self, pairs: list) -> bool:
        # the contact helpers belong to the collision package, which only the wired modules import (tests/impact/test_contracts.py)
        from backend.simulation import order_key, refine_contact

        sim = self._sim
        by_id = self._particles_by_id()
        best = None
        for c in pairs:
            a, b = by_id.get(c.first_id), by_id.get(c.second_id)
            if a is None or b is None:
                continue
            r_rel = [b.x - a.x, b.y - a.y, b.z - a.z]
            u_rel = [b.vx - a.vx, b.vy - a.vy, b.vz - a.vz]
            estimate = contact_time_estimate(c.time_s, abs(c.dt_last_done), r_rel, u_rel, a.r + b.r)
            key = order_key(c, estimate)
            if best is None or key < best[0]:
                best = (key, c, estimate)
        if best is None:
            return False
        _, c, estimate = best
        a, b = by_id[c.first_id], by_id[c.second_id]
        refined = None
        if not self._flight.executing():  # the back-integration follows gravity only: not valid across a burn
            refined = refine_contact(sim, c.first_id, c.second_id, c.time_s - abs(c.dt_last_done), a.r + b.r)
        if refined is not None:
            for p in sim.particles:
                (p.x, p.y, p.z), (p.vx, p.vy, p.vz) = refined.states[p.name]
            sim.t = refined.time_s
            a, b = self._particle(c.first_id), self._particle(c.second_id)
        select_ias15(sim)
        speed = math.dist((a.vx, a.vy, a.vz), (b.vx, b.vy, b.vz))
        craft = self._flight.craft
        ids = tuple(sorted((c.first_id, c.second_id), key=lambda i: (i not in craft, i)))  # a spacecraft is named first
        event = ContactEvent(id=self._flight_event_id("halt"), type="contact", simulationTimeS=sim.t, estimatedContactTimeS=estimate,
                             bodyIds=list(ids), relativeSpeedMPerS=speed, refined=refined is not None,
                             involvesSpacecraft=ids[0] in craft or ids[1] in craft)
        self._pending.append(event)
        self._flight.halt = Halt(event_id=event.id, body_ids=ids, time_s=sim.t, relative_speed_m_per_s=speed, refined=refined is not None)
        self._halted_now = True
        return True

    # ------------------------------------------------------------------------------------------------------------------
    # missions
    # ------------------------------------------------------------------------------------------------------------------
    def _flight_evaluate(self) -> None:
        book = self._flight
        if not book.missions:
            return
        hierarchy = self._flight_hierarchy()
        by_id = self._particles_by_id()
        names = self._flight_names()
        for mission in list(book.missions.values()):
            p = by_id.get(mission.craft_id) if mission.craft_id in self._meta else None
            state = None if p is None else ((p.x, p.y, p.z), (p.vx, p.vy, p.vz))
            updated = mission_rules.evaluate(mission, book, self._sim.t, hierarchy, state, self._sim.G, names)
            if updated is not mission:
                book.put(updated)

    def _flight_mission(self, mission_id: str) -> Mission:
        mission = self._flight.missions.get(mission_id)
        if mission is None:
            raise self._flight_refuse(f"unknown mission: {mission_id}", "mission_not_found", 404)
        return mission

    def _flight_mission_now(self, mission_id: str) -> MissionOut:
        """The mission as the state about to be published will show it. Called under the lock, at the end of the mutation that
        changed it, so a concurrent request cannot come between the change and its answer."""
        mission = self._flight_mission(mission_id)
        stale = mission.plan is not None and mission.plan_fingerprint != mission_rules.fingerprint(self._flight, self._flight_hierarchy())
        return self._flight_mission_out(mission, stale)

    def create_mission(self, data: MissionCreate, guard=None) -> MissionOut:
        with self._mutation(guard):
            self._flight_craft(data.spacecraftId)
            self._flight_body_particle(data.destinationBodyId, "the destination")
            if len(self._flight.missions) >= MAX_MISSIONS:
                raise self._flight_refuse(f"mission limit reached ({MAX_MISSIONS}); delete one first", "mission_limit")
            if any(m.craft_id == data.spacecraftId and m.status in ("draft", "planned", "in_progress") for m in self._flight.missions.values()):
                raise self._flight_refuse("this spacecraft already has an open mission; finish, abort or delete it first", "mission_conflict")
            t = self._sim.t
            mission = Mission(id=self._flight.next_id("msn"), name=data.name, craft_id=data.spacecraftId,
                              destination_body_id=data.destinationBodyId, objective=data.objective.model_dump(), created_at_s=t, updated_at_s=t)
            self._flight.put(mission)
            out = self._flight_mission_now(mission.id)
        return out

    def plan_mission(self, mission_id: str, request: MissionPlanRequest, guard=None) -> MissionOut:
        """Design the transfer. The universe is copied under the lock, the design runs on the copy WITHOUT the lock (steps and reads
        go on), and the result is stored only if the universe is still the one the plan was made for."""
        if not self._plan_slot.acquire(blocking=False):  # one design at a time per universe: each one occupies a worker for seconds
            raise self._flight_refuse("a transfer is already being designed in this universe; wait for it to finish", "plan_in_progress")
        try:
            return self._flight_plan(mission_id, request, guard)
        finally:
            self._plan_slot.release()

    def _flight_plan(self, mission_id: str, request: MissionPlanRequest, guard) -> MissionOut:
        with self._guard():
            if guard is not None:
                guard()
            mission = self._flight_mission(mission_id)
            if mission.committed and mission.status in ("planned", "in_progress"):
                raise self._flight_refuse("the mission's plan is committed; abort the mission to design a new transfer", "mission_committed")
            if mission.status in ("completed", "failed") and mission.committed:
                raise self._flight_refuse("this mission is over; create a new mission", "mission_over")
            craft = self._flight_craft(mission.craft_id)
            from backend.simulation import _copy_sim  # local: simulation imports this module

            sim = _copy_sim(self._sim)
            craft_ids = set(self._flight.craft)
            pending = len(self._flight.pending_maneuvers(mission.craft_id))
            objective = mission.objective
            stamp = (mission_rules.fingerprint(self._flight, self._flight_hierarchy()), craft, mission.plan_revision)
            names = self._flight_names()
            halted = self._flight.halt is not None
        if halted:
            raise self._flight_refuse("the simulation is stopped at a collision", "simulation_halted")
        transfer = TransferRequest(
            destination_id=mission.destination_body_id, periapsis_altitude_m=objective["periapsisAltitudeM"],
            capture="none" if objective["type"] == "flyby" else ("elliptical" if objective.get("apoapsisAltitudeM") else "circular"),
            apoapsis_altitude_m=objective.get("apoapsisAltitudeM"), direction=objective["direction"], transfer_time_s=request.transferTimeS,
            burn_mode=request.burnMode, earliest_departure_s=request.earliestDepartureS)
        result = design_transfer(sim, mission.craft_id, craft, craft_ids, transfer, pending_nodes=pending, time_budget_s=self.plan_time_limit_s,
                                 names=names)
        with self._mutation(guard):
            mission = self._flight_mission(mission_id)
            now = (mission_rules.fingerprint(self._flight, self._flight_hierarchy()), self._flight.craft.get(mission.craft_id), mission.plan_revision)
            if now != stamp or mission.committed:
                raise self._flight_refuse("the universe changed while the transfer was being designed; design it again", "plan_outdated")
            t = self._sim.t
            if result.status != "ok":
                status = "unsupported" if result.status == "unsupported" else "draft"
                phase = "not supported" if result.status == "unsupported" else "no transfer found"
                self._flight.put(replace(mission, status=status, phase=phase, reasons=result.reasons, plan=None, trajectory=(),
                                         plan_nodes=(), plan_fingerprint=None, updated_at_s=t))
            else:
                if t > result.plan["departure"]["ignitionS"]:
                    raise self._flight_refuse("the simulation advanced past the planned departure while the transfer was being designed; "
                                              "pause and design it again", "plan_outdated")
                plan = {**result.plan, "nodes": [{k: v for k, v in n.items() if k != "predictedState"} for n in result.nodes],
                        "request": {"transferTimeS": request.transferTimeS, "burnMode": request.burnMode}}
                self._flight.put(replace(
                    mission, status="planned", phase="proposed (not committed)", reasons=result.reasons, plan=plan,
                    plan_revision=mission.plan_revision + 1, plan_fingerprint=stamp[0], trajectory=result.trajectory,
                    origin_body_id=result.plan["originBodyId"], maneuver_ids=(), committed=False, checks=(), agreement=(), outcome=None,
                    capture_started_at_s=None, plan_nodes=result.nodes, updated_at_s=t))
            out = self._flight_mission_now(mission_id)
        return out

    def commit_mission(self, mission_id: str, guard=None) -> MissionOut:
        """Schedule the designed nodes in the simulation. From here on the mission is flown by the engine and judged on what happens."""
        with self._mutation(guard):
            mission = self._flight_mission(mission_id)
            if mission.committed:
                raise self._flight_refuse("the mission's plan is already committed", "mission_committed")
            if self._flight.halt is not None:
                raise self._flight_refuse(self._flight_halt_out().message, "simulation_halted")
            self._flight_evaluate()
            mission = self._flight_mission(mission_id)
            nodes = mission.plan_nodes
            if mission.status != "planned" or mission.plan is None or not nodes:
                why = "; ".join(mission.reasons) or "design the transfer first"
                raise self._flight_refuse(f"the mission has no current plan to commit ({why})", "mission_not_planned")
            before = self._flight.copy()
            try:
                ids = []
                for n in nodes:
                    node = Maneuver(id=self._flight.next_id("mnv"), craft_id=mission.craft_id, epoch_s=n["epochS"], mode=n["mode"], frame="vnb",
                                    reference_body_id=n["referenceBodyId"], dv=(n["progradeMPerS"], 0.0, 0.0), label=n["label"], centered=True,
                                    mission_id=mission.id, role=n["role"], start_s=n["epochS"], end_s=n["epochS"],
                                    predicted_state=n.get("predictedState"))
                    self._flight.put(node)
                    ids.append(node.id)
                self._flight_reschedule(mission.craft_id)
            except SpaceflightError:
                self._flight = before
                raise
            self._flight.put(replace(self._flight.missions[mission_id], committed=True, maneuver_ids=tuple(ids), updated_at_s=self._sim.t))
            self._flight_evaluate()
            out = self._flight_mission_now(mission_id)
        return out

    def abort_mission(self, mission_id: str, guard=None) -> MissionOut:
        with self._mutation(guard):
            mission = self._flight_mission(mission_id)
            if mission.status in ("completed", "failed"):
                raise self._flight_refuse("this mission is already over", "mission_over")
            if any(self._flight.maneuvers.get(i) is not None and self._flight.maneuvers[i].status == "executing" for i in mission.maneuver_ids):
                raise self._flight_refuse("a burn of this mission is in progress; abort after it ends", "burn_in_progress")
            for i in mission.maneuver_ids:
                node = self._flight.maneuvers.get(i)
                if node is not None and node.status == "planned":
                    del self._flight.maneuvers[i]
            self._flight_reschedule(mission.craft_id, lenient=True)
            self._flight.put(replace(mission, status="failed", phase="aborted", reasons=("aborted by the user",), updated_at_s=self._sim.t))
            self._flight.physics_epoch += 1
            out = self._flight_mission_now(mission_id)
        return out

    def delete_mission(self, mission_id: str, guard=None) -> None:
        with self._mutation(guard):
            mission = self._flight_mission(mission_id)
            if any(self._flight.maneuvers.get(i) is not None and self._flight.maneuvers[i].status == "executing" for i in mission.maneuver_ids):
                raise self._flight_refuse("a burn of this mission is in progress; delete it after the burn ends", "burn_in_progress")
            pending = False
            for i in mission.maneuver_ids:
                node = self._flight.maneuvers.get(i)
                if node is not None and node.status == "planned":
                    del self._flight.maneuvers[i]
                    pending = True
            del self._flight.missions[mission_id]
            if pending:
                self._flight_reschedule(mission.craft_id, lenient=True)
                self._flight.physics_epoch += 1
