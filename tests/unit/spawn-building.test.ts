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
  it("defines one human-scale floor with a hinged door and real glass", () => {
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
    const glass: THREE.Mesh[] = [];
    runtime.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      meshNames.push(object.name);
      if (object.userData.glass) glass.push(object);
    });
    expect(glass).toHaveLength(3);
    for (const pane of glass) {
      expect(pane.material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
      const material = pane.material as THREE.MeshPhysicalMaterial;
      expect(material.transparent).toBe(true);
      expect(material.opacity).toBeGreaterThan(0);
      expect(material.opacity).toBeLessThan(1);
      expect(material.transmission).toBeGreaterThan(0.5);
      expect(material.depthWrite).toBe(false);
      expect(pane.castShadow).toBe(false);
    }
    expect(meshNames).toContain(`authored-door:${SPAWN_BUILDING.doorId}:leaf`);
    expect(meshNames).toContain("spawn-building:roof");
    expect(meshNames.length).toBeLessThan(30);
    expect(runtime.doors).toHaveLength(1);
    expect(runtime.doors[0].isOpen).toBe(false);
    expect(runtime.doors[0].pivot.rotation.y).toBeCloseTo(0);
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

  it("atomically opens the doorway while every wall and door leaf remain solid", () => {
    const runtime = createSpawnBuilding("performance");
    expect(runtime.colliders).toHaveLength(6);
    expect(new Set(runtime.colliders.map((collider) => collider.id)).size).toBe(6);
    expect(runtime.colliders.filter((collider) =>
      collider.id.startsWith(`spawn-building:${SPAWN_BUILDING.id}:wall:`),
    )).toHaveLength(5);
    const interior = { x: SPAWN_BUILDING.x, z: SPAWN_BUILDING.z };
    const doorway = {
      x: SPAWN_BUILDING.x,
      z: SPAWN_BUILDING.z + SPAWN_BUILDING.depth * 0.5,
    };
    const outside = { x: doorway.x, z: doorway.z + 2 };
    expect(isPlanarPositionClear(interior, runtime.colliders, PLAYER_RADIUS)).toBe(true);
    expect(isPlanarPositionClear(doorway, runtime.colliders, PLAYER_RADIUS)).toBe(false);
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
    const blocked = resolvePlanarMovement(
      outside,
      interior,
      runtime.colliders,
      PLAYER_RADIUS,
    );
    expect(blocked.z).toBeGreaterThan(doorway.z);

    const door = runtime.doors[0];
    const colliderId = door.collider.id;
    for (let toggle = 0; toggle < 100; toggle += 1) {
      door.setOpen(toggle % 2 === 0);
      expect(door.collider.id).toBe(colliderId);
    }
    door.setOpen(true);
    expect(door.isOpen).toBe(true);
    expect(door.pivot.rotation.y).toBeCloseTo(Math.PI * 0.5);
    expect(door.collider.id).toBe(colliderId);
    expect(isPlanarPositionClear(doorway, runtime.colliders, PLAYER_RADIUS)).toBe(true);
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
    expect(world.doorsSnapshot).toEqual([
      { id: SPAWN_BUILDING.doorId, open: false },
      { id: "spawn-survey-house-02:front", open: false },
    ]);
    expect(world.targets.filter((target) => target.kind === "door")).toHaveLength(2);
    expect(world.sampleGroundHeight(SPAWN_BUILDING.x, SPAWN_BUILDING.z))
      .toBeCloseTo(SPAWN_BUILDING.floorY);
    expect(isPlanarPositionClear({ x: 0, z: 8 }, world.colliders, PLAYER_RADIUS))
      .toBe(true);

    expect(world.toggleDoor(
      SPAWN_BUILDING.doorId,
      { x: 0, y: SPAWN_BUILDING.floorY, z: 8 },
      PLAYER_RADIUS,
    )).toBe("opened");
    expect(world.doorsSnapshot.find((door) => door.id === SPAWN_BUILDING.doorId)?.open)
      .toBe(true);
    expect(world.toggleDoor(
      SPAWN_BUILDING.doorId,
      {
        x: SPAWN_BUILDING.x,
        y: SPAWN_BUILDING.floorY,
        z: SPAWN_BUILDING.z + SPAWN_BUILDING.depth * 0.5,
      },
      PLAYER_RADIUS,
    )).toBe("blocked");
    expect(world.toggleDoor(
      SPAWN_BUILDING.doorId,
      { x: 0, y: SPAWN_BUILDING.floorY, z: 8 },
      PLAYER_RADIUS,
    )).toBe("closed");
    expect(world.doorsSnapshot.find((door) => door.id === SPAWN_BUILDING.doorId)?.open)
      .toBe(false);
    expect(world.targets.find((target) => target.id === SPAWN_BUILDING.doorId)?.open)
      .toBe(false);
    expect(world.toggleDoor(
      SPAWN_BUILDING.doorId,
      { x: 0, y: SPAWN_BUILDING.floorY, z: 8 },
      PLAYER_RADIUS,
    )).toBe("opened");

    expect(world.toggleDoor(
      "spawn-survey-house-02:front",
      { x: 0, y: SPAWN_BUILDING.floorY, z: 8 },
      PLAYER_RADIUS,
    )).toBe("opened");
    expect(world.targets.find((target) => target.id === "spawn-survey-house-02:front")?.open)
      .toBe(true);
    expect(world.toggleDoor(
      "spawn-survey-house-02:front",
      { x: 0, y: SPAWN_BUILDING.floorY, z: 8 },
      PLAYER_RADIUS,
    )).toBe("closed");

    world.update(1_200, 1_200);
    expect(scene.getObjectsByProperty("name", `spawn-building:${SPAWN_BUILDING.id}`))
      .toHaveLength(0);
    world.update(0, 8);
    expect(scene.getObjectsByProperty("name", `spawn-building:${SPAWN_BUILDING.id}`))
      .toHaveLength(1);
    expect(world.doorsSnapshot.find((door) => door.id === SPAWN_BUILDING.doorId)?.open)
      .toBe(true);
    world.dispose();
  });
});
