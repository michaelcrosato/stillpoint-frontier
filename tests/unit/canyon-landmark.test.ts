import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ChunkManager } from "../../lib/game/world/ChunkManager";
import {
  CANYON_LANDMARK,
  CANYON_RIM_TRAIL_POINTS,
  CANYON_RIVER_POINTS,
  canyonChannelOffset,
  canyonRimTrailLength,
  canyonWorldCoordinates,
  isCanyonRimTrailClearing,
  isCanyonRiverAt,
  nearestCanyonRimTrailPoint,
  sampleCanyonDepth,
} from "../../lib/game/world/canyonLandmark";
import { WORLD_HALF_EXTENT } from "../../lib/game/world/macroWorld";
import { canyonRimTrailSegmentsForChunk } from "../../lib/game/world/roads";
import {
  sampleHorizonTerrainHeight,
  sampleTerrainHeight,
  sampleTerrainHeightLod,
  worldToChunk,
} from "../../lib/game/world/terrain";
import { isWorldWaterAt } from "../../lib/game/world/worldWater";

describe("Sunscar Canyon terrain landmark", () => {
  it("keeps its full footprint, river, rim trail, and overlook inside the atlas", () => {
    const outline = [
      canyonWorldCoordinates(CANYON_LANDMARK.halfLength, 0),
      canyonWorldCoordinates(-CANYON_LANDMARK.halfLength, 0),
      canyonWorldCoordinates(0, CANYON_LANDMARK.footprintHalfWidth),
      canyonWorldCoordinates(0, -CANYON_LANDMARK.footprintHalfWidth),
      CANYON_LANDMARK.overlookWaypoint,
      ...CANYON_RIVER_POINTS,
      ...CANYON_RIM_TRAIL_POINTS,
    ];
    for (const point of outline) {
      expect(Math.abs(point.x)).toBeLessThan(WORLD_HALF_EXTENT);
      expect(Math.abs(point.z)).toBeLessThan(WORLD_HALF_EXTENT);
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.z)).toBe(true);
    }
  });

  it("has exact longitudinal and cross-canyon edges with no remote influence", () => {
    const channelAtCenter = canyonChannelOffset(0);
    const crossEdge = canyonWorldCoordinates(
      0,
      channelAtCenter + CANYON_LANDMARK.carvedHalfWidth,
    );
    const crossOutside = canyonWorldCoordinates(
      0,
      channelAtCenter + CANYON_LANDMARK.carvedHalfWidth + 1,
    );
    const end = canyonWorldCoordinates(
      CANYON_LANDMARK.halfLength,
      canyonChannelOffset(CANYON_LANDMARK.halfLength),
    );
    expect(sampleCanyonDepth(crossEdge.x, crossEdge.z)).toBe(0);
    expect(sampleCanyonDepth(crossOutside.x, crossOutside.z)).toBe(0);
    expect(sampleCanyonDepth(end.x, end.z)).toBe(0);
    expect(sampleCanyonDepth(0, 0)).toBe(0);
  });

  it("preserves more than 650 m of rim relief in every terrain sampler", () => {
    const channel = canyonWorldCoordinates(0, canyonChannelOffset(0));
    const rim = canyonWorldCoordinates(
      0,
      canyonChannelOffset(0) + CANYON_LANDMARK.carvedHalfWidth + 200,
    );
    const samplers = [
      sampleTerrainHeight,
      (x: number, z: number) => sampleTerrainHeightLod(x, z, 1_536),
      sampleHorizonTerrainHeight,
    ];
    for (const sample of samplers) {
      expect(sample(rim.x, rim.z) - sample(channel.x, channel.z))
        .toBeGreaterThan(650);
    }
    expect(sampleTerrainHeight(channel.x, channel.z)).toBeLessThan(-600);
    expect(
      Math.abs(
        sampleTerrainHeightLod(channel.x, channel.z, 1_536) -
        sampleHorizonTerrainHeight(channel.x, channel.z),
      ),
    ).toBeLessThan(3);
  });

  it("keeps the persistent river above its carved banks and dry walls out of water policy", () => {
    const riverRows: Array<{
      left: { x: number; z: number };
      right: { x: number; z: number };
      y: number;
    }> = [];
    for (let index = 0; index < CANYON_RIVER_POINTS.length; index += 1) {
      const point = CANYON_RIVER_POINTS[index];
      const previous = CANYON_RIVER_POINTS[Math.max(0, index - 1)];
      const next = CANYON_RIVER_POINTS[
        Math.min(CANYON_RIVER_POINTS.length - 1, index + 1)
      ];
      const tangentX = next.x - previous.x;
      const tangentZ = next.z - previous.z;
      const length = Math.hypot(tangentX, tangentZ);
      const sideX = -tangentZ / length;
      const sideZ = tangentX / length;
      const surfaceY = sampleTerrainHeight(point.x, point.z) +
        CANYON_LANDMARK.riverSurfaceLift;
      riverRows.push({
        left: {
          x: point.x + sideX * point.halfWidth,
          z: point.z + sideZ * point.halfWidth,
        },
        right: {
          x: point.x - sideX * point.halfWidth,
          z: point.z - sideZ * point.halfWidth,
        },
        y: surfaceY,
      });
      for (const side of [-1, 1]) {
        const bankY = sampleTerrainHeight(
          point.x + sideX * point.halfWidth * side,
          point.z + sideZ * point.halfWidth * side,
        );
        expect(surfaceY - bankY).toBeGreaterThan(1.5);
      }
      expect(isCanyonRiverAt(point.x, point.z)).toBe(true);
      expect(isWorldWaterAt(point.x, point.z)).toBe(true);
    }

    for (let index = 0; index < riverRows.length - 1; index += 1) {
      const start = riverRows[index];
      const end = riverRows[index + 1];
      for (let sample = 0; sample <= 8; sample += 1) {
        const amount = sample / 8;
        const surfaceY = start.y + (end.y - start.y) * amount;
        for (const side of ["left", "right"] as const) {
          const x = start[side].x + (end[side].x - start[side].x) * amount;
          const z = start[side].z + (end[side].z - start[side].z) * amount;
          expect(surfaceY - sampleTerrainHeight(x, z)).toBeGreaterThan(1.25);
        }
      }
    }

    const dryWall = canyonWorldCoordinates(
      0,
      canyonChannelOffset(0) + 1_100,
    );
    expect(sampleTerrainHeight(dryWall.x, dryWall.z)).toBeLessThan(-100);
    expect(isWorldWaterAt(dryWall.x, dryWall.z)).toBe(false);
  });

  it("shares one bounded centerline between rim clearing and streamed trail geometry", () => {
    expect(canyonRimTrailLength()).toBeGreaterThan(7_000);
    expect(canyonRimTrailLength()).toBeLessThan(8_000);
    expect(CANYON_RIM_TRAIL_POINTS[0]).toMatchObject({
      ...CANYON_LANDMARK.overlookWaypoint,
      progress: 0,
    });
    expect(CANYON_RIM_TRAIL_POINTS.at(-1)?.progress).toBe(1);

    for (const point of CANYON_RIM_TRAIL_POINTS) {
      expect(isCanyonRimTrailClearing(point.x, point.z)).toBe(true);
      expect(sampleCanyonDepth(point.x, point.z)).toBeLessThan(8);
    }
    const point = CANYON_RIM_TRAIL_POINTS[3];
    expect(nearestCanyonRimTrailPoint(point.x, point.z)?.distance).toBeCloseTo(0, 6);
    const chunk = worldToChunk(point.x, point.z);
    const segments = canyonRimTrailSegmentsForChunk(chunk.x, chunk.z);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((segment) => segment.kind === "trail")).toBe(true);
    expect(segments.every((segment) =>
      segment.width === CANYON_LANDMARK.rimTrailWidth)).toBe(true);
  });

  it("owns one fixed-budget persistent river mesh and disposes it with the world", () => {
    const scene = new THREE.Scene();
    const world = new ChunkManager(scene, "performance");
    const river = scene.getObjectByName("sunscar-canyon-river");
    expect(river).toBeInstanceOf(THREE.Mesh);
    const geometry = (river as THREE.Mesh).geometry;
    expect(geometry.userData.canyonRiver).toEqual({
      segments: CANYON_RIVER_POINTS.length - 1,
      triangles: (CANYON_RIVER_POINTS.length - 1) * 2,
    });
    expect(geometry.getAttribute("position").count).toBe(CANYON_RIVER_POINTS.length * 2);
    world.dispose();
    expect(scene.getObjectByName("sunscar-canyon-river")).toBeUndefined();
  });
});
