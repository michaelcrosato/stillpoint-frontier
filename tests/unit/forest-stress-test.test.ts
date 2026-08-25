import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ForestStressTest } from "../../lib/game/developer/ForestStressTest";
import { WorldMaterialLibrary } from "../../lib/game/rendering/WorldMaterialLibrary";
import { ChunkManager } from "../../lib/game/world/ChunkManager";
import {
  CANOPY_BENCHMARK_ZONE,
  generateCanopyBenchmarkReeds,
} from "../../lib/game/world/benchmarkZone";
import { sampleTerrainHeight } from "../../lib/game/world/terrain";
import { CHUNK_SIZE, WORLD_CHUNK_LOAD_RADIUS } from "../../lib/game/config";

describe("render-only canopy stress runtime", () => {
  it("lazily builds tiled LOD instances, rebuilds load, and unloads cleanly", () => {
    const scene = new THREE.Scene();
    const materials = new WorldMaterialLibrary();
    const fixture = new ForestStressTest(scene, "cinematic", materials);
    expect(fixture.setLevel(0)).toBe(true);
    expect(fixture.diagnostics.active).toBe(false);
    expect(fixture.update(
      CANOPY_BENCHMARK_ZONE.center.x,
      CANOPY_BENCHMARK_ZONE.center.z,
    )).toBe(true);
    expect(fixture.diagnostics).toMatchObject({
      active: true,
      level: 0,
      trees: 0,
      groundcover: 0,
      rocks: 0,
      reeds: 0,
      activeLodInstances: 0,
      renderOnly: true,
    });
    expect(fixture.setLevel(1)).toBe(true);
    expect(fixture.diagnostics).toMatchObject({
      active: true,
      level: 1,
      trees: 1_500,
      groundcover: 6_000,
      rocks: 250,
      reeds: 512,
      renderOnly: true,
    });
    expect(fixture.diagnostics.tiles).toBeGreaterThan(40);
    expect(fixture.diagnostics.tiles).toBeLessThanOrEqual(49);
    expect(fixture.diagnostics.nearTiles).toBeGreaterThan(0);
    expect(fixture.diagnostics.midTiles).toBeGreaterThan(0);
    expect(fixture.diagnostics.farTiles).toBeGreaterThan(0);
    expect(fixture.diagnostics.allocatedInstances)
      .toBeGreaterThan(fixture.diagnostics.authoredInstances);
    const root = scene.getObjectByName("benchmark:canopy-load-lab");
    expect(root?.userData).toMatchObject({
      benchmarkFixture: true,
      renderOnly: true,
    });
    const lods: THREE.LOD[] = [];
    root?.traverse((object) => {
      if (object instanceof THREE.LOD) lods.push(object);
    });
    expect(lods).toHaveLength(fixture.diagnostics.tiles);
    expect(lods.every((lod) => lod.levels.length === 3)).toBe(true);
    expect(materials.diagnostics.trackedMaterials).toBeGreaterThan(0);

    expect(fixture.setQuality("performance")).toBe(true);
    root?.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) expect(object.castShadow).toBe(false);
    });
    const cachedActiveLod = fixture.diagnostics.activeLodInstances;
    fixture.update(
      CANOPY_BENCHMARK_ZONE.center.x + 0.5,
      CANOPY_BENCHMARK_ZONE.center.z,
    );
    expect(fixture.diagnostics.activeLodInstances).toBe(cachedActiveLod);
    expect(fixture.setLevel(2)).toBe(true);
    expect(fixture.diagnostics.trees).toBe(3_000);
    expect(fixture.diagnostics.rebuilds).toBe(3);
    expect(fixture.setLevel(5)).toBe(true);
    expect(fixture.diagnostics).toMatchObject({
      trees: 20_000,
      groundcover: 80_000,
      rocks: 1_600,
      reeds: 4_096,
      rebuilds: 4,
    });
    expect(fixture.update(
      CANOPY_BENCHMARK_ZONE.center.x + CANOPY_BENCHMARK_ZONE.unloadRadius + 1,
      CANOPY_BENCHMARK_ZONE.center.z,
    )).toBe(false);
    expect(fixture.diagnostics.active).toBe(false);
    expect(scene.getObjectByName("benchmark:canopy-load-lab")).toBeUndefined();
    expect(materials.diagnostics.trackedMaterials).toBe(0);
    expect(fixture.update(
      CANOPY_BENCHMARK_ZONE.center.x,
      CANOPY_BENCHMARK_ZONE.center.z,
      false,
    )).toBe(false);
    expect(fixture.diagnostics.active).toBe(false);
    fixture.dispose();
    fixture.dispose();
    materials.dispose();
  });

  it("keeps one shared-water lake resident across chunk churn and disposes it", () => {
    const scene = new THREE.Scene();
    const world = new ChunkManager(scene, "performance");
    const persistentLake = scene.getObjectByName("canopy-benchmark-lake");
    expect(persistentLake).toBeInstanceOf(THREE.Mesh);
    const lake = persistentLake as THREE.Mesh;
    let geometryDisposals = 0;
    lake.geometry.addEventListener("dispose", () => {
      geometryDisposals += 1;
    });
    world.update(
      CANOPY_BENCHMARK_ZONE.center.x,
      CANOPY_BENCHMARK_ZONE.center.z,
    );
    const lakes: THREE.Object3D[] = [];
    scene.traverse((object) => {
      if (object.name === "canopy-benchmark-lake") lakes.push(object);
    });
    expect(lakes).toHaveLength(1);
    expect(lakes[0]).toBe(lake);
    expect(lakes[0].position.y).toBe(
      CANOPY_BENCHMARK_ZONE.lakeSurfaceY +
        CANOPY_BENCHMARK_ZONE.lakeRenderOffset,
    );
    expect(lakes[0].userData).toMatchObject({
      benchmarkFixture: true,
      persistentWorldSurface: true,
    });
    lake.geometry.computeBoundingSphere();
    expect(lake.geometry.boundingSphere?.radius).toBeCloseTo(
      CANOPY_BENCHMARK_ZONE.lakeRadius +
        CANOPY_BENCHMARK_ZONE.lakeSurfaceOverlap,
      5,
    );
    expect(world.loadedCount).toBe(81);
    world.update(
      CANOPY_BENCHMARK_ZONE.center.x +
        CHUNK_SIZE * (WORLD_CHUNK_LOAD_RADIUS + 2),
      CANOPY_BENCHMARK_ZONE.center.z,
    );
    expect(scene.getObjectByName("canopy-benchmark-lake")).toBe(lake);
    expect(geometryDisposals).toBe(0);
    world.dispose();
    expect(scene.getObjectByName("canopy-benchmark-lake")).toBeUndefined();
    expect(geometryDisposals).toBe(1);
  });

  it("roots shoreline reeds at their sampled terrain height", () => {
    const scene = new THREE.Scene();
    const materials = new WorldMaterialLibrary();
    const fixture = new ForestStressTest(scene, "performance", materials);
    fixture.setLevel(1);
    fixture.update(
      CANOPY_BENCHMARK_ZONE.center.x,
      CANOPY_BENCHMARK_ZONE.center.z,
    );
    const reeds = scene.getObjectByName("benchmark:lake-reeds");
    expect(reeds).toBeInstanceOf(THREE.InstancedMesh);
    const reedMesh = reeds as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    reedMesh.getMatrixAt(0, matrix);
    position.setFromMatrixPosition(matrix);
    const firstPoint = generateCanopyBenchmarkReeds(512)[0];
    expect(position.y).toBeCloseTo(
      sampleTerrainHeight(firstPoint.x, firstPoint.z),
      5,
    );
    fixture.dispose();
    materials.dispose();
  });
});
