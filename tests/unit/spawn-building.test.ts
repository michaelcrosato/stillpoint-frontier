import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  GRAVITY,
  JUMP_SPEED,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  WORLD_RESIDENT_CHUNKS,
} from "../../lib/game/config";
import {
  isPlanarPositionClear,
  resolvePlanarMovement,
} from "../../lib/game/systems/collision";
import { ChunkManager } from "../../lib/game/world/ChunkManager";
import {
  SPAWN_BUILDING,
  createSpawnBuilding,
  spawnBuildingSupportHeight,
} from "../../lib/game/world/spawnBuilding";
import { sampleTerrainHeight } from "../../lib/game/world/terrain";

function disposeRoot(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    materials.forEach((material) => material.dispose());
  });
}

describe("single spawn building prototype", () => {
  it("defines one human-scale floor with an open door and real windows", () => {
    expect(SPAWN_BUILDING.id).toBe("spawn-field-unit-01");
    expect(SPAWN_BUILDING.chunkKey).toBe("0:0");
    expect(SPAWN_BUILDING.floorCount).toBe(1);
    expect(SPAWN_BUILDING.hasBasement).toBe(false);
    expect(SPAWN_BUILDING.roofAccess).toBe(false);
    expect(SPAWN_BUILDING.wallHeight).toBeGreaterThan(PLAYER_HEIGHT);
    expect(SPAWN_BUILDING.wallHeight).toBeLessThan(4.2);
    expect(SPAWN_BUILDING.doorWidth).toBeGreaterThan(PLAYER_RADIUS * 2 + 0.3);
    expect(SPAWN_BUILDING.doorHeight).toBeGreaterThan(PLAYER_HEIGHT);
    const maximumJumpEyeHeight =
      PLAYER_HEIGHT + (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);
    expect(SPAWN_BUILDING.doorHeight).toBeGreaterThan(
      maximumJumpEyeHeight + 0.1,
    );
    expect(Math.hypot(SPAWN_BUILDING.x, SPAWN_BUILDING.z - 8)).toBeGreaterThan(10);
    const runtime = createSpawnBuilding("performance");
    expect(runtime.root.userData).toMatchObject({ enterable: true, floorCount: 1 });
    const meshNames: string[] = [];
    runtime.root.traverse((object) => {
      if (object instanceof THREE.Mesh) meshNames.push(object.name);
    });
    expect(meshNames.filter((name) => name.includes(":window:"))).toHaveLength(3);
    expect(meshNames).toContain("spawn-building:door:open-leaf");
    expect(meshNames).toContain("spawn-building:roof");
    expect(meshNames.length).toBeLessThan(30);
    disposeRoot(runtime.root);
  });

  it("supports the flat floor only inside the room and doorway threshold", () => {
    expect(spawnBuildingSupportHeight(SPAWN_BUILDING.x, SPAWN_BUILDING.z))
      .toBeCloseTo(SPAWN_BUILDING.floorY);
    expect(spawnBuildingSupportHeight(
      SPAWN_BUILDING.x,
      SPAWN_BUILDING.z + SPAWN_BUILDING.depth * 0.5 + 0.3,
    )).toBeCloseTo(SPAWN_BUILDING.floorY);
    expect(spawnBuildingSupportHeight(0, 8)).toBeNull();
    expect(spawnBuildingSupportHeight(Number.NaN, 0)).toBeNull();
    expect(SPAWN_BUILDING.floorY).toBeGreaterThan(
      sampleTerrainHeight(SPAWN_BUILDING.x, SPAWN_BUILDING.z),
    );
  });

  it("allows entry through the doorway while every wall remains solid", () => {
    const runtime = createSpawnBuilding("performance");
    expect(runtime.colliders).toHaveLength(5);
    expect(new Set(runtime.colliders.map((collider) => collider.id)).size).toBe(5);
    const interior = { x: SPAWN_BUILDING.x, z: SPAWN_BUILDING.z };
    const doorway = {
      x: SPAWN_BUILDING.x,
      z: SPAWN_BUILDING.z + SPAWN_BUILDING.depth * 0.5,
    };
    const outside = { x: doorway.x, z: doorway.z + 2 };
    expect(isPlanarPositionClear(interior, runtime.colliders, PLAYER_RADIUS)).toBe(true);
    expect(isPlanarPositionClear(doorway, runtime.colliders, PLAYER_RADIUS)).toBe(true);
    for (const authoredOpening of [
      { x: 0, z: 8 },
      { x: 2.3, z: 5.4 },
      { x: 4.2, z: 0.8 },
      { x: -3.2, z: -0.4 },
    ]) {
      expect(isPlanarPositionClear(
        authoredOpening,
        runtime.colliders,
        PLAYER_RADIUS,
      )).toBe(true);
    }
    const entered = resolvePlanarMovement(
      outside,
      interior,
      runtime.colliders,
      PLAYER_RADIUS,
    );
    expect(entered.x).toBeCloseTo(interior.x, 4);
    expect(entered.z).toBeCloseTo(interior.z, 4);

    const throughRightWall = resolvePlanarMovement(
      interior,
      { x: SPAWN_BUILDING.x + SPAWN_BUILDING.width, z: SPAWN_BUILDING.z },
      runtime.colliders,
      PLAYER_RADIUS,
    );
    expect(throughRightWall.x).toBeLessThan(
      SPAWN_BUILDING.x + SPAWN_BUILDING.width * 0.5,
    );
    expect(isPlanarPositionClear(
      throughRightWall,
      runtime.colliders,
      PLAYER_RADIUS,
    )).toBe(true);

    const throughBackWall = resolvePlanarMovement(
      interior,
      { x: SPAWN_BUILDING.x, z: SPAWN_BUILDING.z - SPAWN_BUILDING.depth },
      runtime.colliders,
      PLAYER_RADIUS,
    );
    expect(throughBackWall.z).toBeGreaterThan(
      SPAWN_BUILDING.z - SPAWN_BUILDING.depth * 0.5,
    );
    disposeRoot(runtime.root);
  });

  it("streams exactly one deterministic prototype with the origin chunk", () => {
    const scene = new THREE.Scene();
    const world = new ChunkManager(scene, "performance");
    world.update(0, 8);
    expect(world.loadedCount).toBe(WORLD_RESIDENT_CHUNKS);
    expect(scene.getObjectsByProperty("name", `spawn-building:${SPAWN_BUILDING.id}`))
      .toHaveLength(1);
    expect(world.colliders.filter((collider) =>
      collider.id.startsWith(`spawn-building:${SPAWN_BUILDING.id}:wall:`),
    )).toHaveLength(5);
    expect(world.sampleGroundHeight(SPAWN_BUILDING.x, SPAWN_BUILDING.z))
      .toBeCloseTo(SPAWN_BUILDING.floorY);
    expect(isPlanarPositionClear({ x: 0, z: 8 }, world.colliders, PLAYER_RADIUS))
      .toBe(true);

    world.update(1_200, 1_200);
    expect(scene.getObjectsByProperty("name", `spawn-building:${SPAWN_BUILDING.id}`))
      .toHaveLength(0);
    world.update(0, 8);
    expect(scene.getObjectsByProperty("name", `spawn-building:${SPAWN_BUILDING.id}`))
      .toHaveLength(1);
    world.dispose();
  });
});
