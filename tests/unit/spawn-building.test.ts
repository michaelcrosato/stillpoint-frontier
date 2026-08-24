import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  GRAVITY,
  JUMP_SPEED,
  MAX_STEP_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  WORLD_RESIDENT_CHUNKS,
} from "../../lib/game/config";
import {
  colliderIntersectsVerticalRange,
  isPlanarPositionClear,
  resolvePlanarMovement,
} from "../../lib/game/systems/collision";
import { stepVertical } from "../../lib/game/systems/locomotion";
import { ChunkManager } from "../../lib/game/world/ChunkManager";
import {
  SPAWN_BUILDING,
  createSpawnBuilding,
  spawnBuildingSupportCandidates,
  spawnBuildingSupportHeight,
} from "../../lib/game/world/spawnBuilding";
import { sampleTerrainHeight } from "../../lib/game/world/terrain";
import { TEN_STORY_BUILDING } from "../../lib/game/world/tenStoryBuilding";
import {
  TWO_STORY_BUILDING,
  selectWalkableSupport,
} from "../../lib/game/world/twoStoryBuilding";

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
    expect(SPAWN_BUILDING.roofAccess).toBe(true);
    expect(SPAWN_BUILDING.roofStairRise).toBeLessThanOrEqual(MAX_STEP_HEIGHT);
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
    expect(runtime.root.userData).toMatchObject({
      enterable: true,
      floorCount: 1,
      roofAccess: true,
    });
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
    expect(meshNames).toContain("spawn-building:roof-stair:steps");
    expect(meshNames.length).toBeLessThan(36);
    expect(runtime.doors).toHaveLength(1);
    expect(runtime.doors[0].isOpen).toBe(false);
    expect(runtime.doors[0].pivot.rotation.y).toBeCloseTo(0);
    disposeRoot(runtime.root);
  });

  it("selects the floor, quantized roof stair, and split roof without snapping", () => {
    const centerSupports = spawnBuildingSupportCandidates(
      SPAWN_BUILDING.x,
      SPAWN_BUILDING.z,
    );
    expect(centerSupports).toEqual([
      SPAWN_BUILDING.floorY,
      SPAWN_BUILDING.roofY,
    ]);
    expect(selectWalkableSupport(centerSupports, SPAWN_BUILDING.floorY))
      .toBeCloseTo(SPAWN_BUILDING.floorY);
    expect(selectWalkableSupport(centerSupports, SPAWN_BUILDING.roofY))
      .toBeCloseTo(SPAWN_BUILDING.roofY);

    const stairSupports = spawnBuildingSupportCandidates(
      SPAWN_BUILDING.x + SPAWN_BUILDING.roofStairCenterX,
      SPAWN_BUILDING.z,
    );
    expect(stairSupports).toContain(SPAWN_BUILDING.floorY);
    expect(stairSupports).not.toContain(SPAWN_BUILDING.roofY);
    expect(stairSupports).toHaveLength(2);
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

  it("provides a grounded, collision-clear twenty-step route up and down", () => {
    const definition = SPAWN_BUILDING;
    const runtime = createSpawnBuilding("performance", true);
    let vertical = { y: definition.floorY, velocity: 0, grounded: true };
    const groundColliders = runtime.colliders.filter((collider) =>
      colliderIntersectsVerticalRange(
        collider,
        definition.floorY,
        definition.floorY + PLAYER_HEIGHT,
      ),
    );
    const roomCenter = { x: definition.x, z: definition.z };
    const stairEntrance = {
      x: definition.x,
      z:
        definition.z +
        definition.roofStairStartZ -
        definition.roofStairTread * 0.5,
    };
    const firstStep = {
      x: definition.x + definition.roofStairCenterX,
      z: stairEntrance.z,
    };
    expect(resolvePlanarMovement(
      roomCenter,
      stairEntrance,
      groundColliders,
      PLAYER_RADIUS,
    )).toEqual(stairEntrance);
    expect(resolvePlanarMovement(
      stairEntrance,
      firstStep,
      groundColliders,
      PLAYER_RADIUS,
    )).toEqual(firstStep);
    let previous: { x: number; z: number } = stairEntrance;

    for (let step = 0; step < definition.roofStairSteps; step += 1) {
      const point = {
        x: definition.x + definition.roofStairCenterX,
        z:
          definition.z +
          definition.roofStairStartZ -
          (step + 0.5) * definition.roofStairTread,
      };
      const support = selectWalkableSupport(
        spawnBuildingSupportCandidates(point.x, point.z),
        vertical.y,
      );
      expect(support).not.toBeNull();
      expect((support ?? vertical.y) - vertical.y).toBeGreaterThan(0);
      expect((support ?? vertical.y) - vertical.y).toBeLessThanOrEqual(
        MAX_STEP_HEIGHT,
      );
      const colliders = runtime.colliders.filter((collider) =>
        colliderIntersectsVerticalRange(
          collider,
          vertical.y,
          vertical.y + PLAYER_HEIGHT,
        ),
      );
      expect(resolvePlanarMovement(previous, point, colliders, PLAYER_RADIUS))
        .toEqual(point);
      vertical = stepVertical(
        vertical.y,
        vertical.velocity,
        support ?? vertical.y,
        1 / 60,
        vertical.grounded,
        MAX_STEP_HEIGHT,
      );
      expect(vertical.grounded).toBe(true);
      previous = point;
    }
    expect(vertical.y).toBeCloseTo(definition.roofY);

    const roofLanding = {
      x: definition.x + definition.roofStairCenterX,
      z: definition.z + definition.roofStairEndZ - 0.35,
    };
    expect(selectWalkableSupport(
      spawnBuildingSupportCandidates(roofLanding.x, roofLanding.z),
      vertical.y,
    )).toBeCloseTo(definition.roofY);

    for (let step = definition.roofStairSteps - 1; step >= 0; step -= 1) {
      const point = {
        x: definition.x + definition.roofStairCenterX,
        z:
          definition.z +
          definition.roofStairStartZ -
          (step + 0.5) * definition.roofStairTread,
      };
      const support = selectWalkableSupport(
        spawnBuildingSupportCandidates(point.x, point.z),
        vertical.y,
      );
      vertical = stepVertical(
        vertical.y,
        vertical.velocity,
        support ?? vertical.y,
        1 / 60,
        vertical.grounded,
        MAX_STEP_HEIGHT,
      );
      expect(vertical.grounded).toBe(true);
    }
    const floorLanding = {
      x: definition.x + definition.roofStairCenterX,
      z: definition.z + definition.roofStairStartZ + 0.15,
    };
    const floorSupport = selectWalkableSupport(
      spawnBuildingSupportCandidates(floorLanding.x, floorLanding.z),
      vertical.y,
    );
    vertical = stepVertical(
      vertical.y,
      vertical.velocity,
      floorSupport ?? vertical.y,
      1 / 60,
      vertical.grounded,
      MAX_STEP_HEIGHT,
    );
    expect(vertical).toEqual({
      y: definition.floorY,
      velocity: 0,
      grounded: true,
    });
    disposeRoot(runtime.root);
  });

  it("atomically opens the doorway while every wall and door leaf remain solid", () => {
    const runtime = createSpawnBuilding("performance");
    expect(new Set(runtime.colliders.map((collider) => collider.id)).size)
      .toBe(runtime.colliders.length);
    expect(runtime.colliders.filter((collider) =>
      collider.id.startsWith(`spawn-building:${SPAWN_BUILDING.id}:wall:`),
    )).toHaveLength(6);
    const interior = { x: SPAWN_BUILDING.x, z: SPAWN_BUILDING.z };
    const doorway = {
      x: SPAWN_BUILDING.x,
      z: SPAWN_BUILDING.z + SPAWN_BUILDING.depth * 0.5,
    };
    const outside = { x: doorway.x, z: doorway.z + 2 };
    const groundColliders = runtime.colliders.filter((collider) =>
      colliderIntersectsVerticalRange(
        collider,
        SPAWN_BUILDING.floorY,
        SPAWN_BUILDING.floorY + PLAYER_HEIGHT,
      ),
    );
    expect(isPlanarPositionClear(interior, groundColliders, PLAYER_RADIUS)).toBe(true);
    expect(isPlanarPositionClear(doorway, groundColliders, PLAYER_RADIUS)).toBe(false);
    for (const authoredOpening of [
      { x: 0, z: 8 },
      { x: 2.3, z: 5.4 },
      { x: 4.2, z: 0.8 },
      { x: -3.2, z: -0.4 },
    ]) {
      expect(isPlanarPositionClear(
        authoredOpening,
        groundColliders,
        PLAYER_RADIUS,
      )).toBe(true);
    }
    const blocked = resolvePlanarMovement(
      outside,
      interior,
      groundColliders,
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
    expect(isPlanarPositionClear(doorway, groundColliders, PLAYER_RADIUS)).toBe(true);
    const entered = resolvePlanarMovement(
      outside,
      interior,
      groundColliders,
      PLAYER_RADIUS,
    );
    expect(entered.x).toBeCloseTo(interior.x, 4);
    expect(entered.z).toBeCloseTo(interior.z, 4);

    const throughRightWall = resolvePlanarMovement(
      interior,
      { x: SPAWN_BUILDING.x + SPAWN_BUILDING.width, z: SPAWN_BUILDING.z },
      groundColliders,
      PLAYER_RADIUS,
    );
    expect(throughRightWall.x).toBeLessThan(
      SPAWN_BUILDING.x + SPAWN_BUILDING.width * 0.5,
    );
    expect(isPlanarPositionClear(
      throughRightWall,
      groundColliders,
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

  it("bounds the roof with parapets while leaving the active stair exit open", () => {
    const definition = SPAWN_BUILDING;
    const runtime = createSpawnBuilding("performance", true);
    const roofColliders = runtime.colliders.filter((collider) =>
      colliderIntersectsVerticalRange(
        collider,
        definition.roofY,
        definition.roofY + PLAYER_HEIGHT,
      ),
    );
    const center = { x: definition.x, z: definition.z };
    for (const desired of [
      { x: definition.x - definition.width, z: definition.z },
      { x: definition.x + definition.width, z: definition.z },
      { x: definition.x, z: definition.z - definition.depth },
      { x: definition.x, z: definition.z + definition.depth },
    ]) {
      const resolved = resolvePlanarMovement(
        center,
        desired,
        roofColliders,
        PLAYER_RADIUS,
      );
      expect(Math.hypot(resolved.x - desired.x, resolved.z - desired.z))
        .toBeGreaterThan(PLAYER_RADIUS);
    }

    const landing = {
      x: definition.x + definition.roofStairCenterX,
      z: definition.z + definition.roofStairEndZ - 0.25,
    };
    const topStep = {
      x: definition.x + definition.roofStairCenterX,
      z: definition.z + definition.roofStairEndZ + 0.12,
    };
    expect(resolvePlanarMovement(
      landing,
      topStep,
      roofColliders,
      PLAYER_RADIUS,
    )).toEqual(topStep);
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
    )).toHaveLength(6);
    expect(world.doorsSnapshot).toEqual([
      { id: SPAWN_BUILDING.doorId, open: false },
      { id: TWO_STORY_BUILDING.doorId, open: false },
      { id: TEN_STORY_BUILDING.doorId, open: false },
    ]);
    expect(world.targets.filter((target) => target.kind === "door")).toHaveLength(3);
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
      TWO_STORY_BUILDING.doorId,
      { x: 0, y: SPAWN_BUILDING.floorY, z: 8 },
      PLAYER_RADIUS,
    )).toBe("opened");
    expect(world.targets.find((target) => target.id === TWO_STORY_BUILDING.doorId)?.open)
      .toBe(true);
    expect(world.toggleDoor(
      TWO_STORY_BUILDING.doorId,
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
