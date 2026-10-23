import { describe, expect, it } from "vitest";
import { earth } from "../test/fixtures";
import { formatNumber } from "./format";
import { NEW_BODY_DEFAULTS, parseBodyEdits, parseBodyForm, valuesFromBody } from "./validation";
import { toBodyView } from "./viewModel";

describe("create form validation", () => {
  it("accepts the defaults and produces an SI-named payload", () => {
    expect(parseBodyForm(NEW_BODY_DEFAULTS)).toEqual({
      ok: true,
      value: {
        name: "New body",
        massKg: 5.972e24,
        radiusM: 6.371e6,
        positionM: { x: 1.496e11, y: 0, z: 0 },
        velocityMPerS: { x: 0, y: 29780, z: 0 },
        colorHex: "#3b82f6",
      },
    });
  });

  it("rejects bad mass, radius, color, name, non-numbers and faster-than-light speed", () => {
    const r = parseBodyForm({
      ...NEW_BODY_DEFAULTS,
      name: "",
      mass: "-1",
      radius: "0",
      color: "red",
      px: "abc",
      vx: "2.9e8",
      vy: "2.9e8",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["color", "mass", "name", "px", "radius", "vx"]);
  });

  it("rejects values beyond the backend bounds", () => {
    expect(parseBodyForm({ ...NEW_BODY_DEFAULTS, mass: "1e46" }).ok).toBe(false);
    expect(parseBodyForm({ ...NEW_BODY_DEFAULTS, px: "1e19" }).ok).toBe(false);
  });
});

describe("inspector edits", () => {
  const body = toBodyView(earth);

  it("sends only edited fields", () => {
    expect(parseBodyEdits({ mass: "7.3e22" }, body)).toEqual({ ok: true, value: { massKg: 7.3e22 } });
  });

  it("fills untouched vector components from the confirmed state", () => {
    expect(parseBodyEdits({ vx: "5" }, body)).toEqual({
      ok: true,
      value: { velocityMPerS: { x: 5, y: 29780, z: 0 } },
    });
  });

  it("reports errors and refuses empty patches", () => {
    expect(parseBodyEdits({ radius: "-5" }, body).ok).toBe(false);
    expect(parseBodyEdits({}, body)).toEqual({ ok: false, errors: {} });
  });

  it("seeds inputs with metres, not kilometres", () => {
    const v = valuesFromBody(body, formatNumber);
    expect(Number(v.radius)).toBe(6.371e6);
    expect(Number(v.px)).toBe(1.496e11);
  });
});
