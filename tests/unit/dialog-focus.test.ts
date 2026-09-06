import { afterEach, describe, expect, it, vi } from "vitest";
import { dialogFocusTarget, trapDialogTab } from "../../lib/game/ui/dialogFocus";

afterEach(() => vi.unstubAllGlobals());

describe("shared dialog focus boundaries", () => {
  const controls = ["close", "slider", "reset"];
  it("wraps both directions from the initially focused heading", () => {
    expect(dialogFocusTarget(controls, "heading", true)).toBe("reset");
    expect(dialogFocusTarget(controls, "heading", false)).toBe("close");
    expect(dialogFocusTarget(controls, null, true)).toBe("reset");
  });
  it("wraps boundaries but preserves normal navigation inside a dialog", () => {
    expect(dialogFocusTarget(controls, "close", true)).toBe("reset");
    expect(dialogFocusTarget(controls, "reset", false)).toBe("close");
    expect(dialogFocusTarget(controls, "slider", true)).toBeNull();
    expect(dialogFocusTarget(controls, "slider", false)).toBeNull();
  });
  it("contains single-control dialogs and handles empty lists", () => {
    expect(dialogFocusTarget(["close"], "close", true)).toBe("close");
    expect(dialogFocusTarget(["close"], "close", false)).toBe("close");
    expect(dialogFocusTarget([], null, true)).toBeNull();
  });
  it("filters unavailable controls before wrapping focus", () => {
    const control = (tabIndex = 0, disabled = false, hidden = false, rendered = true) => ({
      tabIndex, matches: () => disabled, closest: () => hidden ? {} : null,
      getClientRects: () => rendered ? [{}] : [], focus: vi.fn(),
    });
    const first = control();
    const last = control();
    const panel = { querySelectorAll: () => [control(-1), control(0, true), first, last, control(0, false, true), control(0, false, false, false)] } as unknown as HTMLElement;
    vi.stubGlobal("document", { activeElement: {} });
    const event = { key: "Tab", shiftKey: true, preventDefault: vi.fn() };
    trapDialogTab(event, panel);
    expect(last.focus).toHaveBeenCalledOnce();
    expect(first.focus).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    trapDialogTab({ ...event, key: "Enter" }, panel);
    trapDialogTab(event, null);
    vi.stubGlobal("document", { activeElement: first });
    const forward = { key: "Tab", shiftKey: false, preventDefault: vi.fn() };
    trapDialogTab(forward, panel);
    expect(forward.preventDefault).not.toHaveBeenCalled();
    trapDialogTab(event, { querySelectorAll: () => [] } as unknown as HTMLElement);
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
  });
  it("leaves modified Tab shortcuts to the browser", () => {
    const preventDefault = vi.fn();
    const panel = { querySelectorAll: () => controls.map(() => ({
      tabIndex: 0,
      matches: () => false,
      closest: () => null,
      getClientRects: () => [{}],
      focus: vi.fn(),
    })) } as unknown as HTMLElement;
    vi.stubGlobal("document", { activeElement: null });
    for (const modifier of ["ctrlKey", "metaKey", "altKey"] as const) {
      trapDialogTab({
        key: "Tab",
        shiftKey: false,
        [modifier]: true,
        preventDefault,
      }, panel);
    }
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
