import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { CameraRigDiagnostics } from "../../lib/game/camera/CameraRig";
import { PlayerAvatar } from "../../lib/game/camera/PlayerAvatar";
import { PLAYER_RADIUS } from "../../lib/game/config";
import { ForestStressTest } from "../../lib/game/developer/ForestStressTest";
import { createEnvironment } from "../../lib/game/environment";
import { ShadowUpdatePolicy } from "../../lib/game/rendering/ShadowUpdatePolicy";
import { WorldMaterialLibrary } from "../../lib/game/rendering/WorldMaterialLibrary";
import { CANOPY_BENCHMARK_ZONE } from "../../lib/game/world/benchmarkZone";
import { ChunkManager } from "../../lib/game/world/ChunkManager";
import { SPAWN_BUILDING } from "../../lib/game/world/spawnBuilding";

function stubRenderer() {
  return {
    toneMappingExposure: 1,
    capabilities: { maxTextureSize: 8192, reversedDepthBuffer: true },
  } as unknown as THREE.WebGLRenderer;
}

const thirdPerson = (distance = 6.5): CameraRigDiagnostics => ({
  mode: "thirdPerson",
  targetDistance: distance,
  distance,
  collisionLimited: false,
  isometricAngleDegrees: 56,
  effectiveFov: 67,
});

describe("cached sun shadow", () => {
  it("renders the shadow map only when the shadow camera or its casters change", () => {
    const policy = new ShadowUpdatePolicy();
    const environment = createEnvironment(new THREE.Scene(), stubRenderer(), "cinematic", undefined, policy);
    const shadow = environment.sun.shadow;
    expect(shadow.autoUpdate).toBe(false);
    const position = new THREE.Vector3(10, 4, -8);

    environment.present(position, 0);
    expect(shadow.needsUpdate).toBe(true);
    shadow.needsUpdate = false; // three clears the flag once it renders the map

    environment.present(position, 0);
    expect(shadow.needsUpdate).toBe(false);

    environment.present(new THREE.Vector3(30, 4, -8), 0);
    expect(shadow.needsUpdate).toBe(true);
    shadow.needsUpdate = false;

    policy.markDirty("chunks");
    environment.present(new THREE.Vector3(30, 4, -8), 0);
    expect(shadow.needsUpdate).toBe(true);
    environment.dispose();
  });

  it("holds the cache while the sun turns slowly, far from the world origin", () => {
    // The stabilised anchor is snapped in the light's own basis, so a turning
    // sun sweeps it around the world origin by about angle x distance. That
    // sweep must not count as player movement.
    const environment = createEnvironment(new THREE.Scene(), stubRenderer(), "cinematic");
    environment.setDeveloperMode(true);
    environment.setDeveloperClockPaused(true);
    environment.setDeveloperMinuteOfDay(10 * 60);
    const position = new THREE.Vector3(2_400, 30, -1_800);
    environment.sync(position, true);
    environment.present(position, 0);
    let renders = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      environment.sun.shadow.needsUpdate = false;
      environment.advanceDeveloperMinutes(1 / 60); // one real second per game minute
      environment.sync(position, true);
      environment.present(position, 0);
      if (environment.sun.shadow.needsUpdate) renders += 1;
    }
    // 60 frames turn the sun about 0.0044 rad: several threshold crossings,
    // far fewer than one render per frame.
    expect(renders).toBeGreaterThanOrEqual(4);
    expect(renders).toBeLessThanOrEqual(12);
    environment.dispose();
  });

  it("keeps a pending render requested elsewhere until three performs it", () => {
    const policy = new ShadowUpdatePolicy();
    const environment = createEnvironment(new THREE.Scene(), stubRenderer(), "cinematic", undefined, policy);
    const position = new THREE.Vector3(10, 4, -8);
    environment.present(position, 0);
    environment.present(position, 0);
    environment.setQuality("ultra");
    environment.present(position, 0);
    expect(environment.sun.shadow.needsUpdate).toBe(true);
    environment.dispose();
  });
});

describe("shadow invalidation sources", () => {
  it("reports world changes that alter what casts into the sun's shadow", () => {
    const markDirty = vi.fn();
    const world = new ChunkManager(
      new THREE.Scene(),
      "cinematic",
      {},
      {},
      {},
      [],
      undefined,
      { markDirty },
    );
    world.update(0, 8);
    expect(markDirty).toHaveBeenCalledWith("chunks");
    markDirty.mockClear();
    world.update(0, 8.5);
    expect(markDirty).not.toHaveBeenCalled();

    world.setWorldMinutes(700);
    markDirty.mockClear();
    world.setWorldMinutes(701);
    expect(markDirty).not.toHaveBeenCalled();
    world.setWorldMinutes(1_321);
    expect(markDirty).toHaveBeenCalledWith("npc");

    markDirty.mockClear();
    expect(world.toggleDoor(
      SPAWN_BUILDING.doorId,
      { x: 0, y: SPAWN_BUILDING.floorY, z: 8 },
      PLAYER_RADIUS,
    )).toBe("opened");
    expect(markDirty).toHaveBeenCalledWith("door");

    markDirty.mockClear();
    const gatherable = world.targets.find((target) => target.hitsRequired > 0);
    expect(gatherable).toBeDefined();
    world.applyEntityDiff(gatherable!.id, { hits: 1, removed: false });
    expect(markDirty).toHaveBeenCalledWith("harvest");

    markDirty.mockClear();
    world.setPlacedEntities([{
      id: "placed:campfire:1",
      archetypeId: "campfire",
      x: 0,
      y: 1,
      z: -3,
      yaw: 0,
    }]);
    expect(markDirty).toHaveBeenCalledWith("placement");

    markDirty.mockClear();
    world.setQuality("ultra");
    expect(markDirty).toHaveBeenCalledWith("quality");
    world.dispose();
  }, 20_000);

  it("reports avatar moves, turns, and shadow changes, and nothing else", () => {
    const markDirty = vi.fn();
    const avatar = new PlayerAvatar(new THREE.Scene(), "cinematic", { markDirty });
    const position = new THREE.Vector3(4, 8, -2);
    avatar.present(position, 0.75, 1.72, thirdPerson());
    expect(markDirty).toHaveBeenCalledWith("avatar");

    markDirty.mockClear();
    avatar.present(position.clone(), 0.75, 1.72, thirdPerson());
    expect(markDirty).not.toHaveBeenCalled();

    avatar.present(position.clone().setX(4.2), 0.75, 1.72, thirdPerson());
    expect(markDirty).toHaveBeenCalledTimes(1);
    avatar.present(position.clone().setX(4.2), 1.1, 1.72, thirdPerson());
    expect(markDirty).toHaveBeenCalledTimes(2);
    avatar.present(position.clone().setX(4.2), 1.1, 1.2, thirdPerson());
    expect(markDirty).toHaveBeenCalledTimes(3);
    // Fading for a close camera stops the avatar casting.
    avatar.present(position.clone().setX(4.2), 1.1, 1.2, thirdPerson(1.2));
    expect(markDirty).toHaveBeenCalledTimes(4);
    avatar.dispose();
  });

  it("reports the developer canopy zone streaming in and out", () => {
    const markDirty = vi.fn();
    const materials = new WorldMaterialLibrary();
    const forest = new ForestStressTest(new THREE.Scene(), "cinematic", materials, { markDirty });
    const { center } = CANOPY_BENCHMARK_ZONE;
    expect(forest.update(center.x, center.z)).toBe(true);
    expect(markDirty).toHaveBeenCalledWith("forest");
    markDirty.mockClear();
    expect(forest.update(0, 0)).toBe(false);
    expect(markDirty).toHaveBeenCalledWith("forest");
    forest.dispose();
    materials.dispose();
  });
});
