import type * as THREE from "three";

/**
 * Geometry and materials that are identical in every chunk, created once per
 * key and shared by all of them. Chunk disposal must skip what this cache owns;
 * the cache releases each asset exactly once, when the world is disposed.
 *
 * Only share what no chunk mutates: a material whose state differs between
 * chunks or targets (container glow, a scanned beacon) must stay per instance.
 */
export class ChunkAssetCache {
  private readonly materials = new Map<string, THREE.Material>();
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly owned = new Set<object>();

  material<T extends THREE.Material>(key: string, create: () => T): T {
    let material = this.materials.get(key);
    if (!material) {
      material = create();
      this.materials.set(key, material);
      this.owned.add(material);
    }
    return material as T;
  }

  geometry<T extends THREE.BufferGeometry>(key: string, create: () => T): T {
    let geometry = this.geometries.get(key);
    if (!geometry) {
      geometry = create();
      this.geometries.set(key, geometry);
      this.owned.add(geometry);
    }
    return geometry as T;
  }

  owns(resource: object) {
    return this.owned.has(resource);
  }

  get size() {
    return { materials: this.materials.size, geometries: this.geometries.size };
  }

  dispose() {
    for (const geometry of this.geometries.values()) geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.owned.clear();
  }
}
