"""Outcome-model selector (plan 3.6; decisions D-039 DQ-7, D-040 DQ-8, D-041 DQ-9, DQ-2). Pure: no REBOUND, no service state.

Decision order (every branch is recorded in the result's reasons):
1. A body without a material profile -> the exact legacy merge, labelled `material_unspecified` (never an invented material, never a
   refusal; DQ-2). A pair whose profiles are both present proceeds.
2. A gas-envelope-dominated body (gas mass fraction >= 0.5, provisional) on either side -> the envelope models (D-040); an
   envelope-dominated projectile on a non-envelope target is Unsupported. Gas bodies NEVER reach the rigid-body model.
2b. Two debris parcels aggregate (plan 3.9 explicit rule, H3); a parcel and a body go through the ordinary routes below.
3. Mass ratio below the LS12 range -> the cratering model (needs sourced constants in the target profile, otherwise Unsupported).
4. Otherwise the LS12 gravity-regime model, whose constants come from the target profile's explicit `ls12` block and `structureClass`
   (D-039: never inferred from size). Missing `ls12` or an unsupported class -> Unsupported. A pair whose two profiles disagree on
   `structureClass` uses the target's and gets the warning `structure_class_mixed`.
5. Outside the validity envelope (strength regime, D-041) the model returns Unsupported.

An `Unsupported` verdict is never turned into a plausible-looking outcome: the selector returns the DOCUMENTED FALLBACK — a perfect
merge with fidelity `unsupported`, outcome `perfect_merge`, warning `unsupported_regime` and the reasons — flagged `fallback=True`.
Registered extra models (a future solver, e.g. a reviewed strength model) take precedence over the built-ins when their predicate
matches and their `OutcomeSpec` is returned unchanged.
"""
import dataclasses
from dataclasses import dataclass
from typing import Callable, Optional

from backend.impact.contracts import CollisionInput, Fidelity, OutcomeSpec
from backend.impact.models.base import OutcomeModel, Unsupported
from backend.impact.models.cratering import CrateringModel
from backend.impact.models.envelope import EnvelopeModel, is_envelope_dominated
from backend.impact.models.ls12 import LS12Model
from backend.impact.models.perfect_merge import PerfectMergeModel
from backend.impact.models.validity import LS12_ENVELOPE


@dataclass(frozen=True)
class Selection:
    spec: OutcomeSpec
    route: str  # id of the model that produced the spec ("perfect_merge" for the fallback)
    fallback: bool  # True when no supported model applied and the documented fallback was used
    unsupported_reasons: tuple[str, ...] = ()


class Selector:
    def __init__(self, g: float):
        self.g = g
        self._ls12 = LS12Model(g)
        self._cratering = CrateringModel(g)
        self._envelope = EnvelopeModel()
        self._merge = PerfectMergeModel()
        self._extra: list[tuple[Callable[[CollisionInput], bool], OutcomeModel]] = []

    def register(self, predicate: Callable[[CollisionInput], bool], model: OutcomeModel) -> None:
        """Add a model consulted BEFORE the built-in routes (extension point; a future solver adapter plugs in here)."""
        self._extra.append((predicate, model))

    def select(self, data: CollisionInput) -> Selection:
        for predicate, model in self._extra:
            if predicate(data):
                return self._wrap(model.evaluate(data), model.model_id, data)
        imp = data.impact
        tp, pp = imp.target.material_profile, imp.projectile.material_profile
        if tp is None or pp is None:
            return Selection(self._merge.evaluate(data), self._merge.model_id, False)  # DQ-2: exact legacy merge, labelled
        if imp.target.representation == "debris-parcel" and imp.projectile.representation == "debris-parcel":
            return self._aggregate_parcels(data)
        if is_envelope_dominated(tp) or is_envelope_dominated(pp):
            return self._wrap(self._envelope.evaluate(data), self._envelope.model_id, data)
        if imp.mass_ratio < LS12_ENVELOPE.min_mass_ratio:
            return self._wrap(self._cratering.evaluate(data), self._cratering.model_id, data)
        result = self._ls12.evaluate(data)
        if isinstance(result, OutcomeSpec) and pp.structure_class != tp.structure_class:
            result = dataclasses.replace(result, warnings=tuple(dict.fromkeys((*result.warnings, "structure_class_mixed"))))
        return self._wrap(result, self._ls12.model_id, data)

    def _aggregate_parcels(self, data: CollisionInput) -> Selection:
        """Plan 3.9 explicit rule: two debris parcels (statistical populations) that touch aggregate into one parcel, conserving mass and
        momentum. No outcome model is applied to two populations (none is calibrated for it); the record says so (H3)."""
        base = self._merge.evaluate(data)
        assert isinstance(base, OutcomeSpec)
        spec = dataclasses.replace(
            base, outcome="perfect_merge",
            regime_reasons=("both bodies are debris parcels (statistical populations): they aggregate into one parcel (plan 3.9 explicit "
                            "rule, momentum-conserving); no collision-outcome model is applied to two populations",),
            fidelity={"outcome": Fidelity.APPROXIMATION, "remnantState": Fidelity.COMPUTED, "debrisParcels": Fidelity.STATISTICAL},
            warnings=("debris_parcels_aggregated",))
        return Selection(spec, self._merge.model_id, False)

    def _wrap(self, result: "OutcomeSpec | Unsupported", route: str, data: CollisionInput) -> Selection:
        if isinstance(result, OutcomeSpec):
            return Selection(result, route, False)
        return self.fallback(data, route, result.reasons)

    def fallback(self, data: CollisionInput, attempted: Optional[str], reasons: tuple[str, ...]) -> Selection:
        """The documented fallback for an unsupported regime: a perfect merge that says it is unsupported."""
        base = self._merge.evaluate(data)
        assert isinstance(base, OutcomeSpec)
        spec = dataclasses.replace(
            base, outcome="perfect_merge", regime_reasons=tuple((f"{attempted}: unsupported" if attempted else "unsupported", *reasons,
                                                                "fallback: perfect merge (no supported model applies)")),
            fidelity={"outcome": Fidelity.UNSUPPORTED, "remnantState": Fidelity.COMPUTED},
            warnings=tuple(dict.fromkeys((*base.warnings, "unsupported_regime"))))
        return Selection(spec, self._merge.model_id, True, tuple(reasons))
