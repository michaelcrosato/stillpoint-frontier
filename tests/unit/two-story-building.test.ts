import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  MAX_STEP_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
} from "../../lib/game/config";
import {
  colliderIntersectsVerticalRange,
  isPlanarPositionClear,
  resolvePlanarMovement,
} from "../../lib/game/systems/collision";
import { stepVertical } from "../../lib/game/systems/locomotion";
import { SPAWN_BUILDING } from "../../lib/game/world/spawnBuilding";
import {
  TWO_STORY_BUILDING,
  createTwoStoryBuilding,
  selectWalkableSupport,
  twoStorySupportCandidates,
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

function localToWorld(localX: number, localZ: number) {
  const cosine = Math.cos(TWO_STORY_BUILDING.rotation);
  const sine = Math.sin(TWO_STORY_BUILDING.rotation);
  return {
    x: TWO_STORY_BUILDING.x + cosine * localX + sine * localZ,
    z: TWO_STORY_BUILDING.z - sine * localX + cosine * localZ,
  };
}

describe("authored two-story building", () => {
  it("is nearby, non-overlapping, human scale, and visibly two stories", () => {
    const definition = TWO_STORY_BUILDING;
    expect(definition.floorCount).toBe(2);
    expect(definition.hasBasement).toBe(false);
    expect(definition.roofAccess).toBe(false);
    expect(definition.storyHeight).toBeGreaterThan(PLAYER_HEIGHT + 1.5);
    expect(definition.storyHeight).toBeLessThan(4.2);
    expect(definition.stairWidth).toBeGreaterThan(PLAYER_RADIUS * 2 + 0.4);
    expect(definition.stairRise).toBeLessThanOrEqual(MAX_STEP_HEIGHT);
    expect(Math.hypot(definition.x, definition.z - 8)).toBeLessThan(25);
    expect(Math.hypot(
      definition.x - SPAWN_BUILDING.x,
      definition.z - SPAWN_BUILDING.z,
    )).toBeGreaterThan(
      definition.clearanceRadius + SPAWN_BUILDING.clearanceRadius,
    );

    const runtime = createTwoStoryBuilding("performance");
    const meshes: THREE.Mesh[] = [];
    runtime.root.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes.push(object);
    });
    expect(runtime.root.userData).toMatchObject({ enterable: true, floorCount: 2 });
    expect(meshes.filter((mesh) => mesh.userData.glass)).toHaveLength(6);
    expect(meshes.filter((mesh) => mesh.name.includes(":stair:")).length)
      .toBeGreaterThanOrEqual(definition.stairSteps);
    expect(meshes.length).toBeLessThan(90);
    for (const pane of meshes.filter((mesh) => mesh.userData.glass)) {
      expect(pane.material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
      const material = pane.material as THREE.MeshPhysicalMaterial;
      expect(material.transparent).toBe(true);
      expect(material.transmission).toBeGreaterThan(0.5);
      expect(material.opacity).toBeGreaterThan(0);
      expect(material.opacity).toBeLessThan(1);
      expect(material.depthWrite).toBe(false);
    }
    disposeRoot(runtime.root);
  });

  it("selects the correct stacked floor without snapping ground-floor players up", () => {
    const definition = TWO_STORY_BUILDING;
    const centerSupports = twoStorySupportCandidates(definition.x, definition.z);
    expect(centerSupports).toEqual([definition.floorY, definition.upperFloorY]);
    expect(selectWalkableSupport(centerSupports)).toBeCloseTo(definition.floorY);
    expect(selectWalkableSupport(centerSupports, definition.floorY))
      .toBeCloseTo(definition.floorY);
    expect(selectWalkableSupport(centerSupports, definition.upperFloorY))
      .toBeCloseTo(definition.upperFloorY);

    const stairwell = localToWorld(definition.stairCenterX, 0);
    const stairwellSupports = twoStorySupportCandidates(stairwell.x, stairwell.z);
    expect(stairwellSupports).toContain(definition.floorY);
    expect(stairwellSupports).not.toContain(definition.upperFloorY);
    expect(twoStorySupportCandidates(definition.x + 20, definition.z + 20)).toEqual([]);
  });

  it("provides a monotonic twenty-step path to the exact upper floor", () => {
    const definition = TWO_STORY_BUILDING;
    const runtime = createTwoStoryBuilding("performance", true);
    let vertical = { y: definition.floorY, velocity: 0, grounded: true };
    let previousPoint = localToWorld(
      definition.stairCenterX,
      definition.stairStartZ + 0.3,
    );
    for (let index = 0; index < definition.stairSteps; index += 1) {
      const localZ =
        definition.stairStartZ - (index + 0.5) * definition.stairTread;
      const point = localToWorld(definition.stairCenterX, localZ);
      const selected = selectWalkableSupport(
        twoStorySupportCandidates(point.x, point.z),
        vertical.y,
      );
      expect(selected).not.toBeNull();
      expect((selected ?? vertical.y) - vertical.y).toBeGreaterThan(0);
      expect((selected ?? vertical.y) - vertical.y).toBeLessThanOrEqual(MAX_STEP_HEIGHT);
      const movementColliders = runtime.colliders.filter((collider) =>
        colliderIntersectsVerticalRange(
          collider,
          vertical.y,
          vertical.y + PLAYER_HEIGHT,
        ),
      );
      expect(resolvePlanarMovement(
        previousPoint,
        point,
        movementColliders,
        PLAYER_RADIUS,
      )).toEqual(point);
      vertical = stepVertical(
        vertical.y,
        vertical.velocity,
        selected ?? vertical.y,
        1 / 60,
        vertical.grounded,
        MAX_STEP_HEIGHT,
      );
      expect(vertical.grounded).toBe(true);
      previousPoint = point;
    }
    expect(vertical.y).toBeCloseTo(definition.upperFloorY);

    const landing = localToWorld(
      definition.stairCenterX,
      (definition.stairEndZ + definition.stairTopLandingEndZ) * 0.5,
    );
    expect(selectWalkableSupport(
      twoStorySupportCandidates(landing.x, landing.z),
      vertical.y,
    )).toBeCloseTo(definition.upperFloorY);

    for (let index = definition.stairSteps - 1; index >= 0; index -= 1) {
      const localZ =
        definition.stairStartZ - (index + 0.5) * definition.stairTread;
      const point = localToWorld(definition.stairCenterX, localZ);
      const selected = selectWalkableSupport(
        twoStorySupportCandidates(point.x, point.z),
        vertical.y,
      );
      vertical = stepVertical(
        vertical.y,
        vertical.velocity,
        selected ?? vertical.y,
        1 / 60,
        vertical.grounded,
        MAX_STEP_HEIGHT,
      );
      expect(vertical.grounded).toBe(true);
    }
    const bottom = localToWorld(
      definition.stairCenterX,
      definition.stairStartZ + 0.35,
    );
    const bottomSupport = selectWalkableSupport(
      twoStorySupportCandidates(bottom.x, bottom.z),
      vertical.y,
    );
    vertical = stepVertical(
      vertical.y,
      vertical.velocity,
      bottomSupport ?? vertical.y,
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

  it("opens at ground level while its vertically bounded header seals floor two", () => {
    const definition = TWO_STORY_BUILDING;
    const runtime = createTwoStoryBuilding("performance");
    const door = runtime.doors[0];
    const doorway = door.targetPosition;
    const outside = localToWorld(0, definition.depth * 0.5 + 2);
    const interior = localToWorld(0, 0);
    const groundColliders = runtime.colliders.filter((collider) =>
      colliderIntersectsVerticalRange(
        collider,
        definition.floorY,
        definition.floorY + PLAYER_HEIGHT,
      ),
    );
    expect(isPlanarPositionClear(doorway, groundColliders, PLAYER_RADIUS)).toBe(false);
    door.setOpen(true);
    expect(isPlanarPositionClear(doorway, groundColliders, PLAYER_RADIUS)).toBe(true);
    const entered = resolvePlanarMovement(
      outside,
      interior,
      groundColliders,
      PLAYER_RADIUS,
    );
    expect(entered.x).toBeCloseTo(interior.x, 4);
    expect(entered.z).toBeCloseTo(interior.z, 4);

    const upperColliders = runtime.colliders.filter((collider) =>
      colliderIntersectsVerticalRange(
        collider,
        definition.upperFloorY,
        definition.upperFloorY + PLAYER_HEIGHT,
      ),
    );
    const escapedUpperFloor = resolvePlanarMovement(
      interior,
      outside,
      upperColliders,
      PLAYER_RADIUS,
    );
    expect(Math.hypot(
      escapedUpperFloor.x - doorway.x,
      escapedUpperFloor.z - doorway.z,
    )).toBeGreaterThan(PLAYER_RADIUS);

    const frontLanding = localToWorld(
      definition.stairCenterX,
      definition.stairwellMaxZ + 0.5,
    );
    const stairwellDrop = localToWorld(
      definition.stairCenterX,
      definition.stairwellMaxZ - 0.5,
    );
    const guarded = resolvePlanarMovement(
      frontLanding,
      stairwellDrop,
      upperColliders,
      PLAYER_RADIUS,
    );
    expect(Math.hypot(
      guarded.x - stairwellDrop.x,
      guarded.z - stairwellDrop.z,
    )).toBeGreaterThan(PLAYER_RADIUS);
    disposeRoot(runtime.root);
  });
});
