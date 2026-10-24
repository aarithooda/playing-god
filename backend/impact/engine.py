"""CollisionEngine: resolves the contacts recorded by `ContactRecorder` between `integrate` calls (plan 3.2, 3.4, 3.7).

Used by `SimulationService` in mode "outcome-v1" only; mode "legacy-merge" keeps `MergeResolver` inside the REBOUND callback.
In this stage the only outcome is the perfect merger (`models.perfect_merge`): same arithmetic, same `merger` event, same
body state as the legacy resolver. What is new is the lifecycle around it:

  detected (recorder) -> captured (frozen ImpactState) -> classified (model + reasons) -> resolved -> applied -> recorded

`resolve_batch` works on one detection pass:
1. every pair is ordered by (estimated contact time, sorted ids): deterministic whatever REBOUND's report order was;
2. a pair whose bodies no longer exist is stale and dropped (counted); a pair involving a body that an earlier pair of the
   same batch changed is re-checked against the live state and resolved only if the bodies really overlap now (a remnant
   keeps absorbing what it touches, as in the legacy resolver); otherwise it is dropped and the next internal step decides;
3. the pre-impact state is captured BEFORE the merge mutates anything;
4. the particles are changed exactly like the legacy resolver does (survivor in place, absorbed body removed by name);
5. IAS15 is re-selected once for the batch (its predictor state is stale after a structural change).
Nothing is resolved inside the REBOUND callback. Errors propagate as exceptions: the service rolls the whole step back.
"""
from dataclasses import dataclass, field
from typing import Callable, Sequence

from backend.collisions import contact_time_estimate, select_ias15
from backend.impact.config import CollisionConfig
from backend.impact.contracts import CollisionRecord
from backend.impact.detection import ContactCandidate, order_key
from backend.impact.geometry import capture_impact
from backend.impact.models.perfect_merge import MODEL_ID, MODEL_VERSION, PairBody, PerfectMergeModel, merge_pair
from backend.impact.records import build_input, build_record
from backend.impact.models.base import Unsupported


@dataclass
class BatchReport:
    resolved: int = 0
    stale: int = 0
    records: list[CollisionRecord] = field(default_factory=list)


def _body(p) -> PairBody:
    return PairBody(p.name, p.m, p.r, (p.x, p.y, p.z), (p.vx, p.vy, p.vz))


def _add(a: Sequence[float], b: Sequence[float]) -> list[float]:
    return [x + y for x, y in zip(a, b)]


class CollisionEngine:
    def __init__(self, config: CollisionConfig, g: float) -> None:
        self.config = config
        self.g = g
        self.model = PerfectMergeModel()

    def resolve_batch(self, sim, candidates: Sequence[ContactCandidate], *, ledger, on_merge: Callable[[dict], None],
                      event_seq: Callable[[], int], chunk_criterion_satisfied: bool) -> BatchReport:
        """Resolve one detection pass. `ledger` holds `heat_J` and `spin` (the legacy booked-energy and booked-spin
        ledgers); `on_merge(event_fields)` creates the public `merger` event and updates display metadata; `event_seq()`
        returns the engine's event counter (incremented by `on_merge`)."""
        report = BatchReport()
        live = {p.name: p for p in sim.particles}
        ordered = []
        for c in candidates:
            a, b = live.get(c.first_id), live.get(c.second_id)
            if a is None or b is None:
                report.stale += 1
                continue
            r_rel = [x - y for x, y in zip((a.x, a.y, a.z), (b.x, b.y, b.z))]
            v_rel = [x - y for x, y in zip((a.vx, a.vy, a.vz), (b.vx, b.vy, b.vz))]
            ordered.append((order_key(c, contact_time_estimate(c.time_s, c.dt_last_done, r_rel, v_rel, a.r + b.r)), c))
        ordered.sort(key=lambda item: item[0])
        changed: set[str] = set()  # survivors and absorbed bodies of earlier pairs of this batch
        for _, c in ordered:
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
            impact, geometry_warnings = capture_impact(first, second, c.time_s, c.dt_last_done, others,
                                                       chunk_criterion_satisfied, contact_time_estimate, self.g)
            seq = event_seq() + 1
            data = build_input(seq, impact, self.config, MODEL_ID, MODEL_VERSION)
            spec = self.model.evaluate(data)
            if isinstance(spec, Unsupported):  # cannot happen for the perfect merge; never guess an outcome
                raise RuntimeError("perfect merge reported the input unsupported: " + "; ".join(spec.reasons))
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
            report.records.append(build_record(data, spec, spec.regime_reasons, warnings, f"evt-{seq}"))
            report.resolved += 1
        if report.resolved:
            select_ias15(sim)  # stale predictor state after a structural change (see backend/collisions.py)
        if candidates:
            sim.dt = candidates[0].dt_next_s  # resume on the step grid the legacy resolver would have continued on
        return report


def _centre_distance(a, b) -> float:
    return ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2) ** 0.5
