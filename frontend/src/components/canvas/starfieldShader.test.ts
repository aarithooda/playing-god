/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import dreiStarsSource from "../../../node_modules/@react-three/drei/core/Stars.js?raw";
import { applyStarSizeScale, STAR_POINT_SIZE_TERM, STAR_UNIFORM_DECLARATION } from "./starfieldShader";

// The patch depends on the exact text of drei's shader, so pin it against the installed drei.
const dreiVertexShader = dreiStarsSource.slice(dreiStarsSource.indexOf("vertexShader:"), dreiStarsSource.indexOf("fragmentShader:"));

describe("star size compensation shader patch", () => {
  it("applies to the installed drei <Stars> vertex shader", () => {
    expect(dreiVertexShader).toContain(STAR_UNIFORM_DECLARATION);
    expect(dreiVertexShader).toContain(STAR_POINT_SIZE_TERM);
    // The far-plane maths in sim/starfieldScale.ts assumes this homogeneous w.
    expect(dreiVertexShader).toContain("vec4(position, 0.5)");
    const patched = applyStarSizeScale(dreiVertexShader);
    expect(patched).not.toBeNull();
    expect(patched).toContain("uniform float sizeScale;");
    expect(patched).toContain("(30.0 * sizeScale / -mvPosition.z)");
    expect(patched).not.toContain(STAR_POINT_SIZE_TERM);
  });

  it("leaves a shader it does not recognise untouched (all or nothing)", () => {
    expect(applyStarSizeScale("void main() {}")).toBeNull();
    expect(applyStarSizeScale(`${STAR_UNIFORM_DECLARATION}\nvoid main() {}`)).toBeNull();
    expect(applyStarSizeScale(`void main() { x = ${STAR_POINT_SIZE_TERM}; }`)).toBeNull();
  });
});
