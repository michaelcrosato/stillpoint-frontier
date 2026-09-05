import { afterEach, describe, expect, it, vi } from "vitest";
import { InputManager, resolveActionKeys } from "../../lib/game/input/InputManager";
import { DEFAULT_KEY_BINDINGS, rebindAction } from "../../lib/game/settings";

afterEach(() => vi.unstubAllGlobals());

function harness() {
  const windowTarget = new EventTarget();
  class Element extends EventTarget {
    constructor(private readonly tag = "canvas", readonly isContentEditable = false) { super(); }
    matches(selector: string) { return selector.split(", ").includes(this.tag); }
  }
  const canvas = new Element();
  const documentTarget = Object.assign(new EventTarget(), { pointerLockElement: null as unknown });
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", documentTarget);
  vi.stubGlobal("HTMLElement", Element);
  const input = new InputManager(canvas as unknown as HTMLCanvasElement);
  const key = (type: string, code: string, extra = {}, target?: EventTarget) => {
    const event = Object.assign(new Event(type, { cancelable: true }), { code, repeat: false, ...extra });
    if (target) Object.defineProperty(event, "target", { value: target });
    windowTarget.dispatchEvent(event);
    return event;
  };
  return { input, key, canvas, documentTarget, windowTarget, Element };
}

describe("input ownership and lifecycle", () => {
  it("accepts gameplay keys with restored button focus only after capture resumes", () => {
    const { input, key, canvas, documentTarget, Element } = harness();
    const button = new Element("button");
    expect(key("keydown", "KeyW", {}, button).defaultPrevented).toBe(false);
    expect(input.isActionDown("moveForward")).toBe(false);
    documentTarget.pointerLockElement = canvas;
    expect(key("keydown", "KeyW", {}, button).defaultPrevented).toBe(true);
    expect(input.isActionDown("moveForward")).toBe(true);
    key("keyup", "KeyW", {}, button);
    for (const target of [new Element("input"), new Element("textarea"), new Element("div", true)]) {
      expect(key("keydown", "KeyW", {}, target).defaultPrevented).toBe(false);
      expect(input.isActionDown("moveForward")).toBe(false);
    }
    input.dispose();
  });
  it("keeps default shortcuts without allocating new action lists per poll", () => {
    const keys = resolveActionKeys(DEFAULT_KEY_BINDINGS);
    expect(keys.crouch).toEqual(["ControlLeft", "ControlRight", "KeyC"]);
    expect(keys.harvest).toContain("Mouse0");
    expect(keys.sprint).toContain("ShiftRight");
  });
  it.each(["KeyC", "ControlRight", "ShiftRight"])("gives explicit bindings ownership of %s", (code) => {
    const { input, key } = harness();
    input.setBindings(rebindAction(DEFAULT_KEY_BINDINGS, "cameraView", code)!);
    key("keydown", code);
    expect(input.isActionDown("cameraView")).toBe(true);
    expect(input.isActionDown("crouch")).toBe(false);
    expect(input.isActionDown("sprint")).toBe(false);
    expect(input.consumeActionPressed("cameraView")).toBe(true);
    expect(input.consumeActionPressed("cameraView")).toBe(false);
    input.dispose();
  });
  it("leaves browser shortcuts and handled UI events alone outside captured play", () => {
    const { input, key, windowTarget } = harness();
    expect(key("keydown", "KeyL", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(input.isActionDown("flashlight")).toBe(false);
    const handled = Object.assign(new Event("keydown", { cancelable: true }), { code: "KeyL" });
    handled.preventDefault();
    windowTarget.dispatchEvent(handled);
    expect(input.consumeActionPressed("flashlight")).toBe(false);
    input.dispose();
  });
  it("preserves crouch movement with modifiers during captured play", () => {
    const { input, key, canvas, documentTarget } = harness();
    documentTarget.pointerLockElement = canvas;
    key("keydown", "ControlLeft", { ctrlKey: true });
    key("keydown", "KeyW", { ctrlKey: true });
    expect(input.isActionDown("crouch")).toBe(true);
    expect(input.isActionDown("moveForward")).toBe(true);
    key("keyup", "KeyW");
    expect(input.isActionDown("moveForward")).toBe(false);
    input.dispose();
  });
  it("clears held input on blur, rebinding, pointer unlock, and disposal", () => {
    const { input, key, windowTarget, documentTarget } = harness();
    key("keydown", "KeyW");
    windowTarget.dispatchEvent(new Event("blur"));
    expect(input.isActionDown("moveForward")).toBe(false);
    key("keydown", "KeyW");
    input.setBindings(DEFAULT_KEY_BINDINGS);
    expect(input.consumeActionPressed("moveForward")).toBe(false);
    key("keydown", "KeyW");
    documentTarget.dispatchEvent(new Event("pointerlockchange"));
    expect(input.isActionDown("moveForward")).toBe(false);
    input.dispose();
    key("keydown", "KeyW");
    expect(input.isDown("KeyW")).toBe(false);
  });
});
