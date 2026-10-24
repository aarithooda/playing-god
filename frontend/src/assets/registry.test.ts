import { describe, expect, it } from "vitest";
import { resolveCelestialAssets } from "./registry";

describe("celestial asset registry", () => {
  it("prefers a stable body asset key over generic classification maps", () => {
    expect(resolveCelestialAssets("earth", "rocky-planet")?.diffuse).toBe("/assets/textures/earth_diffuse.jpg");
  });

  it("uses distinct maps for Mercury and Venus in the Solar System preset", () => {
    const mercury = resolveCelestialAssets("mercury", "rocky-planet");
    const venus = resolveCelestialAssets("venus", "rocky-planet");
    expect(mercury?.diffuse).toBe("/assets/textures/mercury_diffuse.jpg");
    expect(venus?.diffuse).toBe("/assets/textures/venus_diffuse.jpg");
    expect(mercury?.diffuse).not.toBe(venus?.diffuse);
    expect(mercury?.normal).toBe("/assets/textures/mercury_normal.jpg");
    expect(venus?.roughness).toBe("/assets/textures/venus_roughness.jpg");
  });

  it("resolves a unique diffuse map for the Sun and every Solar System planet", () => {
    const bodies = [
      ["sun", "star"],
      ["mercury", "rocky-planet"],
      ["venus", "rocky-planet"],
      ["earth", "rocky-planet"],
      ["mars", "rocky-planet"],
      ["jupiter", "gas-giant"],
      ["saturn", "gas-giant"],
      ["uranus", "ice-giant"],
      ["neptune", "ice-giant"],
    ] as const;
    const diffuseMaps = bodies.map(([assetKey, bodyType]) =>
      resolveCelestialAssets(assetKey, bodyType)?.diffuse,
    );

    expect(diffuseMaps.every(Boolean)).toBe(true);
    expect(new Set(diffuseMaps).size).toBe(bodies.length);
    expect(resolveCelestialAssets("sun", "star")?.emissive).toBe("/assets/textures/sun_emissive.jpg");
    expect(resolveCelestialAssets("jupiter", "gas-giant")?.rings).toBe("/assets/textures/jupiter_rings.svg");
    expect(resolveCelestialAssets("saturn", "gas-giant")?.rings).toBe("/assets/textures/saturn_rings.svg");
    expect(resolveCelestialAssets("uranus", "ice-giant")?.rings).toBe("/assets/textures/uranus_rings.svg");
    expect(resolveCelestialAssets("neptune", "ice-giant")?.rings).toBe("/assets/textures/neptune_rings.svg");
  });

  it("uses type maps for recognized custom bodies", () => {
    expect(resolveCelestialAssets(undefined, "gas-giant")?.diffuse).toBe("/assets/textures/generic_gas_diffuse.jpg");
    expect(resolveCelestialAssets("future-body", "gas-giant")?.diffuse).toBe("/assets/textures/generic_gas_diffuse.jpg");
  });

  it("leaves unknown/default bodies untextured so their supplied color is used", () => {
    expect(resolveCelestialAssets(undefined, "default")).toBeUndefined();
  });

  it("resolves a distinct diffuse map for every named major moon", () => {
    const moons = ["moon", "io", "europa", "ganymede", "callisto", "titan", "rhea", "iapetus", "dione", "tethys"];
    const diffuseMaps = moons.map((key) => resolveCelestialAssets(key, "moon")?.diffuse);
    expect(diffuseMaps.every(Boolean)).toBe(true);
    expect(new Set(diffuseMaps).size).toBe(moons.length);
    expect(diffuseMaps).toEqual(moons.map((key) => `/assets/textures/${key}_diffuse.jpg`));
    expect(resolveCelestialAssets(undefined, "moon")?.normal).toBe("/assets/textures/generic_asteroid_normal.jpg");
  });
});
