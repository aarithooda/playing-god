import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DiagnosticsDto } from "../../api/types";
import { diagnostics, zeroVec } from "../../test/fixtures";
import { DiagnosticsPanel } from "./DiagnosticsPanel";

afterEach(cleanup);

function open(ui: React.ReactElement) {
  const r = render(ui);
  fireEvent.click(screen.getByRole("button", { name: /system diagnostics/i }));
  return r;
}

const value = (id: string) => screen.getByTestId(`diag-${id}-value`).textContent;
const panel = (d: DiagnosticsDto | null, issue: string | null = null, loadStatus: "loading" | "ready" | "error" = "ready") => (
  <DiagnosticsPanel loadStatus={loadStatus} diagnostics={d} issue={issue} />
);

describe("DiagnosticsPanel", () => {
  it("is collapsed by default and toggles", () => {
    render(panel(diagnostics));
    const toggle = screen.getByRole("button", { name: /system diagnostics/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("diag-mass")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("diag-mass")).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByTestId("diag-mass")).toBeNull();
  });

  it("shows all six backend quantities with their API field names and SI units", () => {
    open(panel(diagnostics));
    expect(screen.getByText(/totalMassKg/)).toBeTruthy();
    expect(screen.getByText(/totalMomentumKgMPerS/)).toBeTruthy();
    expect(screen.getByText(/kineticEnergyJ/)).toBeTruthy();
    expect(screen.getByText(/potentialEnergyJ/)).toBeTruthy();
    expect(screen.getByText(/angularMomentumAboutOriginKgM2PerS/)).toBeTruthy();
    expect(screen.getByText(/bookedSpinKgM2PerS/)).toBeTruthy();
    expect(value("mass")).toBe("1.989e30 kg");
    expect(value("momentum")).toBe("(0, 1.779e29, 0) kg·m/s");
    expect(value("kinetic")).toBe("2.600e33 J");
    expect(value("potential")).toBe("-5.300e33 J");
    expect(value("angular")).toBe("(0, 0, 2.660e40) kg·m²/s");
    expect(value("spin")).toBe("(0, 0, 0) kg·m²/s");
  });

  it("states the scope, the reference origin, the bookkeeping nature of spin and the point-mass model", () => {
    open(panel(diagnostics));
    expect(screen.getByText(/Whole system \(all bodies\), not the selected body/)).toBeTruthy();
    expect(screen.getByText(/about the origin/i)).toBeTruthy();
    expect(screen.getByText(/fixed simulation origin \(0, 0, 0\), not the centre of mass/)).toBeTruthy();
    expect(screen.getByText(/bookkeeping only/i)).toBeTruthy();
    expect(screen.getByText(/No rotation is simulated and it carries no energy/)).toBeTruthy();
    expect(screen.getByText(/Point-mass approximation/)).toBeTruthy();
  });

  it("does not imply K+U is conserved across mergers and labels derived sums as such", () => {
    open(panel(diagnostics));
    expect(screen.getByText(/Not conserved across mergers/)).toBeTruthy();
    expect(screen.getByText(/Derived here by adding backend values \(not backend diagnostics\)/)).toBeTruthy();
    expect(value("k-plus-u")).toBe("-2.700e33 J");
    expect(value("l-plus-spin")).toBe("(0, 0, 2.660e40) kg·m²/s");
  });

  it("shows null scalars as Undefined, not zero, and propagates to K+U", () => {
    open(panel({ ...diagnostics, potentialEnergyJ: null }));
    expect(value("potential")).toBe("Undefined");
    expect(value("k-plus-u")).toBe("Undefined");
    expect(value("kinetic")).toBe("2.600e33 J");
  });

  it("shows a null vector as one wholly Undefined quantity and propagates to the derived sum", () => {
    open(panel({ ...diagnostics, bookedSpinKgM2PerS: null, totalMomentumKgMPerS: null }));
    expect(value("spin")).toBe("Undefined");
    expect(value("momentum")).toBe("Undefined");
    expect(value("l-plus-spin")).toBe("Undefined");
    expect(value("angular")).toBe("(0, 0, 2.660e40) kg·m²/s");
    expect(value("spin")).not.toMatch(/[(),]/); // no partial vector, no components
  });

  it("shows genuine zeros as 0 (an empty system is defined, not undefined)", () => {
    const empty: DiagnosticsDto = {
      version: 1,
      totalMassKg: 0,
      totalMomentumKgMPerS: zeroVec,
      kineticEnergyJ: 0,
      potentialEnergyJ: 0,
      angularMomentumAboutOriginKgM2PerS: zeroVec,
      bookedSpinKgM2PerS: zeroVec,
    };
    open(panel(empty));
    expect(value("mass")).toBe("0 kg");
    expect(value("potential")).toBe("0 J");
    expect(value("k-plus-u")).toBe("0 J");
    expect(screen.queryByText("Undefined")).toBeNull();
  });

  it("renders very large and very small finite values legibly", () => {
    open(panel({ ...diagnostics, totalMassKg: 1e45, kineticEnergyJ: 1.234e-9, potentialEnergyJ: -Number.MAX_VALUE }));
    expect(value("mass")).toBe("1.000e45 kg");
    expect(value("kinetic")).toBe("1.234e-9 J");
    expect(value("potential")).toBe("-1.798e308 J");
    expect(value("k-plus-u")).toBe("-1.798e308 J");
  });

  it("explains missing diagnostics without crashing or showing numbers", () => {
    open(panel(null, "the response contained no diagnostics"));
    expect(screen.getByTestId("diag-unavailable").textContent).toMatch(/Diagnostics unavailable: the response contained no diagnostics/);
    expect(screen.queryByTestId("diag-mass")).toBeNull();
  });

  it("reports an unsupported version instead of interpreting it", () => {
    open(panel(null, "unsupported diagnostics version (2; this client understands 1)"));
    expect(screen.getByTestId("diag-unavailable").textContent).toMatch(/unsupported diagnostics version \(2/);
  });

  it("has a fallback text when no reason is supplied", () => {
    open(panel(null));
    expect(screen.getByTestId("diag-unavailable").textContent).toMatch(/no diagnostics were provided/);
  });

  it("handles loading and error states", () => {
    const { rerender } = open(panel(null, null, "loading"));
    expect(screen.getByRole("status").textContent).toMatch(/Waiting for the simulation/);
    rerender(panel(null, null, "error"));
    expect(screen.getByRole("status").textContent).toMatch(/could not be loaded/);
  });

  it("follows state updates, a reset to an empty system, and loss of diagnostics, keeping it open", () => {
    const { rerender } = open(panel(diagnostics));
    expect(value("kinetic")).toBe("2.600e33 J");
    rerender(panel({ ...diagnostics, kineticEnergyJ: 1e10, bookedSpinKgM2PerS: { x: 0, y: 0, z: -6.667e2 } }));
    expect(value("kinetic")).toBe("1.000e10 J");
    expect(value("spin")).toBe("(0, 0, -666.7) kg·m²/s");
    rerender(panel({ ...diagnostics, totalMassKg: 0, kineticEnergyJ: 0, potentialEnergyJ: 0, bookedSpinKgM2PerS: zeroVec }));
    expect(value("mass")).toBe("0 kg");
    expect(value("spin")).toBe("(0, 0, 0) kg·m²/s");
    rerender(panel(null, "the response contained no diagnostics"));
    expect(within(screen.getByTestId("diag-unavailable")).queryByText(/kg/)).toBeNull();
    expect(screen.getByRole("button", { name: /system diagnostics/i }).getAttribute("aria-expanded")).toBe("true");
  });
});
