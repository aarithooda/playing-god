"""Registry of the PROVISIONAL scientific assumptions (D-038). Every function that uses a relation or constant whose source is
not signed off by a human reviewer is decorated with `@provisional("<id>")`, so the assumptions stay traceable and localised:
a reviewer (or a later correction) finds all of them here and in the matching tests (tests/impact/test_ls12.py).

Nothing in this module is a scientific result. CP-SCI-1 is NOT signed off. Items marked `unverified` have not been read
verbatim from the primary paper by the implementer; items marked `transcribed` appeared verbatim in the part of the paper read by
a fetch sub-agent (model-assisted, still to be checked against the printed paper).
"""
from dataclasses import dataclass
from typing import Callable, TypeVar

PROVISIONAL_LABEL = "provisional:CP-SCI-1"  # appears in the warnings of every outcome that depends on a provisional item
F = TypeVar("F", bound=Callable)


@dataclass(frozen=True)
class ProvisionalItem:
    id: str
    what: str
    source: str
    status: str  # "transcribed" | "unverified" | "engineering"
    open_item: str


ITEMS: dict[str, ProvisionalItem] = {i.id: i for i in (
    ProvisionalItem("LS12-eq28-qrd-gamma1", "Q*_RD,gamma=1 = c* (4/5) pi rho_1 G R_C1^2", "Leinhardt & Stewart 2012 eq. 28", "transcribed",
                    "UD-1: the printed worked example (5.3 J/kg) is not reproduced; its stated inputs are unknown (D-038)"),
    ProvisionalItem("LS12-eq6-bcrit", "b_crit = R_t / (R_t + R_p)", "LS12 eq. 6", "transcribed",
                    "UD-2: the printed value 0.66 for gamma = 0.1 is not reproduced with equal densities (0.683)"),
    ProvisionalItem("LS12-eq23-mass-ratio", "Q*_RD = Q*_RD,gamma=1 (1/4 (gamma+1)^2/gamma)^(2/(3 mubar) - 1)", "LS12 eq. 23", "transcribed",
                    "to be checked against the printed paper"),
    ProvisionalItem("LS12-eq11-15-interacting-mass", "alpha, mu_alpha, Q'*_RD = (mu/mu_alpha)^(2 - 3 mubar/2) Q*_RD", "LS12 eqs. 7, 11, 12, 15", "transcribed",
                    "to be checked against the printed paper"),
    ProvisionalItem("LS12-eq5-universal-law", "M_lr/M_tot = -0.5 (Q_R/Q'*_RD - 1) + 0.5, valid up to Q_R/Q'*_RD = 1.8", "LS12 eqs. 4, 5", "transcribed",
                    "whether the 1.8 transition is in Q*_RD or Q'*_RD (the text read prints Q*_RD); Q'*_RD is used"),
    ProvisionalItem("LS12-eq44-supercatastrophic", "M_lr/M_tot = (0.1 / 1.8^eta) (Q_R/Q'*_RD)^eta, eta = -1.5", "LS12 eq. 44", "unverified",
                    "only seen in a model summary; eta ~ -1.5 and the form are unconfirmed"),
    ProvisionalItem("LS12-beta", "fragment size-distribution slope beta = 2.85", "LS12 sec. III.2", "unverified",
                    "value seen only in a summary and in the planning notes"),
    ProvisionalItem("LS12-ctable", "c* = 5 +/- 2, mubar = 0.37 (small bodies); c* = 1.9 +/- 0.3, mubar = 0.36 (hydrodynamic planets)", "LS12 abstract and sec. III",
                    "transcribed", "rubble values c* = 5.5, mubar = 0.365 were not found in the text read: unverified"),
    ProvisionalItem("LS12-hit-and-run-minimal", "hit-and-run: target keeps min(M_t, M_lr from eq. 5), projectile unchanged", "engineering approximation",
                    "engineering", "LS12 eqs. 46-54 (reverse impact for the projectile) were not read; projectile erosion is not modelled"),
    ProvisionalItem("G12-eq16-graze-and-merge", "v_cr/v_esc = c1 Gamma Theta^c5 + c2 Gamma + c3 Theta^c5 + c4; Theta = 1 - sin(theta)", "Genda, Kokubo & Ida 2012 eq. 16",
                    "transcribed", "calibrated only for protoplanet collisions: used outside it as an approximation"),
    ProvisionalItem("HH11-cratering-form", "crater radius R = K1 (m/rho)^(1/3) [(g a/U^2)(rho/delta)^(2 nu/mu)]^(-mu/(2+mu))", "COLLISION_SCIENTIFIC_MODELS.md 4.4 ([VERIFY])",
                    "unverified", "form and Table 3 constants unverified; no shipped profile has constants, so cratering is Unsupported for them"),
    ProvisionalItem("ENV-0.5-threshold", "envelope-dominated when the gas mass fraction is >= 0.5", "engineering choice (D-040)", "engineering",
                    "not a physical law"),
    ProvisionalItem("VALIDITY-min-radius", "LS12 disruptive outcomes only for target radius >= 1e4 m", "smallest target of the LS12 simulation set (D-041)", "engineering",
                    "to be checked; the strength regime has no model in v1"),
    ProvisionalItem("DQ6-ejection-factor", "ejection speed of every fragment/parcel = f x mutual escape speed, f in [1.05, 1.10]", "Chambers 2013 / Childs & Steffen 2022 practice ('somewhat arbitrary', 'likely an underestimate'; secondary text only)",
                    "engineering", "NOT a universal constant (D-048): source and applicability to non-protoplanet regimes unverified; replace or re-derive before presenting as more than a placeholder"),
    ProvisionalItem("FRAG-tracked-share", "tracked fragments hold at most 50 % of the debris mass; the rest is the untracked tail", "engineering choice (D-048 (3))",
                    "engineering", "no source; the tracked/untracked split is a budget policy, not a physical law"),
    ProvisionalItem("FRAG-parcel-dmin", "untracked population diameter range [1e-3, 1] x its upper cut", "engineering choice",
                    "engineering", "no source; only a numerical truncation of the statistical descriptor"),
    ProvisionalItem("ESC-physical-radii", "merge criterion v_i <= sqrt(2 G M_tot / (R_t + R_p))", "Genda et al. 2012 eq. 8 / CS22 (physical radii)", "engineering",
                    "LS12 uses R_C1 in its scaling; both speeds are recorded"),
)}

REGISTRY: dict[str, str] = {}  # function qualified name -> item id


def provisional(item_id: str) -> Callable[[F], F]:
    if item_id not in ITEMS:
        raise KeyError(f"unknown provisional item {item_id}")

    def mark(fn: F) -> F:
        fn.__provisional__ = item_id  # type: ignore[attr-defined]
        REGISTRY[f"{fn.__module__}.{fn.__qualname__}"] = item_id
        return fn

    return mark
