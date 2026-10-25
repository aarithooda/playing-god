// Short curated facts for the preset Solar System bodies (static, no network). Keyed by the preset's body ids.
const FACTS: Record<string, string> = {
  "body-sun": "The Sun holds about 99.86% of the Solar System's mass.",
  "body-mercury": "Mercury has the most eccentric orbit of the eight planets and a year of just 88 Earth days.",
  "body-venus": "Venus rotates backwards and so slowly that its day is longer than its year.",
  "body-earth": "Earth is the only known world with liquid water standing on its surface.",
  "body-moon": "The Moon drifts away from Earth by about 3.8 cm every year.",
  "body-mars": "Mars hosts Olympus Mons, the tallest known volcano in the Solar System.",
  "body-phobos": "Phobos orbits Mars three times a day and is slowly spiralling inward.",
  "body-deimos": "Deimos is one of Mars's two small moons, about 12 km across.",
  "body-jupiter": "Jupiter is more than twice as massive as all the other planets combined.",
  "body-io": "Io is the most volcanically active body in the Solar System.",
  "body-europa": "Europa hides a global ocean of liquid water beneath its icy shell.",
  "body-ganymede": "Ganymede is the largest moon in the Solar System, bigger than Mercury.",
  "body-callisto": "Callisto's ancient surface is among the most heavily cratered in the Solar System.",
  "body-saturn": "Saturn is less dense than water: in a big enough bath it would float.",
  "body-titan": "Titan has a thick atmosphere and lakes of liquid methane and ethane.",
  "body-rhea": "Rhea is Saturn's second-largest moon, an icy world with a heavily cratered surface.",
  "body-iapetus": "Iapetus has one dark hemisphere and one bright one, and an equatorial ridge.",
  "body-dione": "Dione is a small icy moon of Saturn with bright wispy cliffs on its trailing side.",
  "body-tethys": "Tethys is almost pure water ice and carries a giant canyon, Ithaca Chasma.",
  "body-uranus": "Uranus orbits on its side, tilted about 98 degrees to its orbital plane.",
  "body-neptune": "Neptune has the fastest winds of any planet, measured above 2,000 km/h.",
};

/** One short fact for a body; a neutral line for anything not in the curated set. */
export function bodyFact(id: string): string {
  return FACTS[id] ?? "A body you created. Its motion comes entirely from gravity acting on it.";
}
