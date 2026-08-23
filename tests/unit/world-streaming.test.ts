import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  GAMEPLAY_CHUNK_RADIUS,
  PLAYER_RADIUS,
  WORLD_CHUNK_LOAD_RADIUS,
  WORLD_RESIDENT_CHUNKS,
} from "../../lib/game/config";
import { isPlanarPositionClear } from "../../lib/game/systems/collision";
import { ChunkManager } from "../../lib/game/world/ChunkManager";
import {
  getFastTravelLocation,
  resolveFastTravelArrival,
} from "../../lib/game/world/fastTravel";
import { getSettlement } from "../../lib/game/world/macroWorld";
import { worldToChunk } from "../../lib/game/world/terrain";

function loadedChunkCoordinates(scene: THREE.Scene) {
  return scene.children.flatMap((child) => {
    if (!(child instanceof THREE.Group) || !child.name.startsWith("chunk:")) {
      return [];
    }
    const [x, z] = child.name.slice("chunk:".length).split(":").map(Number);
    return [{ x, z }];
  });
}

describe("progressive world streaming", () => {
  it(
    "loads a dense destination center-outward and cancels stale work",
    { timeout: 20_000 },
    () => {
      const city = getSettlement("vesper-crown");
      const village = getSettlement("dustmere");
      expect(city).not.toBeNull();
      expect(village).not.toBeNull();
      if (!city || !village) return;

      const scene = new THREE.Scene();
      const world = new ChunkManager(scene, "performance");
      world.update(city.x, city.z);
      expect(world.streamingSnapshot).toEqual({
        loaded: 1,
        pending: WORLD_RESIDENT_CHUNKS - 1,
        desired: WORLD_RESIDENT_CHUNKS,
        ready: false,
      });

      for (let index = 0; index < 24; index += 1) {
        expect(world.advanceStreaming(1)).toBe(true);
      }
      expect(world.streamingSnapshot.loaded).toBe(25);
      expect(world.streamingSnapshot.pending).toBe(56);
      const cityCenter = worldToChunk(city.x, city.z);
      expect(loadedChunkCoordinates(scene).every((coordinate) =>
        Math.abs(coordinate.x - cityCenter.x) <= GAMEPLAY_CHUNK_RADIUS &&
        Math.abs(coordinate.z - cityCenter.z) <= GAMEPLAY_CHUNK_RADIUS,
      )).toBe(true);

      const beforeInvalidBudgets = world.streamingSnapshot.loaded;
      world.advanceStreaming(Number.NaN);
      expect(world.streamingSnapshot.loaded).toBe(beforeInvalidBudgets + 1);
      world.advanceStreaming(Number.POSITIVE_INFINITY);
      expect(world.streamingSnapshot.loaded).toBe(beforeInvalidBudgets + 2);

      world.update(village.x, village.z);
      expect(world.streamingSnapshot).toEqual({
        loaded: 1,
        pending: WORLD_RESIDENT_CHUNKS - 1,
        desired: WORLD_RESIDENT_CHUNKS,
        ready: false,
      });
      world.advanceStreaming(1);
      const villageCenter = worldToChunk(village.x, village.z);
      expect(loadedChunkCoordinates(scene).every((coordinate) =>
        Math.abs(coordinate.x - villageCenter.x) <= WORLD_CHUNK_LOAD_RADIUS &&
        Math.abs(coordinate.z - villageCenter.z) <= WORLD_CHUNK_LOAD_RADIUS,
      )).toBe(true);

      world.flushStreamingForTests();
      expect(world.streamingSnapshot).toEqual({
        loaded: WORLD_RESIDENT_CHUNKS,
        pending: 0,
        desired: WORLD_RESIDENT_CHUNKS,
        ready: true,
      });
      world.dispose();
    },
  );

  it(
    "queues only the nine new chunks at Dustmere's half-kilometer boundary",
    { timeout: 20_000 },
    () => {
      const village = getSettlement("dustmere");
      expect(village).not.toBeNull();
      if (!village) return;
      const scene = new THREE.Scene();
      const world = new ChunkManager(scene, "performance");

      world.update(village.x + 616, village.z);
      world.flushStreamingForTests();
      world.update(village.x + 520, village.z);
      expect(world.streamingSnapshot).toEqual({
        loaded: 72,
        pending: 9,
        desired: WORLD_RESIDENT_CHUNKS,
        ready: false,
      });
      world.advanceStreaming(1);
      expect(world.streamingSnapshot.loaded).toBe(73);
      expect(world.streamingSnapshot.pending).toBe(8);
      world.dispose();
    },
  );

  it(
    "primes a bounded collision neighborhood before committing city travel",
    { timeout: 20_000 },
    () => {
      const location = getFastTravelLocation("settlement:ironvale");
      expect(location).not.toBeNull();
      if (!location) return;
      const scene = new THREE.Scene();
      const world = new ChunkManager(scene, "performance");

      const preliminary = resolveFastTravelArrival(location);
      world.update(preliminary.x, preliminary.z);
      world.primeCollisionNeighborhood(preliminary.x, preliminary.z);
      expect(world.streamingSnapshot.loaded).toBe(9);
      expect(world.streamingSnapshot.pending).toBe(72);

      let arrival = resolveFastTravelArrival(location, world.colliders);
      world.update(arrival.x, arrival.z);
      world.primeCollisionNeighborhood(arrival.x, arrival.z);
      arrival = resolveFastTravelArrival(location, world.colliders);
      expect(isPlanarPositionClear(
        { x: arrival.x, z: arrival.z },
        world.colliders,
        PLAYER_RADIUS,
      )).toBe(true);
      expect(world.streamingSnapshot.loaded).toBeLessThanOrEqual(18);
      expect(world.streamingSnapshot.pending).toBeGreaterThan(0);
      world.dispose();
    },
  );
});
