"""Backend-recorded position history of one universe (UI-2; plan section 11B).

Only states produced by the engine are recorded; nothing is interpolated or extrapolated here or anywhere else.
Two modes:
- "grid": a sample at every k * sample_interval_s the engine lands on (presets, Orbit Lab). When the cap is reached
  recording stops and `truncated` is set, which keeps every run comparable from t = 0.
- "step": one sample per committed change (sandbox). A ring: the oldest samples are dropped and `dropped_before`
  (the index of the first retained sample) reports it.

Storage is flat `array`s (no per-sample objects). A sample is `(index, t, segment, [(body, x, y, z), ...])`;
`segment` increases whenever the path is physically discontinuous (edit, add, delete, merger), so a client never joins
points across it. Per-body display metadata is kept for every body that ever appeared, including merged-away ones.

Concurrency: the engine writes under its own lock; readers (`page`) use no engine lock, only this buffer's tiny
lock, and only ever see *committed* samples. `commit()` publishes what the engine recorded, `rollback()` discards the
uncommitted tail (a failed or cancelled step), so a reader never sees a half-finished step.
"""
import itertools
import threading
from array import array

MAX_HISTORY_POINTS = 200_000  # body-position records per universe (24 B each in the coordinate array)
MAX_PAGE_SAMPLES = 5000

_generations = itertools.count(1)


def next_generation() -> int:
    return next(_generations)


class HistoryBuffer:
    def __init__(self, mode: str = "step", sample_interval_s: float | None = None,
                 max_points: int = MAX_HISTORY_POINTS):
        if mode not in ("grid", "step"):
            raise ValueError(f"unknown history mode: {mode}")
        if mode == "grid" and not (sample_interval_s and sample_interval_s > 0):
            raise ValueError("grid mode needs a positive sample_interval_s")
        self.mode = mode
        self.sample_interval_s = sample_interval_s if mode == "grid" else None
        self.max_points = max_points
        self.generation = next_generation()
        self.truncated = False
        self.first_index = 0  # index of the oldest retained sample (== number of dropped samples)
        self._segment = 0
        self._lock = threading.Lock()
        self._t = array("d")
        self._seg = array("q")
        self._off = array("q")  # start of each sample in _ids / _xyz
        self._ids = array("i")  # body index per position record
        self._xyz = array("d")  # 3 floats per position record
        self._bodies: list[str] = []
        self._body_index: dict[str, int] = {}
        self.meta: dict[str, dict] = {}
        self._commit()

    # ---------- bookkeeping ----------
    @property
    def next_index(self) -> int:
        return self.first_index + len(self._t)

    def _commit(self) -> None:
        self._c_next = self.first_index + len(self._t)  # absolute index one past the last committed sample
        self._c_segment = self._segment
        self._c_truncated = self.truncated

    def commit(self) -> None:
        with self._lock:
            self._commit()

    def rollback(self) -> None:
        """Discard everything recorded since the last commit."""
        with self._lock:
            # A ring trim since the commit cannot be undone (dropped samples are gone); only the tail is cut.
            self._cut(max(self._c_next - self.first_index, 0))
            self._segment = self._c_segment
            self.truncated = self._c_truncated
            self._commit()

    def _cut(self, keep: int) -> None:
        if keep >= len(self._t):
            return
        end = self._off[keep]
        del self._t[keep:], self._seg[keep:], self._off[keep:]
        del self._ids[end:], self._xyz[3 * end:]

    def bump_segment(self) -> None:
        self._segment += 1

    @property
    def segment(self) -> int:
        return self._segment

    def new_generation(self) -> int:
        self.generation = next_generation()
        return self.generation

    # ---------- grid helpers ----------
    def next_grid_time(self) -> float | None:
        """Time of the next grid sample the engine must land on, or None (step mode, or recording has stopped)."""
        if self.mode != "grid" or self.truncated:
            return None
        return self.next_index * self.sample_interval_s

    # ---------- recording ----------
    def record(self, t: float, positions: list[tuple[str, float, float, float]], meta: dict[str, dict]) -> bool:
        """Append one sample. Returns False when a grid buffer is full (and marks it truncated)."""
        with self._lock:
            if self.mode == "grid" and len(self._ids) + len(positions) > self.max_points:
                self.truncated = True
                return False
            self._off.append(len(self._ids))
            self._t.append(t)
            self._seg.append(self._segment)
            for body_id, x, y, z in positions:
                idx = self._body_index.get(body_id)
                if idx is None:
                    idx = len(self._bodies)
                    self._bodies.append(body_id)
                    self._body_index[body_id] = idx
                self._ids.append(idx)
                self._xyz.extend((x, y, z))
            for body_id, m in meta.items():
                self.meta[body_id] = dict(m)
            if self.mode == "step" and len(self._ids) > self.max_points:
                self._drop_oldest()
            return True

    def _drop_oldest(self) -> None:
        """Called under the lock: drop whole oldest samples until the cap holds (the newest sample always stays)."""
        drop = 0
        total = len(self._ids)
        while drop < len(self._t) - 1 and total > self.max_points:
            nxt = self._off[drop + 1] if drop + 1 < len(self._off) else len(self._ids)
            total -= nxt - self._off[drop]
            drop += 1
        if drop == 0:
            return
        cut = self._off[drop]
        del self._t[:drop], self._seg[:drop]
        del self._ids[:cut], self._xyz[:3 * cut]
        rest = array("q", (o - cut for o in self._off[drop:]))
        self._off = rest
        self.first_index += drop

    # ---------- reads ----------
    def page(self, generation: int | None, from_index: int, body_ids: set[str] | None, limit: int) -> dict:
        """Committed samples from `from_index` (at most `limit`). A missing or different `generation` means the caller's
        cache is for another history: the page then starts at the first retained sample."""
        limit = max(1, min(limit, MAX_PAGE_SAMPLES))
        with self._lock:
            start = from_index if generation == self.generation else self.first_index
            start = min(max(start, self.first_index, 0), self._c_next)
            stop = min(start + limit, self._c_next)
            samples = []
            for index in range(start, stop):
                i = index - self.first_index
                lo = self._off[i]
                hi = self._off[i + 1] if i + 1 < len(self._off) else len(self._ids)
                pos = {}
                for k in range(lo, hi):
                    bid = self._bodies[self._ids[k]]
                    if body_ids is None or bid in body_ids:
                        pos[bid] = [self._xyz[3 * k], self._xyz[3 * k + 1], self._xyz[3 * k + 2]]
                samples.append({"index": index, "simulationTimeS": self._t[i], "segment": self._seg[i],
                                "positionsM": pos})
            return {"mode": self.mode, "sampleIntervalS": self.sample_interval_s, "generation": self.generation,
                    "firstIndex": start, "nextIndex": stop,
                    "droppedBefore": self.first_index, "truncated": self._c_truncated, "samples": samples,
                    "bodies": {b: dict(m) for b, m in self.meta.items()
                               if body_ids is None or b in body_ids}}

    def sample_at(self, index: int) -> tuple[float, int, dict[str, tuple[float, float, float]]]:
        """(t, segment, positions) of one retained sample, committed or not; used by the engine and by comparisons."""
        with self._lock:
            i = index - self.first_index
            if not 0 <= i < len(self._t):
                raise IndexError(index)
            lo = self._off[i]
            hi = self._off[i + 1] if i + 1 < len(self._off) else len(self._ids)
            return self._t[i], self._seg[i], {
                self._bodies[self._ids[k]]: (self._xyz[3 * k], self._xyz[3 * k + 1], self._xyz[3 * k + 2])
                for k in range(lo, hi)}

    @property
    def committed_next_index(self) -> int:
        with self._lock:
            return self._c_next

    # ---------- copy ----------
    def copy(self) -> "HistoryBuffer":
        """An independent buffer holding everything committed here, with the same generation (the engine assigns a
        new one when the copy replaces live history)."""
        with self._lock:
            c = HistoryBuffer.__new__(HistoryBuffer)
            c.mode, c.sample_interval_s, c.max_points = self.mode, self.sample_interval_s, self.max_points
            c.generation, c.truncated, c.first_index, c._segment = self.generation, self.truncated, self.first_index, self._segment
            c._lock = threading.Lock()
            c._t, c._seg, c._off = array("d", self._t), array("q", self._seg), array("q", self._off)
            c._ids, c._xyz = array("i", self._ids), array("d", self._xyz)
            c._bodies, c._body_index = list(self._bodies), dict(self._body_index)
            c.meta = {b: dict(m) for b, m in self.meta.items()}
            c._commit()
            return c
