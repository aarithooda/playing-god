import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BodyList, groupByPrimary } from "./BodyList";

afterEach(cleanup);

const b = (id: string, primaryId?: string) => ({ id, name: id.toUpperCase(), colorHex: "#888888", ...(primaryId ? { primaryId } : {}) });
const bodies = [b("sun"), b("earth"), b("moon", "earth"), b("jupiter"), b("io", "jupiter"), b("europa", "jupiter")];

describe("BodyList", () => {
  it("nests each moon under its primary, whatever the listing order", () => {
    const shuffled = [bodies[2], bodies[4], bodies[0], bodies[1], bodies[3], bodies[5]];
    expect(groupByPrimary(shuffled).map((r) => [r.body.id, r.depth])).toEqual([
      ["sun", 0], ["earth", 0], ["moon", 1], ["jupiter", 0], ["io", 1], ["europa", 1],
    ]);
  });

  it("shows a moon whose primary is missing at the top level", () => {
    expect(groupByPrimary([b("io", "gone")]).map((r) => [r.body.id, r.depth])).toEqual([["io", 0]]);
  });

  it("selects on click and focuses with the focus button", () => {
    const onSelect = vi.fn();
    const onFocus = vi.fn();
    render(<BodyList bodies={bodies} selectedBodyId="moon" onSelect={onSelect} onFocus={onFocus} />);
    fireEvent.click(screen.getByText("IO"));
    expect(onSelect).toHaveBeenCalledWith("io");
    fireEvent.click(screen.getByLabelText("Focus EUROPA"));
    expect(onFocus).toHaveBeenCalledWith("europa");
    expect(screen.getByText("MOON").getAttribute("aria-pressed")).toBe("true");
  });

  it("renders nothing for a scene without moons", () => {
    const { container } = render(<BodyList bodies={[b("sun"), b("earth")]} onSelect={() => {}} onFocus={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
});
