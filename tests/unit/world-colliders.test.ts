import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { GAMEPLAY_CHUNK_RADIUS, PLAYER_RADIUS } from "../../lib/game/config";
import { isPlanarPositionClear, type PlanarCollider } from "../../lib/game/systems/collision";
import { ChunkManager } from "../../lib/game/world/ChunkManager";
import { getSettlement, riverCenterX } from "../../lib/game/world/macroWorld";
import { ROAD_SURFACE_STEP_METERS } from "../../lib/game/world/RoadSurfaceGeometry";
import { distanceToPathSegment, worldPathSegmentsForChunk } from "../../lib/game/world/roads";
import { worldToChunk } from "../../lib/game/world/terrain";

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

function expectZeroInstanceScale(matrix: THREE.Matrix4, label: string) {
  const basis = [0, 1, 2, 4, 5, 6, 8, 9, 10].map(
    (index) => Math.abs(matrix.elements[index]),
  );
  expect(Math.max(...basis), label).toBeCloseTo(0);
}

describe("streamed world collider coverage", () => {
  it("gives every rendered city solid a unique matching collider", { timeout: 20_000 }, () => {
    const settlement = getSettlement("vesper-crown");
    expect(settlement).not.toBeNull();
    if (!settlement) return;
    const scene = new THREE.Scene();
    const world = new ChunkManager(scene, "performance");
    world.update(settlement.x, settlement.z);
    const roots = activeChunkRoots(scene, settlement.x, settlement.z);
    const colliders = world.colliders;
    const colliderIds = new Set(colliders.map((collider) => collider.id));

    expect(roots).toHaveLength((GAMEPLAY_CHUNK_RADIUS * 2 + 1) ** 2);
    expect(colliderIds.size).toBe(colliders.length);
    expect(colliders.length).toBeGreaterThan(300);
    colliders.forEach(expectFiniteCollider);

    let buildingInstances = 0;
    let treeInstances = 0;
    let rockInstances = 0;
    let ruinInstances = 0;
    let landmarkMeshes = 0;
    let roadMeshes = 0;

    for (const root of roots) {
      const key = root.name.slice("chunk:".length);
      const [chunkX, chunkZ] = key.split(":").map(Number);
      const paths = worldPathSegmentsForChunk(chunkX, chunkZ);
      let rootTreeInstances = 0;
      const generatedSolids = colliders.filter((collider) =>
        collider.id.includes(`:${key}:`) &&
        (
          collider.id.startsWith("building:") ||
          collider.id.startsWith("resource:rock:v2:") ||
          collider.id.startsWith("resource:tree:v2:") ||
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
        if (object instanceof THREE.InstancedMesh && object.name.startsWith("settlement:")) {
          const suffix = `:${key}`;
          const settlementId = object.name.slice("settlement:".length, -suffix.length);
          const matching = colliders.filter((collider) =>
            collider.id.startsWith(`building:${settlementId}:${key}:`),
          );
          expect(matching).toHaveLength(object.count);
          expect(matching.every((collider) => collider.shape === "box")).toBe(true);
          buildingInstances += object.count;

          if (object.count > 0) {
            expect(object.instanceColor).not.toBeNull();
            const matrix = new THREE.Matrix4();
            const position = new THREE.Vector3();
            const quaternion = new THREE.Quaternion();
            const scale = new THREE.Vector3();
            object.getMatrixAt(0, matrix);
            matrix.decompose(position, quaternion, scale);
            const collider = matching[0];
            expect(collider.shape).toBe("box");
            if (collider.shape === "box") {
              expect(collider.x).toBeCloseTo(position.x, 3);
              expect(collider.z).toBeCloseTo(position.z, 3);
              expect(collider.halfWidth).toBeCloseTo(scale.x * 0.5, 4);
              expect(collider.halfDepth).toBeCloseTo(scale.z * 0.5, 4);
              expect(Math.cos(collider.rotation)).toBeCloseTo(
                matrix.elements[0] / scale.x,
                5,
              );
              expect(-Math.sin(collider.rotation)).toBeCloseTo(
                matrix.elements[2] / scale.x,
                5,
              );
            }
          }
        }

        if (object instanceof THREE.InstancedMesh && object.name === `rocks:${key}`) {
          expect(object.instanceColor).not.toBeNull();
          expect(colliders.filter((collider) =>
            collider.id.startsWith(`resource:rock:v2:${key}:`),
          )).toHaveLength(object.count);
          expect(world.targets.filter((target) =>
            target.id.startsWith(`resource:rock:v2:${key}:`),
          )).toHaveLength(object.count);
          rockInstances += object.count;
        }

        if (
          object instanceof THREE.InstancedMesh &&
          object.name.startsWith(`forest:${key}:`)
        ) {
          expect(object.userData.vegetationLayer).toBe("woody");
          rootTreeInstances += object.count;
          treeInstances += object.count;
        }

        if (
          object instanceof THREE.InstancedMesh &&
          object.name.startsWith(`groundcover:${key}:`)
        ) {
          expect(object.userData.vegetationLayer).toBe("decorative");
          expect(object.castShadow).toBe(false);
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

        if (object instanceof THREE.Mesh && object.name.startsWith("roads:")) {
          const positions = object.geometry.getAttribute("position");
          const colors = object.geometry.getAttribute("color");
          expect(positions.count).toBeGreaterThan(0);
          expect(colors.count).toBe(positions.count);
          expect(object.geometry.getIndex()?.count ?? 0).toBeGreaterThan(0);
          expect(object.userData.roadSurface.maxStepMeters).toBeLessThanOrEqual(
            ROAD_SURFACE_STEP_METERS,
          );
          roadMeshes += 1;
        }

        if (object instanceof THREE.Mesh && object.name.startsWith("terrain:")) {
          expect(object.geometry.getAttribute("color").count).toBe(
            object.geometry.getAttribute("position").count,
          );
        }
      });
      expect(colliders.filter((collider) =>
        collider.id.startsWith(`resource:tree:v2:${key}:`),
      )).toHaveLength(rootTreeInstances);
      expect(world.targets.filter((target) =>
        target.id.startsWith(`resource:tree:v2:${key}:`),
      )).toHaveLength(rootTreeInstances);
    }

    expect(buildingInstances).toBeGreaterThan(100);
    expect(treeInstances).toBeGreaterThan(20);
    expect(rockInstances).toBeGreaterThan(50);
    expect(ruinInstances).toBeGreaterThan(0);
    expect(landmarkMeshes).toBeGreaterThan(0);
    expect(roadMeshes).toBeGreaterThan(0);

    const dayLighting = world.nightLightingSnapshot;
    expect(dayLighting.strength).toBe(0);
    expect(dayLighting.windows).toBeGreaterThan(buildingInstances);
    expect(dayLighting.visibleWindowMeshes).toBe(0);
    expect(dayLighting.areaLights).toBeGreaterThan(0);
    expect(dayLighting.activeAreaLights).toBe(0);

    world.setNightLighting(1);
    const nightLighting = world.nightLightingSnapshot;
    expect(nightLighting.strength).toBe(1);
    expect(nightLighting.visibleWindowMeshes).toBeGreaterThan(0);
    expect(nightLighting.activeAreaLights).toBe(nightLighting.areaLights);

    world.setNightLighting(0);
    expect(world.nightLightingSnapshot.visibleWindowMeshes).toBe(0);
    world.setNightLighting(Number.NaN);
    expect(world.nightLightingSnapshot.strength).toBe(0);
    let windowMesh: THREE.InstancedMesh | undefined;
    scene.traverse((object) => {
      if (!windowMesh && object instanceof THREE.InstancedMesh && object.name.startsWith("city-windows:")) {
        windowMesh = object;
      }
    });
    expect(windowMesh).toBeDefined();
    const disposeWindowMesh = vi.spyOn(windowMesh!, "dispose");
    world.dispose();
    expect(disposeWindowMesh).toHaveBeenCalledOnce();

    const waterScene = new THREE.Scene();
    const waterWorld = new ChunkManager(waterScene, "performance");
    waterWorld.update(riverCenterX(0), 0);
    const waterMeshes: THREE.Mesh[] = [];
    waterScene.traverse((object) => {
      if (object instanceof THREE.Mesh && object.name === "greywater-river") {
        waterMeshes.push(object);
      }
    });
    expect(waterMeshes.length).toBeGreaterThan(1);
    const sharedWaterMaterial = waterMeshes[0].material as THREE.ShaderMaterial;
    expect(waterMeshes.every((mesh) => mesh.material === sharedWaterMaterial)).toBe(true);
    const disposeWater = vi.spyOn(sharedWaterMaterial, "dispose");
    waterWorld.update(1_200, 1_200);
    expect(disposeWater).not.toHaveBeenCalled();
    waterWorld.dispose();
    waterWorld.dispose();
    expect(disposeWater).toHaveBeenCalledOnce();
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

  it("makes every procedural tree and rock harvestable without breaking instancing", { timeout: 20_000 }, () => {
    const scene = new THREE.Scene();
    const worldDiffs: Record<string, { hits: number; removed: boolean }> = {};
    const world = new ChunkManager(scene, "performance", worldDiffs);
    world.update(0, 8);

    const procedural = world.targets.filter((target) =>
      target.id.startsWith("resource:rock:v2:") ||
      target.id.startsWith("resource:tree:v2:"),
    );
    expect(procedural.length).toBeGreaterThan(100);
    expect(procedural.length).toBeLessThan(1_000);
    expect(procedural.every((target) =>
      Number.isFinite(target.position.x) &&
      Number.isFinite(target.position.y) &&
      Number.isFinite(target.position.z) &&
      (target.interactionRadius ?? 0) > 0 &&
      target.instanceVisuals?.length,
    )).toBe(true);
    expect(procedural.every((target) =>
      world.colliders.some((collider) => collider.id === target.id),
    )).toBe(true);

    const rock = procedural.find((target) =>
      target.id.startsWith("resource:rock:v2:0:0:"),
    );
    const tree = procedural.find((target) =>
      target.id.startsWith("resource:tree:v2:0:0:"),
    );
    expect(rock).toBeDefined();
    expect(tree).toBeDefined();
    if (!rock?.instanceVisuals?.length || !tree?.instanceVisuals?.length) {
      world.dispose();
      return;
    }

    const matrix = new THREE.Matrix4();
    const beforeRock = new THREE.Matrix4();
    const rockVisual = rock.instanceVisuals[0];
    rockVisual.mesh.getMatrixAt(rockVisual.index, beforeRock);
    const sibling = procedural.find((target) =>
      target !== rock &&
      target.instanceVisuals?.[0]?.mesh === rockVisual.mesh,
    );
    const beforeSibling = new THREE.Matrix4();
    if (sibling?.instanceVisuals?.[0]) {
      sibling.instanceVisuals[0].mesh.getMatrixAt(
        sibling.instanceVisuals[0].index,
        beforeSibling,
      );
    }

    world.applyEntityDiff(rock.id, { hits: 1, removed: false });
    rockVisual.mesh.getMatrixAt(rockVisual.index, matrix);
    expect(matrix.equals(beforeRock)).toBe(false);
    if (sibling?.instanceVisuals?.[0]) {
      const afterSibling = new THREE.Matrix4();
      sibling.instanceVisuals[0].mesh.getMatrixAt(
        sibling.instanceVisuals[0].index,
        afterSibling,
      );
      expect(afterSibling.equals(beforeSibling)).toBe(true);
    }

    world.applyEntityDiff(rock.id, {
      hits: rock.hitsRequired,
      removed: true,
    });
    world.applyEntityDiff(tree.id, {
      hits: tree.hitsRequired,
      removed: true,
    });
    for (const target of [rock, tree]) {
      expect(target.root.visible, `${target.id}:runtime visual state`).toBe(false);
      for (const visual of target.instanceVisuals ?? []) {
        visual.mesh.getMatrixAt(visual.index, matrix);
        expectZeroInstanceScale(
          matrix,
          `${target.id}:${visual.mesh.name}:${visual.index}`,
        );
      }
      expect(world.targets.some((candidate) => candidate.id === target.id)).toBe(false);
      expect(world.colliders.some((collider) => collider.id === target.id)).toBe(false);
    }

    const rockIndex = rockVisual.index;
    const rockKey = rock.id.split(":").slice(3, 5).join(":");
    const treeVisuals = tree.instanceVisuals.map((visual) => ({
      name: visual.mesh.name,
      index: visual.index,
    }));
    world.update(1_200, 1_200);
    world.update(0, 8);
    const reloadedRockMesh = scene.getObjectByName(`rocks:${rockKey}`);
    expect(reloadedRockMesh).toBeInstanceOf(THREE.InstancedMesh);
    if (reloadedRockMesh instanceof THREE.InstancedMesh) {
      reloadedRockMesh.getMatrixAt(rockIndex, matrix);
      expectZeroInstanceScale(matrix, `${rock.id}:reloaded`);
    }
    treeVisuals.forEach((visual, index) => {
      const object = scene.getObjectByName(visual.name);
      expect(object).toBeInstanceOf(THREE.InstancedMesh);
      if (!(object instanceof THREE.InstancedMesh)) return;
      object.getMatrixAt(visual.index, matrix);
      expectZeroInstanceScale(matrix, `${tree.id}:reloaded:${index}`);
    });
    expect(worldDiffs[rock.id]).toEqual({ hits: rock.hitsRequired, removed: true });
    expect(worldDiffs[tree.id]).toEqual({ hits: tree.hitsRequired, removed: true });
    world.dispose();
  });

  it("keeps legacy gatherable placement stable when an earlier resource is depleted", { timeout: 20_000 }, () => {
    const firstScene = new THREE.Scene();
    const firstWorld = new ChunkManager(firstScene, "performance");
    firstWorld.update(0, 8);
    const legacyRock = firstWorld.targets.find((target) =>
      target.id.startsWith("resource:rock:v1:") &&
      !target.id.startsWith("resource:rock:v1:0:0:") &&
      firstWorld.targets.some(
        (candidate) => candidate.id === target.id.replace(":rock:", ":tree:"),
      ),
    );
    expect(legacyRock).toBeDefined();
    if (!legacyRock) {
      firstWorld.dispose();
      return;
    }
    const treeId = legacyRock.id.replace(":rock:", ":tree:");
    const firstTree = firstWorld.targets.find((target) => target.id === treeId);
    expect(firstTree).toBeDefined();
    const firstPosition = firstTree?.position.clone();
    firstWorld.dispose();

    const worldDiffs = {
      [legacyRock.id]: { hits: legacyRock.hitsRequired, removed: true },
    };
    const restoredScene = new THREE.Scene();
    const restoredWorld = new ChunkManager(
      restoredScene,
      "performance",
      worldDiffs,
    );
    restoredWorld.update(0, 8);
    const restoredTree = restoredWorld.targets.find(
      (target) => target.id === treeId,
    );
    expect(restoredTree).toBeDefined();
    expect(restoredTree?.position.toArray()).toEqual(firstPosition?.toArray());
    expect(restoredWorld.targets.some((target) => target.id === legacyRock.id))
      .toBe(false);
    expect(restoredWorld.colliders.some((collider) => collider.id === legacyRock.id))
      .toBe(false);
    restoredWorld.dispose();
  });
});
