import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InteractionSystem } from "../../lib/game/systems/InteractionSystem";
import type { GameRuntimeContext } from "../../lib/game/systems/runtime";
import type { WorldTarget } from "../../lib/game/world/ChunkManager";

const targetAt = (
  id: string,
  position: THREE.Vector3,
  maxDistance = 2,
): WorldTarget => ({
  id,
  kind: "pickup",
  action: "collect",
  name: id,
  position,
  root: new THREE.Group(),
  maxDistance,
  hitsRequired: 1,
  hits: 0,
});

const runtimeWithTargets = (targets: WorldTarget[]) => ({
  input: {
    consumePressed: vi.fn(() => false),
  },
  camera: {
    position: new THREE.Vector3(0, 1.6, 0),
    getWorldDirection: (out: THREE.Vector3) => out.set(1, 0, 0),
  },
  world: { targets },
  player: { position: new THREE.Vector3(0, 0, 0) },
  started: true,
  paused: false,
  developerPanelOpen: false,
  nearbyTarget: null,
  nearbyDistance: null,
  toggleDeveloperPanel: vi.fn(),
  toggleMap: vi.fn(),
  toggleQuality: vi.fn(),
  performInteraction: vi.fn(),
}) as unknown as GameRuntimeContext;

describe("InteractionSystem", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefilters horizontally and vertically distant targets before vector work", () => {
    const horizontal = targetAt(
      "far-horizontal",
      new THREE.Vector3(100, 1.6, 0),
    );
    Object.defineProperty(horizontal, "traversal", {
      get: () => {
        throw new Error("distant traversal target should not be resolved");
      },
    });
    const vertical = targetAt("far-vertical", new THREE.Vector3(0, 100, 0));
    const nearby = targetAt("nearby", new THREE.Vector3(1, 1.6, 0));
    const originalLength = THREE.Vector3.prototype.length;
    vi.spyOn(THREE.Vector3.prototype, "length").mockImplementation(function (
      this: THREE.Vector3,
    ) {
      if (Math.abs(this.y) > 10) {
        throw new Error("distant target should not reach Vector3.length");
      }
      return originalLength.call(this);
    });

    const context = runtimeWithTargets([horizontal, vertical, nearby]);
    new InteractionSystem().update(context);

    expect(context.nearbyTarget).toBe(nearby);
    expect(context.nearbyDistance).toBe(1);
  });

  it("selects a level-aware stair target and routes the real use key", () => {
    const stairs: WorldTarget = {
      ...targetAt("building:test:stairs:up", new THREE.Vector3(1, 1.05, 0), 2.55),
      kind: "traversal",
      action: "traverse",
      traversal: {
        direction: 1,
        stops: [
          { kind: "floor", index: 0, label: "F01", y: 0 },
          { kind: "floor", index: 1, label: "F02", y: 3.2 },
        ],
        destinationX: 1,
        destinationZ: 0,
      },
    };
    const context = runtimeWithTargets([stairs]);
    context.input.consumePressed = vi.fn((code) => code === "KeyE");

    new InteractionSystem().update(context);

    expect(context.nearbyTarget).toBe(stairs);
    expect(context.performInteraction).toHaveBeenCalledWith(stairs);
  });
});
