import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { InteractionSystem } from "../../lib/game/systems/InteractionSystem";
import type { GameRuntimeContext } from "../../lib/game/systems/runtime";
import type { WorldTarget } from "../../lib/game/world/ChunkManager";

function target(
  action: WorldTarget["action"],
  overrides: Partial<WorldTarget> = {},
): WorldTarget {
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
    ...overrides,
  };
}

function context(
  worldTarget: WorldTarget | readonly WorldTarget[],
  pressed: readonly string[],
  overrides: Partial<Pick<GameRuntimeContext, "started" | "paused">> = {},
) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.72, 0);
  camera.updateMatrixWorld(true);
  const pressedSet = new Set(pressed);
  const actionCodes: Record<string, string> = {
    map: "KeyM",
    inventory: "KeyI",
    quality: "KeyQ",
    interact: "KeyE",
    harvest: "KeyF",
  };
  return {
    input: {
      consumePressed: vi.fn((code: string) => pressedSet.has(code)),
      consumeActionPressed: vi.fn((action: string) => pressedSet.has(actionCodes[action])),
    },
    camera,
    world: { targets: Array.isArray(worldTarget) ? worldTarget : [worldTarget] },
    started: true,
    paused: false,
    developerPanelOpen: false,
    nearbyTarget: null,
    nearbyDistance: null,
    performInteraction: vi.fn(),
    toggleDeveloperPanel: vi.fn(),
    toggleMap: vi.fn(),
    toggleInventory: vi.fn(),
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

  it("targets resources by yaw even when camera pitch and target height differ", () => {
    const resource = target("harvest", {
      position: new THREE.Vector3(3, -12, 0),
    });
    const runtime = context(resource, []);
    runtime.camera.rotation.set(Math.PI / 2, -Math.PI / 2, 0, "YXZ");
    runtime.camera.updateMatrixWorld(true);

    new InteractionSystem().update(runtime);

    expect(runtime.nearbyTarget).toBe(resource);
    expect(runtime.nearbyDistance).toBeCloseTo(3);
  });

  it("accepts a resource near the viewport edge but never one behind the player", () => {
    const edge = target("harvest", {
      id: "test:edge-resource",
      position: new THREE.Vector3(Math.sin(Math.PI / 3) * 3, 1, -1.5),
    });
    const behind = target("harvest", {
      id: "test:behind-resource",
      position: new THREE.Vector3(0, 1, 2),
    });
    const runtime = context([behind, edge], []);

    new InteractionSystem().update(runtime);

    expect(runtime.nearbyTarget).toBe(edge);

    const behindOnly = context(behind, []);
    new InteractionSystem().update(behindOnly);
    expect(behindOnly.nearbyTarget).toBeNull();
  });

  it("uses resource interaction radius for aim assist and surface reach", () => {
    const resource = target("harvest", {
      position: new THREE.Vector3(4.75, 18, -1.27),
      maxDistance: 4,
    }) as WorldTarget & { interactionRadius: number };
    resource.interactionRadius = 1.25;
    const runtime = context(resource, []);

    new InteractionSystem().update(runtime);

    expect(runtime.nearbyTarget).toBe(resource);
    expect(runtime.nearbyDistance).toBeCloseTo(Math.hypot(4.75, 1.27) - 1.25);
  });

  it("prefers the resource being aimed at over a nearer edge candidate", () => {
    const centered = target("harvest", {
      id: "test:centered-resource",
      position: new THREE.Vector3(0, 1, -3.8),
    });
    const edge = target("harvest", {
      id: "test:near-edge-resource",
      position: new THREE.Vector3(Math.sin(Math.PI / 3) * 2, 1, -1),
    });
    const runtime = context([edge, centered], []);

    new InteractionSystem().update(runtime);

    expect(runtime.nearbyTarget).toBe(centered);
    expect(runtime.nearbyDistance).toBeCloseTo(3.8);
  });

  it("selects centered inspectables through the same E interaction contract", () => {
    const inspectable = target("inspect", {
      id: "inspectable:test",
      kind: "inspectable",
      position: new THREE.Vector3(0, 1.4, -2.4),
    });
    const resource = target("harvest", {
      id: "resource:edge",
      position: new THREE.Vector3(1.5, 1, -1.4),
    });
    const runtime = context([resource, inspectable], ["KeyE"]);
    new InteractionSystem().update(runtime);
    expect(runtime.nearbyTarget).toBe(inspectable);
    expect(runtime.performInteraction).toHaveBeenCalledWith(inspectable);
  });
});
