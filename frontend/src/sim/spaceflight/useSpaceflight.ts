// Space Mission Design actions and derived inputs for one universe. Every write goes through the simulation hook's queue
// (`simulation.mutate`), so it is ordered with steps and edits and the state shown afterwards is the backend's. Nothing here
// computes physics: orbits, plans and mission status are read from the backend's responses.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScopedClient } from "../../api/client";
import type {
  ManeuverCreateDto, ManeuverPreviewDto, MissionCreateDto, MissionDto, MissionPlanRequestDto, MissionTrajectoryDto, OrbitPreviewDto,
  OrbitSpecDto, SpacecraftCreateDto, SpacecraftUpdateDto,
} from "../../api/types";
import type { PlannedTrajectoryInput, RelativePoint, SpaceflightSceneInput, SpacecraftPathInput } from "../../render/contract";
import type { HistoryCache } from "../history/historyModel";
import type { ActionResult, SimulationApi } from "../useSimulation";
import type { BodyView } from "../viewModel";
import { conicPoints, plannedPaths, relativeRecordedPath } from "./orbitGeometry";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useSpaceflight(client: ScopedClient, simulation: SimulationApi) {
  const { sim, mutate } = simulation;
  const bodies = sim?.bodies ?? [];
  const spacecraft = useMemo(() => bodies.filter((b) => b.kind === "spacecraft"), [bodies]);
  const maneuvers = sim?.maneuvers ?? [];
  const missions = sim?.missions ?? [];
  /** A transfer is being designed (it can take seconds). */
  const [planning, setPlanning] = useState(false);

  // Planned trajectories, fetched once per (mission, plan revision).
  const [trajectories, setTrajectories] = useState<Record<string, MissionTrajectoryDto>>({});
  const requested = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const planKeys = missions.filter((m) => m.plan !== null).map((m) => `${m.id}:${m.planRevision}`).join("|");
  useEffect(() => {
    for (const key of planKeys ? planKeys.split("|") : []) {
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      const missionId = key.slice(0, key.lastIndexOf(":"));
      client.getMissionTrajectory(missionId).then(
        (t) => { if (mounted.current && `${t.missionId}:${t.planRevision}` === key) setTrajectories((all) => ({ ...all, [key]: t })); },
        () => { requested.current.delete(key); }, // shown without its planned line; retried when the state next changes
      );
    }
  }, [client, planKeys]);

  const run = useCallback(async <T,>(task: () => Promise<T>, layout = false): Promise<{ ok: true; value: T } | { ok: false; error: string }> => {
    let value: T | undefined;
    const result: ActionResult = await mutate(async () => { value = await task(); }, { layout });
    if (!result.ok) simulation.dismissError(); // the panel that asked shows the message next to its form
    return result.ok ? { ok: true, value: value as T } : result;
  }, [mutate, simulation.dismissError]); // eslint-disable-line react-hooks/exhaustive-deps

  const createSpacecraft = useCallback((request: SpacecraftCreateDto) => run(() => client.createSpacecraft(request)), [client, run]);
  const updateSpacecraft = useCallback((id: string, patch: SpacecraftUpdateDto) => run(() => client.updateSpacecraft(id, patch)), [client, run]);
  const addManeuver = useCallback((craftId: string, request: ManeuverCreateDto) => run(() => client.createManeuver(craftId, request)), [client, run]);
  const deleteManeuver = useCallback((id: string) => run(() => client.deleteManeuver(id)), [client, run]);
  const createMission = useCallback((request: MissionCreateDto) => run(() => client.createMission(request)), [client, run]);
  const commitMission = useCallback((id: string) => run(() => client.commitMission(id)), [client, run]);
  const abortMission = useCallback((id: string) => run(() => client.abortMission(id)), [client, run]);
  const deleteMission = useCallback((id: string) => run(() => client.deleteMission(id)), [client, run]);
  const planMission = useCallback(async (id: string, request: MissionPlanRequestDto = {}) => {
    simulation.pause(); // the plan is made for the present state: the simulation must not run past the departure meanwhile
    setPlanning(true);
    try {
      return await run<MissionDto>(() => client.planMission(id, request));
    } finally {
      if (mounted.current) setPlanning(false);
    }
  }, [client, run, simulation.pause]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Read-only previews (no queue: they change nothing). */
  const previewOrbit = useCallback(async (orbit: OrbitSpecDto, massKg: number): Promise<{ ok: true; value: OrbitPreviewDto } | { ok: false; error: string }> => {
    try {
      return { ok: true, value: await client.previewOrbit(orbit, massKg) };
    } catch (e) {
      return { ok: false, error: message(e) };
    }
  }, [client]);
  const previewManeuver = useCallback(async (craftId: string, request: ManeuverCreateDto): Promise<{ ok: true; value: ManeuverPreviewDto } | { ok: false; error: string }> => {
    try {
      return { ok: true, value: await client.previewManeuver(craftId, request) };
    } catch (e) {
      return { ok: false, error: message(e) };
    }
  }, [client]);

  return {
    spacecraft, maneuvers, missions, trajectories, planning,
    createSpacecraft, updateSpacecraft, addManeuver, deleteManeuver, createMission, planMission, commitMission, abortMission, deleteMission,
    previewOrbit, previewManeuver,
  };
}

export type SpaceflightApi = ReturnType<typeof useSpaceflight>;

/** Missions whose planned line is worth drawing: a current plan that has not been flown to its end. */
function showsPlan(m: MissionDto): boolean {
  return m.plan !== null && (m.status === "planned" || m.status === "in_progress");
}

/**
 * What the canvas draws for spacecraft (render contract `SpaceflightSceneInput`): the osculating conic from the backend's
 * elements, the recorded path from the backend's history, the planned path from the planner's samples. `showRecorded`: the
 * user's "Show paths" choice. Returns undefined when there is nothing to draw.
 */
export function buildSpaceflightScene(
  bodies: readonly BodyView[], missions: readonly MissionDto[], trajectories: Record<string, MissionTrajectoryDto>,
  history: HistoryCache | null, showRecorded: boolean, nowS: number,
): SpaceflightSceneInput | undefined {
  const names = new Map(bodies.map((b) => [b.id, b.name]));
  const craft: SpacecraftPathInput[] = [];
  for (const b of bodies) {
    const orbit = b.spacecraft?.orbit;
    if (b.kind !== "spacecraft" || !orbit) continue;
    // an escape trajectory is drawn out to the edge of the reference body's sphere of influence (or 40 periapsis radii)
    const reach = orbit.sphereOfInfluenceM ?? (orbit.periapsisRadiusM !== null ? orbit.periapsisRadiusM * 40 : undefined);
    craft.push({
      bodyId: b.id, colorHex: b.colorHex, frameBodyId: orbit.referenceBodyId,
      orbit: conicPoints(orbit, 180, reach),
      recorded: showRecorded && history ? relativeRecordedPath(history, b.id, orbit.referenceBodyId).map((piece) => piece.points) : [],
    });
  }
  const plans: PlannedTrajectoryInput[] = [];
  for (const m of missions) {
    const t = trajectories[`${m.id}:${m.planRevision}`];
    if (!showsPlan(m) || !m.plan || !t || !names.has(m.plan.originBodyId) || !names.has(m.plan.destinationBodyId)) continue;
    const plan = m.plan;
    const nodeTimes = [plan.departure.epochS, ...(plan.insertion ? [plan.insertion.epochS] : [plan.arrival.epochS])];
    // what lies behind the present time has been flown (or not): only the part still ahead is a plan
    const paths = plannedPaths(t, plan.arrival.epochS, 0.5 * plan.arrival.sphereOfInfluenceM, nodeTimes, m.committed ? nowS : -Infinity);
    const destinationName = names.get(plan.destinationBodyId) ?? plan.destinationBodyId;
    const nodes: { label: string; frameBodyId: string; position: RelativePoint }[] = [];
    if (paths.nodes[0] && plan.departure.epochS >= nowS) nodes.push({ label: "Departure burn", frameBodyId: plan.originBodyId, position: paths.nodes[0].aboutOrigin });
    if (paths.nodes[1] && nodeTimes[1]! >= nowS) {
      nodes.push({ label: plan.insertion ? "Insertion burn" : "Closest approach", frameBodyId: plan.destinationBodyId, position: paths.nodes[1].aboutDestination });
    }
    plans.push({
      key: `${m.id}:${m.planRevision}`, originBodyId: plan.originBodyId, destinationBodyId: plan.destinationBodyId,
      aboutOrigin: paths.aboutOrigin, aboutDestination: paths.aboutDestination,
      destinationAtArrival: plan.arrival.epochS >= nowS ? paths.destinationAtArrival : null, destinationName, nodes, committed: m.committed,
    });
  }
  return craft.length || plans.length ? { craft, plans } : undefined;
}
