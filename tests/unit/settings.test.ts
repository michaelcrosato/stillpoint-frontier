import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_SETTINGS,
  GAME_ACTIONS,
  INTERFACE_SCALES,
  isBindableCode,
  keyLabel,
  normalizeGameSettings,
  rebindAction,
} from "../../lib/game/settings";

describe("game settings", () => {
  it("returns independent safe defaults for malformed input", () => {
    const result = normalizeGameSettings("corrupt");
    expect(result).toEqual(DEFAULT_GAME_SETTINGS);
    expect(result.keyBindings).not.toBe(DEFAULT_GAME_SETTINGS.keyBindings);
  });

  it("clamps numeric preferences and validates enums", () => {
    const result = normalizeGameSettings({
      fov: 500,
      lookSensitivity: -4,
      masterVolume: 3,
      ambientVolume: -1,
      effectsVolume: Number.NaN,
      quality: "impossible",
      horizonMode: "infinite",
      worldDetail: 99,
    }, "extended");
    expect(result.fov).toBe(95);
    expect(result.lookSensitivity).toBe(0.25);
    expect(result.masterVolume).toBe(1);
    expect(result.ambientVolume).toBe(0);
    expect(result.effectsVolume).toBe(DEFAULT_GAME_SETTINGS.effectsVolume);
    expect(result.quality).toBe("cinematic");
    expect(result.horizonMode).toBe("extended");
    expect(result.worldDetail).toBe(4);
    expect(result.interfaceScale).toBe("standard");
  });

  it("normalizes the persisted interface scale", () => {
    expect(INTERFACE_SCALES).toEqual([
      "compact",
      "standard",
      "large",
      "extraLarge",
    ]);
    expect(normalizeGameSettings({ interfaceScale: "extraLarge" }).interfaceScale)
      .toBe("extraLarge");
    expect(normalizeGameSettings({ interfaceScale: "oversized" }).interfaceScale)
      .toBe(DEFAULT_GAME_SETTINGS.interfaceScale);
  });

  it("accepts the opt-in Ultra rendering profile", () => {
    expect(normalizeGameSettings({ quality: "ultra" }).quality).toBe("ultra");
    expect(normalizeGameSettings({ worldDetail: 0 }).worldDetail).toBe(0);
  });

  it("swaps conflicting bindings instead of leaving an action unbound", () => {
    const result = rebindAction(DEFAULT_GAME_SETTINGS.keyBindings, "moveForward", "KeyS");
    expect(result?.moveForward).toBe("KeyS");
    expect(result?.moveBackward).toBe("KeyW");
    expect(new Set(Object.values(result!)).size).toBe(GAME_ACTIONS.length);
  });

  it("normalizes a corrupt binding map into unique valid controls", () => {
    const result = normalizeGameSettings({
      keyBindings: {
        moveForward: "KeyZ",
        moveBackward: "KeyZ",
        jump: "Escape",
        flashlight: "not-a-key",
      },
    });
    expect(result.keyBindings.moveBackward).toBe("KeyZ");
    expect(result.keyBindings.moveForward).not.toBe("KeyZ");
    expect(result.keyBindings.jump).toBe("Space");
    expect(new Set(Object.values(result.keyBindings)).size).toBe(GAME_ACTIONS.length);
  });

  it("accepts gameplay-safe codes and formats compact HUD labels", () => {
    expect(isBindableCode("KeyP")).toBe(true);
    expect(isBindableCode("ControlRight")).toBe(true);
    expect(isBindableCode("Escape")).toBe(false);
    expect(keyLabel("KeyL")).toBe("L");
    expect(keyLabel("ControlLeft")).toBe("CTRL L");
  });
});
