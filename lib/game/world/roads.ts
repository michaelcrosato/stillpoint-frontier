import { CHUNK_SIZE } from "../config";
import { hashString } from "../core/random";
import { clipSegmentToRect, type Point2 } from "./geometry";
import {
  ROAD_CORRIDORS,
  settlementsNear,
  type RoadCorridor,
  type Settlement,
  type SettlementTier,
} from "./macroWorld";
import {
  MOUNTAIN_LANDMARK,
  MOUNTAIN_TRAIL_POINTS,
} from "./mountainLandmark";
import {
  CANYON_LANDMARK,
  CANYON_RIM_TRAIL_BOUNDS,
  CANYON_RIM_TRAIL_POINTS,
} from "./canyonLandmark";
import { chunkCenter } from "./terrain";

export const ROAD_WIDTHS = { trunk: 9, regional: 6.2, local: 3.8 } as const;

const STREET_SPECS: Record<SettlementTier, { spacing: number; width: number }> = {
  megacity: { spacing: 34, width: 7.4 },
  city: { spacing: 48, width: 6.6 },
  town: { spacing: 72, width: 5.2 },
  village: { spacing: 92, width: 4.2 },
};

export interface WorldPathSegment {
  id: string;
  kind: "road" | "street" | "trail";
  start: Point2;
  end: Point2;
  width: number;
  roadClass?: RoadCorridor["class"];
  corridorId?: string;
  settlementId?: string;
  /** True only at an authored path end, never at a chunk clipping boundary. */
  capStart?: boolean;
  /** True only at an authored path end, never at a chunk clipping boundary. */
  capEnd?: boolean;
}

export interface PedestrianLane {
  id: string;
  source: "road" | "settlement";
  sourceId: string;
  start: Point2;
  end: Point2;
  roadClass?: RoadCorridor["class"];
  settlementId?: string;
  corridorId?: string;
}

function segmentLength(segment: Pick<WorldPathSegment, "start" | "end">) {
  return Math.hypot(segment.end.x - segment.start.x, segment.end.z - segment.start.z);
}

function clipSegmentToCircle(
  start: Point2,
  end: Point2,
  center: Point2,
  radius: number,
): { start: Point2; end: Point2 } | null {
  if (radius <= 0) return null;
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const fx = start.x - center.x;
  const fz = start.z - center.z;
  const a = dx * dx + dz * dz;
  if (a < 0.0001) return null;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return c <= 0 ? { start: { ...start }, end: { ...end } } : null;
  }
  const root = Math.sqrt(discriminant);
  const first = (-b - root) / (2 * a);
  const second = (-b + root) / (2 * a);
  const low = Math.max(0, Math.min(first, second));
  const high = Math.min(1, Math.max(first, second));
  if (low > high) return null;
  return {
    start: { x: start.x + dx * low, z: start.z + dz * low },
    end: { x: start.x + dx * high, z: start.z + dz * high },
  };
}

function axisStreet(
  settlement: Settlement,
  axis: "x" | "z",
  coordinate: number,
  gridIndex: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): WorldPathSegment | null {
  const spec = STREET_SPECS[settlement.tier];
  if (axis === "x") {
    const delta = coordinate - settlement.z;
    if (Math.abs(delta) >= settlement.radius) return null;
    const span = Math.sqrt(settlement.radius ** 2 - delta ** 2);
    const naturalStartX = settlement.x - span;
    const naturalEndX = settlement.x + span;
    const startX = Math.max(minX, naturalStartX);
    const endX = Math.min(maxX, naturalEndX);
    if (endX - startX < 8) return null;
    return {
      id: `street:${settlement.id}:x:${gridIndex}`,
      kind: "street",
      start: { x: startX, z: coordinate },
      end: { x: endX, z: coordinate },
      width: spec.width,
      settlementId: settlement.id,
      capStart: Math.abs(startX - naturalStartX) < 0.001,
      capEnd: Math.abs(endX - naturalEndX) < 0.001,
    };
  }

  const delta = coordinate - settlement.x;
  if (Math.abs(delta) >= settlement.radius) return null;
  const span = Math.sqrt(settlement.radius ** 2 - delta ** 2);
  const naturalStartZ = settlement.z - span;
  const naturalEndZ = settlement.z + span;
  const startZ = Math.max(minZ, naturalStartZ);
  const endZ = Math.min(maxZ, naturalEndZ);
  if (endZ - startZ < 8) return null;
  return {
    id: `street:${settlement.id}:z:${gridIndex}`,
    kind: "street",
    start: { x: coordinate, z: startZ },
    end: { x: coordinate, z: endZ },
    width: spec.width,
    settlementId: settlement.id,
    capStart: Math.abs(startZ - naturalStartZ) < 0.001,
    capEnd: Math.abs(endZ - naturalEndZ) < 0.001,
  };
}

function settlementStreets(
  settlement: Settlement,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
) {
  const spec = STREET_SPECS[settlement.tier];
  const streets: WorldPathSegment[] = [];
  const villagePrimaryAxis = hashString(settlement.id) % 2 === 0 ? "x" : "z";
  const villageCrossStreet = settlement.population >= 1_500;

  if (settlement.tier === "village") {
    const primary = axisStreet(
      settlement,
      villagePrimaryAxis,
      villagePrimaryAxis === "x" ? settlement.z : settlement.x,
      0,
      minX,
      maxX,
      minZ,
      maxZ,
    );
    if (primary) streets.push(primary);
    if (villageCrossStreet) {
      const crossAxis = villagePrimaryAxis === "x" ? "z" : "x";
      const cross = axisStreet(
        settlement,
        crossAxis,
        crossAxis === "x" ? settlement.z : settlement.x,
        0,
        minX,
        maxX,
        minZ,
        maxZ,
      );
      if (cross) streets.push(cross);
    }
    return streets;
  }

  const firstHorizontal = Math.ceil((minZ - settlement.z) / spec.spacing);
  const lastHorizontal = Math.floor((maxZ - settlement.z) / spec.spacing);
  for (let grid = firstHorizontal; grid <= lastHorizontal; grid += 1) {
    const street = axisStreet(
      settlement,
      "x",
      settlement.z + grid * spec.spacing,
      grid,
      minX,
      maxX,
      minZ,
      maxZ,
    );
    if (street) streets.push(street);
  }

  const firstVertical = Math.ceil((minX - settlement.x) / spec.spacing);
  const lastVertical = Math.floor((maxX - settlement.x) / spec.spacing);
  for (let grid = firstVertical; grid <= lastVertical; grid += 1) {
    const street = axisStreet(
      settlement,
      "z",
      settlement.x + grid * spec.spacing,
      grid,
      minX,
      maxX,
      minZ,
      maxZ,
    );
    if (street) streets.push(street);
  }
  return streets;
}

export function roadSegmentsForChunk(chunkX: number, chunkZ: number): WorldPathSegment[] {
  const center = chunkCenter({ x: chunkX, z: chunkZ });
  const half = CHUNK_SIZE / 2;
  const minX = center.x - half;
  const maxX = center.x + half;
  const minZ = center.z - half;
  const maxZ = center.z + half;
  const segments: WorldPathSegment[] = [];
  for (const corridor of ROAD_CORRIDORS) {
    const clipped = clipSegmentToRect(corridor.from, corridor.to, minX, maxX, minZ, maxZ);
    if (!clipped) continue;
    const segment: WorldPathSegment = {
      id: `road:${corridor.id}`,
      kind: "road",
      start: clipped.start,
      end: clipped.end,
      width: ROAD_WIDTHS[corridor.class],
      roadClass: corridor.class,
      corridorId: corridor.id,
      capStart:
        Math.hypot(
          clipped.start.x - corridor.from.x,
          clipped.start.z - corridor.from.z,
        ) < 0.001,
      capEnd:
        Math.hypot(
          clipped.end.x - corridor.to.x,
          clipped.end.z - corridor.to.z,
        ) < 0.001,
    };
    if (segmentLength(segment) >= 0.5) segments.push(segment);
  }
  return segments;
}

export function mountainTrailSegmentsForChunk(
  chunkX: number,
  chunkZ: number,
): WorldPathSegment[] {
  const center = chunkCenter({ x: chunkX, z: chunkZ });
  const half = CHUNK_SIZE / 2;
  const minX = center.x - half;
  const maxX = center.x + half;
  const minZ = center.z - half;
  const maxZ = center.z + half;
  const mountainMinX = Math.min(
    MOUNTAIN_LANDMARK.center.x - MOUNTAIN_LANDMARK.footprintRadius,
    MOUNTAIN_LANDMARK.baseWaypoint.x,
  );
  const mountainMaxX = MOUNTAIN_LANDMARK.center.x +
    MOUNTAIN_LANDMARK.footprintRadius;
  const mountainMinZ = MOUNTAIN_LANDMARK.center.z -
    MOUNTAIN_LANDMARK.footprintRadius;
  const mountainMaxZ = MOUNTAIN_LANDMARK.center.z +
    MOUNTAIN_LANDMARK.footprintRadius;
  if (
    maxX < mountainMinX || minX > mountainMaxX ||
    maxZ < mountainMinZ || minZ > mountainMaxZ
  ) {
    return [];
  }

  const segments: WorldPathSegment[] = [];
  for (let index = 0; index < MOUNTAIN_TRAIL_POINTS.length - 1; index += 1) {
    const start = MOUNTAIN_TRAIL_POINTS[index];
    const end = MOUNTAIN_TRAIL_POINTS[index + 1];
    const clipped = clipSegmentToRect(start, end, minX, maxX, minZ, maxZ);
    if (!clipped) continue;
    const segment: WorldPathSegment = {
      id: `trail:crownspire:${index}`,
      kind: "trail",
      start: clipped.start,
      end: clipped.end,
      width: MOUNTAIN_LANDMARK.trailWidth,
      corridorId: MOUNTAIN_LANDMARK.trailheadId,
      capStart: Math.hypot(
        clipped.start.x - start.x,
        clipped.start.z - start.z,
      ) < 0.001,
      capEnd: Math.hypot(
        clipped.end.x - end.x,
        clipped.end.z - end.z,
      ) < 0.001,
    };
    if (segmentLength(segment) >= 0.5) segments.push(segment);
  }
  return segments;
}

export function canyonRimTrailSegmentsForChunk(
  chunkX: number,
  chunkZ: number,
): WorldPathSegment[] {
  const center = chunkCenter({ x: chunkX, z: chunkZ });
  const half = CHUNK_SIZE / 2;
  const minX = center.x - half;
  const maxX = center.x + half;
  const minZ = center.z - half;
  const maxZ = center.z + half;
  if (
    maxX < CANYON_RIM_TRAIL_BOUNDS.minX ||
    minX > CANYON_RIM_TRAIL_BOUNDS.maxX ||
    maxZ < CANYON_RIM_TRAIL_BOUNDS.minZ ||
    minZ > CANYON_RIM_TRAIL_BOUNDS.maxZ
  ) {
    return [];
  }

  const segments: WorldPathSegment[] = [];
  for (let index = 0; index < CANYON_RIM_TRAIL_POINTS.length - 1; index += 1) {
    const start = CANYON_RIM_TRAIL_POINTS[index];
    const end = CANYON_RIM_TRAIL_POINTS[index + 1];
    const clipped = clipSegmentToRect(start, end, minX, maxX, minZ, maxZ);
    if (!clipped) continue;
    const segment: WorldPathSegment = {
      id: `trail:sunscar-rim:${index}`,
      kind: "trail",
      start: clipped.start,
      end: clipped.end,
      width: CANYON_LANDMARK.rimTrailWidth,
      corridorId: CANYON_LANDMARK.overlookId,
      capStart: Math.hypot(
        clipped.start.x - start.x,
        clipped.start.z - start.z,
      ) < 0.001,
      capEnd: Math.hypot(
        clipped.end.x - end.x,
        clipped.end.z - end.z,
      ) < 0.001,
    };
    if (segmentLength(segment) >= 0.5) segments.push(segment);
  }
  return segments;
}

export function settlementStreetSegmentsForChunk(
  chunkX: number,
  chunkZ: number,
): WorldPathSegment[] {
  const center = chunkCenter({ x: chunkX, z: chunkZ });
  const half = CHUNK_SIZE / 2;
  const minX = center.x - half;
  const maxX = center.x + half;
  const minZ = center.z - half;
  const maxZ = center.z + half;
  return settlementsNear(center.x, center.z, CHUNK_SIZE * 0.72).flatMap((settlement) =>
    settlementStreets(settlement, minX, maxX, minZ, maxZ),
  );
}

export function worldPathSegmentsForChunk(chunkX: number, chunkZ: number) {
  return [
    ...roadSegmentsForChunk(chunkX, chunkZ),
    ...mountainTrailSegmentsForChunk(chunkX, chunkZ),
    ...canyonRimTrailSegmentsForChunk(chunkX, chunkZ),
    ...settlementStreetSegmentsForChunk(chunkX, chunkZ),
  ];
}

function pedestrianLanesForSegment(
  segment: WorldPathSegment,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  settlement: Settlement | null,
) {
  const dx = segment.end.x - segment.start.x;
  const dz = segment.end.z - segment.start.z;
  const length = Math.hypot(dx, dz);
  if (length < 8) return [];
  const shoulder = segment.width / 2 + (segment.kind === "street" ? 1.15 : 1.3);
  const perpendicularX = -dz / length;
  const perpendicularZ = dx / length;
  const lanes: PedestrianLane[] = [];

  for (const side of [-1, 1] as const) {
    let candidate: { start: Point2; end: Point2 } | null = {
      start: {
        x: segment.start.x + perpendicularX * shoulder * side,
        z: segment.start.z + perpendicularZ * shoulder * side,
      },
      end: {
        x: segment.end.x + perpendicularX * shoulder * side,
        z: segment.end.z + perpendicularZ * shoulder * side,
      },
    };
    if (settlement) {
      candidate = clipSegmentToCircle(
        candidate.start,
        candidate.end,
        settlement,
        Math.max(1, settlement.radius - 0.5),
      );
    }
    if (!candidate) continue;
    candidate = clipSegmentToRect(candidate.start, candidate.end, minX, maxX, minZ, maxZ);
    if (!candidate) continue;
    if (Math.hypot(candidate.end.x - candidate.start.x, candidate.end.z - candidate.start.z) < 6) {
      continue;
    }
    lanes.push({
      id: `${segment.id}:walk:${side < 0 ? "a" : "b"}`,
      source: segment.kind === "street" ? "settlement" : "road",
      sourceId: segment.settlementId ?? segment.corridorId ?? segment.id,
      start: candidate.start,
      end: candidate.end,
      roadClass: segment.roadClass,
      settlementId: segment.settlementId,
      corridorId: segment.corridorId,
    });
  }
  return lanes;
}

export function pedestrianLanesForChunk(chunkX: number, chunkZ: number): PedestrianLane[] {
  const center = chunkCenter({ x: chunkX, z: chunkZ });
  const half = CHUNK_SIZE / 2;
  const minX = center.x - half;
  const maxX = center.x + half;
  const minZ = center.z - half;
  const maxZ = center.z + half;
  const streets = settlementStreetSegmentsForChunk(chunkX, chunkZ);
  const nearbySettlements = new Map(
    settlementsNear(center.x, center.z, CHUNK_SIZE).map((settlement) => [settlement.id, settlement]),
  );
  return [...roadSegmentsForChunk(chunkX, chunkZ), ...streets].flatMap((segment) =>
    pedestrianLanesForSegment(
      segment,
      minX,
      maxX,
      minZ,
      maxZ,
      segment.settlementId ? nearbySettlements.get(segment.settlementId) ?? null : null,
    ),
  );
}

export function distanceToPathSegment(point: Point2, segment: Pick<WorldPathSegment, "start" | "end">) {
  const dx = segment.end.x - segment.start.x;
  const dz = segment.end.z - segment.start.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 0.0001) return Math.hypot(point.x - segment.start.x, point.z - segment.start.z);
  const amount = Math.min(
    1,
    Math.max(
      0,
      ((point.x - segment.start.x) * dx + (point.z - segment.start.z) * dz) /
        lengthSquared,
    ),
  );
  return Math.hypot(
    point.x - (segment.start.x + dx * amount),
    point.z - (segment.start.z + dz * amount),
  );
}
