import type { CollisionDetailDto, CollisionProductDto, ReplayReportDto } from "../../api/types";

/** Text for the collision inspector, built ONLY from fields the API supplied (the UI never derives an outcome or invents a reason).
 *  Fidelity labels are always shown beside what they qualify, so an approximation, a statistical representation or an
 *  unsupported fallback is never presented as a computed result (FID-UI). */

export const FIDELITY_MEANING: Record<string, string> = {
  computed: "computed from simulation state",
  model: "output of a published scaling law inside its stated envelope",
  approximation: "an engineering choice or bounded extrapolation",
  statistical: "a population representation, not individual objects",
  visual: "no physical meaning",
  unsupported: "outside every model envelope: a labelled fallback was used",
};

export const CLASS_LABEL: Record<string, string> = {
  bound_to_remnant: "bound to its remnant",
  orbiting_system: "orbiting the system",
  escaping: "escaping",
};

export function fidelityLines(fidelity: Record<string, string>): string[] {
  return Object.entries(fidelity).map(([quantity, label]) => `${quantity}: ${label}${FIDELITY_MEANING[label] ? ` (${FIDELITY_MEANING[label]})` : ""}`);
}

/** Whether any quantity is not a computed or model result: the inspector then says so at the top. */
export function hasSoftFidelity(fidelity: Record<string, string>): boolean {
  return Object.values(fidelity).some((label) => label !== "computed" && label !== "model");
}

export function formatSci(x: number): string {
  return x === 0 ? "0" : Math.abs(x) >= 1e5 || Math.abs(x) < 1e-2 ? x.toExponential(3) : x.toPrecision(5);
}

export interface InspectorText {
  headline: string;
  lineage: string;
  why: string[];
  parameters: string[];
  materials: string;
  accounting: string[];
  residuals: string[];
  aftermath: string[];
  fidelity: string[];
  warnings: string[];
  caveat: string;
}

export function describeProduct(p: CollisionProductDto, bodyName: (id: string) => string): string {
  const what = p.representation === "debris-parcel" ? "debris parcel (statistical aggregate)" : p.representation === "fragment" ? "tracked fragment" : "remnant";
  if (!p.exists) return `${bodyName(p.bodyId)} (${what}) no longer exists; it had ${formatSci(p.massKgAtEvent)} kg at the event`;
  const cls = p.fragmentClass ? `, now ${CLASS_LABEL[p.fragmentClass] ?? p.fragmentClass}` : "";
  return `${bodyName(p.bodyId)} (${what}): ${formatSci(p.massKgAtEvent)} kg at the event, ${formatSci(p.massKgNow ?? 0)} kg now${cls}`;
}

/** D-063: an outcome-v1 impact speed refers to the contact time (integrated contact state) unless the backend warns that it fell back
 *  to the detection-time velocities. Legacy `merger` events always report the speed at detection. */
export function impactSpeedBasis(warnings: readonly string[]): string {
  return warnings.includes("contact_state_linear_rewind") || warnings.includes("contact_time_not_estimable")
    ? "relative speed at detection"
    : "relative speed at contact";
}

export function describeRecord(detail: CollisionDetailDto, bodyName: (id: string) => string): InspectorText {
  const r = detail.record;
  const i = r.impact;
  const outcome = r.outcome?.outcome ?? "legacy merge";
  const headline =
    `${outcome.replace(/_/g, " ")}: ${bodyName(i.projectileId)} hit ${bodyName(i.targetId)} at ${formatSci(i.impactSpeedMPerS)} m/s ${impactSpeedBasis(r.warnings)}, ` +
    `${i.impactAngleDeg.toFixed(1)}° from the normal (Q_R ${formatSci(i.specificImpactEnergyJPerKg)} J/kg)`;
  const lineage =
    r.parentEventId === null
      ? `${r.eventId}: an original impact (generation 0)${detail.childEventIds.length ? `; later impacts of its debris: ${detail.childEventIds.join(", ")}` : ""}`
      : `${r.eventId}: a secondary impact (generation ${r.generation}) of debris created by ${r.parentEventId}; root ${r.rootEventId}`;
  const c = r.result?.conservation;
  const residuals: string[] = c
    ? [
        `mass residual ${c.massResidualRel.toExponential(2)}, momentum residual ${c.momentumResidualRel.toExponential(2)}`,
        c.angularMomentumResidualRel !== null
          ? `angular-momentum residual ${c.angularMomentumResidualRel.toExponential(2)}`
          : `angular momentum not fully represented: ${c.angularMomentumUnmodelled ?? "reason not given"}`,
        `energy dissipated ${formatSci(c.dissipatedJ)} J (${c.dissipatedNonNegative ? "not negative" : "NEGATIVE beyond tolerance"})`,
        c.withinTolerance ? "within the conservation tolerances" : "OUTSIDE the conservation tolerances",
      ]
    : ["no result recorded: the exact legacy merge (see the merger event) conserves momentum by its own arithmetic"];
  const ledger = r.result?.massLedger;
  const accounting = ledger
    ? [
        `consumed ${formatSci(ledger.consumedBodiesKg ?? 0)} kg → remnants ${formatSci(ledger.remnantsKg ?? 0)} kg, tracked fragments ` +
          `${formatSci(ledger.fragmentsKg ?? 0)} kg, parcels ${formatSci(ledger.parcelsKg ?? 0)} kg, returned to the remnant ${formatSci(ledger.returnedToRemnantKg ?? 0)} kg`,
      ]
    : [];
  return {
    headline,
    lineage,
    why: r.outcome?.regimeReasons ?? r.selectionReasons,
    parameters: (r.outcome?.parameters ?? []).map((p) => `${p.name} = ${formatSci(p.value)} ${p.unit} (${p.source})`),
    materials: `target ${i.targetMaterialId ?? "no material (legacy merge)"} · projectile ${i.projectileMaterialId ?? "no material (legacy merge)"}`,
    accounting,
    residuals,
    aftermath: detail.products.map((p) => describeProduct(p, bodyName)),
    fidelity: fidelityLines(r.fidelity),
    warnings: r.warnings,
    caveat: detail.note,
  };
}

export function describeReplay(report: ReplayReportDto): string {
  const failed = report.checks.filter((c) => c.ok === false).map((c) => c.name);
  return report.reproduced
    ? `Reproduced: the recorded input recomputes to the same result (digest ${report.replayedResultDigest.slice(0, 12) || "n/a"}…). Nothing was changed.`
    : `NOT reproduced (${failed.join(", ") || "see checks"}). ${report.differingFields.length ? `Differing result fields: ${report.differingFields.join(", ")}. ` : ""}Nothing was changed.`;
}
