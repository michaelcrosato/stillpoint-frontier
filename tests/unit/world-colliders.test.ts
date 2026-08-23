import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { GAMEPLAY_CHUNK_RADIUS, PLAYER_RADIUS } from "../../lib/game/config";
import {
  isPlanarPositionClear,
  resolvePlanarMovement,
  type PlanarCollider,
} from "../../lib/game/systems/collision";
import { ChunkManager } from "../../lib/game/world/ChunkManager";
import {
  BUILDING_SLAB_THICKNESS,
  BUILDING_STEP_HEIGHT,
  BUILDING_WINDOW_HEIGHT,
  BUILDING_WINDOW_SILL,
  buildingBasementSupportY,
  buildingContainsPoint,
  buildingGroundSupportY,
  buildingLocalToWorld,
} from "../../lib/game/world/buildings";
import { getSettlement } from "../../lib/game/world/macroWorld";
import { distanceToPathSegment, worldPathSegmentsForChunk } from "../../lib/game/world/roads";
import { sampleTerrainHeight, worldToChunk } from "../../lib/game/world/terrain";

function activeChunkRoots(scene: THREE.Scene, x: number, z: number) {
  const center = worldToChunk(x, z);
  return scene.children.filter((child): child is THREE.Group => {
    if (!(child instanceof THREE.Group) || !child.name.startsWith("chunk:")) return false;
    const [chunkX, chunkZ] = child.name.slice("chunk:".length).split(":").map(Number);
    return (
      Math.abs(chunkX - center.x) <= GAMEPLAY_CHUNK_RADIUS &&
      Math.abs(chunkZ - center.z) <= GAMEPLAY_CHUNK_RADIUS
    );
  });
}

function expectFiniteCollider(collider: PlanarCollider) {
  expect(collider.id.length).toBeGreaterThan(3);
  expect(Number.isFinite(collider.x)).toBe(true);
  expect(Number.isFinite(collider.z)).toBe(true);
  if (collider.shape === "circle") {
    expect(Number.isFinite(collider.radius)).toBe(true);
    expect(collider.radius).toBeGreaterThan(0);
  } else {
    expect(Number.isFinite(collider.halfWidth)).toBe(true);
    expect(Number.isFinite(collider.halfDepth)).toBe(true);
    expect(Number.isFinite(collider.rotation)).toBe(true);
    expect(collider.halfWidth).toBeGreaterThan(0);
    expect(collider.halfDepth).toBeGreaterThan(0);
  }
}

describe("streamed world collider coverage", () => {
  it("gives every rendered city solid a unique matching collider", { timeout: 20_000 }, () => {
    const settlement = getSettlement("vesper-crown");
    expect(settlement).not.toBeNull();
    if (!settlement) return;
    const scene = new THREE.Scene();
    const world = new ChunkManager(scene, "performance");
    world.update(settlement.x, settlement.z);
    world.flushStreamingForTests();
    const roots = activeChunkRoots(scene, settlement.x, settlement.z);
    const colliders = world.colliders;
    const colliderIds = new Set(colliders.map((collider) => collider.id));

    expect(roots).toHaveLength((GAMEPLAY_CHUNK_RADIUS * 2 + 1) ** 2);
    expect(colliderIds.size).toBe(colliders.length);
    expect(colliders.length).toBeGreaterThan(300);
    colliders.forEach(expectFiniteCollider);

    let buildingShellInstances = 0;
    let buildingFloorInstances = 0;
    let buildingDoorInstances = 0;
    let buildingStairInstances = 0;
    let buildingFacadeInstances = 0;
    let settlementInstanceCapacity = 0;
    let settlementLiveInstances = 0;
    let treeInstances = 0;
    let rockInstances = 0;
    let ruinInstances = 0;
    let landmarkMeshes = 0;

    for (const root of roots) {
      const key = root.name.slice("chunk:".length);
      const [chunkX, chunkZ] = key.split(":").map(Number);
      const paths = worldPathSegmentsForChunk(chunkX, chunkZ);
      const generatedSolids = colliders.filter((collider) =>
        collider.id.includes(`:${key}:`) &&
        (
          collider.id.endsWith(":footprint") ||
          collider.id.startsWith("scenery-") ||
          collider.id.startsWith("ruin:")
        ),
      );
      for (const collider of generatedSolids) {
        const radius = collider.shape === "circle"
          ? collider.radius
          : Math.hypot(collider.halfWidth, collider.halfDepth);
        expect(paths.every((path) =>
          distanceToPathSegment(collider, path) >= path.width * 0.5 + radius + 1.249,
        ), collider.id).toBe(true);
      }
      root.traverse((object) => {
        if (
          object instanceof THREE.InstancedMesh &&
          (object.name.startsWith("settlement-") ||
            object.name.startsWith("city-windows:"))
        ) {
          settlementInstanceCapacity += object.instanceMatrix.count;
          settlementLiveInstances += object.count;
        }
        if (object instanceof THREE.InstancedMesh && object.name.startsWith("settlement-shells:")) {
          buildingShellInstances += object.count;
        }
        if (object instanceof THREE.InstancedMesh && object.name.startsWith("settlement-floors:")) {
          buildingFloorInstances += object.count;
          const instanceMatrix = new THREE.Matrix4();
          const instanceScale = new THREE.Vector3();
          for (let instanceIndex = 0; instanceIndex < object.count; instanceIndex += 1) {
            object.getMatrixAt(instanceIndex, instanceMatrix);
            instanceScale.setFromMatrixScale(instanceMatrix);
            expect(instanceScale.y).toBeCloseTo(BUILDING_SLAB_THICKNESS);
          }
        }
        if (object instanceof THREE.InstancedMesh && object.name.startsWith("settlement-doors:")) {
          buildingDoorInstances += object.count;
        }
        if (object instanceof THREE.InstancedMesh && object.name.startsWith("settlement-stairs:")) {
          buildingStairInstances += object.count;
        }
        if (object instanceof THREE.InstancedMesh && object.name.startsWith("city-windows:")) {
          buildingFacadeInstances += object.count;
        }

        if (object instanceof THREE.InstancedMesh && object.name === `rocks:${key}`) {
          expect(colliders.filter((collider) =>
            collider.id.startsWith(`scenery-rock:${key}:`),
          )).toHaveLength(object.count);
          rockInstances += object.count;
        }

        if (object instanceof THREE.InstancedMesh && object.name === `forest:${key}`) {
          expect(colliders.filter((collider) =>
            collider.id.startsWith(`scenery-tree:${key}:`),
          )).toHaveLength(object.count);
          treeInstances += object.count * 0.5;
        }

        if (object instanceof THREE.InstancedMesh && object.name === `ruins:${key}`) {
          const matching = colliders.filter((collider) =>
            collider.id.startsWith(`ruin:${key}:`),
          );
          expect(matching).toHaveLength(object.count);
          expect(matching.every((collider) => collider.shape === "box")).toBe(true);
          ruinInstances += object.count;
        }

        if (object instanceof THREE.Mesh && object.name.startsWith("landmark:")) {
          expect(colliderIds.has(object.name)).toBe(true);
          landmarkMeshes += 1;
        }
      });
    }

    const recipes = world.buildings;
    expect(recipes.length).toBeGreaterThan(80);
    expect(buildingDoorInstances).toBe(recipes.length);
    expect(buildingShellInstances).toBe(
      recipes.length * 4 + recipes.filter((recipe) => recipe.roofAccess).length * 4,
    );
    expect(buildingFloorInstances).toBeGreaterThan(recipes.length * 2);
    expect(buildingStairInstances).toBeGreaterThan(0);
    expect(buildingFacadeInstances).toBe(recipes.length * 4);
    expect(settlementInstanceCapacity).toBe(settlementLiveInstances);
    const interiorDetailVisibility = { near: 0, far: 0 };
    scene.traverse((object) => {
      if (!(object instanceof THREE.InstancedMesh)) return;
      if (!object.name.startsWith("settlement-floors:") && !object.name.startsWith("settlement-stairs:")) return;
      if (object.visible) interiorDetailVisibility.near += 1;
      else interiorDetailVisibility.far += 1;
    });
    expect(interiorDetailVisibility.near).toBeGreaterThan(0);
    expect(interiorDetailVisibility.far).toBeGreaterThan(0);
    expect(recipes.some((recipe) => recipe.floorCount > 1)).toBe(true);
    expect(recipes.some((recipe) => recipe.hasBasement)).toBe(true);
    expect(recipes.some((recipe) => recipe.roofAccess)).toBe(true);
    for (const recipe of recipes) {
      const matching = colliders.filter((collider) =>
        collider.id.startsWith(`${recipe.id}:`),
      );
      expect(matching.some((collider) => collider.id.endsWith(":footprint"))).toBe(true);
      expect(matching.some((collider) => collider.id.endsWith(":entrance-apron"))).toBe(true);
      expect(matching.filter((collider) => collider.id.includes(":wall:"))).toHaveLength(
        6 + (recipe.hasBasement ? 1 : 0),
      );
      expect(matching.filter((collider) => collider.id.includes(":roof:")).length)
        .toBe(recipe.roofAccess ? 4 : 0);
      expect(recipe.doorWidth).toBeGreaterThan(PLAYER_RADIUS * 2);
      expect(recipe.doorHeight).toBeGreaterThan(1.8);
      expect(recipe.height).toBeCloseTo(recipe.floorHeight * recipe.floorCount);
    }

    const controlledFloor = recipes[0];
    expect(controlledFloor).toBeDefined();
    if (controlledFloor) {
      const center = buildingLocalToWorld(controlledFloor, 0, 0);
      const terrainY = sampleTerrainHeight(center.x, center.z);
      const originalFoundationY = controlledFloor.foundationY;
      controlledFloor.foundationY =
        terrainY - BUILDING_SLAB_THICKNESS - BUILDING_STEP_HEIGHT * 0.5;
      const floorY = buildingGroundSupportY(controlledFloor);
      try {
        expect(terrainY - floorY).toBeCloseTo(BUILDING_STEP_HEIGHT * 0.5);
        expect(world.samplePlayerSupportHeight(
          center.x,
          center.z,
          floorY,
          0,
          true,
        )).toBeCloseTo(floorY);
      } finally {
        controlledFloor.foundationY = originalFoundationY;
      }
    }

    const enterable = recipes.find((recipe) => recipe.floorCount > 2);
    expect(enterable).toBeDefined();
    if (enterable) {
      const groundY = buildingGroundSupportY(enterable);
      const outside = buildingLocalToWorld(
        enterable,
        0,
        enterable.depth * 0.5 + 1.8,
      );
      const inside = buildingLocalToWorld(enterable, 0, 0);
      const entered = resolvePlanarMovement(
        outside,
        inside,
        world.queryColliders(outside, inside, PLAYER_RADIUS, groundY, groundY + 1.82),
        PLAYER_RADIUS,
      );
      expect(buildingContainsPoint(enterable, entered.x, entered.z)).toBe(true);
      expect(world.samplePlayerSupportHeight(
        inside.x,
        inside.z,
        groundY - 0.1,
        0,
        true,
      )).toBeCloseTo(groundY);
      const upperY = groundY + enterable.floorHeight;
      expect(world.samplePlayerSupportHeight(
        inside.x,
        inside.z,
        upperY,
        0,
        true,
      )).toBeCloseTo(upperY);
      expect(world.samplePlayerCeilingHeight(inside.x, inside.z, upperY))
        .toBeCloseTo(upperY + enterable.floorHeight - 0.2);
    }

    const basement = recipes.find((recipe) => recipe.hasBasement);
    expect(basement).toBeDefined();
    if (basement) {
      const inside = buildingLocalToWorld(basement, 0, 0);
      const basementY = buildingBasementSupportY(basement);
      expect(world.samplePlayerSupportHeight(
        inside.x,
        inside.z,
        basementY,
        0,
        true,
      )).toBeCloseTo(basementY);
      expect(world.getInteriorStatus(inside.x, inside.z, basementY)?.level).toBe("B1");
    }
    expect(treeInstances).toBeGreaterThan(20);
    expect(rockInstances).toBeGreaterThan(50);
    expect(ruinInstances).toBeGreaterThan(0);
    expect(landmarkMeshes).toBeGreaterThan(0);

    const dayLighting = world.nightLightingSnapshot;
    expect(dayLighting.strength).toBe(0);
    expect(dayLighting.windows).toBeGreaterThan(buildingFacadeInstances);
    expect(dayLighting.visibleWindowMeshes).toBeGreaterThan(0);
    expect(dayLighting.litWindowMeshes).toBe(0);
    expect(dayLighting.areaLights).toBeGreaterThan(0);
    expect(dayLighting.activeAreaLights).toBe(0);

    world.setNightLighting(1);
    const nightLighting = world.nightLightingSnapshot;
    expect(nightLighting.strength).toBe(1);
    expect(nightLighting.visibleWindowMeshes).toBeGreaterThan(0);
    expect(nightLighting.litWindowMeshes).toBe(nightLighting.visibleWindowMeshes);
    expect(nightLighting.activeAreaLights).toBe(nightLighting.areaLights);

    world.setNightLighting(0);
    expect(world.nightLightingSnapshot.visibleWindowMeshes).toBeGreaterThan(0);
    expect(world.nightLightingSnapshot.litWindowMeshes).toBe(0);
    world.setNightLighting(Number.NaN);
    expect(world.nightLightingSnapshot.strength).toBe(0);
    let windowMesh: THREE.InstancedMesh | undefined;
    let facadeMesh: THREE.InstancedMesh | undefined;
    scene.traverse((object) => {
      if (!windowMesh && object instanceof THREE.InstancedMesh && object.name.startsWith("city-windows:")) {
        windowMesh = object;
      }
      if (!facadeMesh && object instanceof THREE.InstancedMesh && object.name.startsWith("settlement-facades:")) {
        facadeMesh = object;
      }
    });
    expect(windowMesh).toBeDefined();
    expect(facadeMesh).toBeDefined();
    const rawWindowMaterial = windowMesh?.material;
    const windowMaterial = Array.isArray(rawWindowMaterial)
      ? rawWindowMaterial[0]
      : rawWindowMaterial;
    expect(windowMaterial).toBeInstanceOf(THREE.ShaderMaterial);
    if (windowMaterial instanceof THREE.ShaderMaterial) {
      expect(windowMaterial.uniforms.uWindowSill?.value).toBe(BUILDING_WINDOW_SILL);
      expect(windowMaterial.uniforms.uWindowHeight?.value).toBe(BUILDING_WINDOW_HEIGHT);
      expect(windowMaterial.fog).toBe(true);
      expect(windowMaterial.side).toBe(THREE.DoubleSide);
    }
    const rawFacadeMaterial = facadeMesh?.material;
    const facadeMaterial = Array.isArray(rawFacadeMaterial)
      ? rawFacadeMaterial[0]
      : rawFacadeMaterial;
    expect(facadeMaterial).toBeInstanceOf(THREE.ShaderMaterial);
    if (facadeMaterial instanceof THREE.ShaderMaterial) {
      expect(facadeMaterial.fog).toBe(true);
      expect(facadeMaterial.side).toBe(THREE.DoubleSide);
      expect(facadeMaterial.fragmentShader).toContain("facadeWindowMask() > 0.5");
      expect(facadeMaterial.fragmentShader).toContain("facadeDoorMask() > 0.5");
    }
    const disposeWindowMesh = vi.spyOn(windowMesh!, "dispose");
    let shellMesh: THREE.InstancedMesh | undefined;
    scene.traverse((object) => {
      if (!shellMesh && object instanceof THREE.InstancedMesh && object.name.startsWith("settlement-shells:")) {
        shellMesh = object;
      }
    });
    expect(shellMesh).toBeDefined();
    const disposeSharedBox = vi.spyOn(shellMesh!.geometry, "dispose");
    const shellMaterial = Array.isArray(shellMesh!.material)
      ? shellMesh!.material[0]
      : shellMesh!.material;
    const disposeSharedShellMaterial = vi.spyOn(shellMaterial, "dispose");
    const disposeSharedWindowMaterial = vi.spyOn(windowMaterial!, "dispose");
    world.dispose();
    expect(disposeWindowMesh).toHaveBeenCalledOnce();
    expect(disposeSharedBox).toHaveBeenCalledOnce();
    expect(disposeSharedShellMaterial).toHaveBeenCalledOnce();
    expect(disposeSharedWindowMaterial).toHaveBeenCalledOnce();
  });

  it("keeps the opening and pickups accessible and removes harvested collision", { timeout: 20_000 }, () => {
    const scene = new THREE.Scene();
    const world = new ChunkManager(scene, "performance");
    world.update(0, 8);

    expect(isPlanarPositionClear({ x: 0, z: 8 }, world.colliders, PLAYER_RADIUS)).toBe(true);
    const pickup = world.targets.find((target) => target.kind === "pickup");
    expect(pickup).toBeDefined();
    if (pickup) {
      expect(isPlanarPositionClear(
        { x: pickup.position.x, z: pickup.position.z },
        world.colliders,
        PLAYER_RADIUS,
      )).toBe(true);
    }

    const rock = world.targets.find((target) => target.id === "resource:rock:v1:0:0:0");
    expect(rock).toBeDefined();
    if (rock) {
      expect(world.colliders.some((collider) => collider.id === rock.id)).toBe(true);
      world.applyEntityDiff(rock.id, { hits: rock.hitsRequired, removed: true });
      expect(world.colliders.some((collider) => collider.id === rock.id)).toBe(false);
      expect(world.queryColliders(
        { x: rock.position.x - 2, z: rock.position.z },
        { x: rock.position.x + 2, z: rock.position.z },
        PLAYER_RADIUS,
      ).some((collider) => collider.id === rock.id)).toBe(false);
    }
    world.dispose();
  });
});
