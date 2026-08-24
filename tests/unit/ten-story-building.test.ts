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
  type PlanarCollider,
} from "../../lib/game/systems/collision";
import { stepVertical } from "../../lib/game/systems/locomotion";
import { ChunkManager } from "../../lib/game/world/ChunkManager";
import { SPAWN_BUILDING } from "../../lib/game/world/spawnBuilding";
import {
  TEN_STORY_BUILDING,
  createTenStoryBuilding,
  tenStorySupportCandidates,
  type TenStoryBuildingRuntime,
} from "../../lib/game/world/tenStoryBuilding";
import {
  TWO_STORY_BUILDING,
  selectWalkableSupport,
} from "../../lib/game/world/twoStoryBuilding";

function disposeRoot(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    objectMaterials.forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function localToWorld(localX: number, localZ: number) {
  const cosine = Math.cos(TEN_STORY_BUILDING.rotation);
  const sine = Math.sin(TEN_STORY_BUILDING.rotation);
  return {
    x: TEN_STORY_BUILDING.x + cosine * localX + sine * localZ,
    z: TEN_STORY_BUILDING.z - sine * localX + cosine * localZ,
  };
}

function collidersAtFloor(
  runtime: TenStoryBuildingRuntime,
  floorY: number,
): PlanarCollider[] {
  return runtime.colliders.filter((collider) =>
    colliderIntersectsVerticalRange(collider, floorY, floorY + PLAYER_HEIGHT),
  );
}

describe("authored ten-story building", () => {
  it("is a human-scale, nearby landmark with a bounded render budget", () => {
    const definition = TEN_STORY_BUILDING;
    expect(definition.floorCount).toBe(10);
    expect(definition.floorYs).toHaveLength(10);
    expect(definition.stairFlights).toHaveLength(9);
    expect(definition.hasBasement).toBe(false);
    expect(definition.roofAccess).toBe(false);
    expect(definition.storyHeight).toBeGreaterThan(3.1);
    expect(definition.storyHeight).toBeLessThan(4.2);
    expect(definition.stairWidth).toBeGreaterThan(PLAYER_RADIUS * 2 + 0.3);
    expect(definition.stairRise).toBeLessThanOrEqual(MAX_STEP_HEIGHT);
    const maximumJumpEyeHeight =
      PLAYER_HEIGHT + (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);
    expect(definition.storyHeight - definition.slabThickness)
      .toBeGreaterThan(maximumJumpEyeHeight + 0.2);
    expect(Math.hypot(definition.x, definition.z - 8)).toBeLessThan(40);
    for (const neighbour of [SPAWN_BUILDING, TWO_STORY_BUILDING]) {
      expect(Math.hypot(
        definition.x - neighbour.x,
        definition.z - neighbour.z,
      )).toBeGreaterThan(definition.clearanceRadius + neighbour.clearanceRadius);
    }
    for (let floor = 1; floor < definition.floorYs.length; floor += 1) {
      expect(definition.floorYs[floor] - definition.floorYs[floor - 1])
        .toBeCloseTo(definition.storyHeight);
    }
    expect(new Set(definition.stairFlights.map((flight) => flight.lane)))
      .toEqual(new Set([0, 1]));
    for (let index = 1; index < definition.stairFlights.length; index += 1) {
      expect(definition.stairFlights[index].lane)
        .not.toBe(definition.stairFlights[index - 1].lane);
    }

    const runtime = createTenStoryBuilding("performance");
    expect(runtime.root.userData).toMatchObject({
      enterable: true,
      floorCount: 10,
    });
    expect(runtime.doors).toHaveLength(1);
    const drawables: THREE.Mesh[] = [];
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    let adjustedTriangles = 0;
    runtime.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      drawables.push(object);
      geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      objectMaterials.forEach((material) => materials.add(material));
      const triangles = (object.geometry.index?.count ??
        object.geometry.getAttribute("position").count) / 3;
      adjustedTriangles += triangles * (
        object instanceof THREE.InstancedMesh ? object.count : 1
      );
    });
    expect(drawables.length).toBeLessThanOrEqual(12);
    expect(geometries.size).toBeLessThanOrEqual(12);
    expect(materials.size).toBeLessThanOrEqual(8);
    expect(adjustedTriangles).toBeLessThan(10_000);
    expect(runtime.root.userData.staticInstanceCount).toBeLessThan(600);
    expect(runtime.colliders.length).toBeLessThan(50);

    const glass = drawables.filter((mesh) => mesh.userData.glass);
    expect(glass).toHaveLength(4);
    expect(glass.reduce(
      (sum, mesh) => sum + (mesh instanceof THREE.InstancedMesh ? mesh.count : 1),
      0,
    )).toBe(39);
    for (const facade of glass) {
      expect(facade).toBeInstanceOf(THREE.InstancedMesh);
      expect(facade.material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
      const material = facade.material as THREE.MeshPhysicalMaterial;
      expect(material.transparent).toBe(true);
      expect(material.transmission).toBeGreaterThan(0.5);
      expect(material.opacity).toBeGreaterThan(0);
      expect(material.opacity).toBeLessThan(1);
      expect(material.depthWrite).toBe(false);
      expect(facade.castShadow).toBe(false);
    }
    disposeRoot(runtime.root);
  });

  it("selects all ten floors without exposing a roof or snapping players upward", () => {
    const definition = TEN_STORY_BUILDING;
    const safeRoomPoint = localToWorld(0, 0);
    const supports = tenStorySupportCandidates(safeRoomPoint.x, safeRoomPoint.z);
    expect(supports).toEqual(definition.floorYs);
    expect(selectWalkableSupport(supports)).toBeCloseTo(definition.floorY);
    definition.floorYs.forEach((floorY) => {
      expect(selectWalkableSupport(supports, floorY)).toBeCloseTo(floorY);
    });
    expect(supports).not.toContain(definition.floorY + definition.wallHeight);

    const threshold = localToWorld(0, definition.depth * 0.5 + 0.3);
    expect(tenStorySupportCandidates(threshold.x, threshold.z))
      .toEqual([definition.floorY]);
    const outside = localToWorld(0, definition.depth * 0.5 + 2);
    expect(tenStorySupportCandidates(outside.x, outside.z)).toEqual([]);
    expect(tenStorySupportCandidates(Number.NaN, 0)).toEqual([]);

    for (const lane of [0, 1] as const) {
      const sameLaneFlights = definition.stairFlights.filter(
        (flight) => flight.lane === lane,
      );
      for (let index = 1; index < sameLaneFlights.length; index += 1) {
        expect(sameLaneFlights[index].fromFloor - sameLaneFlights[index - 1].fromFloor)
          .toBe(2);
      }
    }
  });

  it("provides a collision-clear 180-step route up and down every floor", () => {
    const definition = TEN_STORY_BUILDING;
    const runtime = createTenStoryBuilding("performance", true);
    let vertical = { y: definition.floorY, velocity: 0, grounded: true };
    let previous = localToWorld(
      definition.stairFlights[0].centerX,
      definition.stairFlights[0].startZ + 0.55,
    );

    for (const flight of definition.stairFlights) {
      expect(vertical.y).toBeCloseTo(flight.startY);
      const direction = Math.sign(flight.endZ - flight.startZ);
      const startLanding = localToWorld(
        flight.centerX,
        flight.startZ - direction * 0.55,
      );
      const landingColliders = collidersAtFloor(runtime, vertical.y);
      expect(resolvePlanarMovement(
        previous,
        startLanding,
        landingColliders,
        PLAYER_RADIUS,
      )).toEqual(startLanding);
      previous = startLanding;

      for (let step = 0; step < flight.steps; step += 1) {
        const point = localToWorld(
          flight.centerX,
          flight.startZ + direction * (step + 0.5) * flight.tread,
        );
        const selected = selectWalkableSupport(
          tenStorySupportCandidates(point.x, point.z),
          vertical.y,
        );
        expect(selected).not.toBeNull();
        expect((selected ?? vertical.y) - vertical.y).toBeGreaterThan(0);
        expect((selected ?? vertical.y) - vertical.y)
          .toBeLessThanOrEqual(MAX_STEP_HEIGHT);
        const movementColliders = collidersAtFloor(runtime, vertical.y);
        expect(resolvePlanarMovement(
          previous,
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
        previous = point;
      }

      expect(vertical.y).toBeCloseTo(flight.endY);
      const endLanding = localToWorld(
        flight.centerX,
        flight.endZ + direction * 0.55,
      );
      expect(selectWalkableSupport(
        tenStorySupportCandidates(endLanding.x, endLanding.z),
        vertical.y,
      )).toBeCloseTo(flight.endY);
      previous = endLanding;
    }
    expect(vertical.y).toBeCloseTo(
      definition.floorYs[definition.floorYs.length - 1],
    );

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
        previous,
        endLanding,
        collidersAtFloor(runtime, vertical.y),
        PLAYER_RADIUS,
      )).toEqual(endLanding);
      previous = endLanding;

      for (let step = flight.steps - 1; step >= 0; step -= 1) {
        const point = localToWorld(
          flight.centerX,
          flight.startZ + direction * (step + 0.5) * flight.tread,
        );
        const selected = selectWalkableSupport(
          tenStorySupportCandidates(point.x, point.z),
          vertical.y,
        );
        expect(selected).not.toBeNull();
        expect(vertical.y - (selected ?? vertical.y)).toBeGreaterThanOrEqual(0);
        expect(vertical.y - (selected ?? vertical.y))
          .toBeLessThanOrEqual(MAX_STEP_HEIGHT);
        expect(resolvePlanarMovement(
          previous,
          point,
          collidersAtFloor(runtime, vertical.y),
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
        previous = point;
      }

      const startLanding = localToWorld(
        flight.centerX,
        flight.startZ - direction * 0.55,
      );
      const floorSupport = selectWalkableSupport(
        tenStorySupportCandidates(startLanding.x, startLanding.z),
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
      expect(vertical.y).toBeCloseTo(flight.startY);
      expect(vertical.grounded).toBe(true);
      previous = startLanding;
    }
    expect(vertical).toEqual({
      y: definition.floorY,
      velocity: 0,
      grounded: true,
    });
    disposeRoot(runtime.root);
  });

  it("keeps every floor enclosed while leaving the active stair landing open", () => {
    const definition = TEN_STORY_BUILDING;
    const runtime = createTenStoryBuilding("performance");
    const colliderIds = runtime.colliders.map((collider) => collider.id);
    expect(new Set(colliderIds).size).toBe(colliderIds.length);
    runtime.colliders.forEach((collider) => {
      expect(Number.isFinite(collider.x)).toBe(true);
      expect(Number.isFinite(collider.z)).toBe(true);
    });

    const doorway = runtime.doors[0].targetPosition;
    const groundColliders = collidersAtFloor(runtime, definition.floorY);
    expect(isPlanarPositionClear(doorway, groundColliders, PLAYER_RADIUS)).toBe(false);
    runtime.doors[0].setOpen(true);
    expect(isPlanarPositionClear(doorway, groundColliders, PLAYER_RADIUS)).toBe(true);
    const outside = localToWorld(0, definition.depth * 0.5 + 2);
    const interior = localToWorld(0, 0);
    expect(resolvePlanarMovement(
      outside,
      interior,
      groundColliders,
      PLAYER_RADIUS,
    )).toEqual(interior);

    for (const floor of [1, 5, 9]) {
      const floorColliders = collidersAtFloor(runtime, definition.floorYs[floor]);
      const throughFront = resolvePlanarMovement(
        interior,
        outside,
        floorColliders,
        PLAYER_RADIUS,
      );
      expect(Math.hypot(
        throughFront.x - outside.x,
        throughFront.z - outside.z,
      )).toBeGreaterThan(PLAYER_RADIUS);
      for (const [start, desired] of [
        [localToWorld(0, 0), localToWorld(0, -definition.depth)],
        [localToWorld(0, 0), localToWorld(-definition.width, 0)],
        [localToWorld(0, 0), localToWorld(definition.width, 0)],
      ] as const) {
        const resolved = resolvePlanarMovement(
          start,
          desired,
          floorColliders,
          PLAYER_RADIUS,
        );
        expect(Math.hypot(resolved.x - desired.x, resolved.z - desired.z))
          .toBeGreaterThan(PLAYER_RADIUS);
      }
    }

    for (let floor = 1; floor < definition.floorCount; floor += 1) {
      const connectedAtBack = floor % 2 === 1;
      const guardZ = connectedAtBack
        ? definition.stairwellMaxZ
        : definition.stairwellMinZ;
      const outward = connectedAtBack ? 1 : -1;
      const landing = localToWorld(4.1, guardZ + outward * 0.55);
      const voidPoint = localToWorld(4.1, guardZ - outward * 0.55);
      const floorColliders = collidersAtFloor(runtime, definition.floorYs[floor]);
      const guarded = resolvePlanarMovement(
        landing,
        voidPoint,
        floorColliders,
        PLAYER_RADIUS,
      );
      expect(Math.hypot(
        guarded.x - voidPoint.x,
        guarded.z - voidPoint.z,
      )).toBeGreaterThan(PLAYER_RADIUS);

      const incoming = definition.stairFlights[floor - 1];
      const connectedZ = connectedAtBack
        ? definition.stairwellMinZ
        : definition.stairwellMaxZ;
      const connectedOutward = connectedAtBack ? -1 : 1;
      const activeLanding = localToWorld(
        incoming.centerX,
        connectedZ + connectedOutward * 0.55,
      );
      const activeStep = localToWorld(
        incoming.centerX,
        connectedZ - connectedOutward * 0.15,
      );
      expect(resolvePlanarMovement(
        activeLanding,
        activeStep,
        floorColliders,
        PLAYER_RADIUS,
      )).toEqual(activeStep);
    }
    disposeRoot(runtime.root);
  });

  it("streams exactly one tower and persists its door across chunk reloads", () => {
    const definition = TEN_STORY_BUILDING;
    const scene = new THREE.Scene();
    const doorStates: Record<string, boolean> = {};
    const world = new ChunkManager(scene, "performance", {}, doorStates);
    world.update(0, 8);
    expect(world.loadedCount).toBe(WORLD_RESIDENT_CHUNKS);
    expect(scene.getObjectsByProperty(
      "name",
      `ten-story-building:${definition.id}`,
    )).toHaveLength(1);
    expect(world.doorsSnapshot).toEqual([
      { id: SPAWN_BUILDING.doorId, open: false },
      { id: TWO_STORY_BUILDING.doorId, open: false },
      { id: definition.doorId, open: false },
    ]);
    expect(world.targets.filter((target) => target.kind === "door")).toHaveLength(3);
    definition.floorYs.forEach((floorY) => {
      expect(world.sampleGroundHeight(definition.x, definition.z, floorY))
        .toBeCloseTo(floorY);
    });

    expect(world.toggleDoor(
      definition.doorId,
      { x: 0, y: definition.floorY, z: 8 },
      PLAYER_RADIUS,
    )).toBe("opened");
    expect(doorStates[definition.doorId]).toBe(true);
    expect(world.toggleDoor(
      definition.doorId,
      {
        x: world.targets.find((target) => target.id === definition.doorId)?.position.x ?? 0,
        y: definition.floorY,
        z: world.targets.find((target) => target.id === definition.doorId)?.position.z ?? 0,
      },
      PLAYER_RADIUS,
    )).toBe("blocked");

    world.update(1_200, 1_200);
    expect(scene.getObjectsByProperty(
      "name",
      `ten-story-building:${definition.id}`,
    )).toHaveLength(0);
    world.update(0, 8);
    expect(scene.getObjectsByProperty(
      "name",
      `ten-story-building:${definition.id}`,
    )).toHaveLength(1);
    expect(world.doorsSnapshot.find((door) => door.id === definition.doorId)?.open)
      .toBe(true);
    expect(world.targets.filter((target) => target.id === definition.doorId))
      .toHaveLength(1);
    world.dispose();
  });
});
