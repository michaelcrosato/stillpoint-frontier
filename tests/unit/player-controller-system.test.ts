import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { PlayerControllerSystem } from "../../lib/game/systems/PlayerControllerSystem";
import type { DeveloperSpeedMode } from "../../lib/game/developer/PlayerSandbox";
import type { GameRuntimeContext } from "../../lib/game/systems/runtime";
import { INITIAL_PLAYER_CONDITION } from "../../lib/game/gameplay/playerCondition";

function runtime(
  speedMode: DeveloperSpeedMode,
  actions: readonly string[],
  fly = false,
) {
  const held = new Set(actions);
  const queryColliders = vi.fn(() => []);
  const applyFallImpact = vi.fn();
  const context = {
    started: true,
    paused: false,
    testMode: true,
    settings: { lookSensitivity: 1, invertY: false },
    developerPlayer: { invincible: false, speedMode, fly },
    input: {
      consumeActionPressed: vi.fn(() => false),
      isLocked: vi.fn(() => true),
      consumeLookDelta: vi.fn(() => ({ x: 0, y: 0 })),
      isActionDown: vi.fn((action: string) => held.has(action)),
    },
    player: {
      position: new THREE.Vector3(0, fly ? 10 : 0, 0),
      yaw: 0,
      pitch: 0,
      verticalVelocity: 0,
      grounded: !fly,
      crouching: false,
      sprinting: false,
      stamina: 1,
      staminaRecoveryDelay: 0,
      eyeHeight: 1.72,
      jumpBufferRemaining: 0,
      coyoteRemaining: 0,
      sheltered: false,
      condition: { ...INITIAL_PLAYER_CONDITION },
      safePosition: new THREE.Vector3(),
      groundedSafeTime: 0,
    },
    camera: new THREE.PerspectiveCamera(),
    world: {
      canStandAt: vi.fn(() => true),
      queryColliders,
      sampleGroundHeight: vi.fn(() => 0),
    },
    inventoryWeight: vi.fn(() => 0),
    applyFallImpact,
  } as unknown as GameRuntimeContext;
  return { context, queryColliders, applyFallImpact };
}

describe("player controller developer traversal", () => {
  it.each([
    ["normal", 6.4],
    ["fast", 19.2],
    ["veryFast", 51.2],
  ] as const)("applies the %s grounded multiplier after normal locomotion", (mode, distance) => {
    const { context, queryColliders } = runtime(mode, ["moveForward"]);
    new PlayerControllerSystem().update(context, 1);
    expect(context.player.position.z).toBeCloseTo(-distance);
    expect(queryColliders).toHaveBeenCalledOnce();
    expect(context.player.grounded).toBe(true);
  });

  it("holds altitude and bypasses collision, gravity, stamina, and fall damage", () => {
    const { context, queryColliders, applyFallImpact } = runtime("fast", [], true);
    context.player.verticalVelocity = -99;
    context.player.stamina = 0.2;
    context.player.eyeHeight = 1.08;
    new PlayerControllerSystem().update(context, 1);
    expect(context.player.position.y).toBe(10);
    expect(context.player.eyeHeight).toBe(1.72);
    expect(context.player.verticalVelocity).toBe(0);
    expect(context.player.stamina).toBe(1);
    expect(context.player.grounded).toBe(false);
    expect(queryColliders).not.toHaveBeenCalled();
    expect(applyFallImpact).not.toHaveBeenCalled();
  });

  it("uses held jump and crouch controls for vertical flight", () => {
    const ascending = runtime("normal", ["jump"], true).context;
    new PlayerControllerSystem().update(ascending, 1);
    expect(ascending.player.position.y).toBeCloseTo(16.4);

    const descending = runtime("normal", ["crouch"], true).context;
    new PlayerControllerSystem().update(descending, 1);
    expect(descending.player.position.y).toBeCloseTo(3.6);
  });
});
