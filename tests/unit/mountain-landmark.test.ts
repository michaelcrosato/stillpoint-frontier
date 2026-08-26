import { describe, expect, it } from "vitest";
import { WORLD_HALF_EXTENT } from "../../lib/game/world/macroWorld";
import {
  MOUNTAIN_LANDMARK,
  MOUNTAIN_TRAIL_POINTS,
  isMountainTrailClearing,
  mountainGroundcoverFactor,
  mountainFootprintInfluence,
  mountainTrailLength,
  mountainWoodyVegetationFactor,
  nearestMountainTrailPoint,
  sampleMountainLift,
} from "../../lib/game/world/mountainLandmark";
import { mountainTrailSegmentsForChunk } from "../../lib/game/world/roads";
import {
  sampleHorizonTerrainHeight,
  sampleTerrainHeight,
  sampleTerrainHeightLod,
  worldToChunk,
} from "../../lib/game/world/terrain";

describe("Crownspire terrain landmark", () => {
  it("keeps the authored footprint, summit, and trailhead inside the atlas", () => {
    for (const point of [
      MOUNTAIN_LANDMARK.center,
      MOUNTAIN_LANDMARK.summit,
      MOUNTAIN_LANDMARK.baseWaypoint,
      ...MOUNTAIN_TRAIL_POINTS,
    ]) {
      expect(Math.abs(point.x)).toBeLessThan(WORLD_HALF_EXTENT);
      expect(Math.abs(point.z)).toBeLessThan(WORLD_HALF_EXTENT);
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.z)).toBe(true);
    }
    expect(
      Math.abs(MOUNTAIN_LANDMARK.center.x) + MOUNTAIN_LANDMARK.footprintRadius,
    ).toBeLessThan(WORLD_HALF_EXTENT);
    expect(
      Math.abs(MOUNTAIN_LANDMARK.center.z) + MOUNTAIN_LANDMARK.footprintRadius,
    ).toBeLessThan(WORLD_HALF_EXTENT);
  });

  it("has an exact, smooth edge and no effect outside its footprint", () => {
    const radius = MOUNTAIN_LANDMARK.footprintRadius;
    const x = MOUNTAIN_LANDMARK.center.x;
    const z = MOUNTAIN_LANDMARK.center.z;
    expect(sampleMountainLift(x + radius, z)).toBe(0);
    expect(sampleMountainLift(x + radius + 1, z)).toBe(0);
    expect(mountainFootprintInfluence(x + radius, z)).toBe(0);
    expect(sampleMountainLift(x + radius - 1, z)).toBeLessThan(0.001);
  });

  it("transitions from meadow vegetation to an exposed alpine summit", () => {
    const base = MOUNTAIN_LANDMARK.baseWaypoint;
    const summit = MOUNTAIN_LANDMARK.summit;
    expect(mountainWoodyVegetationFactor(base.x, base.z)).toBe(1);
    expect(mountainGroundcoverFactor(base.x, base.z)).toBe(1);
    expect(mountainWoodyVegetationFactor(summit.x, summit.z)).toBe(0);
    expect(mountainGroundcoverFactor(summit.x, summit.z)).toBe(0);
    const upperTrail = MOUNTAIN_TRAIL_POINTS[8];
    expect(mountainGroundcoverFactor(upperTrail.x, upperTrail.z)).toBeGreaterThanOrEqual(
      mountainWoodyVegetationFactor(upperTrail.x, upperTrail.z),
    );
  });

  it("rises far above the tallest skyline proxy and survives every terrain sampler", () => {
    const { x, z } = MOUNTAIN_LANDMARK.summit;
    const rawLift = sampleMountainLift(x, z);
    expect(rawLift).toBeGreaterThan(118 * 8);
    expect(rawLift).toBeLessThan(1_500);
    expect(Math.abs(rawLift - MOUNTAIN_LANDMARK.summitRelief)).toBeLessThan(10);

    const heights = [
      sampleTerrainHeight(x, z),
      sampleTerrainHeightLod(x, z, 1_536),
      sampleHorizonTerrainHeight(x, z),
    ];
    expect(Math.min(...heights)).toBeGreaterThan(1_000);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(12);
  });

  it("authors a continuous, traversable switchback from trailhead to summit", () => {
    expect(MOUNTAIN_TRAIL_POINTS[0]).toMatchObject({
      ...MOUNTAIN_LANDMARK.baseWaypoint,
      progress: 0,
    });
    expect(MOUNTAIN_TRAIL_POINTS.at(-1)).toMatchObject({
      ...MOUNTAIN_LANDMARK.summit,
      progress: 1,
    });
    expect(mountainTrailLength()).toBeGreaterThan(11_000);
    expect(mountainTrailLength()).toBeLessThan(12_000);

    let maximumGrade = 0;
    let maximumLateralGrade = 0;
    for (let index = 0; index < MOUNTAIN_TRAIL_POINTS.length - 1; index += 1) {
      const start = MOUNTAIN_TRAIL_POINTS[index];
      const end = MOUNTAIN_TRAIL_POINTS[index + 1];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const distance = Math.hypot(dx, dz);
      const steps = Math.ceil(distance / 4);
      const perpendicularX = -dz / distance;
      const perpendicularZ = dx / distance;
      let previous: { x: number; z: number; y: number } | null = null;
      for (let step = 0; step <= steps; step += 1) {
        const amount = step / steps;
        const x = start.x + dx * amount;
        const z = start.z + dz * amount;
        const y = sampleTerrainHeight(x, z);
        if (previous) {
          maximumGrade = Math.max(
            maximumGrade,
            Math.abs(y - previous.y) /
              Math.hypot(x - previous.x, z - previous.z),
          );
        }
        previous = { x, z, y };

        if (step % 8 !== 0) continue;
        for (const side of [-1, 1]) {
          const inner = MOUNTAIN_LANDMARK.trailWidth * 0.5;
          const outer = MOUNTAIN_LANDMARK.trailShoulderWidth;
          const edgeHeight = sampleTerrainHeight(
            x + perpendicularX * inner * side,
            z + perpendicularZ * inner * side,
          );
          const shoulderHeight = sampleTerrainHeight(
            x + perpendicularX * outer * side,
            z + perpendicularZ * outer * side,
          );
          maximumLateralGrade = Math.max(
            maximumLateralGrade,
            Math.abs(edgeHeight - shoulderHeight) / (outer - inner),
          );
        }
      }
      expect(end.progress).toBeGreaterThan(start.progress);
    }
    expect(maximumGrade).toBeLessThanOrEqual(0.31);
    expect(maximumLateralGrade).toBeLessThanOrEqual(0.5);
  });

  it("shares one centerline between terrain clearing and streamed path geometry", () => {
    const point = MOUNTAIN_TRAIL_POINTS[4];
    const nearest = nearestMountainTrailPoint(point.x, point.z);
    expect(nearest).not.toBeNull();
    expect(nearest?.distance).toBeCloseTo(0, 6);
    expect(nearest?.progress).toBeCloseTo(point.progress, 6);
    expect(isMountainTrailClearing(point.x, point.z)).toBe(true);
    expect(
      isMountainTrailClearing(
        point.x + MOUNTAIN_LANDMARK.trailShoulderWidth + 20,
        point.z,
      ),
    ).toBe(false);

    const chunk = worldToChunk(point.x, point.z);
    const segments = mountainTrailSegmentsForChunk(chunk.x, chunk.z);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((segment) => segment.kind === "trail")).toBe(true);
    expect(segments.every((segment) => segment.width === MOUNTAIN_LANDMARK.trailWidth))
      .toBe(true);
  });
});
