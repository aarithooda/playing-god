import { describe, expect, it } from "vitest";
import { resolveCelestialAssets } from "./registry";

describe("celestial asset registry", () => {
  it("prefers a stable body asset key over generic classification maps", () => {
    expect(resolveCelestialAssets("earth", "rocky-planet")?.diffuse).toBe("/assets/textures/earth_diffuse.jpg");
  });

  it("uses type maps for recognized custom bodies", () => {
    expect(resolveCelestialAssets(undefined, "gas-giant")?.diffuse).toBe("/assets/textures/generic_gas_diffuse.jpg");
    expect(resolveCelestialAssets("future-body", "gas-giant")?.diffuse).toBe("/assets/textures/generic_gas_diffuse.jpg");
  });

  it("leaves unknown/default bodies untextured so their supplied color is used", () => {
    expect(resolveCelestialAssets(undefined, "default")).toBeUndefined();
  });

  it("gives every moon the Moon map, and Earth's Moon its own key", () => {
    expect(resolveCelestialAssets("moon", "moon")?.diffuse).toBe("/assets/textures/generic_asteroid_diffuse.jpg");
    expect(resolveCelestialAssets("io", "moon")?.diffuse).toBe("/assets/textures/generic_asteroid_diffuse.jpg");
    expect(resolveCelestialAssets(undefined, "moon")?.normal).toBe("/assets/textures/generic_asteroid_normal.jpg");
  });
});
