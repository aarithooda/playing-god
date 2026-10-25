// Shared steps for the App-level tests: waiting for the workspace and opening a tool of the left rail.
import { fireEvent, screen, waitFor } from "@testing-library/react";

/**
 * The workspace is up and the simulation either loaded or failed visibly. The bar's "Simulation" heading exists from
 * the first render, so it alone does not mean the state has arrived.
 */
export async function waitForWorkspace(): Promise<void> {
  await screen.findByText("Simulation");
  await waitFor(() => {
    const loading = screen.getByTestId("sim-state").textContent === "Waiting for the simulation";
    if (loading && screen.queryAllByRole("alert").length === 0) throw new Error("the simulation state has not arrived yet");
  });
}

/** Opens a tool of the left rail (Add, Universes, Orbit Lab, Events, History, Diagnostics) unless it is already open. */
export function openTool(label: string): void {
  const button = screen.getByRole("button", { name: new RegExp(`^${label}( \\(\\d+\\))?$`) });
  if (button.getAttribute("aria-pressed") !== "true") fireEvent.click(button);
}
