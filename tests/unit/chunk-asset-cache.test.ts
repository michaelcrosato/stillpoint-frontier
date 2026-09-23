import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { CHUNK_SIZE } from "../../lib/game/config";
import { ChunkAssetCache } from "../../lib/game/world/ChunkAssetCache";
import { ChunkManager } from "../../lib/game/world/ChunkManager";

describe("chunk asset cache", () => {
  it("creates each keyed asset once and counts a lease once", () => {
    const cache = new ChunkAssetCache();
    const lease = cache.lease();
    const createMaterial = vi.fn(() => new THREE.MeshStandardMaterial());
    const createGeometry = vi.fn(() => new THREE.BoxGeometry());
    const material = lease.material("rock", createMaterial);
    expect(lease.material("rock", createMaterial)).toBe(material);
    const geometry = lease.geometry("rock", createGeometry);
    expect(cache.lease().geometry("rock", createGeometry)).toBe(geometry);
    expect(createMaterial).toHaveBeenCalledTimes(1);
    expect(createGeometry).toHaveBeenCalledTimes(1);
    expect(cache.owns(material)).toBe(true);
    expect(cache.owns(geometry)).toBe(true);
    expect(cache.owns(new THREE.MeshStandardMaterial())).toBe(false);
  });

  it("keeps an asset while any lease holds it and disposes it once with the last", () => {
    const cache = new ChunkAssetCache();
    const first = cache.lease();
    const second = cache.lease();
    const geometry = first.geometry("rock", () => new THREE.BoxGeometry());
    second.geometry("rock", () => new THREE.BoxGeometry());
    second.geometry("rock", () => new THREE.BoxGeometry());
    const dispose = vi.spyOn(geometry, "dispose");
    first.release();
    first.release();
    expect(dispose).not.toHaveBeenCalled();
    expect(cache.owns(geometry)).toBe(true);
    second.release();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(cache.owns(geometry)).toBe(false);
    expect(cache.size).toEqual({ materials: 0, geometries: 0 });
  });

  it("disposes whatever is still held exactly once when the cache is disposed", () => {
    const cache = new ChunkAssetCache();
    const lease = cache.lease();
    const material = lease.material("rock", () => new THREE.MeshStandardMaterial());
    const dispose = vi.spyOn(material, "dispose");
    cache.dispose();
    lease.release();
    cache.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe("chunk asset sharing", () => {
  function meshNamed(scene: THREE.Scene, name: string) {
    const object = scene.getObjectByName(name);
    expect(object).toBeInstanceOf(THREE.InstancedMesh);
    return object as THREE.InstancedMesh;
  }

  it("shares rock assets across chunks and keeps them until no chunk uses them", () => {
    const scene = new THREE.Scene();
    const world = new ChunkManager(scene, "performance");
    world.update(0, 0);
    const west = meshNamed(scene, "rocks:0:0");
    const east = meshNamed(scene, "rocks:1:0");
    expect(east.geometry).toBe(west.geometry);
    expect(east.material).toBe(west.material);
    const disposeGeometry = vi.spyOn(west.geometry, "dispose");
    const disposeMaterial = vi.spyOn(west.material as THREE.Material, "dispose");

    // Step one chunk east: the western column unloads, the rest stays.
    world.update(CHUNK_SIZE, 0);
    expect(scene.getObjectByName("rocks:1:0")).toBeDefined();
    expect(disposeGeometry).not.toHaveBeenCalled();
    expect(disposeMaterial).not.toHaveBeenCalled();

    world.dispose();
    expect(disposeGeometry).toHaveBeenCalledTimes(1);
    expect(disposeMaterial).toHaveBeenCalledTimes(1);
  }, 20_000);

  it("releases assets for content left behind, so churn returns to the same set", () => {
    const scene = new THREE.Scene();
    const world = new ChunkManager(scene, "performance");
    world.update(0, 8);
    const home = world.sharedAssets;
    for (const [x, z] of [[2_000, 2_000], [-3_000, 1_500], [4_500, -4_500]] as const) {
      world.update(x, z);
    }
    expect(world.sharedAssets.geometries).toBeGreaterThan(0);
    world.update(0, 8);
    expect(world.sharedAssets).toEqual(home);
    world.dispose();
    expect(world.sharedAssets).toEqual({ materials: 0, geometries: 0 });
  }, 30_000);

  it("keeps a harvest to the harvested chunk's instances", () => {
    const scene = new THREE.Scene();
    const world = new ChunkManager(scene, "performance");
    world.update(0, 0);
    const target = world.targets.find((candidate) => candidate.id.startsWith("resource:rock:v2:0:0:"));
    expect(target).toBeDefined();
    const neighbour = meshNamed(scene, "rocks:1:0");
    const before = Array.from(neighbour.instanceMatrix.array);
    world.applyEntityDiff(target!.id, { hits: 0, removed: true });
    expect(Array.from(neighbour.instanceMatrix.array)).toEqual(before);
    world.dispose();
  }, 20_000);
});
