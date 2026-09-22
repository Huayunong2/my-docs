import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isInteractionBlocked,
  navigationIndex,
  pageShortcuts,
  shortcutForPage,
} from "./navigationInteractions";

afterEach(() => vi.unstubAllGlobals());
describe("workspace keyboard interactions", () => {
  it("wraps through navigation without activating pages", () => {
    expect(navigationIndex("ArrowDown", 7, 8)).toBe(0);
    expect(navigationIndex("ArrowUp", 0, 8)).toBe(7);
    expect(navigationIndex("Home", 4, 8)).toBe(0);
    expect(navigationIndex("End", 4, 8)).toBe(7);
  });
  it("leaves unrelated keys and an empty navigation untouched", () => {
    expect(navigationIndex("Enter", 1, 8)).toBeNull();
    expect(navigationIndex("ArrowDown", 0, 0)).toBeNull();
  });
  it("shortcut hints agree with the actual global map", () => {
    for (const [page, key] of Object.entries(shortcutForPage))
      expect(pageShortcuts[key]).toBe(page);
  });
  it("does not intercept composition or an already handled key", () => {
    expect(
      isInteractionBlocked({
        target: null,
        isComposing: true,
        defaultPrevented: false,
      }),
    ).toBe(true);
    expect(
      isInteractionBlocked({
        target: null,
        isComposing: false,
        defaultPrevented: true,
      }),
    ).toBe(true);
  });
  it("blocks editable fields and popup interactions", () => {
    class Editable {
      closest(selector: string) {
        return selector.includes('[role="menu"]') ? this : null;
      }
    }
    vi.stubGlobal("Element", Editable);
    expect(
      isInteractionBlocked({
        target: new Editable() as unknown as EventTarget,
        isComposing: false,
        defaultPrevented: false,
      }),
    ).toBe(true);
  });
});
