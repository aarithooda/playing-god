"""CollisionEngine: resolves the contacts recorded by `ContactRecorder` between `integrate` calls (plan 3.2, 3.4, 3.7).

Used by `SimulationService` in mode "outcome-v1" only; mode "legacy-merge" keeps `MergeResolver` inside the REBOUND callback.
Lifecycle of one contact (nothing is resolved inside the REBOUND callback):

  detected (recorder) -> captured (frozen ImpactState) -> classified (selector: model + reasons) -> realised (pure CollisionResult +
  conservation report) -> validated (whole result, before any change) -> applied (atomically) -> recorded

`resolve_batch` works on one detection pass:
1. every pair is ordered by (estimated contact time, sorted ids): deterministic whatever REBOUND's report order was;
2. the contact state of every pair is refined on a copy of the system integrated back to the contact (D-063, `contact.py`); a pair
   whose bodies no longer exist is stale and dropped (counted); a pair involving a body that an earlier pair of the same batch
   changed is re-checked against the live state and resolved only if the bodies really overlap now; otherwise the next step decides;
3. the pre-impact state is captured BEFORE anything is mutated;
4. DQ-2 (D-033): a pair in which a body has no material profile resolves with the EXACT legacy merge (same arithmetic, same `merger`
   event, same body state; `material_unspecified` only in the record). Every other pair goes through the selector and the applier;
5. an outcome whose result fails validation or conservation gets ONE fallback attempt (a perfect merge, warning `model_failed_fallback`);
   if that fails too the step is rolled back (HTTP 500 `collision_unresolvable`), state unchanged;
6. IAS15 is re-selected once for the batch (its predictor state is stale after a structural change).
Errors propagate as exceptions: the service rolls the whole step back.
"""
from dataclasses import dataclass, field
from typing import Callable, Optional, Sequence

from backend.collisions import contact_time_estimate, select_ias15
from backend.impact.applier import ApplyState, ResultInvalid, apply_result, collision_unresolvable, realise, validate_result
from backend.impact.config import CollisionConfig
from backend.impact.contact import refine_contact
from backend.impact.contracts import CollisionEvent, CollisionRecord, CollisionResult, ContractError, OutcomeSpec
from backend.impact.detection import ContactCandidate, order_key
from backend.impact.fragments import FragmentBudget
from backend.impact.geometry import BodyExtras, capture_impact
from backend.impact.models.perfect_merge import MODEL_ID, MODEL_VERSION, PairBody, merge_pair
from backend.impact.records import build_input, build_record
from backend.impact.selector import Selection, Selector

NEW_REMNANT_OUTCOMES = frozenset({"catastrophic_disruption", "super_catastrophic_disruption"})
# outcomes that create tracked fragments or a second remnant; beyond the cascade limit they are replaced by the labelled merge (RA-3)
FRAGMENTING_OUTCOMES = frozenset({"catastrophic_disruption", "super_catastrophic_disruption", "partial_erosion", "hit_and_run"})
RECOVERABLE = (ResultInvalid, ValueError, ContractError, ZeroDivisionError, OverflowError)


@dataclass
class BatchReport:
    resolved: int = 0
    stale: int = 0
    fallbacks: int = 0
    records: list[CollisionRecord] = field(default_factory=list)


def _body(p) -> PairBody:
    return PairBody(p.name, p.m, p.r, (p.x, p.y, p.z), (p.vx, p.vy, p.vz))


def _add(a: Sequence[float], b: Sequence[float]) -> list[float]:
    return [x + y for x, y in zip(a, b)]


def _centre_distance(a, b) -> float:
    return ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2) ** 0.5


class CollisionEngine:
    def __init__(self, config: CollisionConfig, g: float) -> None:
        self.config = config
        self.g = g
        self.selector = Selector(g)

    # ------------------------------------------------------------------------------------------------------------------------
    def resolve_batch(self, sim, candidates: Sequence[ContactCandidate], *, ledger, on_merge: Callable[[dict], None],
                      event_seq: Callable[[], int], chunk_criterion_satisfied: bool, extras: "BodyExtras | None" = None,
                      emit_collision: "Callable[[CollisionEvent], None] | None" = None,
                      apply_state: "Callable[[], ApplyState] | None" = None, parcel_count: "Callable[[], int] | None" = None,
                      lineage: "Callable[[str], Optional[tuple[str, int]]] | None" = None,
                      representation: "Callable[[str], str] | None" = None) -> BatchReport:
        """Resolve one detection pass. `ledger` holds `heat_J` and `spin` (the booked-energy and booked-spin ledgers); `on_merge(fields)`
        creates the legacy `merger` event; `emit_collision(event)` creates a `collision` event (and advances the event counter);
        `apply_state()` gives the tables the applier may change; `event_seq()` returns the engine's event counter;
        `lineage(event_id)` gives (root event id, generation) of an earlier event (None = unknown/trimmed: treated as generation 0);
        `representation(body_id)` gives a body's representation (H3: debris parcels are populations)."""
        report = BatchReport()
        live = {p.name: p for p in sim.particles}
        ordered = []
        for c in candidates:
            a, b = live.get(c.first_id), live.get(c.second_id)
            if a is None or b is None:
                report.stale += 1
                continue
            # D-063: the gravity-consistent contact state, from a copy of the whole system integrated back from this detection
            # pass (computed before anything is mutated; the live simulation is untouched)
            contact = refine_contact(sim, c.first_id, c.second_id, c.time_s - c.dt_last_done, a.r + b.r) if sim.t == c.time_s else None
            if contact is not None:
                t_c = contact.time_s
            else:
                r_rel = [x - y for x, y in zip((a.x, a.y, a.z), (b.x, b.y, b.z))]
                v_rel = [x - y for x, y in zip((a.vx, a.vy, a.vz), (b.vx, b.vy, b.vz))]
                t_c = contact_time_estimate(c.time_s, c.dt_last_done, r_rel, v_rel, a.r + b.r)
            ordered.append((order_key(c, t_c), c, contact))
        ordered.sort(key=lambda item: item[0])
        changed: set[str] = set()  # survivors, absorbed and created bodies of earlier pairs of this batch
        for _, c, contact in ordered:
            live = {p.name: p for p in sim.particles}
            pa, pb = live.get(c.first_id), live.get(c.second_id)
            if pa is None or pb is None:
                report.stale += 1
                continue
            if (c.first_id in changed or c.second_id in changed) and _centre_distance(pa, pb) >= pa.r + pb.r:
                report.stale += 1  # the remnant no longer touches it: the next internal step decides
                continue
            first, second = _body(pa), _body(pb)
            others = [_body(p) for p in sim.particles if p.name not in (c.first_id, c.second_id)]
            if c.first_id in changed or c.second_id in changed:
                contact = None  # integrated before an earlier pair changed this body: stale, so the linear rewind is used (labelled)
            impact, geometry_warnings = capture_impact(first, second, c.time_s, c.dt_last_done, others,
                                                       chunk_criterion_satisfied, contact_time_estimate, self.g, extras, contact,
                                                       representation)
            if impact.contact_state_method == "linear_rewind" and impact.contact_time_estimated:
                geometry_warnings.append("contact_state_linear_rewind")  # integrated refinement unavailable: velocities are those at detection
            seq = event_seq() + 1
            parent_id, root_id, generation = self._lineage(c.first_id, c.second_id, apply_state, lineage, seq)
            data = build_input(seq, impact, self.config, MODEL_ID, MODEL_VERSION, parent_event_id=parent_id, generation=generation)
            selection = self.selector.select(data)
            if selection.spec.outcome == "legacy_merge":
                record = self._legacy_merge(sim, ledger, on_merge, event_seq, seq, data, selection.spec, geometry_warnings,
                                            (first, second, pa, pb, c), changed, root_id)
            else:
                if emit_collision is None or apply_state is None or parcel_count is None:
                    raise RuntimeError("the engine was not given the hooks needed to apply a non-legacy outcome")
                record = self._resolve_outcome(sim, data, selection, emit_collision, apply_state, parcel_count, event_seq, seq, changed, report, root_id,
                                               tuple(geometry_warnings))
            report.records.append(record)
            report.resolved += 1
        if report.resolved:
            select_ias15(sim)  # stale predictor state after a structural change (see backend/collisions.py)
        if candidates:
            sim.dt = candidates[0].dt_next_s  # resume on the step grid the legacy resolver would have continued on
        return report

    # ------------------------------------------------------------------------------------------------------------------------
    @staticmethod
    def _lineage(first_id, second_id, apply_state, lineage, seq) -> "tuple[Optional[str], str, int]":
        """(parent event id, root event id, generation) of a contact. A body created by an earlier event (fragment, parcel, remnant) makes
        this event its child; if both were created by events the one of the higher generation (then the later one) is the parent."""
        own = f"col-{seq}"
        if apply_state is None or lineage is None:
            return None, own, 0
        products = apply_state().products
        candidates = []
        for body_id in (first_id, second_id):
            product = products.get(body_id)
            if product is not None and product[1] is not None:
                root, gen = lineage(product[1]) or (product[1], 0)
                candidates.append((gen, int(product[1].split("-", 1)[1]) if product[1].split("-", 1)[-1].isdigit() else 0, product[1], root))
        if not candidates:
            return None, own, 0
        gen, _, parent, root = max(candidates)
        return parent, root, gen + 1

    def _legacy_merge(self, sim, ledger, on_merge, event_seq, seq, data, spec, geometry_warnings, pair, changed, root_id=None) -> CollisionRecord:
        """The exact legacy merger (DQ-2): identical arithmetic and body state to `MergeResolver`."""
        first, second, pa, pb, c = pair
        merged = merge_pair(first, second, c.time_s, c.dt_last_done, contact_time_estimate)
        surv = pa if merged.remove_code == 2 else pb
        for axis, value in zip(("x", "y", "z"), merged.position):
            setattr(surv, axis, value)
        for axis, value in zip(("vx", "vy", "vz"), merged.velocity):
            setattr(surv, axis, value)
        surv.m = merged.mass
        surv.r = merged.radius
        ledger.heat_J += merged.kinetic_energy_lost_j
        spin = _add(ledger.spin.pop(merged.survivor_id, [0.0] * 3), ledger.spin.pop(merged.absorbed_id, [0.0] * 3))
        ledger.spin[merged.survivor_id] = _add(spin, merged.orbital_angular_momentum)
        on_merge(merged.event)
        if event_seq() != seq:
            raise RuntimeError(f"event counter mismatch: expected {seq}, got {event_seq()}")
        sim.remove(next(p.index for p in sim.particles if p.name == merged.absorbed_id))
        changed.update((merged.survivor_id, merged.absorbed_id))
        warnings = tuple(dict.fromkeys((*geometry_warnings, *spec.warnings)))
        return build_record(data, spec, spec.regime_reasons, warnings, f"evt-{seq}", None, root_id)

    # ------------------------------------------------------------------------------------------------------------------------
    def _resolve_outcome(self, sim, data, selection: Selection, emit_collision, apply_state, parcel_count, event_seq, seq, changed, report,
                         root_id=None, geometry_warnings: tuple[str, ...] = ()) -> CollisionRecord:
        from backend.models import MAX_BODIES  # local: backend.models does not depend on this package

        cfg = self.config
        live_ids = {p.name for p in sim.particles}
        n_bodies, parcels_now = len(sim.particles), parcel_count()

        fragments_now = sum(1 for v in apply_state().products.values() if v[0] == "fragment")
        # RA-3 / DQ-10: fragments made by an event of generation >= maxFragmentingGeneration resolve with non-fragmenting outcomes only
        cascade_limited = data.parent_event_id is not None and data.generation - 1 >= cfg.max_fragmenting_generation

        def room(spec: OutcomeSpec) -> int:
            """Bodies the event may ADD beyond the pair it consumes (the reserve for the user stays free, D-047)."""
            new_remnant = spec.outcome in NEW_REMNANT_OUTCOMES
            base_net = (1 if new_remnant else 0) - (2 if new_remnant else (0 if spec.outcome == "hit_and_run" else 1))
            return MAX_BODIES - cfg.reserve_for_user - (n_bodies + base_net)

        def budget_for(spec: OutcomeSpec) -> FragmentBudget:
            """Parcels first (they hold the mass nothing else can, D-047), then tracked fragments, within the per-event, global and body limits."""
            free = max(room(spec), 0)
            parcels_ok = min(cfg.max_debris_parcels_per_event, max(cfg.max_debris_parcels_total - parcels_now, 0), free)
            fragments_ok = min(cfg.max_tracked_fragments_per_event, max(cfg.max_tracked_fragments_total - fragments_now, 0), max(free - parcels_ok, 0))
            if spec.outcome == "hit_and_run" or cascade_limited:
                fragments_ok = 0  # hit-and-run: the 4a single-parcel path (documented limitation); cascade limit: parcels only (RA-3)
            return FragmentBudget(fragments_ok, parcels_ok, cfg.tracked_fragment_min_mass_fraction)

        def parcel_allowed(spec: OutcomeSpec) -> bool:
            if spec.debris_mass_kg <= 0.0:
                return True
            b = budget_for(spec)
            return b.max_parcels + b.max_fragments > 0

        def attempt(spec: OutcomeSpec, extra: tuple[str, ...], represent_spin: bool = True) -> CollisionResult:
            result = realise(data, spec, self.g, parcel_allowed=parcel_allowed(spec), extra_warnings=extra, represent_spin=represent_spin,
                             budget=budget_for(spec))
            validate_result(result, live_ids, data)
            return result

        spec = selection.spec
        cascade_extra: tuple[str, ...] = geometry_warnings  # carried into every attempt's warnings
        if cascade_limited:
            cascade_extra = (*geometry_warnings, "cascade_limit_reached")
            if spec.outcome in FRAGMENTING_OUTCOMES:
                fb0 = self.selector.fallback(data, spec.model_id, (f"cascade limit: generation {data.generation} may not fragment",))
                spec = fb0.spec
        try:
            result = attempt(spec, cascade_extra)
        except RECOVERABLE as exc:
            reason = f"the result of {spec.model_id} ({spec.outcome}) failed validation: {exc}"
            fb = self.selector.fallback(data, spec.model_id, (reason,))
            report.fallbacks += 1
            try:
                result = attempt(fb.spec, ("model_failed_fallback", *cascade_extra))
            except RECOVERABLE as exc2:
                # last resort that cannot fail on physics grounds: a plain merge without rotation states (the angular momentum is booked in
                # the spin ledger and reported unmodelled), e.g. a slow, very grazing impact whose remnant would spin faster than break-up
                try:
                    result = attempt(fb.spec, ("model_failed_fallback", "spin_not_represented_fallback", *cascade_extra), represent_spin=False)
                except RECOVERABLE as exc3:
                    raise collision_unresolvable(f"{data.event_id} cannot be resolved: {reason}; fallbacks also failed: {exc2}; {exc3}") from exc3
            spec = fb.spec
        apply_result(result, apply_state())
        imp = data.impact
        remnants = [p.mass_kg for p in (*result.transformed, *result.created)]
        event = CollisionEvent(
            id=data.event_id, outcome=result.outcome, simulation_time_s=imp.detection_time_s,
            estimated_contact_time_s=imp.contact_time_s if imp.contact_time_estimated else None,
            body_ids=(imp.target.id, imp.projectile.id), surviving_body_ids=tuple(p.id for p in result.transformed),
            created_body_ids=tuple(p.id for p in (*result.created, *result.debris_parcels)), removed_body_ids=result.removed_body_ids,
            parent_event_id=data.parent_event_id, root_event_id=root_id or data.event_id, generation=data.generation, model_id=spec.model_id, model_version=spec.model_version,
            impact_speed_m_per_s=imp.impact_speed_m_per_s, impact_angle_deg=imp.impact_angle_deg,
            specific_impact_energy_j_per_kg=imp.specific_impact_energy_j_per_kg, largest_remnant_mass_kg=max(remnants),
            debris_mass_kg=sum(p.mass_kg for p in result.debris_parcels), mass_residual_rel=result.conservation.mass_residual_rel,
            momentum_residual_rel=result.conservation.momentum_residual_rel, warnings=result.warnings,
            fidelity_summary=dict(result.fidelity), has_visual=True)  # a description can be derived from this result (D-055)
        emit_collision(event)
        if event_seq() != seq:
            raise RuntimeError(f"event counter mismatch: expected {seq}, got {event_seq()}")
        changed.update((*result.removed_body_ids, *(p.id for p in result.transformed), *event.created_body_ids))
        return build_record(data, spec, spec.regime_reasons, result.warnings, None, result, root_id)
