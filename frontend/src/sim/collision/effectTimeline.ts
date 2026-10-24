import type { VisualEventDto } from "../../api/types";
import type { CollisionEffectInput, EffectPoint } from "../../render/contract";
import { appearanceStyle } from "./materialAppearance";
import { sampleParcel } from "./debrisSampling";

/** The display-time rule of DQ-12 (a) (D-033):
 *  - everything that represents material (the cloud, the debris samples) is a pure function of the DISPLAYED SIMULATION TIME and the
 *    body states: it freezes on pause (the time does not change), follows the time scale (the time does) and replays on a seek;
 *  - the flash is visual only and has a wall-clock life that elapses ONLY while the display is live and advancing: it is frozen while
 *    paused, restarts when the view seeks back across the event, and is already over when the view seeks to a time after it.
 *  Nothing here has a mass field and nothing here is read by the simulation or the inspector. */

export const FLASH_FRESH = 0;

/** State of one event's flash clock. `ageWallS` is how much wall-clock life the flash has used; `lifetimeWallS` its total. */
export interface FlashClock {
  ageWallS: number;
  lifetimeWallS: number;
  lastDisplayTimeS: number | null;
}

export function newFlashClock(lifetimeWallS: number): FlashClock {
  return { ageWallS: FLASH_FRESH, lifetimeWallS, lastDisplayTimeS: null };
}

export interface ClockInput {
  /** The displayed simulation time. */
  displayTimeS: number;
  /** Wall-clock seconds since the previous call. */
  wallDeltaS: number;
  /** The view jumped (history seek, return to live, universe switch) instead of advancing smoothly. */
  seeked: boolean;
  /** The display is live and advancing (the simulation is running, or a history playback is). False while paused. */
  advancing: boolean;
}

/** Advance a flash clock. Pure: returns a new clock. */
export function stepFlashClock(clock: FlashClock, eventTimeS: number, input: ClockInput): FlashClock {
  const { displayTimeS, wallDeltaS, seeked, advancing } = input;
  const next: FlashClock = { ...clock, lastDisplayTimeS: displayTimeS };
  if (displayTimeS < eventTimeS) return { ...next, ageWallS: FLASH_FRESH }; // before the event (a seek back restarts it)
  if (seeked) {
    // landing after the event by a jump: its short life is over; landing exactly at the start of it: fresh
    return { ...next, ageWallS: displayTimeS > eventTimeS ? clock.lifetimeWallS : FLASH_FRESH };
  }
  if (!advancing) return next; // paused: the remaining wall-clock life is unchanged, whatever the length of the pause
  return { ...next, ageWallS: Math.min(clock.lifetimeWallS, clock.ageWallS + Math.max(0, wallDeltaS)) };
}

export function flashRemaining01(clock: FlashClock): number {
  return clock.lifetimeWallS <= 0 ? 0 : Math.max(0, 1 - clock.ageWallS / clock.lifetimeWallS);
}

/** A body's position at the displayed time, as the viewer sees it (from the live state or a history frame). */
export interface BodyPoint {
  id: string;
  positionM: EffectPoint;
  radiusM: number;
}

export interface TimelineContext {
  universeId: string;
  displayTimeS: number;
  bodies: ReadonlyMap<string, BodyPoint>;
  /** Max debris samples this event may draw (effectBudget). */
  particleBudget: number;
}

export function hasPhase(d: VisualEventDto, name: string): boolean {
  return d.phases.some((p) => p.name === name);
}

/** The effect of one event at the displayed time, or null if there is nothing to draw (before the event: a seek back replays it). */
export function effectAt(d: VisualEventDto, clock: FlashClock | undefined, ctx: TimelineContext): CollisionEffectInput | null {
  if (ctx.displayTimeS < d.timeS) return null;
  const style = appearanceStyle(d.materialAppearance[d.impactSite.bodyId] ?? d.cloud?.materialAppearance);
  const elapsed = ctx.displayTimeS - d.timeS;
  const out: CollisionEffectInput = {
    key: `${ctx.universeId}:${d.eventId}`, eventId: d.eventId, centerM: d.impactSite.centerWorldAtContactM, particles: [],
    colorHex: style.colorHex, label: "visual · debris is statistical, the flash has no physical meaning",
  };
  if (d.cloud && hasPhase(d, "cloud-expansion")) {
    const radiusM = d.cloud.initialRadiusM + d.cloud.expansionSpeedMPerS * elapsed;
    // opacity falls as the cloud thins out (geometry only; a function of the displayed simulation time)
    const spread = radiusM / d.cloud.initialRadiusM;
    out.cloud = { radiusM, opacity: style.cloudOpacity / (1 + 0.05 * spread * spread), colorHex: style.colorHex };
  }
  if (ctx.particleBudget > 0 && d.debrisParcelIds.length > 0) {
    const perParcel = Math.max(1, Math.floor(ctx.particleBudget / d.debrisParcelIds.length));
    const points: EffectPoint[] = [];
    for (const id of d.debrisParcelIds) {
      const body = ctx.bodies.get(id);
      if (body) points.push(...sampleParcel(id, body.positionM, body.radiusM, perParcel));
    }
    out.particles = points;
  }
  const flash = d.visualOnly.find((e) => e.kind === "flash");
  if (flash && clock) {
    const remaining01 = flashRemaining01(clock);
    if (remaining01 > 0) out.flash = { intensity: flash.intensity, remaining01 };
  }
  return out;
}
