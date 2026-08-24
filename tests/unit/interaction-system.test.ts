import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { InteractionSystem } from "../../lib/game/systems/InteractionSystem";
import type { GameRuntimeContext } from "../../lib/game/systems/runtime";
import type { WorldTarget } from "../../lib/game/world/ChunkManager";

function target(action: WorldTarget["action"]): WorldTarget {
  return {
    id: `test:${action}`,
    kind: action === "toggle" ? "door" : "resource",
    action,
    name: "Test target",
    position: new THREE.Vector3(0, 1.45, -2),
    root: new THREE.Group(),
    maxDistance: 4,
    hitsRequired: action === "harvest" ? 3 : 0,
    hits: 0,
    doorId: action === "toggle" ? "test:door" : undefined,
    open: action === "toggle" ? false : undefined,
  };
}

function context(
  worldTarget: WorldTarget,
  pressed: readonly string[],
  overrides: Partial<Pick<GameRuntimeContext, "started" | "paused">> = {},
) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.72, 0);
  camera.updateMatrixWorld(true);
  const pressedSet = new Set(pressed);
  return {
    input: {
      consumePressed: vi.fn((code: string) => pressedSet.has(code)),
    },
    camera,
    world: { targets: [worldTarget] },
    started: true,
    paused: false,
    developerPanelOpen: false,
    nearbyTarget: null,
    nearbyDistance: null,
    performInteraction: vi.fn(),
    toggleDeveloperPanel: vi.fn(),
    toggleMap: vi.fn(),
    toggleQuality: vi.fn(),
    ...overrides,
  } as unknown as GameRuntimeContext;
}

describe("interaction system routing", () => {
  it("uses one E press to select and toggle a facing door", () => {
    const door = target("toggle");
    const runtime = context(door, ["KeyE"]);
    new InteractionSystem().update(runtime);
    expect(runtime.nearbyTarget).toBe(door);
    expect(runtime.nearbyDistance).toBeCloseTo(Math.hypot(2, 0.27));
    expect(runtime.performInteraction).toHaveBeenCalledTimes(1);
    expect(runtime.performInteraction).toHaveBeenCalledWith(door);
  });

  it("preserves harvest controls and clears stale prompts while paused", () => {
    const resource = target("harvest");
    const wrongKey = context(resource, ["KeyE"]);
    new InteractionSystem().update(wrongKey);
    expect(wrongKey.performInteraction).not.toHaveBeenCalled();

    const correctKey = context(resource, ["KeyF"]);
    new InteractionSystem().update(correctKey);
    expect(correctKey.performInteraction).toHaveBeenCalledWith(resource);

    const paused = context(resource, ["KeyF"], { paused: true });
    paused.nearbyTarget = resource;
    paused.nearbyDistance = 1;
    new InteractionSystem().update(paused);
    expect(paused.nearbyTarget).toBeNull();
    expect(paused.nearbyDistance).toBeNull();
    expect(paused.performInteraction).not.toHaveBeenCalled();
  });
});
