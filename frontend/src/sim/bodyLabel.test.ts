import { describe, expect, it } from "vitest";
import { displayBodyLabel } from "./bodyLabel";

describe("displayBodyLabel", () => {
  it("omits a system-barycentre note from the visual label", () => {
    expect(displayBodyLabel("Mars (system barycentre)")).toBe("Mars");
    expect(displayBodyLabel("Neptune (system barycenter)  ")).toBe("Neptune");
  });

  it("preserves other scientific names and unknown labels", () => {
    expect(displayBodyLabel("Earth (Earth–Moon barycentre)")).toBe("Earth (Earth–Moon barycentre)");
    expect(displayBodyLabel("Custom body")).toBe("Custom body");
  });
});
