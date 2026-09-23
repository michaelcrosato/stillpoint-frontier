import type * as THREE from "three";

type CachedResource = THREE.Material | THREE.BufferGeometry;

interface CachedAsset {
  kind: "material" | "geometry";
  resource: CachedResource;
  leases: number;
}

/**
 * Geometry and materials that are identical in every chunk, created once per
 * key and shared by the chunks that use them. Each chunk holds a lease; an
 * asset is disposed exactly once, when the last lease holding it is released
 * (or when the cache itself is disposed), so content the player has left
 * behind does not stay on the GPU. Chunk disposal must skip what the cache
 * owns and release its lease instead.
 *
 * Only share what no chunk mutates: a material whose state differs between
 * chunks or targets (container glow, a scanned beacon) must stay per instance.
 */
export class ChunkAssetCache {
  private readonly assets = new Map<string, CachedAsset>();
  private readonly owned = new Set<object>();

  /** A handle for one chunk: each asset counts once per lease. */
  lease() {
    return new ChunkAssetLease(this);
  }

  owns(resource: object) {
    return this.owned.has(resource);
  }

  get size() {
    let materials = 0;
    let geometries = 0;
    for (const asset of this.assets.values()) {
      if (asset.kind === "material") materials += 1;
      else geometries += 1;
    }
    return { materials, geometries };
  }

  dispose() {
    for (const asset of this.assets.values()) asset.resource.dispose();
    this.assets.clear();
    this.owned.clear();
  }

  /** @internal Used by ChunkAssetLease. */
  acquire<T extends CachedResource>(
    kind: CachedAsset["kind"],
    key: string,
    create: () => T,
  ): T {
    const id = `${kind}:${key}`;
    let asset = this.assets.get(id);
    if (!asset) {
      asset = { kind, resource: create(), leases: 0 };
      this.assets.set(id, asset);
      this.owned.add(asset.resource);
    }
    asset.leases += 1;
    return asset.resource as T;
  }

  /** @internal Used by ChunkAssetLease. */
  releaseOne(kind: CachedAsset["kind"], key: string) {
    const id = `${kind}:${key}`;
    const asset = this.assets.get(id);
    if (!asset) return;
    asset.leases -= 1;
    if (asset.leases > 0) return;
    this.assets.delete(id);
    this.owned.delete(asset.resource);
    asset.resource.dispose();
  }
}

export class ChunkAssetLease {
  private readonly held = new Map<string, { kind: "material" | "geometry"; key: string; resource: CachedResource }>();
  private released = false;

  constructor(private readonly cache: ChunkAssetCache) {}

  material<T extends THREE.Material>(key: string, create: () => T): T {
    return this.take("material", key, create);
  }

  geometry<T extends THREE.BufferGeometry>(key: string, create: () => T): T {
    return this.take("geometry", key, create);
  }

  /** Returns every asset this lease holds; the last holder disposes it. */
  release() {
    if (this.released) return;
    this.released = true;
    for (const { kind, key } of this.held.values()) this.cache.releaseOne(kind, key);
    this.held.clear();
  }

  private take<T extends CachedResource>(
    kind: "material" | "geometry",
    key: string,
    create: () => T,
  ): T {
    if (this.released) throw new Error("ChunkAssetLease used after release");
    const id = `${kind}:${key}`;
    const held = this.held.get(id);
    if (held) return held.resource as T;
    const resource = this.cache.acquire(kind, key, create);
    this.held.set(id, { kind, key, resource });
    return resource;
  }
}
