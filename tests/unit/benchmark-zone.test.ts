import { describe, expect, it } from "vitest";
import {
  CANOPY_BENCHMARK_LEVELS,
  CANOPY_BENCHMARK_ZONE,
  applyCanopyBenchmarkTerrainHeight,
  canopyBenchmarkArrivalChunk,
  canopyBenchmarkDistance,
  generateCanopyBenchmarkPoints,
  generateCanopyBenchmarkReeds,
  isCanopyBenchmarkClearing,
  isCanopyBenchmarkLake,
  normalizeCanopyBenchmarkLevel,
} from "../../lib/game/world/benchmarkZone";
import {
  sampleTerrainHeight,
  sampleHorizonTerrainHeight,
  sampleTerrainHeightLod,
  worldToChunk,
} from "../../lib/game/world/terrain";
import { CAMERA_DRAW_DISTANCE } from "../../lib/game/config";

describe("canopy benchmark zone", () => {
  it("anchors the isolated site and its cleared overlook deterministically", () => {
    expect(worldToChunk(
      CANOPY_BENCHMARK_ZONE.center.x,
      CANOPY_BENCHMARK_ZONE.center.z,
    )).toEqual({ x: 64, z: -60 });
    expect(canopyBenchmarkArrivalChunk()).toEqual({ x: 64, z: -62 });
    expect(canopyBenchmarkDistance(
      CANOPY_BENCHMARK_ZONE.center.x,
      CANOPY_BENCHMARK_ZONE.center.z,
    )).toBe(0);
    expect(isCanopyBenchmarkClearing(
      CANOPY_BENCHMARK_ZONE.arrival.x,
      CANOPY_BENCHMARK_ZONE.arrival.z,
    )).toBe(true);
  });

  it("defines monotonic bounded graphics load stops", () => {
    expect(CANOPY_BENCHMARK_LEVELS[0]).toMatchObject({
      id: "baseline",
      trees: 0,
      groundcover: 0,
      rocks: 0,
      reeds: 0,
    });
    for (let index = 1; index < CANOPY_BENCHMARK_LEVELS.length; index += 1) {
      const previous = CANOPY_BENCHMARK_LEVELS[index - 1];
      const current = CANOPY_BENCHMARK_LEVELS[index];
      expect(current.trees).toBeGreaterThan(previous.trees);
      expect(current.groundcover).toBeGreaterThan(previous.groundcover);
      expect(current.rocks).toBeGreaterThan(previous.rocks);
      expect(current.reeds).toBeGreaterThan(previous.reeds);
    }
    expect(CANOPY_BENCHMARK_LEVELS.at(-1)?.trees).toBe(20_000);
    expect(CANOPY_BENCHMARK_LEVELS.at(-1)?.groundcover).toBe(80_000);
    expect(normalizeCanopyBenchmarkLevel(-20)).toBe(0);
    expect(normalizeCanopyBenchmarkLevel(2.7)).toBe(3);
    expect(normalizeCanopyBenchmarkLevel(99)).toBe(5);
    expect(normalizeCanopyBenchmarkLevel(Number.NaN)).toBe(2);
    expect(
      CANOPY_BENCHMARK_ZONE.activationRadius -
        CANOPY_BENCHMARK_ZONE.forestRadius,
    ).toBeGreaterThan(CAMERA_DRAW_DISTANCE);
    expect(CANOPY_BENCHMARK_ZONE.unloadRadius).toBeGreaterThan(
      CANOPY_BENCHMARK_ZONE.activationRadius,
    );
  });

  it("generates stable prefixes that never occupy the lake or approach", () => {
    const short = generateCanopyBenchmarkPoints("trees", 80);
    const long = generateCanopyBenchmarkPoints("trees", 160);
    expect(long.slice(0, short.length)).toEqual(short);
    expect(short).toHaveLength(80);
    for (const point of long) {
      expect(Number.isFinite(point.x + point.z + point.scale + point.yaw)).toBe(true);
      expect(canopyBenchmarkDistance(point.x, point.z)).toBeLessThanOrEqual(
        CANOPY_BENCHMARK_ZONE.forestRadius,
      );
      expect(isCanopyBenchmarkClearing(point.x, point.z, 1.8)).toBe(false);
    }
    expect(generateCanopyBenchmarkPoints("rocks", -3)).toEqual([]);
  });

  it("places deterministic reeds around the water edge", () => {
    const reeds = generateCanopyBenchmarkReeds(64);
    expect(reeds).toEqual(generateCanopyBenchmarkReeds(64));
    expect(reeds).toHaveLength(64);
    for (const reed of reeds) {
      const distance = canopyBenchmarkDistance(reed.x, reed.z);
      expect(distance).toBeGreaterThan(CANOPY_BENCHMARK_ZONE.lakeRadius);
      expect(distance).toBeLessThan(CANOPY_BENCHMARK_ZONE.shorelineRadius);
    }
    expect(generateCanopyBenchmarkReeds(Number.NaN)).toEqual([]);
  });

  it("carves one shallow continuous lake and leaves outside terrain unchanged", () => {
    const zone = CANOPY_BENCHMARK_ZONE;
    const centerHeight = sampleTerrainHeight(zone.center.x, zone.center.z);
    expect(centerHeight).toBeLessThan(zone.lakeSurfaceY);
    expect(centerHeight).toBeCloseTo(zone.lakeBedY, 5);
    expect(sampleTerrainHeightLod(zone.center.x, zone.center.z, 192))
      .toBeLessThan(zone.lakeSurfaceY);
    expect(sampleHorizonTerrainHeight(zone.center.x, zone.center.z))
      .toBeLessThan(zone.lakeSurfaceY);
    expect(isCanopyBenchmarkLake(zone.center.x, zone.center.z)).toBe(true);
    expect(applyCanopyBenchmarkTerrainHeight(
      11.25,
      zone.center.x + zone.lakeRadius,
      zone.center.z,
    )).toBeCloseTo(zone.lakeSurfaceY, 8);
    for (let index = 0; index < 32; index += 1) {
      const angle = (index / 32) * Math.PI * 2;
      expect(sampleTerrainHeight(
        zone.center.x + Math.cos(angle) * zone.lakeRadius,
        zone.center.z + Math.sin(angle) * zone.lakeRadius,
      )).toBeCloseTo(zone.lakeSurfaceY, 5);
    }
    const outerX = zone.center.x + zone.shorelineRadius;
    expect(applyCanopyBenchmarkTerrainHeight(11.25, outerX, zone.center.z))
      .toBe(11.25);
    const justInside = applyCanopyBenchmarkTerrainHeight(
      11.25,
      outerX - 0.001,
      zone.center.z,
    );
    expect(Math.abs(justInside - 11.25)).toBeLessThan(0.001);
    expect(applyCanopyBenchmarkTerrainHeight(Number.NaN, 0, 0)).toBeNaN();
  });
});
