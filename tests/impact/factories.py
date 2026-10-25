"""Fully populated example contracts for tests (every optional field filled in, so a round trip exercises it).

The numbers are arbitrary but self-consistent test inputs; they are NOT physical reference values (reference values
come only from the cited literature, see tests/impact/reference_values.py from Stage 3 on)."""
import math

from backend.impact import contracts as c

DIGEST_A = "a" * 64
DIGEST_B = "0123456789abcdef" * 4
HALF = math.sqrt(0.5)


def vec(x=1.0, y=2.0, z=3.0) -> c.Vec3:
    return c.Vec3(x, y, z)


def layers() -> tuple[c.Layer, ...]:
    return (c.Layer("silicate-rock", 0.68, "solid", None, 3300.0),
            c.Layer("iron", 0.32, "partial", 0.5, 7800.0))


def provenance() -> tuple[c.Provenance, ...]:
    return (c.Provenance("momentOfInertiaFactor", 0.33, "test fixture", 0.01, "engineering"),)


def material_profile(profile_id="test-differentiated") -> c.MaterialProfile:
    return c.MaterialProfile(
        id=profile_id, category="mixed", structure_class="strengthless-planet", layers=layers(),
        moment_of_inertia_factor=0.33, appearance="rock", provenance=provenance(),
        validity=c.Validity("test fixture", {"massKg": "1e20..1e25"}),
        ls12=c.Ls12Params(1.9, 0.3, 0.36, "test fixture"),
        strength=c.StrengthParams(1.0, 2.0, 3.0, 4.0, "cgs", "test fixture", (1.0e3, 5.0e3)),
        cratering=c.CrateringParams(0.2, 0.55, 0.4, None, "test fixture"),
        wave_speed_m_per_s=5000.0)


def orientation() -> c.Orientation:
    return c.Orientation((HALF, 0.0, HALF, 0.0), 10.0)


def rotation() -> c.RotationState:
    return c.RotationState(vec(0.0, 0.0, 7.0e-5), (1.0, 0.0, 0.0, 0.0), 0.0, 8.0e37)


def body_impact_state(name="target", mass=6.0e24, radius=6.4e6, x=0.0) -> c.BodyImpactState:
    return c.BodyImpactState(
        id=name, mass_kg=mass, radius_m=radius, position_m=vec(x, 0.0, 0.0), velocity_m_per_s=vec(0.0, 1.0, 0.0),
        representation="body", spin_rad_per_s=vec(0.0, 0.0, 7.0e-5), orientation=orientation(),
        material_profile=material_profile(), origin_event_id="evt-1")


def impact_state() -> c.ImpactState:
    return c.ImpactState(
        detection_time_s=100.0, contact_time_s=99.5, contact_time_estimated=True, rewind_s=0.5,
        target=body_impact_state("target"), projectile=body_impact_state("projectile", 1.0e22, 1.7e6, 8.0e6),
        relative_velocity_m_per_s=vec(-1.0e4, 0.0, 0.0), impact_speed_m_per_s=1.0e4, contact_point_m=vec(6.4e6, 0.0, 0.0),
        contact_normal=vec(1.0, 0.0, 0.0),
        contact_point_local=c.ContactPointLocal(vec(1.0, 0.0, 0.0), vec(-1.0, 0.0, 0.0)),
        contact_lat_lon_deg=c.ContactLatLon((-90.0, 12.5)), impact_angle_deg=30.0, impact_parameter=0.5,
        spin_axis_angle_deg=5.0, total_mass_kg=6.01e24, reduced_mass_kg=9.98e21, mass_ratio=1.0e22 / 6.0e24,
        mutual_escape_speed_m_per_s=c.MutualEscapeSpeed(1.1e4, 1.0e4), specific_impact_energy_j_per_kg=8.3e3,
        pair_momentum_kg_m_per_s=vec(1.0e26, 0.0, 0.0), pair_kinetic_energy_com_j=5.0e29,
        pair_orbital_angular_momentum_com_kg_m2_per_s=vec(0.0, 0.0, 1.0e32),
        environment=c.Environment("sun", 1.5e9, ("moon", "other")), chunk_criterion_satisfied=True,
        contact_state_method="integrated", detection_relative_speed_m_per_s=2.0e4, contact_separation_residual_rel=1.0e-12)


def collision_input() -> c.CollisionInput:
    return c.CollisionInput(event_id="col-1", parent_event_id="col-0", generation=1, impact=impact_state(),
                            config=c.CollisionConfig(), seed=42, input_digest=DIGEST_A)


def composition() -> tuple[c.CompositionLayer, ...]:
    return (c.CompositionLayer("silicate-rock", 0.75), c.CompositionLayer("iron", 0.25))


def size_distribution() -> c.SizeDistribution:
    return c.SizeDistribution("power-law", 2.85, 1.0, 1.0e5)


def debris_descriptor() -> c.DebrisDescriptor:
    return c.DebrisDescriptor(1.0e21, size_distribution(), 150.0, "silicate-rock", 7)


def outcome_spec() -> c.OutcomeSpec:
    return c.OutcomeSpec(
        model_id="test-model", model_version="0", outcome="partial_erosion", regime_reasons=("v_i > v_esc",),
        parameters={"cStar": c.ParameterValue(1.9, "1", "test fixture")},
        largest_remnant=c.RemnantSpec(5.5e24, "target", composition()),
        second_remnant=c.RemnantSpec(5.0e21, "projectile", ()), debris_mass_kg=4.9e23,
        debris_size_distribution=size_distribution(), ejecta_velocity_model="test", energy_partition_j={"dissipated": 1.0e28},
        fidelity={"largestRemnantMass": c.Fidelity.MODEL, "contactPoint": c.Fidelity.APPROXIMATION},
        warnings=("spin_not_in_model",), fields_extra={"extra": 1.5})


def body_post(name="rem-1-0", mass=5.5e24) -> c.BodyPost:
    return c.BodyPost(
        id=name, mass_kg=mass, radius_m=6.2e6, position_m=vec(), velocity_m_per_s=vec(0.1, 0.2, 0.3), representation="fragment",
        material=c.MaterialRef("test-differentiated", layers()), rotation=rotation(), composition=composition(),
        origin_event_id="col-1", fragment_class="bound_to_remnant")


def parcel_post() -> c.ParcelPost:
    return c.ParcelPost(id="debris-1-0", mass_kg=1.0e21, radius_m=2.0e4, position_m=vec(), velocity_m_per_s=vec(),
                        debris=debris_descriptor(), origin_event_id="col-1", fragment_class="escaping")


def impact_site() -> c.ImpactSite:
    return c.ImpactSite(
        site_id="site-1", body_id="target", event_id="col-1", time_s=99.5, center_local=vec(0.0, 0.0, -1.0),
        crater_radius_m=1.0e5, transient_depth_m=1.0e4, damage_profile=c.DamageProfile("power-law-falloff", 1.0e5, 2.0),
        ejecta_cone=c.EjectaCone(vec(0.0, 0.0, -1.0), 45.0), energy_j=1.0e24,
        propagation=c.Propagation("geodesic-front-v1", 5000.0, 1.0e6, True), fidelity=c.Fidelity.APPROXIMATION)


def energy_report() -> c.EnergyReport:
    return c.EnergyReport(5.0e29, 4.0e29, 1.0e25, 2.0e25, -3.0e30, -3.0e30, -1.0e32, -1.0e32, 1.0e29, True)


def conservation_report() -> c.ConservationReport:
    return c.ConservationReport(
        mass_before_kg=6.01e24, mass_after_kg=6.01e24, mass_residual_rel=0.0, momentum_before_kg_m_per_s=vec(),
        momentum_after_kg_m_per_s=vec(), momentum_residual_rel=1.0e-14, angular_momentum_before_kg_m2_per_s=vec(),
        angular_momentum_after_kg_m2_per_s=vec(), angular_momentum_residual_rel=1.0e-12,
        angular_momentum_unmodelled="ejecta spin", energy=energy_report(), tolerances=c.CollisionTolerances(),
        within_tolerance=True)


def collision_result() -> c.CollisionResult:
    return c.CollisionResult(
        event_id="col-1", outcome="partial_erosion", removed_body_ids=("projectile",), transformed=(body_post("target"),),
        created=(body_post("frag-1-0", 1.0e21),), debris_parcels=(parcel_post(),), impact_sites=(impact_site(),),
        mass_ledger=c.MassLedger(6.01e24, 5.5e24, 1.0e21, 1.0e21, 0.0, 0.0), conservation=conservation_report(),
        warnings=("debris_returned_to_remnant",), fidelity={"mass": c.Fidelity.COMPUTED}, result_digest=DIGEST_B,
        fields_extra={"k": 2.0})


def collision_event() -> c.CollisionEvent:
    return c.CollisionEvent(
        id="col-1", outcome="partial_erosion", simulation_time_s=100.0, estimated_contact_time_s=99.5,
        body_ids=("target", "projectile"), surviving_body_ids=("target",), created_body_ids=("frag-1-0",),
        removed_body_ids=("projectile",), parent_event_id="col-0", root_event_id="col-0", generation=1,
        model_id="test-model", model_version="0", impact_speed_m_per_s=1.0e4, impact_angle_deg=30.0,
        specific_impact_energy_j_per_kg=8.3e3, largest_remnant_mass_kg=5.5e24, debris_mass_kg=4.9e23,
        mass_residual_rel=0.0, momentum_residual_rel=1.0e-14, warnings=("w",),
        fidelity_summary={"mass": c.Fidelity.COMPUTED}, has_visual=True)


def collision_record() -> c.CollisionRecord:
    return c.CollisionRecord(
        event_id="col-1", parent_event_id="col-0", root_event_id="col-0", generation=1, input=collision_input(),
        selection_reasons=("v_i > v_esc",), outcome_spec=outcome_spec(), result=collision_result(), warnings=("w",),
        fidelity={"mass": c.Fidelity.COMPUTED}, input_digest=DIGEST_A, result_digest=DIGEST_B, detail_dropped=False,
        legacy_event_id="evt-1", fields_extra={"k": 1.0})


def visual_event() -> c.VisualEventDescription:
    return c.VisualEventDescription(
        event_id="col-1", outcome="partial_erosion", time_s=99.5,
        impact_site=c.VisualImpactSite("target", vec(0.0, 0.0, -1.0), vec(6.4e6, 0.0, 0.0), vec(1.0, 0.0, 0.0)),
        phases=(c.VisualPhase("contact", 99.5, 99.5, "simulation-time"),
                c.VisualPhase("flash", 99.5, None, "visual-wall-clock", 0.6)),
        ejecta_sources=(c.EjectaSource("target", vec(0.0, 0.0, -1.0), 40.0, 1.0e21, (10.0, 5000.0)),),
        fragment_body_ids=("frag-1-0",), debris_parcel_ids=("debris-1-0",),
        cloud=c.DebrisCloud(1.0e5, 100.0, "dust"), visual_only=(c.VisualOnlyEffect("flash", 0.8, 0.6),),
        material_appearance={"target": "rock"}, fidelity_notes=("reduced-order propagation; not a resolved shock",))


# One factory per concrete contract class: the completeness test asserts nothing is missing from this table.
FACTORIES = {
    c.Vec3: vec, c.CollisionTolerances: c.CollisionTolerances, c.CollisionConfig: c.CollisionConfig,
    c.CompositionLayer: lambda: composition()[0], c.Layer: lambda: layers()[0],
    c.Ls12Params: lambda: material_profile().ls12, c.StrengthParams: lambda: material_profile().strength,
    c.CrateringParams: lambda: material_profile().cratering, c.Provenance: lambda: provenance()[0],
    c.Validity: lambda: material_profile().validity, c.MaterialProfile: material_profile,
    c.MaterialRef: lambda: c.MaterialRef("test-differentiated", layers()), c.Orientation: orientation,
    c.RotationState: rotation, c.SizeDistribution: size_distribution, c.DebrisDescriptor: debris_descriptor,
    c.BodyImpactState: body_impact_state, c.MutualEscapeSpeed: lambda: impact_state().mutual_escape_speed_m_per_s,
    c.ContactLatLon: lambda: impact_state().contact_lat_lon_deg, c.ContactPointLocal: lambda: impact_state().contact_point_local,
    c.Environment: lambda: impact_state().environment, c.ImpactState: impact_state, c.CollisionInput: collision_input,
    c.ParameterValue: lambda: outcome_spec().parameters["cStar"], c.RemnantSpec: lambda: outcome_spec().largest_remnant,
    c.OutcomeSpec: outcome_spec, c.BodyPost: body_post, c.ParcelPost: parcel_post,
    c.DamageProfile: lambda: impact_site().damage_profile, c.EjectaCone: lambda: impact_site().ejecta_cone,
    c.Propagation: lambda: impact_site().propagation, c.ImpactSite: impact_site,
    c.MassLedger: lambda: collision_result().mass_ledger, c.EnergyReport: energy_report,
    c.ConservationReport: conservation_report, c.CollisionResult: collision_result, c.CollisionEvent: collision_event,
    c.CollisionRecord: collision_record, c.VisualImpactSite: lambda: visual_event().impact_site,
    c.VisualPhase: lambda: visual_event().phases[1], c.EjectaSource: lambda: visual_event().ejecta_sources[0],
    c.DebrisCloud: lambda: visual_event().cloud, c.VisualOnlyEffect: lambda: visual_event().visual_only[0],
    c.VisualEventDescription: visual_event,
}
