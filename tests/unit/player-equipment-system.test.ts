import { describe, expect, it, vi } from "vitest";
import { PlayerEquipmentSystem } from "../../lib/game/systems/PlayerEquipmentSystem";
import type { GameRuntimeContext } from "../../lib/game/systems/runtime";

function context({
  started = true,
  paused = false,
  pressed = true,
} = {}) {
  return {
    started,
    paused,
    input: {
      consumePressed: vi.fn((code: string) => pressed && code === "KeyL"),
    },
    toggleFlashlight: vi.fn(),
  } as unknown as GameRuntimeContext;
}

describe("player equipment input", () => {
  it("uses a single L press to toggle the field light during active play", () => {
    const runtime = context();
    new PlayerEquipmentSystem().update(runtime);
    expect(runtime.input.consumePressed).toHaveBeenCalledWith("KeyL");
    expect(runtime.toggleFlashlight).toHaveBeenCalledTimes(1);
  });

  it("does not toggle while the session is inactive, paused, or missing an edge press", () => {
    for (const runtime of [
      context({ started: false }),
      context({ paused: true }),
      context({ pressed: false }),
    ]) {
      new PlayerEquipmentSystem().update(runtime);
      expect(runtime.input.consumePressed).toHaveBeenCalledWith("KeyL");
      expect(runtime.toggleFlashlight).not.toHaveBeenCalled();
    }
  });
});
