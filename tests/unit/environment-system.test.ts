import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { EnvironmentRuntime } from "../../lib/game/environment";
import { EnvironmentSystem } from "../../lib/game/systems/EnvironmentSystem";
import type { GameRuntimeContext } from "../../lib/game/systems/runtime";

function context(
  overrides: Partial<Pick<GameRuntimeContext, "started" | "paused" | "testMode">> = {},
) {
  return {
    player: { position: new THREE.Vector3(4, 2, -7) },
    started: true,
    paused: false,
    testMode: false,
    ...overrides,
  } as GameRuntimeContext;
}

describe("environment system clock gating", () => {
  it("advances only during active normal gameplay", () => {
    const tick = vi.fn();
    const environment = { tick } as unknown as EnvironmentRuntime;
    const system = new EnvironmentSystem(environment);

    system.update(context(), 1 / 60);
    expect(tick).toHaveBeenLastCalledWith(expect.any(THREE.Vector3), 1 / 60, true);

    system.update(context({ paused: true }), 1 / 60);
    expect(tick).toHaveBeenLastCalledWith(expect.any(THREE.Vector3), 1 / 60, false);

    system.update(context({ started: false }), 1 / 60);
    expect(tick).toHaveBeenLastCalledWith(expect.any(THREE.Vector3), 1 / 60, false);

    system.update(context({ testMode: true }), 1 / 60);
    expect(tick).toHaveBeenLastCalledWith(expect.any(THREE.Vector3), 1 / 60, false);
    expect(tick).toHaveBeenCalledTimes(4);
  });
});
