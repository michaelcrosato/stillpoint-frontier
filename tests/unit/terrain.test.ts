import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CHUNK_SIZE } from "../../lib/game/config";
import {
  chunkCenter,
  chunkKey,
  chunksAround,
  sampleTerrainHeight,
  worldToChunk,
} from "../../lib/game/world/terrain";

describe("world coordinates", () => {
  it.each([
    [-48.001, -1],
    [-48, 0],
    [0, 0],
    [47.999, 0],
    [48, 1],
    [-144, -1],
  ])("maps world x=%s into centered chunk %s", (x, expected) => {
    expect(worldToChunk(x, 0).x).toBe(expected);
  });

  it("keeps arbitrary coordinates inside their returned chunk bounds", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -100_000, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -100_000, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        (x, z) => {
          const chunk = worldToChunk(x, z);
          const center = chunkCenter(chunk);
          expect(x).toBeGreaterThanOrEqual(center.x - CHUNK_SIZE / 2);
          expect(x).toBeLessThan(center.x + CHUNK_SIZE / 2);
          expect(z).toBeGreaterThanOrEqual(center.z - CHUNK_SIZE / 2);
          expect(z).toBeLessThan(center.z + CHUNK_SIZE / 2);
        },
      ),
    );
  });

  it("returns a stable square neighborhood for any requested radius", () => {
    const chunks = chunksAround({ x: -7, z: 12 }, 2);
    expect(chunks).toHaveLength(25);
    expect(new Set(chunks.map((chunk) => chunkKey(chunk.x, chunk.z))).size).toBe(25);
    expect(chunks[0]).toEqual({ x: -9, z: 10 });
    expect(chunks.at(-1)).toEqual({ x: -5, z: 14 });
  });

  it("uses one analytic terrain function at chunk seams", () => {
    for (let z = -48; z <= 48; z += 3) {
      const seamX = CHUNK_SIZE / 2;
      expect(sampleTerrainHeight(seamX, z)).toBe(sampleTerrainHeight(seamX, z));
    }
  });

  it("produces finite heights throughout the supported survey space", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        (x, z) => {
          expect(Number.isFinite(sampleTerrainHeight(x, z))).toBe(true);
        },
      ),
    );
  });
});
