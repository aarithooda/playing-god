"""M0 spike tests: collision detection, merger mechanics, stable ids, checkpoint with collisions. SI units.

Test spheres: A = 2000 kg, r = 1.0 m; B = 1000 kg, r = 0.8 m (contact distance 1.8 m). Mutual gravity changes the
relative velocity by ~6e-8 relative over a 100 s, 2 m/s approach, so expectations computed from initial
conditions use a 1e-6 tolerance (model approximation, derived), while arithmetic identities use 1e-12 (round-off).
Tests named *known_failure* / *limitation* PRESERVE an observed REBOUND behaviour; if one starts failing, REBOUND
changed: review the spike report before touching the assertion.
"""
import pytest

pytest.importorskip("rebound")

# Two tests here (the `merger` fixture and `test_builtin_merge...`) end with a single remnant drifting for 40 s,
# and REBOUND's IAS15 then reports "predictor corrector loops did not converge". It is spurious: with one body the
# acceleration is exactly zero and IAS15's convergence ratio is 0/0 (diagnosis and minimal repro:
# tests/test_step_guard.py::test_rebound_ias15_reports_nonconvergence_for_a_single_force_free_body, task P-004).
# The production service avoids it by advancing a lone body analytically. Only this message is ignored, and only
# here; pytest.ini turns every other RuntimeWarning into an error.
pytestmark = pytest.mark.filterwarnings("ignore:At least 10 predictor corrector loops:RuntimeWarning")

from backend.experiments import collision_spike as cs  # noqa: E402
from backend.experiments.rebound_spike import G_SI, add, norm, scale, sub, vel  # noqa: E402


# ---------------------------------------------------------------- detection: analytic scenarios
@pytest.mark.parametrize("mode", ["direct", "line"])
@pytest.mark.parametrize("dt", [1.0, 0.1, 0.01])
def test_slow_head_on_detected_within_one_step_after_contact(mode, dt):
    """Timestep refinement. Contact t_c = (sep - R)/v_rel = 99.1185 s (analytic; sep chosen so contact does not
    coincide with a step end). Detection can only happen at a step end after contact: 0 <= delay <= dt."""
    r = cs.detection_run(mode, dt)
    assert r["detected"] and r["stale"] == 0
    assert -1e-9 <= r["delay"] <= dt + 1e-9


def test_fast_head_on_direct_misses_line_detects_known_limitation_of_direct():
    """v_rel = 2000 m/s, dt = 0.01 s => 20 m per step vs contact distance 1.8 m (3.6 m overlap window)."""
    assert cs.detection_run("direct", 0.01, v_rel=2000.0, sep=cs.SEP_FAST)["detected"] is False
    assert cs.detection_run("line", 0.01, v_rel=2000.0, sep=cs.SEP_FAST)["detected"] is True


@pytest.mark.parametrize("direction", [(1.0, 0.0, 0.0), (1.0, 2.0, 3.0)])
@pytest.mark.parametrize("b", [0.0, 1e-6, 0.5])
def test_line_never_misses_head_on_phase_scan_while_direct_mostly_misses(direction, b):
    """50 crossing phases within one 0.01 s step, v_rel = 2000 m/s, gravity off (isolates detection geometry;
    leapfrog). Expected miss probability for direct: ~1 - 3.6 m / 20 m = 82%."""
    miss_line = miss_direct = 0
    for i in range(50):
        tx = 10.0 + 0.01 * i / 50 + 1e-7
        kw = dict(v_rel=2000.0, sep=2000.0 * tx, b=b, direction=direction)
        miss_line += not cs.detection_run("line", 0.01, **kw)["detected"]
        miss_direct += not cs.detection_run("direct", 0.01, **kw)["detected"]
    assert miss_line == 0
    assert miss_direct >= 35


@pytest.mark.parametrize("mode", ["direct", "line"])
def test_grazing_detected_and_near_miss_not_detected(mode):
    """b = 1.7 m < 1.8 m (grazing, overlap path 1.18 m) must be detected at dt=0.1; b = 1.9 m (near miss, margin
    0.1 m >> mutual-gravity deflection ~1e-9 m) must not be, at dt = 1.0 and 0.1 (no false positives)."""
    g = cs.detection_run(mode, 0.1, b=1.7)
    assert g["detected"] and 0 <= g["delay"] <= 0.1 + 1e-9
    for dt in (1.0, 0.1):
        assert cs.detection_run(mode, dt, b=1.9)["detected"] is False


def test_grazing_coarse_step_line_detects():
    assert cs.detection_run("line", 1.0, b=1.7)["detected"] is True


# ---------------------------------------------------------------- randomised sweep against measured truth
@pytest.fixture(scope="module")
def scenarios():
    return cs.sweep_scenarios()  # n=150, seed=12345; each has a TRUE closest approach from a reference run


@pytest.mark.parametrize("integrator,dt,chunk", [("ias15", None, None), ("ias15", None, 1e3), ("whfast", 1e5, None),
                                                 ("whfast", 1e4, None), ("whfast", 1e3, None)])
def test_sweep_line_has_no_errors_direct_misses_most(scenarios, integrator, dt, chunk):
    """150 random scenarios (relative speed 10 .. 1e5 m/s, impact parameter 0 .. 3 contact distances, random
    direction and encounter phase; a star+planet set the step size). Classified against the true closest
    approach (scenarios within 5% of the contact distance are excluded as ambiguous). EVIDENCE, NOT PROOF:
    one seed, 5 integrator/step configurations, ~144 classified scenarios each."""
    line = cs.sweep_confusion(scenarios, "line", integrator, dt, chunk)
    direct = cs.sweep_confusion(scenarios, "direct", integrator, dt, chunk)
    n_true = line["TP"] + line["FN"]
    assert n_true >= 40 and line["TN"] + line["FP"] >= 80
    assert line["FN"] == 0 and line["FP"] == 0
    assert direct["FP"] == 0
    assert direct["FN"] >= 0.7 * n_true  # direct misses most true collisions with these steps


def test_whfast_radial_pass_corrupts_state_known_failure():
    """Exact axis-aligned head-on (b=0), real G, 20 m per step, sep = 20007 m: WHFast's Kepler step passes through
    r = 0 and returns |x| ~ 1e45 m, and line mode then misses the collision. (sep 20012 hangs the process, so it is
    deliberately not run.) IAS15 on the same input detects and stays finite."""
    w = cs.whfast_radial_failure("whfast")
    assert w["detected"] is False and w["max_abs_x"] > 1e20
    i = cs.whfast_radial_failure("ias15")
    assert i["detected"] is True and i["max_abs_x"] < 1e5


# ---------------------------------------------------------------- merger mechanics (analytic, SI)
@pytest.fixture(scope="module")
def merger():
    return cs.merger_analytic()


def test_merger_conserves_mass_and_linear_momentum(merger):
    """Mass [kg]: exact sum (round-off). Momentum [kg m/s]: remnant p = M v_com must equal the analytic initial
    total momentum; bound 1e-12 relative to sum |m v| (round-off)."""
    ex, b, a = merger["expected"], merger["before"], merger["after"]
    pre = merger["layer"].events[0]["pre"]
    assert abs(a["mass"] - b["mass"]) < 1e-9 and a["mass"] == pytest.approx(ex["M"], abs=1e-9)
    scale_p = sum(abs(m) * norm(v) for m, v in zip(pre["m"], pre["v"]))
    assert norm(sub(a["p"], ex["p"])) < 1e-12 * scale_p
    assert norm(sub(a["p"], b["p"])) < 1e-12 * scale_p


def test_merger_remnant_moves_with_centre_of_mass_velocity(merger):
    """Remnant velocity [m/s] == analytic p/M (round-off, 1e-12 abs). Remnant position after 40 s of free motion
    == x_com0 + v_com t (COM motion is unaffected by internal forces; round-off at ~100 m: 1e-9 m)."""
    sim, ex = merger["sim"], merger["expected"]
    rem = sim.particles["A"]
    assert norm(sub(vel(rem), ex["v_com"])) < 1e-12
    expect_x = add(ex["x_com0"], scale(ex["v_com"], merger["t_end"]))
    assert norm(sub([rem.x, rem.y, rem.z], expect_x)) < 1e-9
    assert rem.m == pytest.approx(ex["M"], abs=1e-9) and rem.r == pytest.approx(ex["R"], rel=1e-12)


def test_merger_energy_loss_uses_reduced_mass_and_pre_collision_velocities(merger):
    """Translational KE lost [J] = 1/2 mu v_rel^2.
    (a) arithmetic identity from the callback's own pre-collision velocities: 1e-12 relative (round-off);
    (b) from the INITIAL conditions only: 1e-6 relative (mutual gravity speeds the pair up by ~6e-8);
    (c) initial conditions + energy conservation of the relative orbit,
        v_rel^2 = v0^2 + 2 G M (1/r_cb - 1/r0): 1e-12 relative (integration + round-off)."""
    ev, ex = merger["layer"].events[0], merger["expected"]
    mu = ex["mu"]
    assert ev["ke_lost"] == pytest.approx(0.5 * mu * ev["v_rel"] ** 2, rel=1e-12)
    assert ev["ke_lost"] == pytest.approx(ex["dKE"], rel=1e-6)
    r0 = norm(sub(merger["bodies"][0]["x"], merger["bodies"][1]["x"]))
    v2 = ex["v_rel"] ** 2 + 2 * G_SI * ex["M"] * (1 / ev["sep_at_callback"] - 1 / r0)
    assert ev["ke_lost"] == pytest.approx(0.5 * mu * v2, rel=1e-12)
    assert ev["b"] == pytest.approx(0.5, rel=1e-6)  # impact parameter (offset along y)


def test_merger_angular_momentum_accounting_orbital_vs_remnant_spin(merger):
    """Angular momentum about the origin [kg m^2/s]. The point-mass remnant keeps only M r_com x v_com; the
    orbital part mu (r_rel x v_rel) is NOT kept by the point-mass state and is booked as remnant spin.
    Central forces conserve r_rel x v_rel exactly, so the analytic value from the initial state holds:
    1e-9 relative (integration), and L_before = L_after + spin to 1e-9 relative."""
    ev, ex, layer = merger["layer"].events[0], merger["expected"], merger["layer"]
    assert norm(sub(ev["L_orb"], ex["L_orb"])) < 1e-9 * norm(ex["L_orb"])
    lost = sub(merger["before"]["L"], merger["after"]["L"])
    assert norm(sub(lost, ex["L_orb"])) < 1e-9 * norm(ex["L_orb"])
    assert norm(sub(layer.spin["A"], ex["L_orb"])) < 1e-9 * norm(ex["L_orb"])
    assert norm(ex["L_orb"]) > 100.0  # b = 0.5 m makes the effect large enough to be meaningful


def test_total_energy_is_not_conserved_it_is_booked_as_heat_plus_potential_jump(merger):
    """Kinetic + gravitational potential energy [J] is NOT conserved across the merger. Ledger:
    dE_total = -ke_lost + dPE_jump (dPE = +7.6e-5 J: merged bodies no longer share a potential). Final minus
    initial total energy equals the event's dE_total (energy is conserved between events, 1e-9 relative)."""
    ev, layer = merger["layer"].events[0], merger["layer"]
    assert ev["dKE_total"] == pytest.approx(-ev["ke_lost"], rel=1e-12)
    assert ev["dE_total"] == pytest.approx(ev["dKE_total"] + ev["dPE_total"], rel=1e-12)
    assert 0 < ev["dPE_total"] < 1e-3
    assert layer.heat_J == pytest.approx(ev["ke_lost"], rel=1e-12)
    dE = merger["after"]["E"] - merger["before"]["E"]
    assert dE == pytest.approx(ev["dE_total"], rel=1e-9)
    assert dE < -1000.0  # a kinetic-energy-only ledger would wrongly claim conservation


def test_builtin_merge_gives_same_remnant_state_but_no_diagnostics(merger):
    b = cs.merge_run(merger["bodies"], "line", 0.5, merger["t_end"], builtin=True)
    rem = b["sim"].particles[0]
    ours = merger["sim"].particles["A"]
    assert b["sim"].N == 1 and len(b["layer"].events) == 0
    assert rem.m == pytest.approx(ours.m, abs=1e-9)
    assert norm(sub([rem.x, rem.y, rem.z], [ours.x, ours.y, ours.z])) < 1e-6
    assert norm(sub(vel(rem), vel(ours))) < 1e-9


# ---------------------------------------------------------------- multiple collisions, three bodies, ids
@pytest.mark.parametrize("mode,dt", [("line", 0.5), ("direct", 0.5), ("line", 5.0), ("direct", 5.0)])
def test_two_independent_collisions_in_one_step(mode, dt):
    """(A,B) and (C,D) touch in the same step (also with 5 s steps = 10 m of travel). Both must merge, mass and
    momentum conserved (round-off 1e-12 relative to sum |m v|), no stale callbacks, no callback exceptions."""
    r = cs.two_pairs_one_step(mode, dt)
    layer = r["layer"]
    assert r["sim"].N == 2 and layer.errors == [] and layer.stale == 0
    assert {(e["survivor"], e["absorbed"]) for e in layer.events} == {("A", "B"), ("C", "D")}
    scale_p = sum(abs(p.m) * norm(vel(p)) for p in r["sim"].particles)
    assert abs(r["after"]["mass"] - r["before"]["mass"]) < 1e-9
    assert norm(sub(r["after"]["p"], r["before"]["p"])) < 1e-12 * scale_p


@pytest.mark.parametrize("mode", ["line", "direct"])
def test_chain_collision_resolves_fully_and_conserves(mode):
    """A and C hit a resting B from both sides in the same step. Observed: the first merge happens in that step
    and the remnant merges with the third body one step later; the survivor id depends on callback order (see the
    seeding test), so only the invariants are asserted."""
    r = cs.chain_collision(mode)
    layer = r["layer"]
    assert r["sim"].N == 1 and len(layer.events) == 2 and layer.errors == [] and layer.stale == 0
    assert r["sim"].particles[0].name in ("A", "C")
    assert abs(r["after"]["mass"] - r["before"]["mass"]) < 1e-9
    scale_p = 2.0e3 * 2.0 + 1.5e3 * 2.0
    assert norm(sub(r["after"]["p"], r["before"]["p"])) < 1e-12 * scale_p


def test_collision_resolution_order_is_random_unless_rand_seed_is_set():
    """OBSERVED: with identical inputs REBOUND resolves simultaneous collisions in random order (survivor id differs
    run to run). new_sim() sets sim.rand_seed, which made repeated runs identical."""
    import rebound as rb

    seeded = {cs.chain_collision("line")["layer"].events[0]["survivor"] for _ in range(10)}
    assert len(seeded) == 1

    def unseeded_first():
        d = 101.037
        sim = rb.Simulation()
        sim.units = ("m", "s", "kg")
        sim.G = G_SI
        sim.integrator = "leapfrog"
        sim.dt = 0.5
        cs.add_bodies(sim, [dict(cs.SPH_A, name="A", x=[-d, 0, 0], v=[2.0, 0, 0]),
                            {"name": "B", "m": 1.0e3, "r": 0.8, "x": [0, 0, 0], "v": [0, 0, 0]},
                            {"name": "C", "m": 1.5e3, "r": 0.9, "x": [d, 0, 0], "v": [-2.0, 0, 0]}])
        layer = cs.MergeLayer()
        sim.collision = "line"
        sim.collision_resolve = layer.resolve
        cs.run_to(sim, 80.0, 0.5)
        return layer.events[0]["survivor"]

    assert len({unseeded_first() for _ in range(30)}) == 2  # both outcomes occur without a seed (limitation)


def test_three_body_near_collision_conserves_with_ias15_reset_and_not_without():
    """A,B collide while a 1e11 kg body C pulls on them (~7e-3 m/s^2). Total momentum [kg m/s]: with our layer's
    IAS15 re-selection after each merge |dp| = 4.5e-13; WITHOUT the reset (same as REBOUND's built-in merge)
    |dp| = 9.3e-6 (5e-9 relative) because IAS15's stale predictor coefficients no longer satisfy Sum(m b) = 0 after a
    particle is removed. Both are asserted (the second as a documented limitation)."""
    good = cs.three_body_near_collision(reset_ias15=True)
    bad = cs.three_body_near_collision(reset_ias15=False)
    dp_good = norm(sub(good["after"]["p"], good["before"]["p"]))
    dp_bad = norm(sub(bad["after"]["p"], bad["before"]["p"]))
    assert good["layer"].errors == [] and len(good["layer"].events) == 1 and good["sim"].N == 2
    assert dp_good < 1e-11  # round-off class: ~1e-14 relative to the ~1.9e3 kg m/s scale
    assert 1e-6 < dp_bad < 1e-4
    assert abs(good["after"]["mass"] - good["before"]["mass"]) < 1e-9
    ev = good["layer"].events[0]  # independent recomputation from the callback's own pre-collision state
    (ms, mg), (vs, vg) = ev["pre"]["m"], ev["pre"]["v"]
    mu = ms * mg / (ms + mg)
    assert ev["ke_lost"] == pytest.approx(0.5 * mu * norm(sub(vs, vg)) ** 2, rel=1e-12)
    assert norm(sub(ev["post"]["v"], scale(add(scale(vs, ms), scale(vg, mg)), 1 / (ms + mg)))) < 1e-12
    assert ev["dKE_total"] == pytest.approx(-ev["ke_lost"], rel=1e-12)


@pytest.mark.parametrize("first_is_lighter", [False, True])
def test_stable_ids_survive_merger_while_array_indices_shift(first_is_lighter):
    """Order [X, p1, p2, Z]: after the merger Z's ARRAY INDEX drops from 3 to 2 but its name still finds it. The
    heavier body keeps its name whichever of p1/p2 it was; the absorbed name is gone. Z is a free 1 kg body:
    x = x0 + v t within 1e-6 m (neglected gravity of 3 tonnes at 5 km, ~7e-8 m over 130 s)."""
    r = cs.id_stability(first_is_lighter)
    assert r["names_in_order"] == ["X", "HEAVY", "Z"]
    assert r["index_Z"] == 2 and r["index_before_Z"] == 3 and r["light_found"] is False
    z, z0 = r["Z"], r["Z0"]
    expected = add(z0["x"], scale(z0["v"], r["t_end"]))
    assert norm(sub([z.x, z.y, z.z], expected)) < 1e-6
    assert r["layer"].absorbed == {"LIGHT": "HEAVY"} and r["layer"].errors == []


# ---------------------------------------------------------------- checkpoint with collisions
@pytest.mark.parametrize("integrator", ["ias15", "leapfrog"])
def test_collision_after_checkpoint_restore_reproduces_uninterrupted_run(integrator):
    """save at t=50, collision at ~99 s after the restore point. Compared: positions, velocities, masses, radii,
    names (bitwise), t, G, collision mode, N, dt, event list. REQUIRED after restore: re-register the resolver."""
    r = cs.checkpoint_collision(integrator=integrator)
    assert r["restore_warning_emitted"] is True  # REBOUND warns that function pointers must be reset
    assert r["restored_collision_mode"] == "line" and r["restored_G"] == G_SI and r["N_at_restore"] == 3
    assert r["original_equals_reference"] is True  # saving does not perturb the original
    assert r["restored_equals_reference"] is True and r["config_equal"] and r["t_equal"]
    assert r["restored_events"] == r["ref_events"] and len(r["ref_events"]) == 1
    assert r["names_restored"] == ["A", "C"]


def test_restore_without_resolver_halts_with_collision_exception():
    """Collision mode survives a restore but the resolver does not: REBOUND then raises rebound.Collision at the
    first overlap (fails loudly rather than silently ignoring the collision)."""
    r = cs.checkpoint_collision(reset_resolver=False)
    assert r["restored_collision_mode"] == "line"
    assert r["halted_with"] == "Two particles collided (d < r1+r2)"
    assert r["restored_events"] == [] and r["N_final_restored"] == 3


# ---------------------------------------------------------------- cross-check with the independent review
@pytest.mark.parametrize("name", list(cs.INDEPENDENT_FIXTURES))
def test_independent_review_geometry_fixtures(name):
    """Fixtures and expected values from context/INDEPENDENT_PHYSICS_REVIEW.md (derived without this spike).
    Gravity off (their model is constant relative velocity), one leapfrog step of size dt. Expectations:
    endpoint-only ('direct') detection fails the fast and grazing fixtures; swept ('line') detects every real
    contact and nothing for the near miss. Contact time from our straight-line estimate: abs 1e-9 s."""
    r0, u, R, dt, t_exp, d_min = cs.INDEPENDENT_FIXTURES[name]
    direct = cs.fixture_detect(r0, u, R, dt, "direct")
    line = cs.fixture_detect(r0, u, R, dt, "line")
    if name == "slow_head_on":  # end-of-step separation 1 m < 2 m: both see it, REBOUND reports at the step end
        assert direct["detected"] and line["detected"] and line["t_callback"] == pytest.approx(dt)
    elif name == "near_miss":
        assert not direct["detected"] and not line["detected"]
    else:
        assert not direct["detected"] and line["detected"]
    if t_exp is not None:
        assert line["t_contact_est"] == pytest.approx(
            t_exp if name != "grazing" else (5.0 - (4.0 - 1.9 ** 2) ** 0.5) / 10.0, abs=1e-9)


def test_exactly_coincident_centres_give_nan_state_known_limitation():
    """Their fast fixture as written crosses at exactly dt/2: centres coincide mid-step and REBOUND returns NaN
    positions even with G = 0 (0 * 1/0). The layer must never let two bodies reach r = 0."""
    r = cs.fixture_detect((-100.0, 0.0, 0.0), (1000.0, 0.0, 0.0), 2.0, 0.2, "direct")
    assert r["detected"] and r["t_contact_est"] != r["t_contact_est"]  # NaN


@pytest.mark.parametrize("case", ["head_on", "grazing"])
def test_independent_review_merger_examples(case):
    """Their worked merger examples through our layer. head_on: M=3 kg, V=(1,0,0) m/s, Ki=13.5 J, Kf=1.5 J, loss
    12 J, L_orb=0. grazing: loss 25 J, L_orb=(0,0,-6) kg m^2/s, volume radius 1.25992105 m. Tolerance 1e-9 relative:
    the pair's mutual gravity at 2 m (G m/r^2 ~ 3e-11 m/s^2) changes v_rel by ~1e-12 relative."""
    r = cs.independent_merger(case)
    ev = r["layer"].events[0]
    assert r["sim"].N == 1 and r["layer"].errors == []
    assert ev["post"]["m"] == pytest.approx(3.0 if case == "head_on" else 2.0)
    assert ev["post"]["r"] == pytest.approx(1.25992105, rel=1e-8)
    assert ev["contact_time_est"] == pytest.approx(0.05, abs=1e-9)  # started 0.05 s before contact
    if case == "head_on":
        assert norm(sub(ev["post"]["v"], [1.0, 0.0, 0.0])) < 1e-9
        assert ev["ke_pair_before"] == pytest.approx(13.5, rel=1e-9)
        assert ev["ke_pair_after"] == pytest.approx(1.5, rel=1e-9)
        assert ev["ke_lost"] == pytest.approx(12.0, rel=1e-9)
        assert norm(ev["L_orb"]) < 1e-9
    else:
        assert norm(ev["post"]["v"]) < 1e-9
        assert ev["ke_lost"] == pytest.approx(25.0, rel=1e-9)
        assert norm(sub(ev["L_orb"], [0.0, 0.0, -6.0])) < 1e-9 * 6.0
        assert norm(sub(r["layer"].spin["P"], [0.0, 0.0, -6.0])) < 1e-9 * 6.0


def test_contact_time_estimate_matches_analytic_contact_time_in_detection_runs():
    """Event localisation: REBOUND reports at the step end, but a straight-line backward solve from the callback
    state recovers the first-contact time. Gravity off, so the straight line is exact: abs 1e-9 s at every dt."""
    for dt in (1.0, 0.1):
        r = cs.detection_run("line", dt, b=0.5, gravity=False)
        assert r["contact_est"] == pytest.approx(r["t_contact"], abs=1e-9)


def test_chain_collision_after_restore_matches_uninterrupted_run():
    """Several simultaneous collisions after the restore point: event order, survivors and final state identical
    (10 repetitions) thanks to the fixed rand_seed."""
    for _ in range(10):
        r = cs.chain_checkpoint()
        assert r["events_equal"] and r["state_equal"]
