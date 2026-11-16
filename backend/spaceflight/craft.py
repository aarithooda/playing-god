"""The spaceflight state of ONE universe: spacecraft, manoeuvre nodes, missions and the collision halt.

Everything here is a value. The records are frozen dataclasses and the book only swaps whole records, so `copy()` (new dicts over the
same immutable records) is an exact, cheap rollback point: the engine takes one for every step, mutation, snapshot and reset, exactly
as it does for its other side tables (materials, rotations, ...). Nothing in this module touches REBOUND.

A spacecraft is a particle of the universe's REBOUND simulation whose id is in `SpaceflightBook.craft`. Its gravitational mass is
dry mass + propellant; the book is the only place that knows the split.
"""
from dataclasses import dataclass, field, replace
from typing import Optional

Vec = tuple[float, float, float]
State = tuple[Vec, Vec]  # (position, velocity) relative to a reference body

MANEUVER_STATUSES = ("planned", "executing", "executed", "failed")
MISSION_STATUSES = ("draft", "planned", "in_progress", "completed", "failed", "unsupported")


@dataclass(frozen=True)
class Spacecraft:
    id: str
    dry_mass_kg: float
    propellant_kg: float
    propellant_capacity_kg: float  # what it was loaded with (gauge reference); never less than propellant_kg
    thrust_n: float  # 0 = no engine fitted
    isp_s: float  # 0 = no engine fitted
    home_body_id: Optional[str]  # the body it was placed around (provenance only; the live reference body is computed)
    created_at_s: float

    @property
    def mass_kg(self) -> float:
        return self.dry_mass_kg + self.propellant_kg

    @property
    def has_engine(self) -> bool:
        return self.isp_s > 0.0

    def to_digest(self) -> list:
        return [float(v).hex() for v in (self.dry_mass_kg, self.propellant_kg, self.thrust_n, self.isp_s)]


@dataclass(frozen=True)
class Maneuver:
    """One manoeuvre node. `epoch_s` is the node time: the instant of an impulsive burn, and the centre (or, with
    `centered=False`, the ignition) of a finite burn. `dv` is (prograde, normal, radial-out) in the VNB frame of `reference_body_id`,
    or (x, y, z) in the inertial frame. A zero delta-v node is an OBSERVATION: the engine lands exactly on it and records the state."""

    id: str
    craft_id: str
    epoch_s: float
    mode: str  # "impulsive" | "finite"
    frame: str  # "vnb" | "inertial"
    reference_body_id: Optional[str]
    dv: Vec
    label: str = ""
    centered: bool = True
    mission_id: Optional[str] = None
    role: Optional[str] = None  # "departure" | "insertion" | "observation" for mission nodes
    status: str = "planned"
    # schedule of a finite burn, from the mass predicted at ignition (recomputed whenever the craft's node list changes)
    start_s: float = 0.0
    end_s: float = 0.0
    planned_propellant_kg: float = 0.0
    feasible: bool = True  # False: the propellant predicted to be on board does not cover the commanded delta-v
    # execution record
    started_at_s: Optional[float] = None
    ended_at_s: Optional[float] = None
    ignition_mass_kg: Optional[float] = None
    mass_flow_kg_per_s: float = 0.0
    burn_direction: Optional[Vec] = None  # inertial unit vector of an inertial-frame finite burn (fixed at ignition)
    delivered_dv: Optional[float] = None  # integral of the thrust acceleration actually applied [m/s]
    propellant_used_kg: Optional[float] = None
    failure: Optional[str] = None
    # state relative to the reference body just BEFORE the burn: predicted by the planner / recorded by the engine
    predicted_state: Optional[State] = None
    actual_state: Optional[State] = None
    actual_state_after: Optional[State] = None

    @property
    def dv_magnitude(self) -> float:
        return (self.dv[0] ** 2 + self.dv[1] ** 2 + self.dv[2] ** 2) ** 0.5

    @property
    def is_observation(self) -> bool:
        return self.dv_magnitude == 0.0

    @property
    def pending(self) -> bool:
        return self.status in ("planned", "executing")


@dataclass(frozen=True)
class Mission:
    id: str
    name: str
    craft_id: str
    destination_body_id: str
    objective: dict  # {"type": "orbit" | "flyby", "periapsisAltitudeM": .., "apoapsisAltitudeM": .. | None, "direction": ..}
    status: str = "draft"
    phase: str = "not designed"
    reasons: tuple = ()  # why it is unsupported / failed / flagged (plain sentences)
    origin_body_id: Optional[str] = None
    plan: Optional[dict] = None  # the planner's result (JSON-like; never mutated in place)
    plan_revision: int = 0  # +1 per accepted plan: the client refetches the planned trajectory when it changes
    plan_fingerprint: Optional[tuple] = None  # (physics epoch, body ids) the plan was computed for
    trajectory: tuple = ()  # planned samples: (t, craft xyz, origin xyz, destination xyz)
    plan_nodes: tuple = ()  # the designed manoeuvre nodes (dicts, with the predicted pre-burn state), scheduled on commit
    committed: bool = False  # the plan's manoeuvre nodes are scheduled in the simulation
    maneuver_ids: tuple = ()
    checks: tuple = ()  # evaluated conditions of the ACTUAL state: dicts {id, label, ok, actual, target, unit}
    agreement: tuple = ()  # planned-vs-actual comparisons at the plan's nodes
    outcome: Optional[dict] = None
    capture_started_at_s: Optional[float] = None  # when the actual orbit about the destination first met the conditions
    created_at_s: float = 0.0
    updated_at_s: float = 0.0


@dataclass(frozen=True)
class Halt:
    """The simulation is stopped at a contact (collision policy of this phase: stop, report, keep a consistent state)."""

    event_id: str
    body_ids: tuple
    time_s: float
    relative_speed_m_per_s: float
    refined: bool  # True: the whole system was put back to the instant of first contact; False: state at detection (slight overlap)
    reason: str = "collision"


@dataclass
class SpaceflightBook:
    craft: dict = field(default_factory=dict)  # body id -> Spacecraft, creation order
    maneuvers: dict = field(default_factory=dict)  # manoeuvre id -> Maneuver, creation order
    missions: dict = field(default_factory=dict)  # mission id -> Mission, creation order
    halt: Optional[Halt] = None
    seq: int = 0  # ids of manoeuvres and missions; never reused inside one engine state lineage
    physics_epoch: int = 0  # +1 whenever the universe changes in a way a stored plan did not foresee

    def copy(self) -> "SpaceflightBook":
        return SpaceflightBook(dict(self.craft), dict(self.maneuvers), dict(self.missions), self.halt, self.seq, self.physics_epoch)

    @property
    def empty(self) -> bool:
        return not (self.craft or self.maneuvers or self.missions or self.halt)

    def next_id(self, prefix: str) -> str:
        self.seq += 1
        return f"{prefix}-{self.seq}"

    def put(self, record) -> None:
        table = self.craft if isinstance(record, Spacecraft) else self.maneuvers if isinstance(record, Maneuver) else self.missions
        table[record.id] = record

    def amend(self, record, **changes):
        updated = replace(record, **changes)
        self.put(updated)
        return updated

    def pending_maneuvers(self, craft_id: Optional[str] = None) -> list:
        return [m for m in self.maneuvers.values() if m.pending and (craft_id is None or m.craft_id == craft_id)]

    def has_pending(self) -> bool:
        return any(m.pending for m in self.maneuvers.values())

    def executing(self) -> list:
        return [m for m in self.maneuvers.values() if m.status == "executing"]
