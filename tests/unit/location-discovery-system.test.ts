import { describe, expect, it, vi } from "vitest";
import { LocationDiscoverySystem } from "../../lib/game/systems/LocationDiscoverySystem";
import type { GameRuntimeContext } from "../../lib/game/systems/runtime";

describe("location discovery system", () => {
  it("checks the current area during active play only", () => {
    for (const [started, paused, calls] of [
      [true, false, 1],
      [false, false, 0],
      [true, true, 0],
    ] as const) {
      const context = {
        started,
        paused,
        discoverCurrentLocation: vi.fn(),
      } as unknown as GameRuntimeContext;
      new LocationDiscoverySystem().update(context);
      expect(context.discoverCurrentLocation).toHaveBeenCalledTimes(calls);
    }
  });
});
