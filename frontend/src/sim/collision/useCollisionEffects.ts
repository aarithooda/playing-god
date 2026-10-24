import { useEffect, useMemo, useRef, useState } from "react";
import type { ScopedClient } from "../../api/client";
import type { VisualEventDto } from "../../api/types";
import type { CollisionEffectInput, SurfaceMarkInput } from "../../render/contract";
import type { EventView } from "../viewModel";
import { allocate } from "./effectBudget";
import { effectAt, newFlashClock, stepFlashClock, type BodyPoint, type FlashClock } from "./effectTimeline";
import { appearanceStyle } from "./materialAppearance";

/** Display size of a surface mark (radians of arc): a display constant, not a crater size (crater size is not modelled). */
export const SURFACE_MARK_DISPLAY_RAD = 0.05;

export interface EffectsInput {
  client: ScopedClient;
  events: readonly EventView[];
  /** Bodies at the DISPLAYED time (live state or a history frame). */
  bodies: readonly BodyPoint[];
  /** The displayed simulation time. */
  displayTimeS: number | null;
  /** Changes whenever the view jumps (history position, live/history, universe): the flash clock then treats the move as a seek. */
  seekKey: string;
  /** The display is advancing (simulation running, or history playback). False while paused. */
  advancing: boolean;
  enabled: boolean;
}

export interface EffectsOutput {
  effects: CollisionEffectInput[];
  marks: SurfaceMarkInput[];
}

/** Turns collision events into renderer inputs. Reads only each event's visual description and body states (it derives no outcome),
 *  fetches at most the newest events the budget allows, and never writes to the simulation. */
export function useCollisionEffects({ client, events, bodies, displayTimeS, seekKey, advancing, enabled }: EffectsInput): EffectsOutput {
  const universe = `${client.scope.universeId}#${client.scope.activationEpoch}`;
  const [visuals, setVisuals] = useState<ReadonlyMap<string, VisualEventDto | null>>(new Map());
  const [tick, setTick] = useState(0);
  const clocks = useRef(new Map<string, FlashClock>());
  const lastWall = useRef<number | null>(null);
  const lastSeek = useRef<string>("");
  const requested = useRef(new Set<string>());
  const generation = useRef(0); // changes with the universe: a late answer for another universe is dropped

  const collisionIds = useMemo(() => events.filter((e) => e.type === "collision").map((e) => e.id), [events]);
  const allocation = useMemo(() => allocate(collisionIds), [collisionIds]);

  useEffect(() => {
    generation.current += 1;
    setVisuals(new Map());
    clocks.current = new Map();
    requested.current = new Set();
    lastWall.current = null;
  }, [universe]);

  useEffect(() => {
    if (!enabled) return;
    const mine = generation.current;
    for (const id of allocation.events) {
      if (requested.current.has(id)) continue;
      requested.current.add(id);
      client.getCollisionVisual(id).then(
        (d) => generation.current === mine && setVisuals((m) => new Map(m).set(id, d)),
        () => generation.current === mine && setVisuals((m) => new Map(m).set(id, null)), // a legacy merge or a dropped record: nothing to draw
      );
    }
  }, [client, allocation, enabled]);

  // Wall-clock ticks only while some flash has life left or the view just jumped; a paused view draws no frames of its own.
  useEffect(() => {
    if (!enabled || displayTimeS === null) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const wallDeltaS = lastWall.current === null ? 0 : Math.max(0, (now - lastWall.current) / 1000);
    lastWall.current = now;
    const seeked = lastSeek.current !== seekKey;
    lastSeek.current = seekKey;
    let alive = false;
    let changed = false;
    for (const [id, d] of visuals) {
      if (!d) continue;
      const flash = d.visualOnly.find((e) => e.kind === "flash");
      if (!flash) continue;
      const known = clocks.current.get(id);
      const clock = known ?? newFlashClock(flash.lifetimeWallS);
      const next = stepFlashClock(clock, d.timeS, { displayTimeS, wallDeltaS, seeked, advancing });
      clocks.current.set(id, next);
      if (!known || next.ageWallS !== clock.ageWallS) changed = true; // the clocks are a ref: a render must be asked for
      if (advancing && next.ageWallS < next.lifetimeWallS && displayTimeS >= d.timeS) alive = true;
    }
    if (!alive && !changed) return;
    const handle = setTimeout(() => setTick((t) => t + 1), alive ? 50 : 0);
    return () => clearTimeout(handle);
  }, [enabled, displayTimeS, seekKey, advancing, visuals, tick]);

  return useMemo(() => {
    if (!enabled || displayTimeS === null) return { effects: [], marks: [] };
    const byId = new Map(bodies.map((b) => [b.id, b] as const));
    const effects: CollisionEffectInput[] = [];
    const marks: SurfaceMarkInput[] = [];
    for (const id of allocation.events) {
      const d = visuals.get(id);
      if (!d) continue;
      const effect = effectAt(d, clocks.current.get(id), {
        universeId: client.scope.universeId, displayTimeS, bodies: byId, particleBudget: allocation.particlesPerEvent,
      });
      if (!effect) continue; // before the event at the displayed time: a seek back shows nothing, the replay comes back as time advances
      effects.push(effect);
      if (byId.has(d.impactSite.bodyId)) {
        marks.push({
          key: `${client.scope.universeId}:${d.eventId}:site`, bodyId: d.impactSite.bodyId, centerLocal: d.impactSite.centerLocal,
          angularRadiusRad: SURFACE_MARK_DISPLAY_RAD, colorHex: appearanceStyle(d.materialAppearance[d.impactSite.bodyId]).colorHex,
        });
      }
    }
    return { effects, marks };
    // `tick` re-evaluates the flash lifetimes; the clocks live in a ref on purpose (they are wall-clock state, not simulation state)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, displayTimeS, bodies, allocation, visuals, client.scope.universeId, tick]);
}
