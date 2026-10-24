"""Orbit Lab: Experiment 01, "How does changing a planet's initial velocity affect its subsequent orbit?"

Spec: context/specs/EXPERIMENT_01_SPEC.md; design: plan section 11.
- The baseline is an immutable reference universe built from the Solar System preset's archived data (Sun and the
  Earth-Moon barycentre only), re-centred on their barycentre. It can be advanced and reset, never edited or restored.
- The modified run is a separate universe derived from the *baseline's initial snapshot* (never from its current state),
  with exactly one change: the selected body's velocity scaled by a factor from the system's fixed list (direction kept).
  What was changed is recorded in its provenance. Any later physical edit is audited and marks the run uncontrolled.
- A comparison reads both runs' recorded grid histories at the common sample times they have both reached; nothing is
  interpolated and neither run is touched.
"""
import json
import math
import threading
import time
import uuid
from pathlib import Path

from backend.errors import CodedError
from backend.presets.loader import PresetDataError, UnknownPresetError, load_preset
from backend.simulation import InitialBody, SimulationService
from backend.universes import UniverseRegistry, get_registry

SYSTEMS_FILE = Path(__file__).resolve().parent / "orbit_lab_systems.json"
SPEED_FACTOR_NOTE = "The velocity of the selected body is multiplied by the factor; its direction is kept exactly."


def _load_systems() -> dict[str, dict]:
    data = json.loads(SYSTEMS_FILE.read_text(encoding="utf-8"))
    return {s["id"]: s for s in data["systems"]}


def _recentre(bodies: list[InitialBody]) -> list[InitialBody]:
    """Shift to the barycentre of exactly these bodies (zero total momentum); a pure translation."""
    total = math.fsum(b.massKg for b in bodies)
    x0 = [math.fsum(b.massKg * b.positionM[k] for b in bodies) / total for k in range(3)]
    v0 = [math.fsum(b.massKg * b.velocityMPerS[k] for b in bodies) / total for k in range(3)]
    return [InitialBody(id=b.id, name=b.name, kind=b.kind, massKg=b.massKg, radiusM=b.radiusM,
                        positionM=tuple(b.positionM[k] - x0[k] for k in range(3)),
                        velocityMPerS=tuple(b.velocityMPerS[k] - v0[k] for k in range(3)), colorHex=b.colorHex,
                        basis=b.basis, sources=b.sources) for b in bodies]


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class Experiment:
    def __init__(self, eid: str, system_id: str, baseline_uid: str, created_at: str):
        self.id = eid
        self.system_id = system_id
        self.baseline_uid = baseline_uid
        self.modified_uid: str | None = None
        self.modification: dict | None = None
        self.created_at = created_at


class OrbitLab:
    def __init__(self, registry: UniverseRegistry):
        self.registry = registry
        self._systems = _load_systems()
        self._experiments: dict[str, Experiment] = {}
        self._lock = threading.RLock()

    # ---------- systems ----------
    def list_systems(self) -> list[dict]:
        return [json.loads(json.dumps(s)) for s in self._systems.values()]

    def _system(self, system_id: str) -> dict:
        s = self._systems.get(system_id)
        if s is None:
            raise CodedError(f"unknown Orbit Lab system: {system_id}", code="system_not_found", status=404)
        return s

    # ---------- experiments ----------
    def create_experiment(self, system_id: str) -> dict:
        system = self._system(system_id)
        try:
            preset = load_preset(system["presetId"])
        except (UnknownPresetError, PresetDataError) as exc:
            raise CodedError(f"the system's preset data cannot be loaded: {exc}", code="preset_invalid", status=500) from exc
        wanted = {b.id: b for b in preset.raw_bodies}
        try:
            chosen = [wanted[i] for i in system["bodyIds"]]
        except KeyError as exc:
            raise CodedError(f"the preset has no body {exc.args[0]}", code="preset_invalid", status=500) from exc
        bodies = _recentre(chosen)
        engine = SimulationService()
        try:
            engine.load_bodies(bodies, history_mode=system["historyMode"], sample_interval_s=system["sampleIntervalS"])
        except Exception as exc:  # noqa: BLE001
            raise CodedError(f"the experiment cannot be initialised: {exc}", code="preset_invalid", status=500) from exc
        data = preset.provenance
        provenance = {
            "sourceKind": "experiment", "presetId": system["presetId"], "presetDataVersion": data["dataVersion"],
            "epoch": data["epoch"]["label"], "epochDetail": data["epoch"], "frame": data["frame"],
            "origin": "Barycentre of the two included bodies (zero total momentum), shifted from the Solar System Barycenter",
            "units": data["units"], "initialStateDigest": engine.initial_state_digest, "derivedFrom": None, "modification": None,
        }
        eid = f"exp-{uuid.uuid4().hex[:12]}"
        with self._lock:
            u = self.registry.create("Orbit Lab · Baseline", role="baseline", engine=engine, provenance=provenance,
                                     preset_id=system["presetId"], experiment_id=eid, activate=True)
            exp = Experiment(eid, system_id, u.id, _now())
            self._experiments[eid] = exp
            return self._dto(exp)

    def list_experiments(self) -> list[dict]:
        with self._lock:
            return [self._dto(e) for e in self._experiments.values()]

    def _experiment(self, eid: str) -> Experiment:
        exp = self._experiments.get(eid)
        if exp is None:
            raise CodedError(f"unknown experiment: {eid}", code="experiment_not_found", status=404)
        return exp

    def get(self, eid: str) -> dict:
        with self._lock:
            return self._dto(self._experiment(eid))

    def _dto(self, exp: Experiment) -> dict:
        from backend.api_universes import summary  # the one place the UniverseSummary shape is defined
        system = self._system(exp.system_id)
        base = self.registry.get(exp.baseline_uid)
        snap = base.engine.initial_snapshot
        by_id = {p.name: p for p in snap.sim.particles}
        initial_bodies = []
        for bid in snap.meta:
            p, m = by_id[bid], snap.meta[bid]
            speed = math.sqrt(p.vx ** 2 + p.vy ** 2 + p.vz ** 2)
            initial_bodies.append({"id": bid, "name": m.name, "massKg": p.m, "radiusM": p.r, "positionM": [p.x, p.y, p.z],
                                   "velocityMPerS": [p.vx, p.vy, p.vz], "speedMPerS": speed})
        prov = base.provenance or {}
        mod = self.registry.get(exp.modified_uid) if exp.modified_uid else None
        return {
            "id": exp.id, "systemId": exp.system_id, "name": system["name"], "createdAtIso": exp.created_at,
            "baselineUniverseId": exp.baseline_uid, "modifiedUniverseId": exp.modified_uid,
            "baseline": summary(self.registry, base).model_dump(),
            "modified": summary(self.registry, mod).model_dump() if mod else None,
            "activeUniverseId": self.registry.active_id, "activationEpoch": self.registry.epoch,
            "system": json.loads(json.dumps(system)),
            "initialState": {"epoch": prov.get("epoch"), "jdTdb": (prov.get("epochDetail") or {}).get("jdTdb"),
                             "frame": prov.get("frame"), "origin": prov.get("origin"), "units": prov.get("units"),
                             "digest": base.engine.initial_state_digest, "bodies": initial_bodies,
                             "modelNote": system["modelNote"]},
            "modification": json.loads(json.dumps(exp.modification)) if exp.modification else None,
        }

    def create_modified_run(self, eid: str, body_id: str, speed_factor: float, replace_existing: bool) -> dict:
        with self._lock:
            exp = self._experiment(eid)
            system = self._system(exp.system_id)
            if body_id not in system["selectableBodyIds"]:
                raise CodedError(f"body {body_id!r} cannot be modified in this experiment; allowed: "
                                 f"{', '.join(system['selectableBodyIds'])}", code="body_not_allowed", status=422)
            if not isinstance(speed_factor, (int, float)) or isinstance(speed_factor, bool) or not any(
                    speed_factor == f for f in system["speedFactors"]):
                raise CodedError(f"speed factor {speed_factor!r} is not allowed; the first release accepts exactly "
                                 f"{system['speedFactors']}", code="factor_not_allowed", status=422)
            old = self.registry.get(exp.modified_uid) if exp.modified_uid else None
            if old is not None:
                if not replace_existing:
                    raise CodedError("this experiment already has a modified run; pass replaceExisting to recreate it",
                                     code="modified_run_exists")
                if old.id == self.registry.active_id:
                    raise CodedError("the modified run is the active universe; switch to another universe before replacing it",
                                     code="experiment_has_active_run")
            baseline = self.registry.get(exp.baseline_uid)
            snap = baseline.engine.initial_snapshot
            original = next(p for p in snap.sim.particles if p.name == body_id)
            original_v = [original.vx, original.vy, original.vz]
            factor = float(speed_factor)

            def scale(sim) -> None:
                for p in sim.particles:
                    if p.name == body_id:
                        p.vx, p.vy, p.vz = factor * p.vx, factor * p.vy, factor * p.vz

            engine = SimulationService.from_snapshot(snap, transform=scale, history_mode=system["historyMode"],
                                                     sample_interval_s=system["sampleIntervalS"])
            engine.audit_edits = True
            modified_v = [factor * v for v in original_v]
            modification = {
                "baselineUniverseId": exp.baseline_uid, "baselineInitialDigest": baseline.engine.initial_state_digest,
                "bodyId": body_id, "originalVelocityMPerS": original_v, "modifiedVelocityMPerS": modified_v,
                "speedFactor": factor, "units": "m/s", "createdAtIso": _now(),
            }
            prov = dict(baseline.provenance or {})
            prov.update({"initialStateDigest": engine.initial_state_digest,
                         "derivedFrom": {"baselineUniverseId": exp.baseline_uid,
                                         "baselineInitialDigest": baseline.engine.initial_state_digest},
                         "modification": modification})
            if old is not None:  # the new run exists only once everything above succeeded
                self.registry.delete(old.id)
            name = f"Orbit Lab · Modified ×{factor:.2f} speed"
            u = self.registry.create(name, role="modified", engine=engine, provenance=prov,
                                     preset_id=baseline.preset_id, experiment_id=eid, activate=False)
            exp.modified_uid, exp.modification = u.id, modification
            return self._dto(exp)

    def initial_differences(self, eid: str) -> dict:
        with self._lock:
            exp = self._experiment(eid)
            if exp.modified_uid is None:
                raise CodedError("this experiment has no modified run yet", code="no_modified_run")
            base, mod = self.registry.get(exp.baseline_uid), self.registry.get(exp.modified_uid)
            return _diff_initial(exp.id, base, mod)

    def delete(self, eid: str) -> None:
        with self._lock:
            exp = self._experiment(eid)
            uids = [u for u in (exp.baseline_uid, exp.modified_uid) if u]
            if self.registry.active_id in uids:
                raise CodedError("a run of this experiment is the active universe; switch to another universe first",
                                 code="experiment_has_active_run")
            for uid in uids:
                self.registry.delete(uid)
            del self._experiments[eid]

    # ---------- comparison ----------
    def comparison(self, eid: str, body_id: str) -> dict:
        with self._lock:
            exp = self._experiment(eid)
            system = self._system(exp.system_id)
            if body_id not in system["bodyIds"]:
                raise CodedError(f"body {body_id!r} is not part of this experiment", code="body_not_allowed", status=422)
            return self._compare(exp, system, body_id)

    def _compare(self, exp: Experiment, system: dict, body_id: str) -> dict:
        base = self.registry.get(exp.baseline_uid)
        interval = system["sampleIntervalS"]
        window_samples = int(round(system["observationWindowS"] / interval)) + 1  # k = 0 ... 730
        issues: list[str] = []
        out = {
            "bodyId": body_id, "sampleIntervalS": interval, "observationWindowS": system["observationWindowS"],
            "baseline": {"universeId": base.id, "simulationTimeS": base.engine.snapshot().simulationTimeS,
                         "sampleCount": base.engine.history.committed_next_index},
            "modified": None, "commonSampleCount": 0, "timesS": [], "baselinePositionM": [], "modifiedPositionM": [],
            "separationM": [], "windowCompleteBoth": False, "complete": False, "issues": issues, "timesDiffer": False,
            "comparedUpToS": None, "controlled": True, "firstUncontrolledAtS": None, "modification": exp.modification,
        }
        if exp.modified_uid is None:
            issues.append("no modified run has been created yet")
            return out
        mod = self.registry.get(exp.modified_uid)
        nb, nm = out["baseline"]["sampleCount"], mod.engine.history.committed_next_index
        out["modified"] = {"universeId": mod.id, "simulationTimeS": mod.engine.snapshot().simulationTimeS, "sampleCount": nm}
        out["controlled"], out["firstUncontrolledAtS"] = mod.engine.controlled, mod.engine.first_uncontrolled_at_s
        out["timesDiffer"] = out["baseline"]["simulationTimeS"] != out["modified"]["simulationTimeS"]
        for label, run, n in (("baseline", base, nb), ("modified", mod, nm)):
            if run.engine.history.truncated:
                issues.append(f"history recording stopped for the {label} run (its sample limit was reached)")
            if n <= 1:
                issues.append(f"the {label} run has not advanced past its initial sample")
        hb, hm = base.engine.history, mod.engine.history
        use = min(nb, nm, window_samples)
        for i in range(use):
            tb, _, pb = hb.sample_at(i)
            tm, _, pm = hm.sample_at(i)
            if tb != tm:  # both grids are k * interval; a mismatch would be a bug, and is reported rather than hidden
                issues.append(f"sample {i} has different times in the two runs ({tb} s and {tm} s)")
                break
            if body_id not in pb or body_id not in pm:
                issues.append(f"{body_id} is missing from a recorded sample at t = {tb} s (it was removed or merged)")
                break
            out["timesS"].append(tb)
            out["baselinePositionM"].append(list(pb[body_id]))
            out["modifiedPositionM"].append(list(pm[body_id]))
            out["separationM"].append(math.dist(pb[body_id], pm[body_id]))
        out["commonSampleCount"] = len(out["timesS"])
        out["comparedUpToS"] = out["timesS"][-1] if out["timesS"] else None
        if not mod.engine.controlled:
            issues.append(f"the modified run is uncontrolled since t = {mod.engine.first_uncontrolled_at_s:g} s "
                          "(a physical edit was made after it was created)")
        out["windowCompleteBoth"] = nb >= window_samples and nm >= window_samples
        out["complete"] = out["windowCompleteBoth"] and not issues
        return out


def _diff_initial(eid: str, base, mod) -> dict:
    """Field-by-field comparison of the two runs' initial states and configuration."""
    bs, ms = base.engine.initial_snapshot, mod.engine.initial_snapshot
    bp = {p.name: p for p in bs.sim.particles}
    mp = {p.name: p for p in ms.sim.particles}
    differences: list[dict] = []
    for bid in sorted(set(bs.meta) | set(ms.meta)):
        if bid not in bs.meta or bid not in ms.meta:
            differences.append({"bodyId": bid, "field": "presence", "baseline": bid in bs.meta, "modified": bid in ms.meta})
            continue
        a, b = bp[bid], mp[bid]
        pairs = [("massKg", a.m, b.m), ("radiusM", a.r, b.r), ("positionM", [a.x, a.y, a.z], [b.x, b.y, b.z]),
                 ("velocityMPerS", [a.vx, a.vy, a.vz], [b.vx, b.vy, b.vz]), ("name", bs.meta[bid].name, ms.meta[bid].name),
                 ("kind", bs.meta[bid].kind, ms.meta[bid].kind)]
        for field, x, y in pairs:
            if x != y:
                differences.append({"bodyId": bid, "field": field, "baseline": x, "modified": y})

    def config(snap, engine) -> dict:
        s = snap.sim
        return {"timeS": snap.simulation_time_s, "G": s.G, "integrator": str(s.integrator).lower(),
                "adaptiveMode": str(s.integrator.adaptive_mode).lower(), "collision": s.collision, "randSeed": s.rand_seed,
                "historyMode": engine.history.mode, "sampleIntervalS": engine.history.sample_interval_s,
                "bodyOrder": list(snap.meta)}

    cb, cm = config(bs, base.engine), config(ms, mod.engine)
    return {"experimentId": eid, "baselineUniverseId": base.id, "modifiedUniverseId": mod.id, "differences": differences,
            "configEqual": cb == cm, "config": {"baseline": cb, "modified": cm}}


_lab: OrbitLab | None = None
_lab_lock = threading.Lock()


def get_orbit_lab() -> OrbitLab:
    """The Orbit Lab of the current registry (a fresh registry, as in tests, gets a fresh lab)."""
    global _lab
    registry = get_registry()
    with _lab_lock:
        if _lab is None or _lab.registry is not registry:
            _lab = OrbitLab(registry)
        return _lab
