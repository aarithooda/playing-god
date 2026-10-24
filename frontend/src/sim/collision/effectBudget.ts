/** Limits on what is drawn (V-PERF): at most 8 simultaneous events and 20,000 samples, with level-of-detail tiers. The budget changes
 *  only how many VISUAL samples are drawn: it never changes a physical number, which the simulation and the inspector read from the API. */

export const MAX_SIMULTANEOUS_EVENTS = 8;
export const MAX_PARTICLES = 20_000;

export type LodTier = 0 | 1 | 2 | 3;

export interface Allocation {
  /** Event ids that may be drawn, newest first, at most MAX_SIMULTANEOUS_EVENTS. */
  events: string[];
  /** Event ids dropped by the cap (their effects are not drawn; nothing else changes). */
  dropped: string[];
  tier: LodTier;
  /** Samples per event. */
  particlesPerEvent: number;
}

/** Tier from the number of events drawn: 0 = full; each tier draws fewer samples; 3 draws none. */
export function tierFor(eventCount: number): LodTier {
  if (eventCount <= 1) return 0;
  if (eventCount <= 3) return 1;
  if (eventCount <= 6) return 2;
  return 3;
}

const PER_EVENT_BY_TIER = [4000, 1500, 400, 0] as const;

/** `eventIds` ordered oldest to newest. */
export function allocate(eventIds: readonly string[]): Allocation {
  const newestFirst = [...eventIds].reverse();
  const events = newestFirst.slice(0, MAX_SIMULTANEOUS_EVENTS);
  const dropped = newestFirst.slice(MAX_SIMULTANEOUS_EVENTS);
  const tier = tierFor(events.length);
  const perEvent = Math.min(PER_EVENT_BY_TIER[tier], events.length === 0 ? 0 : Math.floor(MAX_PARTICLES / events.length));
  return { events, dropped, tier, particlesPerEvent: perEvent };
}
