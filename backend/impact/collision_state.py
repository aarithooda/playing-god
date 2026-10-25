"""The `CollisionState` of a universe: everything the collision engine keeps that is not in the REBOUND simulation, as one versioned
contract with a canonical JSON form (plan 3.13; decision D-054).

D-054 (DQ-11 (a), OD-5): there is NO persistence across restarts and none is introduced here. This module only defines the shape and the
canonical serialisation, so the state has a migration anchor if a disk format is ever decided, and so a test can prove that the live side
tables lose nothing when written out and read back. It is pure: it reads plain tables and builds a value; it never writes to a service.

Contents (schemaVersion 1): the collision configuration (mode, seed, budgets), the next event counter, per-body state (material,
rotation state, product marker with its debris descriptor, impact sites), the collision records, the escaped-material ledger and the
booked-spin / heat ledgers that absorb what no state represents. A universe without any of it yields an empty state; a snapshot that predates
a field simply has that field empty.
"""
from dataclasses import dataclass, field
from typing import Mapping, Optional

from backend.impact.contracts import (CollisionConfig, CollisionRecord, DebrisDescriptor, ImpactSite, MaterialRef, Representation, RotationState,
                                      Vec3)
from backend.impact.serialization import Contract, ContractError, SCHEMA_VERSION


@dataclass(frozen=True)
class ProductState(Contract):
    """A body created by a collision: how it is represented and by which event."""

    representation: Representation
    origin_event_id: Optional[str]
    debris: Optional[DebrisDescriptor] = None


@dataclass(frozen=True)
class BodyCollisionState(Contract):
    body_id: str
    material: Optional[MaterialRef] = None
    rotation: Optional[RotationState] = None
    product: Optional[ProductState] = None
    sites: tuple[ImpactSite, ...] = ()

    def _validate(self) -> None:
        if not self.body_id:
            raise ContractError("BodyCollisionState.body_id: must not be empty")


@dataclass(frozen=True)
class EscapedBody(Contract):
    body_id: str
    mass_kg: float


@dataclass(frozen=True)
class EscapedState(Contract):
    mass_kg: float
    momentum_kg_m_per_s: Vec3
    angular_momentum_about_origin_kg_m2_per_s: Vec3
    bodies: tuple[EscapedBody, ...]


@dataclass(frozen=True)
class BookedSpin(Contract):
    body_id: str
    spin_kg_m2_per_s: Vec3


@dataclass(frozen=True)
class CollisionState(Contract):
    config: CollisionConfig
    event_seq: int
    bodies: tuple[BodyCollisionState, ...] = ()
    records: tuple[CollisionRecord, ...] = ()
    escaped: Optional[EscapedState] = None
    booked_spin: tuple[BookedSpin, ...] = ()
    heat_j: float = 0.0
    schema_version: int = SCHEMA_VERSION

    def _validate(self) -> None:
        if self.schema_version != SCHEMA_VERSION:
            raise ContractError(f"CollisionState.schema_version: unsupported {self.schema_version!r} (this build reads {SCHEMA_VERSION})")
        if self.event_seq < 0:
            raise ContractError("CollisionState.event_seq: must be >= 0")
        ids = [b.body_id for b in self.bodies]
        if len(set(ids)) != len(ids):
            raise ContractError("CollisionState.bodies: duplicate body ids")


def build_collision_state(config: CollisionConfig, event_seq: int, materials: Mapping, rotations: Mapping, products: Mapping, sites: Mapping,
                          records: list, escaped: Mapping, spin: Mapping, heat_j: float) -> CollisionState:
    """From the live side tables (body id -> value). Bodies are sorted by id so the form is canonical."""
    ids = sorted(set(materials) | set(rotations) | set(products) | {k for k, v in sites.items() if v})
    bodies = []
    for i in ids:
        p = products.get(i)
        bodies.append(BodyCollisionState(i, materials.get(i), rotations.get(i), None if p is None else ProductState(p[0], p[1], p[2]),
                                         tuple(sites.get(i, ()))))
    esc = None
    if escaped:
        esc = EscapedState(escaped["massKg"], Vec3.of(escaped["momentumKgMPerS"]), Vec3.of(escaped["angularMomentumKgM2PerS"]),
                           tuple(EscapedBody(b, m) for b, m in escaped["bodies"]))
    booked = tuple(BookedSpin(k, Vec3.of(v)) for k, v in sorted(spin.items()) if any(c != 0.0 for c in v))
    return CollisionState(config, event_seq, tuple(bodies), tuple(records), esc, booked, float(heat_j))


def tables_of(state: CollisionState) -> dict:
    """The inverse: the side tables a state describes (what a loader would install). Used to prove the form is lossless."""
    materials, rotations, products, sites = {}, {}, {}, {}
    for b in state.bodies:
        if b.material is not None:
            materials[b.body_id] = b.material
        if b.rotation is not None:
            rotations[b.body_id] = b.rotation
        if b.product is not None:
            products[b.body_id] = (b.product.representation, b.product.origin_event_id, b.product.debris)
        if b.sites:
            sites[b.body_id] = b.sites
    escaped: dict = {}
    if state.escaped is not None:
        e = state.escaped
        escaped = {"massKg": e.mass_kg, "momentumKgMPerS": list(e.momentum_kg_m_per_s.as_tuple()),
                   "angularMomentumKgM2PerS": list(e.angular_momentum_about_origin_kg_m2_per_s.as_tuple()),
                   "bodies": [(x.body_id, x.mass_kg) for x in e.bodies]}
    return {"materials": materials, "rotations": rotations, "products": products, "sites": sites, "escaped": escaped,
            "spin": {s.body_id: list(s.spin_kg_m2_per_s.as_tuple()) for s in state.booked_spin}, "heat_j": state.heat_j,
            "event_seq": state.event_seq, "records": list(state.records)}
