import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { INITIAL_PLAYER_CONDITION } from "../../lib/game/gameplay/playerCondition";
import { PlayerConditionSystem } from "../../lib/game/systems/PlayerConditionSystem";
import type { GameRuntimeContext } from "../../lib/game/systems/runtime";

function runtime(overrides: { paused?: boolean; health?: number; sheltered?: boolean; recover?: boolean } = {}) {
  const condition = { ...INITIAL_PLAYER_CONDITION, health: overrides.health ?? 100 };
  return {
    started: true,
    paused: overrides.paused ?? false,
    input: { consumeActionPressed: vi.fn(() => overrides.recover ?? false) },
    player: {
      position: new THREE.Vector3(),
      condition,
      sheltered: false,
      stamina: 1,
    },
    world: { isShelteredAt: vi.fn(() => overrides.sheltered ?? false) },
    environment: {
      getSample: () => ({
        precipitation: "rain",
        precipitationRate: 1,
        temperatureC: 4,
        windKph: 30,
      }),
    },
    inventoryWeight: () => 0,
    recoverPlayer: vi.fn(),
  } as unknown as GameRuntimeContext;
}

describe("player condition system", () => {
  it("updates shelter and exposure only during active simulation", () => {
    const active = runtime();
    new PlayerConditionSystem().update(active, 0.25);
    expect(active.player.condition.wetness).toBeGreaterThan(0);
    expect(active.world.isShelteredAt).toHaveBeenCalledTimes(1);

    const paused = runtime({ paused: true });
    new PlayerConditionSystem().update(paused, 0.25);
    expect(paused.player.condition).toEqual(INITIAL_PLAYER_CONDITION);
  });

  it("routes the recover action only while incapacitated", () => {
    const dead = runtime({ health: 0, recover: true });
    new PlayerConditionSystem().update(dead, 1 / 60);
    expect(dead.recoverPlayer).toHaveBeenCalledTimes(1);

    const alive = runtime({ recover: true });
    new PlayerConditionSystem().update(alive, 1 / 60);
    expect(alive.recoverPlayer).not.toHaveBeenCalled();
  });
});
