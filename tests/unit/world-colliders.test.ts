import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { GAMEPLAY_CHUNK_RADIUS, PLAYER_RADIUS } from "../../lib/game/config";
import { isPlanarPositionClear, type PlanarCollider } from "../../lib/game/systems/collision";
import { ChunkManager } from "../../lib/game/world/ChunkManager";
import { getSettlement } from "../../lib/game/world/macroWorld";
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

    for (const root of roots) {
      const key = root.name.slice("chunk:".length);
      const [chunkX, chunkZ] = key.split(":").map(Number);
      const paths = worldPathSegmentsForChunk(chunkX, chunkZ);
      const generatedSolids = colliders.filter((collider) =>
        collider.id.includes(`:${key}:`) &&
        (
          collider.id.startsWith("building:") ||
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

    expect(buildingInstances).toBeGreaterThan(100);
    expect(treeInstances).toBeGreaterThan(20);
    expect(rockInstances).toBeGreaterThan(50);
    expect(ruinInstances).toBeGreaterThan(0);
    expect(landmarkMeshes).toBeGreaterThan(0);

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
