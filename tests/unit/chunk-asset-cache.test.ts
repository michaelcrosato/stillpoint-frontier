import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { CHUNK_SIZE } from "../../lib/game/config";
import { ChunkAssetCache } from "../../lib/game/world/ChunkAssetCache";
import { ChunkManager } from "../../lib/game/world/ChunkManager";

describe("chunk asset cache", () => {
  it("creates each keyed asset once and owns only what it created", () => {
    const cache = new ChunkAssetCache();
    const createMaterial = vi.fn(() => new THREE.MeshStandardMaterial());
    const createGeometry = vi.fn(() => new THREE.BoxGeometry());
    const material = cache.material("rock", createMaterial);
    expect(cache.material("rock", createMaterial)).toBe(material);
    const geometry = cache.geometry("rock", createGeometry);
    expect(cache.geometry("rock", createGeometry)).toBe(geometry);
    expect(createMaterial).toHaveBeenCalledTimes(1);
    expect(createGeometry).toHaveBeenCalledTimes(1);
    expect(cache.owns(material)).toBe(true);
    expect(cache.owns(geometry)).toBe(true);
    expect(cache.owns(new THREE.MeshStandardMaterial())).toBe(false);
  });

  it("disposes every asset exactly once and forgets it", () => {
    const cache = new ChunkAssetCache();
    const material = cache.material("rock", () => new THREE.MeshStandardMaterial());
    const geometry = cache.geometry("rock", () => new THREE.BoxGeometry());
    const disposeMaterial = vi.spyOn(material, "dispose");
    const disposeGeometry = vi.spyOn(geometry, "dispose");
    cache.dispose();
    cache.dispose();
    expect(disposeMaterial).toHaveBeenCalledTimes(1);
    expect(disposeGeometry).toHaveBeenCalledTimes(1);
    expect(cache.owns(material)).toBe(false);
  });
});

describe("chunk asset sharing", () => {
  function meshNamed(scene: THREE.Scene, name: string) {
    const object = scene.getObjectByName(name);
    expect(object).toBeInstanceOf(THREE.InstancedMesh);
    return object as THREE.InstancedMesh;
  }

  it("shares rock assets across chunks and keeps them until the world is disposed", () => {
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
