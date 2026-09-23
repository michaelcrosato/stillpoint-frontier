import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WORLD_CHUNK_LOAD_RADIUS } from "../../lib/game/config";
import { ChunkManager } from "../../lib/game/world/ChunkManager";

const NEIGHBORHOOD = (WORLD_CHUNK_LOAD_RADIUS * 2 + 1) ** 2;

interface ChunkBuilders {
  addRuinSlabs(root: THREE.Group, ...rest: unknown[]): void;
  applyNightLighting(lighting: unknown): void;
}

function chunkRoots(scene: THREE.Scene) {
  return scene.children.filter((child) => child.name.startsWith("chunk:"));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("chunk load failure", () => {
  it("disposes a partly built chunk and releases its shared assets", () => {
    const scene = new THREE.Scene();
    const world = new ChunkManager(scene, "performance");
    const builders = world as unknown as ChunkBuilders;
    let partial: THREE.Group | undefined;
    let terrainDispose: ReturnType<typeof vi.spyOn> | undefined;
    vi.spyOn(builders, "addRuinSlabs").mockImplementationOnce((root: THREE.Group) => {
      partial = root;
      const terrain = root.children.find((child) => child.name.startsWith("terrain:"));
      expect(terrain).toBeInstanceOf(THREE.Mesh);
      terrainDispose = vi.spyOn((terrain as THREE.Mesh).geometry, "dispose");
      throw new Error("injected builder failure");
    });
    try {
      expect(() => world.update(0, 0)).toThrow("injected builder failure");
      expect(partial).toBeDefined();
      expect(chunkRoots(scene)).toHaveLength(0);
      expect(world.loadedCount).toBe(0);
      expect(terrainDispose).toHaveBeenCalledTimes(1);
      expect(world.sharedAssets).toEqual({ materials: 0, geometries: 0 });
      expect(world.update(0, 0)).toBe(true);
      expect(world.loadedCount).toBe(NEIGHBORHOOD);
    } finally {
      world.dispose();
    }
  });

  it("does not keep a chunk whose final lighting pass fails", () => {
    const scene = new THREE.Scene();
    const world = new ChunkManager(scene, "performance");
    const builders = world as unknown as ChunkBuilders;
    vi.spyOn(builders, "applyNightLighting").mockImplementationOnce(() => {
      throw new Error("injected lighting failure");
    });
    try {
      expect(() => world.update(0, 0)).toThrow("injected lighting failure");
      expect(world.loadedCount).toBe(0);
      expect(chunkRoots(scene)).toHaveLength(0);
      expect(world.sharedAssets).toEqual({ materials: 0, geometries: 0 });
      expect(world.update(0, 0)).toBe(true);
      expect(world.loadedCount).toBe(NEIGHBORHOOD);
      expect(chunkRoots(scene)).toHaveLength(NEIGHBORHOOD);
    } finally {
      world.dispose();
    }
  });
});
