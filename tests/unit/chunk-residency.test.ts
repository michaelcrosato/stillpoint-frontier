import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { WORLD_CHUNK_LOAD_RADIUS } from "../../lib/game/config";
import { ChunkManager } from "../../lib/game/world/ChunkManager";

describe("chunk neighborhood replacement", () => {
  // Builds the full 81-chunk neighborhood four times over. This is deterministic
  // work that legitimately exceeds the 5s default on a loaded runner, matching the
  // explicit budgets already used in world-colliders.test.ts.
  it("bounds transient residency and retries a failed teleport with fresh gameplay caches", { timeout: 20_000 }, () => {
    const scene = new THREE.Scene();
    const world = new ChunkManager(scene, "performance");
    const limit = (WORLD_CHUNK_LOAD_RADIUS * 2 + 1) ** 2;
    let peak = 0;
    const add = scene.add.bind(scene);
    vi.spyOn(scene, "add").mockImplementation((...objects) => {
      const result = add(...objects);
      peak = Math.max(peak, scene.children.filter((child) => child.name.startsWith("chunk:")).length);
      return result;
    });
    try {
      world.update(0, 0);
      expect(world.loadedCount).toBe(limit);
      world.update(10_000, 10_000);
      expect(world.loadedCount).toBe(limit);
      expect(peak).toBe(limit);
      const oldTargets = new Set(world.targets.map((target) => target.id));
      // Fail before a new chunk is built, after departures have been retired.
      const loader = vi.spyOn(world as unknown as { loadChunk(x: number, z: number): void }, "loadChunk");
      loader.mockImplementationOnce(() => { throw new Error("injected chunk failure"); });
      expect(() => world.update(20_000, 20_000)).toThrow("injected chunk failure");
      expect(world.loadedCount).toBe(0);
      expect(world.targets.some((target) => oldTargets.has(target.id))).toBe(false);
      expect(world.update(20_000, 20_000)).toBe(true);
      expect(world.loadedCount).toBe(limit);
      expect(peak).toBe(limit);
      expect(world.targets.some((target) => oldTargets.has(target.id))).toBe(false);
      expect(world.update(20_000, 20_000)).toBe(false);
    } finally {
      world.dispose();
      vi.restoreAllMocks();
    }
    expect(scene.children.filter((child) => child.name.startsWith("chunk:"))).toHaveLength(0);
  });
});
