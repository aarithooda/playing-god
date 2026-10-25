import { describe, expect, it } from "vitest";
import { observedRate, trimSamples } from "./useObservedRate";

describe("observedRate", () => {
  it("is unknown with fewer than two confirmed times", () => {
    expect(observedRate([])).toBeNull();
    expect(observedRate([{ wallMs: 0, simulationTimeS: 10 }])).toBeNull();
  });

  it("divides the simulated time that passed by the wall time it took", () => {
    expect(observedRate([
      { wallMs: 1000, simulationTimeS: 0 },
      { wallMs: 1500, simulationTimeS: 43200 },
      { wallMs: 3000, simulationTimeS: 172800 },
    ])).toBeCloseTo(86400); // two days in two seconds: one day per second
  });

  it("reports nothing when time did not advance or no wall time passed", () => {
    expect(observedRate([{ wallMs: 0, simulationTimeS: 5 }, { wallMs: 900, simulationTimeS: 5 }])).toBeNull();
    expect(observedRate([{ wallMs: 7, simulationTimeS: 5 }, { wallMs: 7, simulationTimeS: 9 }])).toBeNull();
  });
});

describe("trimSamples", () => {
  it("drops samples older than the window but always keeps the newest", () => {
    const samples = [
      { wallMs: 0, simulationTimeS: 0 },
      { wallMs: 3000, simulationTimeS: 1 },
      { wallMs: 6000, simulationTimeS: 2 },
    ];
    expect(trimSamples(samples, 6000, 4000).map((s) => s.wallMs)).toEqual([3000, 6000]);
    expect(trimSamples([{ wallMs: 0, simulationTimeS: 0 }], 99999, 4000)).toHaveLength(1);
  });
});
