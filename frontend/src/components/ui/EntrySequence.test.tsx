import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntrySequence, INTRO_MS, shouldShowIntro } from "./EntrySequence";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("EntrySequence", () => {
  it("ends by itself after a few seconds", () => {
    const onDone = vi.fn();
    render(<EntrySequence onDone={onDone} />);
    expect(screen.getByText("Let there be light.")).toBeTruthy();
    act(() => vi.advanceTimersByTime(INTRO_MS + 1000));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("can be skipped at once with the button or any key, and finishes only once", () => {
    const onDone = vi.fn();
    render(<EntrySequence onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Enter the universe" }));
    fireEvent.keyDown(window, { key: "Escape" });
    act(() => vi.advanceTimersByTime(INTRO_MS + 1000));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("remembers that it was seen", () => {
    render(<EntrySequence onDone={() => {}} />);
    fireEvent.keyDown(window, { key: " " });
    expect(window.localStorage.getItem("playing-god.intro-seen")).toBe("1");
  });

  it("never runs in unit tests, so it cannot sit over the controls under test", () => {
    expect(shouldShowIntro()).toBe(false);
  });
});
