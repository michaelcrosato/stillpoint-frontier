import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  ROAD_SURFACE_CROSS_SECTION_VERTICES,
  ROAD_SURFACE_STEP_METERS,
  createRoadSurfaceGeometry,
  roadBridgeInfluence,
  roadShoulderWidth,
  roadSurfaceHeight,
  type RoadSurfaceGeometryStats,
} from "../../lib/game/world/RoadSurfaceGeometry";
import {
  WATER_LEVEL,
  riverCenterX,
  riverWidth,
} from "../../lib/game/world/macroWorld";
import type { WorldPathSegment } from "../../lib/game/world/roads";
import { sampleTerrainHeight } from "../../lib/game/world/terrain";

function roadSegment(
  start: { x: number; z: number },
  end: { x: number; z: number },
  id = "road:test",
): WorldPathSegment {
  return {
    id,
    kind: "road",
    start,
    end,
    width: 9,
    roadClass: "trunk",
    corridorId: "test",
  };
}

function attributeValues(
  geometry: THREE.BufferGeometry,
  name: "position" | "normal" | "color",
) {
  return Array.from(geometry.getAttribute(name).array as ArrayLike<number>);
}

describe("terrain-conforming road surfaces", () => {
  it("builds a deterministic bounded ribbon with shoulders and vertex color", () => {
    const segment = roadSegment({ x: -5_000, z: -4_000 }, { x: -4_904, z: -4_000 });
    const first = createRoadSurfaceGeometry([segment]);
    const second = createRoadSurfaceGeometry([segment]);
    const stats = first.userData.roadSurface as RoadSurfaceGeometryStats;

    expect(stats.segments).toBe(1);
    expect(stats.rows).toBe(25);
    expect(stats.vertices).toBe(25 * ROAD_SURFACE_CROSS_SECTION_VERTICES);
    expect(stats.triangles).toBe(24 * 4 * 2);
    expect(stats.maxStepMeters).toBeLessThanOrEqual(ROAD_SURFACE_STEP_METERS);
    expect(roadShoulderWidth(segment)).toBe(1.15);
    expect(attributeValues(first, "position")).toEqual(attributeValues(second, "position"));
    expect(attributeValues(first, "normal")).toEqual(attributeValues(second, "normal"));
    expect(attributeValues(first, "color")).toEqual(attributeValues(second, "color"));
    expect(first.getAttribute("color").count).toBe(first.getAttribute("position").count);
    expect(first.getIndex()?.count).toBe(stats.triangles * 3);
    expect(first.boundingBox).not.toBeNull();
    expect(first.boundingSphere).not.toBeNull();
    expect(
      (first.boundingBox?.max.z ?? 0) - (first.boundingBox?.min.z ?? 0),
    ).toBeLessThanOrEqual(segment.width + 2 * 1.25);

    const geometryIndices = Array.from(first.getIndex()?.array ?? []);
    expect(geometryIndices.every(
      (index) => Number.isInteger(index) && index >= 0 && index < stats.vertices,
    )).toBe(true);

    for (const value of [
      ...attributeValues(first, "position"),
      ...attributeValues(first, "normal"),
      ...attributeValues(first, "color"),
    ]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    const colors = attributeValues(first, "color").map((value) => value.toFixed(4));
    expect(new Set(colors).size).toBeGreaterThan(8);
    first.dispose();
    second.dispose();
  });

  it("keeps every vertex just above its analytic road surface", () => {
    const segment = roadSegment({ x: -5_000, z: -4_000 }, { x: -4_920, z: -3_960 });
    const geometry = createRoadSurfaceGeometry([segment]);
    const positions = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      const z = positions.getZ(index);
      const clearance = y - roadSurfaceHeight(segment, x, z);
      expect(clearance).toBeGreaterThan(0.025);
      expect(clearance).toBeLessThan(0.12);
      expect(normals.getY(index)).toBeGreaterThan(0.35);
    }
    geometry.dispose();
  });

  it("renders narrow dirt trails without inheriting bridge behavior", () => {
    const trail: WorldPathSegment = {
      id: "trail:test",
      kind: "trail",
      start: { x: -8_620, z: -4_920 },
      end: { x: -8_540, z: -4_870 },
      width: 3.4,
      corridorId: "landmark:test",
    };
    const geometry = createRoadSurfaceGeometry([trail]);
    const positions = geometry.getAttribute("position");
    expect(roadShoulderWidth(trail)).toBe(0.65);
    expect(roadBridgeInfluence(trail, riverCenterX(0), 0)).toBe(0);
    expect(
      (geometry.boundingBox?.max.z ?? 0) -
      (geometry.boundingBox?.min.z ?? 0),
    ).toBeLessThan(90);
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      const z = positions.getZ(index);
      expect(y - sampleTerrainHeight(x, z)).toBeGreaterThan(0.02);
      expect(y - sampleTerrainHeight(x, z)).toBeLessThan(0.1);
    }
    geometry.dispose();
  });

  it("matches height, normals, and colors exactly where adjacent chunks meet", () => {
    const firstSegment = roadSegment(
      { x: -48, z: -25 },
      { x: 48, z: 25 },
      "road:seam",
    );
    const secondSegment = roadSegment(
      { x: 48, z: 25 },
      { x: 144, z: 75 },
      "road:seam",
    );
    const first = createRoadSurfaceGeometry([firstSegment]);
    const second = createRoadSurfaceGeometry([secondSegment]);
    const rowValues = ROAD_SURFACE_CROSS_SECTION_VERTICES * 3;

    for (const attribute of ["position", "normal", "color"] as const) {
      const left = attributeValues(first, attribute);
      const right = attributeValues(second, attribute);
      expect(left.slice(-rowValues)).toEqual(right.slice(0, rowValues));
    }
    first.dispose();
    second.dispose();
  });

  it("eases trade roads onto a finite river deck instead of stepping underwater", () => {
    const z = 0;
    const centerX = riverCenterX(z);
    const segment = roadSegment(
      { x: centerX - 80, z },
      { x: centerX + 80, z },
      "road:bridge",
    );

    expect(roadBridgeInfluence(segment, centerX, z)).toBeCloseTo(1, 6);
    expect(roadSurfaceHeight(segment, centerX, z)).toBeGreaterThanOrEqual(
      WATER_LEVEL + 0.369,
    );
    expect(
      roadBridgeInfluence(
        segment,
        centerX + riverWidth(z) + segment.width + 50,
        z,
      ),
    ).toBe(0);
  });

  it("deduplicates authored junction pads and separates crossing street layers", () => {
    const streetX: WorldPathSegment = {
      id: "street:test:x:0",
      kind: "street",
      start: { x: -8, z: 0 },
      end: { x: 8, z: 0 },
      width: 6,
      settlementId: "test",
    };
    const streetZ: WorldPathSegment = {
      ...streetX,
      id: "street:test:z:0",
      start: { x: 0, z: -8 },
      end: { x: 0, z: 8 },
    };
    const crossing = createRoadSurfaceGeometry([streetX, streetZ]);
    const crossingPositions = crossing.getAttribute("position");
    const centerVertex = 2 * ROAD_SURFACE_CROSS_SECTION_VERTICES + 2;
    const secondSegmentStart = 5 * ROAD_SURFACE_CROSS_SECTION_VERTICES;
    expect(
      Math.abs(
        crossingPositions.getY(secondSegmentStart + centerVertex) -
        crossingPositions.getY(centerVertex),
      ),
    ).toBeGreaterThan(0.0015);

    const incoming = roadSegment({ x: -12, z: 0 }, { x: 0, z: 0 }, "road:join:a");
    const outgoing = roadSegment({ x: 0, z: 0 }, { x: 8, z: 8 }, "road:join:b");
    incoming.capEnd = true;
    outgoing.capStart = true;
    const joined = createRoadSurfaceGeometry([incoming, outgoing]);
    const stats = joined.userData.roadSurface as RoadSurfaceGeometryStats;
    expect(stats.junctionPads).toBe(1);
    expect(stats.triangles).toBeGreaterThan(0);
    crossing.dispose();
    joined.dispose();
  });
});
