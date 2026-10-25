"""Contact detection for deferred resolution (plan 3.4).

REBOUND's `line` mode (swept straight-segment overlap test over each internal IAS15 step; M0 evidence D-008: 0 misses in 144
swept scenarios) decides WHETHER two bodies touched. In mode "outcome-v1" its callback only RECORDS the pair and asks
REBOUND to stop integrating at the end of that internal step. It never changes particles: adding or removing particles
inside the callback hangs the process (probe P3) and an unresolved overlap re-triggers thousands of callbacks (probe P2).
The engine resolves every recorded pair between `integrate` calls (backend/impact/engine.py).

REBOUND reports ALL pairs of one detection pass after `stop()` (probe, REBOUND 5.2.2), in an arbitrary order; `order_key`
imposes the deterministic resolution order (estimated contact time, then the sorted ids).
"""
import traceback
from dataclasses import dataclass


@dataclass(frozen=True)
class ContactCandidate:
    """A pair REBOUND reported, in REBOUND's own order (p1, p2), at detection time `time_s`."""

    first_id: str
    second_id: str
    time_s: float
    dt_last_done: float
    dt_next_s: float  # IAS15's suggested next step when the callback ran (see ContactRecorder.resolve)

    @property
    def pair_key(self) -> frozenset:
        return frozenset((self.first_id, self.second_id))


def order_key(candidate: ContactCandidate, estimated_contact_time_s: "float | None") -> tuple:
    """Deterministic resolution order: earlier contact first; then by the sorted body ids (independent of insertion order)."""
    t = candidate.time_s if estimated_contact_time_s is None else estimated_contact_time_s
    a, b = sorted((candidate.first_id, candidate.second_id))
    return (t, a, b)


class ContactRecorder:
    """The REBOUND `collision_resolve` callback of mode "outcome-v1": record, stop, keep both bodies (return 0)."""

    def __init__(self) -> None:
        self.pending: list[ContactCandidate] = []
        self.errors: list[str] = []
        self.stale = 0  # callbacks whose indices were out of range
        self.callbacks = 0

    def reset(self) -> None:
        self.pending = []
        self.errors = []

    def resolve(self, sim_ptr, col) -> int:
        self.callbacks += 1
        try:
            sim = sim_ptr.contents
            if col.p1 >= sim.N or col.p2 >= sim.N or col.p1 == col.p2:
                self.stale += 1
                return 0
            a, b = sim.particles[col.p1], sim.particles[col.p2]
            # REBOUND resets `sim.dt` (IAS15's suggested next step) to its default 0.001 s when `integrate` returns after a
            # stop, whereas the legacy in-callback resolver keeps the suggestion. Recording it lets the engine restore it,
            # so the integration continues on the same internal step grid as the legacy path (measured: without it the
            # second merge of a chain is detected 0.1 s later, tests/impact/test_deferred_equivalence.py).
            self.pending.append(ContactCandidate(a.name, b.name, sim.t, sim.dt_last_done, sim.dt))
            sim.stop()
            return 0
        except Exception:  # noqa: BLE001 - ctypes would swallow it; surface via `errors`
            self.errors.append(traceback.format_exc())
            try:
                sim_ptr.contents.stop()
            except Exception:  # noqa: BLE001
                pass
            return 0

    def take(self) -> list[ContactCandidate]:
        """The candidates recorded since the last call, unique by pair, in the order REBOUND reported them."""
        seen, out = set(), []
        for c in self.pending:
            if c.pair_key not in seen:
                seen.add(c.pair_key)
                out.append(c)
        self.pending = []
        return out
