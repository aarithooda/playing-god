// Shared steps for the browser specs: the left tool rail of the workspace.
import { expect, type Page } from "@playwright/test";

/** Opens a tool of the left rail (its accessible name may carry a count, e.g. "Events (1)") unless it is already open. */
export async function openTool(page: Page, label: string): Promise<void> {
  const button = page.getByRole("button", { name: new RegExp(`^${label}( \\(\\d+\\))?$`) });
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
  await expect(page.getByTestId("sidebar-left")).toHaveAttribute("data-open", "true");
}
