import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  proceduralSurfaceColor,
  sampleSurfaceNoise,
  sampleTerrainSlope,
  terrainSurfaceColor,
  terrainSurfaceFactors,
} from "../../lib/game/world/surfaceVariation";
import { sampleTerrainHeight } from "../../lib/game/world/terrain";

describe("deterministic surface variation", () => {
  it("is stable, finite, and bounded across the world", () => {
    const points = [
      [-6_400, -6_400],
      [-2_320.5, 904.25],
      [0, 0],
      [1_700.75, -3_880.5],
      [6_400, 6_400],
    ] as const;
    for (const [x, z] of points) {
      const height = sampleTerrainHeight(x, z);
      const first = sampleSurfaceNoise(x, z);
      const second = sampleSurfaceNoise(x, z);
      const factors = terrainSurfaceFactors(x, z, height);
      const color = terrainSurfaceColor(new THREE.Color(), x, z, height);
      expect(first).toBe(second);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThanOrEqual(1);
      expect(factors.slope).toBeGreaterThanOrEqual(0);
      expect(factors.slope).toBeLessThanOrEqual(1);
      expect(factors.moisture).toBeGreaterThanOrEqual(0);
      expect(factors.elevation).toBeGreaterThanOrEqual(0);
      expect(color.toArray().every(Number.isFinite)).toBe(true);
      expect(color.toArray().every((channel) => channel >= 0 && channel <= 1)).toBe(true);
    }
  });

  it("changes continuously in world space without chunk-local seams", () => {
    const left = terrainSurfaceColor(
      new THREE.Color(),
      47.999,
      -31,
      sampleTerrainHeight(47.999, -31),
    );
    const right = terrainSurfaceColor(
      new THREE.Color(),
      48.001,
      -31,
      sampleTerrainHeight(48.001, -31),
    );
    expect(Math.hypot(left.r - right.r, left.g - right.g, left.b - right.b)).toBeLessThan(0.01);
    expect(sampleTerrainSlope(Number.NaN, Number.POSITIVE_INFINITY)).toBeGreaterThanOrEqual(0);
    expect(sampleSurfaceNoise(Number.NaN, 3, Number.NaN)).toBeGreaterThanOrEqual(0);
  });

  it("provides restrained but distinct object palettes", () => {
    const colors = (["building", "road", "rock"] as const).map((kind) =>
      proceduralSurfaceColor(new THREE.Color(), 0x62605a, kind, 127.3, -82.4).getHex(),
    );
    expect(new Set(colors).size).toBe(3);
    expect(
      proceduralSurfaceColor(new THREE.Color(), 0x62605a, "rock", 127.3, -82.4).getHex(),
    ).toBe(colors[2]);
    expect(sampleSurfaceNoise(127.3, -82.4)).not.toBe(sampleSurfaceNoise(428.9, 211.6));
  });

  it("removes unresolvable color frequencies from coarse horizon cells", () => {
    expect(sampleSurfaceNoise(127.3, -82.4, 0, 512)).toBe(0.5);
    expect(sampleSurfaceNoise(127.3, -82.4, 0, 24)).not.toBe(0.5);
    const color = terrainSurfaceColor(
      new THREE.Color(),
      127.3,
      -82.4,
      sampleTerrainHeight(127.3, -82.4),
      768,
    );
    expect(color.toArray().every(Number.isFinite)).toBe(true);
    expect(terrainSurfaceFactors(127.3, -82.4, 12, 24, 3).slope).toBe(1);
  });
});
