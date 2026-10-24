import { describe, expect, it } from "vitest";
import { parseBodyDto } from "../../api/parse";
import { buildSceneBodies } from "../sceneBodies";
import { toBodyView } from "../viewModel";

import { earth } from "../../test/fixtures";

describe("orientation reaches the scene only when the backend supplied one (D-053)", () => {
  const withOrientation = parseBodyDto({
    ...earth, material: { profileId: "silicate-rock" }, spinRadPerS: { x: 0, y: 0, z: 7e-5 },
    orientation: { quaternion: [1, 0, 0, 0], epochS: 5 },
  });

  it("a body with a rotation state carries its quaternion to the scene body", () => {
    const [scene] = buildSceneBodies([toBodyView(withOrientation)], { metersPerUnit: 5e9 }, "universe");
    expect(scene!.orientation).toEqual([1, 0, 0, 0]);
  });

  it("an ordinary body has no orientation key at all, so it is drawn exactly as before", () => {
    const [scene] = buildSceneBodies([toBodyView(parseBodyDto(earth))], { metersPerUnit: 5e9 }, "universe");
    expect("orientation" in scene!).toBe(false);
  });
});
