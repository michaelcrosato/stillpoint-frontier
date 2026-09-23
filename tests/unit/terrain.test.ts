import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CHUNK_SIZE } from "../../lib/game/config";
import {
  chunkCenter,
  chunkKey,
  chunksAround,
  sampleTerrainHeight,
  sampleTerrainHeightLod,
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
      // Approach the seam from the chunk on either side. Sampling the same point
      // twice cannot fail; a step change across the boundary is the actual defect
      // a per-chunk height function would introduce.
      const left = sampleTerrainHeight(seamX - 1e-3, z);
      const right = sampleTerrainHeight(seamX + 1e-3, z);
      expect(Math.abs(right - left)).toBeLessThan(1e-2);
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

  it("low-pass filters the shortest terrain wave for coarse HLOD grids", () => {
    const x = 13.7;
    const z = 29.1;
    expect(sampleTerrainHeightLod(x, z, 0)).toBe(sampleTerrainHeight(x, z));
    expect(sampleTerrainHeightLod(x, z, 48)).not.toBe(sampleTerrainHeight(x, z));
    expect(Number.isFinite(sampleTerrainHeightLod(x, z, 1_536))).toBe(true);
  });
});

describe("terrain height goldens", () => {
  // Saves store literal world positions, so a change to these heights moves
  // saved players and camps. Change them deliberately, never to pass a test.
  it.each([
    ["the spawn", 0, 0, 10.6928],
    ["a chunk seam", 48, 0, 11.6313],
    ["dry Sunscar Canyon floor", 37_100, -13_485, -640.5649],
    ["the Sunscar Canyon channel", 37_005, -13_455, -657.68],
    ["the mountain summit", -8_640, -4_800, 1_198.9395],
    ["Ironvale", -23_850, -23_275, 5.3265],
    ["a far survey point", 12_345, -6_789, 7.6034],
    ["a far survey point", -40_000, 35_000, 18.3529],
    ["a far survey point", 47_000, -47_000, 71.3717],
  ])("holds %s (%d, %d) at its recorded height", (_place, x, z, height) => {
    expect(sampleTerrainHeight(x, z)).toBeCloseTo(height, 3);
  });
});
