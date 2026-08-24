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
  type TwoStoryBuildingRuntime,
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

function collidersAt(
  runtime: TwoStoryBuildingRuntime,
  floorY: number,
) {
  return runtime.colliders.filter((collider) =>
    colliderIntersectsVerticalRange(
      collider,
      floorY,
      floorY + PLAYER_HEIGHT,
    ),
  );
}

describe("authored two-story building", () => {
  it("is nearby, non-overlapping, human scale, and visibly two stories", () => {
    const definition = TWO_STORY_BUILDING;
    expect(definition.floorCount).toBe(2);
    expect(definition.hasBasement).toBe(false);
    expect(definition.roofAccess).toBe(true);
    expect(definition.roofY).toBeCloseTo(
      definition.floorY + definition.wallHeight + definition.roofThickness,
    );
    expect(definition.stairFlights).toHaveLength(2);
    expect(definition.storyHeight).toBeGreaterThan(PLAYER_HEIGHT + 1.5);
    expect(definition.storyHeight).toBeLessThan(4.2);
    expect(definition.stairWidth).toBeGreaterThan(PLAYER_RADIUS * 2 + 0.4);
    expect(definition.stairRise).toBeLessThanOrEqual(MAX_STEP_HEIGHT);
    expect(definition.roofStairRise).toBeLessThanOrEqual(MAX_STEP_HEIGHT);
    for (const flight of definition.stairFlights) {
      expect(flight.rise).toBeGreaterThan(0);
      expect(flight.rise).toBeLessThanOrEqual(MAX_STEP_HEIGHT);
      expect(flight.tread).toBeGreaterThanOrEqual(0.27);
    }
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
    expect(runtime.root.userData).toMatchObject({
      enterable: true,
      floorCount: 2,
      roofAccess: true,
      roofY: definition.roofY,
    });
    expect(meshes.filter((mesh) => mesh.userData.glass)).toHaveLength(6);
    expect(meshes.filter((mesh) => mesh.name.includes(":stair:")).length)
      .toBeGreaterThanOrEqual(definition.stairSteps * 2);
    expect(meshes.filter((mesh) => mesh.name.includes(":roof:"))).toHaveLength(4);
    expect(meshes.filter((mesh) => mesh.name.includes(":roof-guard:")))
      .toHaveLength(7);
    expect(meshes.length).toBeLessThan(130);
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

  it("selects both floors and the roof without snapping lower players upward", () => {
    const definition = TWO_STORY_BUILDING;
    const centerSupports = twoStorySupportCandidates(definition.x, definition.z);
    expect(centerSupports).toEqual([
      definition.floorY,
      definition.upperFloorY,
      definition.roofY,
    ]);
    expect(selectWalkableSupport(centerSupports)).toBeCloseTo(definition.floorY);
    expect(selectWalkableSupport(centerSupports, definition.floorY))
      .toBeCloseTo(definition.floorY);
    expect(selectWalkableSupport(centerSupports, definition.upperFloorY))
      .toBeCloseTo(definition.upperFloorY);
    expect(selectWalkableSupport(centerSupports, definition.roofY))
      .toBeCloseTo(definition.roofY);

    const stairwell = localToWorld(definition.stairCenterX, 0);
    const stairwellSupports = twoStorySupportCandidates(stairwell.x, stairwell.z);
    expect(stairwellSupports).toContain(definition.floorY);
    expect(stairwellSupports).not.toContain(definition.upperFloorY);
    expect(stairwellSupports).toContain(definition.roofY);

    const roofStairwell = localToWorld(definition.roofStairCenterX, 0);
    const roofStairwellSupports = twoStorySupportCandidates(
      roofStairwell.x,
      roofStairwell.z,
    );
    expect(roofStairwellSupports).not.toContain(definition.upperFloorY);
    expect(roofStairwellSupports).not.toContain(definition.roofY);
    expect(twoStorySupportCandidates(definition.x + 20, definition.z + 20)).toEqual([]);
  });

  it("provides a collision-clear forty-step route from ground to roof and back", () => {
    const definition = TWO_STORY_BUILDING;
    const runtime = createTwoStoryBuilding("performance", true);
    let vertical = { y: definition.floorY, velocity: 0, grounded: true };
    const firstFlight = definition.stairFlights[0];
    const firstDirection = Math.sign(firstFlight.endZ - firstFlight.startZ);
    let previousPoint = localToWorld(
      firstFlight.centerX,
      firstFlight.startZ - firstDirection * 0.55,
    );
    for (const flight of definition.stairFlights) {
      expect(vertical.y).toBeCloseTo(flight.startY);
      const direction = Math.sign(flight.endZ - flight.startZ);
      const startLanding = localToWorld(
        flight.centerX,
        flight.startZ - direction * 0.55,
      );
      expect(resolvePlanarMovement(
        previousPoint,
        startLanding,
        collidersAt(runtime, vertical.y),
        PLAYER_RADIUS,
      )).toEqual(startLanding);
      previousPoint = startLanding;

      for (let index = 0; index < flight.steps; index += 1) {
        const localZ = flight.startZ + direction * (index + 0.5) * flight.tread;
        const point = localToWorld(flight.centerX, localZ);
        const selected = selectWalkableSupport(
          twoStorySupportCandidates(point.x, point.z),
          vertical.y,
        );
        expect(selected).not.toBeNull();
        expect((selected ?? vertical.y) - vertical.y).toBeGreaterThan(0);
        expect((selected ?? vertical.y) - vertical.y)
          .toBeLessThanOrEqual(MAX_STEP_HEIGHT);
        expect(resolvePlanarMovement(
          previousPoint,
          point,
          collidersAt(runtime, vertical.y),
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
      expect(vertical.y).toBeCloseTo(flight.endY);

      const endLanding = localToWorld(
        flight.centerX,
        flight.endZ + direction * 0.55,
      );
      expect(selectWalkableSupport(
        twoStorySupportCandidates(endLanding.x, endLanding.z),
        vertical.y,
      )).toBeCloseTo(flight.endY);
      expect(resolvePlanarMovement(
        previousPoint,
        endLanding,
        collidersAt(runtime, vertical.y),
        PLAYER_RADIUS,
      )).toEqual(endLanding);
      previousPoint = endLanding;
    }
    expect(vertical.y).toBeCloseTo(definition.roofY);

    for (let flightIndex = definition.stairFlights.length - 1;
      flightIndex >= 0;
      flightIndex -= 1) {
      const flight = definition.stairFlights[flightIndex];
      const direction = Math.sign(flight.endZ - flight.startZ);
      const endLanding = localToWorld(
        flight.centerX,
        flight.endZ + direction * 0.55,
      );
      expect(resolvePlanarMovement(
        previousPoint,
        endLanding,
        collidersAt(runtime, vertical.y),
        PLAYER_RADIUS,
      )).toEqual(endLanding);
      previousPoint = endLanding;

      for (let index = flight.steps - 1; index >= 0; index -= 1) {
        const localZ = flight.startZ + direction * (index + 0.5) * flight.tread;
        const point = localToWorld(flight.centerX, localZ);
        const selected = selectWalkableSupport(
          twoStorySupportCandidates(point.x, point.z),
          vertical.y,
        );
        expect(selected).not.toBeNull();
        expect(vertical.y - (selected ?? vertical.y)).toBeGreaterThanOrEqual(0);
        expect(vertical.y - (selected ?? vertical.y))
          .toBeLessThanOrEqual(MAX_STEP_HEIGHT);
        expect(resolvePlanarMovement(
          previousPoint,
          point,
          collidersAt(runtime, vertical.y),
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

      const startLanding = localToWorld(
        flight.centerX,
        flight.startZ - direction * 0.55,
      );
      const landingSupport = selectWalkableSupport(
        twoStorySupportCandidates(startLanding.x, startLanding.z),
        vertical.y,
      );
      vertical = stepVertical(
        vertical.y,
        vertical.velocity,
        landingSupport ?? vertical.y,
        1 / 60,
        vertical.grounded,
        MAX_STEP_HEIGHT,
      );
      expect(vertical.y).toBeCloseTo(flight.startY);
      expect(vertical.grounded).toBe(true);
      previousPoint = startLanding;
    }
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
    const groundColliders = collidersAt(runtime, definition.floorY);
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

    const upperColliders = collidersAt(runtime, definition.upperFloorY);
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

    const roofColliders = collidersAt(runtime, definition.roofY);
    expect(roofColliders.filter((collider) =>
      collider.id.includes(":roof-guard:"),
    )).toHaveLength(7);
    const roofCenter = localToWorld(0, 0);
    for (const outsideRoof of [
      localToWorld(-definition.width, 0),
      localToWorld(definition.width, 0),
      localToWorld(0, -definition.depth),
      localToWorld(0, definition.depth),
    ]) {
      const stopped = resolvePlanarMovement(
        roofCenter,
        outsideRoof,
        roofColliders,
        PLAYER_RADIUS,
      );
      expect(Math.hypot(
        stopped.x - outsideRoof.x,
        stopped.z - outsideRoof.z,
      )).toBeGreaterThan(PLAYER_RADIUS);
    }

    const guardedRoofLanding = localToWorld(
      definition.roofStairCenterX,
      definition.roofStairwellMinZ - 0.55,
    );
    const unsafeOpening = localToWorld(
      definition.roofStairCenterX,
      definition.roofStairwellMinZ + 0.2,
    );
    const stoppedAtOpening = resolvePlanarMovement(
      guardedRoofLanding,
      unsafeOpening,
      roofColliders,
      PLAYER_RADIUS,
    );
    expect(Math.hypot(
      stoppedAtOpening.x - unsafeOpening.x,
      stoppedAtOpening.z - unsafeOpening.z,
    )).toBeGreaterThan(PLAYER_RADIUS);

    const activeRoofLanding = localToWorld(
      definition.roofStairCenterX,
      definition.roofStairwellMaxZ + 0.55,
    );
    const activeTopStep = localToWorld(
      definition.roofStairCenterX,
      definition.roofStairwellMaxZ - 0.15,
    );
    expect(resolvePlanarMovement(
      activeRoofLanding,
      activeTopStep,
      roofColliders,
      PLAYER_RADIUS,
    )).toEqual(activeTopStep);
    disposeRoot(runtime.root);
  });
});
