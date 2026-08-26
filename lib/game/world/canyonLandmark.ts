/**
 * Authored badlands canyon shared by terrain, water, paths, navigation, map UI,
 * discovery, and playtest travel. The module stays renderer-independent so all
 * consumers sample the exact same landform and access routes.
 */

export interface CanyonPathPoint {
  x: number;
  z: number;
  progress: number;
}

export interface CanyonRiverPoint {
  x: number;
  z: number;
  halfWidth: number;
}

const CANYON_AXIS_ANGLE = (72 * Math.PI) / 180;
const AXIS_X = Math.cos(CANYON_AXIS_ANGLE);
const AXIS_Z = Math.sin(CANYON_AXIS_ANGLE);
const NORMAL_X = AXIS_Z;
const NORMAL_Z = -AXIS_X;

export const CANYON_LANDMARK = Object.freeze({
  id: "landmark:sunscar-canyon",
  overlookId: "landmark:sunscar-overlook",
  fastTravelId: "landmark:sunscar-overlook",
  navigationSystemId: "authored-landmarks",
  name: "Sunscar Canyon",
  overlookName: "Sunscar Overlook",
  region: "Glass Barrens",
  note: "A vast, terraced badlands canyon cut around a narrow river corridor.",
  center: Object.freeze({ x: 36_960, z: -13_440 }),
  overlookWaypoint: Object.freeze({ x: 33_408, z: -12_384 }),
  axis: Object.freeze({ x: AXIS_X, z: AXIS_Z }),
  normal: Object.freeze({ x: NORMAL_X, z: NORMAL_Z }),
  halfLength: 8_640,
  footprintHalfWidth: 3_456,
  carvedHalfWidth: 2_800,
  maxDepth: 680,
  riverBedDepth: 18,
  riverSurfaceLift: 5,
  riverHalfWidth: 34,
  riverHalfLength: 6_500,
  rimTrailWidth: 3.6,
  rimTrailShoulderWidth: 18,
  discoveryPadding: 420,
} as const);

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function smootherstep(value: number) {
  const unit = clamp01(value);
  return unit * unit * unit * (unit * (unit * 6 - 15) + 10);
}

function descendingBand(value: number, inner: number, outer: number) {
  if (value <= inner) return 1;
  if (value >= outer) return 0;
  return 1 - smootherstep((value - inner) / (outer - inner));
}

export function canyonLocalCoordinates(x: number, z: number) {
  const deltaX = x - CANYON_LANDMARK.center.x;
  const deltaZ = z - CANYON_LANDMARK.center.z;
  return {
    longitudinal: deltaX * AXIS_X + deltaZ * AXIS_Z,
    lateral: deltaX * NORMAL_X + deltaZ * NORMAL_Z,
  };
}

export function canyonWorldCoordinates(longitudinal: number, lateral: number) {
  return {
    x:
      CANYON_LANDMARK.center.x +
      longitudinal * AXIS_X +
      lateral * NORMAL_X,
    z:
      CANYON_LANDMARK.center.z +
      longitudinal * AXIS_Z +
      lateral * NORMAL_Z,
  };
}

/** Stable centerline meander that stays broad enough for coarse HLOD grids. */
export function canyonChannelOffset(longitudinal: number) {
  const safe = Number.isFinite(longitudinal) ? longitudinal : 0;
  return (
    Math.sin(safe * 0.00054 + 0.45) * 260 +
    Math.sin(safe * 0.00117 - 0.8) * 92
  );
}

export function canyonRiverHalfWidthAt(longitudinal: number) {
  const amount = clamp01(
    (longitudinal / CANYON_LANDMARK.riverHalfLength + 1) * 0.5,
  );
  return CANYON_LANDMARK.riverHalfWidth *
    (0.88 + Math.sin(amount * Math.PI) * 0.18);
}

export function isCanyonRiverAt(x: number, z: number, padding = 0) {
  const local = canyonLocalCoordinates(x, z);
  const safePadding = Math.max(0, Number.isFinite(padding) ? padding : 0);
  if (
    Math.abs(local.longitudinal) >
      CANYON_LANDMARK.riverHalfLength + safePadding
  ) {
    return false;
  }
  return Math.abs(
    local.lateral - canyonChannelOffset(local.longitudinal),
  ) <= canyonRiverHalfWidthAt(local.longitudinal) + safePadding;
}

export function canyonEllipticalDistance(x: number, z: number) {
  const local = canyonLocalCoordinates(x, z);
  return Math.hypot(
    local.longitudinal / CANYON_LANDMARK.halfLength,
    local.lateral / CANYON_LANDMARK.footprintHalfWidth,
  );
}

export function canyonFootprintInfluence(x: number, z: number) {
  const distance = canyonEllipticalDistance(x, z);
  if (distance >= 1) return 0;
  return smootherstep(1 - distance);
}

function canyonLongitudinalInfluence(longitudinal: number) {
  const normalized = Math.abs(longitudinal) / CANYON_LANDMARK.halfLength;
  if (normalized >= 1) return 0;
  return smootherstep((1 - normalized) / 0.24);
}

/**
 * Multi-bench cross section: a narrow inner gorge, two broad wall terraces,
 * and a long outer rim. The feature remains legible at the 1,536 m HLOD cell.
 */
export function sampleCanyonDepth(x: number, z: number) {
  const local = canyonLocalCoordinates(x, z);
  if (
    Math.abs(local.longitudinal) >=
      CANYON_LANDMARK.halfLength - 0.000001
  ) return 0;
  const longitudinalInfluence = canyonLongitudinalInfluence(local.longitudinal);
  if (longitudinalInfluence <= 0) return 0;

  const channelOffset = canyonChannelOffset(local.longitudinal);
  const channelDistance = Math.abs(local.lateral - channelOffset);
  if (channelDistance >= CANYON_LANDMARK.carvedHalfWidth) return 0;

  const innerGorge = descendingBand(channelDistance, 120, 760);
  const middleBench = descendingBand(channelDistance, 640, 1_580);
  const outerBench = descendingBand(channelDistance, 1_430, 2_800);
  const crossSection =
    innerGorge * 0.44 + middleBench * 0.34 + outerBench * 0.22;
  const wallVariation =
    0.965 +
    Math.sin(local.longitudinal * 0.00073 + 0.25) * 0.025 +
    Math.sin(local.longitudinal * 0.00161 - 1.1) * 0.01;
  const riverBed = channelDistance <= CANYON_LANDMARK.riverHalfWidth * 1.8
    ? CANYON_LANDMARK.riverBedDepth *
      descendingBand(
        channelDistance,
        CANYON_LANDMARK.riverHalfWidth,
        CANYON_LANDMARK.riverHalfWidth * 1.8,
      )
    : 0;
  return Math.max(
    0,
    CANYON_LANDMARK.maxDepth *
      longitudinalInfluence *
      crossSection *
      wallVariation +
      riverBed * longitudinalInfluence,
  );
}

export function applyCanyonTerrainHeight(
  baseHeight: number,
  x: number,
  z: number,
) {
  if (!Number.isFinite(baseHeight)) return baseHeight;
  return baseHeight - sampleCanyonDepth(x, z);
}

export function canyonDepthRatio(x: number, z: number) {
  return clamp01(
    sampleCanyonDepth(x, z) /
      (CANYON_LANDMARK.maxDepth + CANYON_LANDMARK.riverBedDepth),
  );
}

export function canyonWoodyVegetationFactor(x: number, z: number) {
  return 1 - smootherstep((canyonDepthRatio(x, z) - 0.015) / 0.16);
}

export function canyonGroundcoverFactor(x: number, z: number) {
  return 1 - smootherstep((canyonDepthRatio(x, z) - 0.025) / 0.28) * 0.88;
}

export function isCanyonSteepSurface(x: number, z: number, interval = 6) {
  const step = Math.max(3, Number.isFinite(interval) ? interval : 6);
  const dx = (
    sampleCanyonDepth(x + step, z) - sampleCanyonDepth(x - step, z)
  ) / (step * 2);
  const dz = (
    sampleCanyonDepth(x, z + step) - sampleCanyonDepth(x, z - step)
  ) / (step * 2);
  return Math.hypot(dx, dz) > 0.58;
}

export const CANYON_RIVER_POINTS: readonly CanyonRiverPoint[] = Object.freeze(
  Array.from({ length: 69 }, (_, index) => {
    const amount = index / 68;
    const longitudinal =
      (amount * 2 - 1) * CANYON_LANDMARK.riverHalfLength;
    const point = canyonWorldCoordinates(
      longitudinal,
      canyonChannelOffset(longitudinal),
    );
    return Object.freeze({
      ...point,
      halfWidth: canyonRiverHalfWidthAt(longitudinal),
    });
  }),
);

const RIM_TRAIL_LOCAL_POINTS = [
  { longitudinal: 800, lateralOffset: -2_940 },
  { longitudinal: 2_050, lateralOffset: -2_900 },
  { longitudinal: 3_350, lateralOffset: -2_860 },
  { longitudinal: 4_650, lateralOffset: -2_800 },
  { longitudinal: 5_850, lateralOffset: -2_700 },
  { longitudinal: 6_750, lateralOffset: -2_540 },
] as const;

const authoredRimPoints = [
  CANYON_LANDMARK.overlookWaypoint,
  ...RIM_TRAIL_LOCAL_POINTS.map(({ longitudinal, lateralOffset }) =>
    canyonWorldCoordinates(
      longitudinal,
      canyonChannelOffset(longitudinal) + lateralOffset,
    ),
  ),
];

const rimSegmentLengths = authoredRimPoints.slice(1).map((point, index) =>
  Math.hypot(
    point.x - authoredRimPoints[index].x,
    point.z - authoredRimPoints[index].z,
  ),
);
const rimTrailLength = rimSegmentLengths.reduce((sum, length) => sum + length, 0);
let accumulatedRimLength = 0;

export const CANYON_RIM_TRAIL_POINTS: readonly CanyonPathPoint[] = Object.freeze(
  authoredRimPoints.map((point, index) => {
    if (index > 0) accumulatedRimLength += rimSegmentLengths[index - 1];
    return Object.freeze({
      ...point,
      progress: rimTrailLength > 0 ? accumulatedRimLength / rimTrailLength : 0,
    });
  }),
);

export const CANYON_RIM_TRAIL_BOUNDS = Object.freeze({
  minX: Math.min(...CANYON_RIM_TRAIL_POINTS.map((point) => point.x)),
  maxX: Math.max(...CANYON_RIM_TRAIL_POINTS.map((point) => point.x)),
  minZ: Math.min(...CANYON_RIM_TRAIL_POINTS.map((point) => point.z)),
  maxZ: Math.max(...CANYON_RIM_TRAIL_POINTS.map((point) => point.z)),
});

export interface CanyonTrailSample {
  distance: number;
  progress: number;
  x: number;
  z: number;
  segmentIndex: number;
}

export function nearestCanyonRimTrailPoint(
  x: number,
  z: number,
): CanyonTrailSample | null {
  const padding = CANYON_LANDMARK.rimTrailShoulderWidth + 4;
  if (
    x < CANYON_RIM_TRAIL_BOUNDS.minX - padding ||
    x > CANYON_RIM_TRAIL_BOUNDS.maxX + padding ||
    z < CANYON_RIM_TRAIL_BOUNDS.minZ - padding ||
    z > CANYON_RIM_TRAIL_BOUNDS.maxZ + padding
  ) {
    return null;
  }

  let nearest: CanyonTrailSample | null = null;
  for (let index = 0; index < CANYON_RIM_TRAIL_POINTS.length - 1; index += 1) {
    const start = CANYON_RIM_TRAIL_POINTS[index];
    const end = CANYON_RIM_TRAIL_POINTS[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const amount = lengthSquared > 0.0001
      ? clamp01(((x - start.x) * dx + (z - start.z) * dz) / lengthSquared)
      : 0;
    const pointX = start.x + dx * amount;
    const pointZ = start.z + dz * amount;
    const distance = Math.hypot(x - pointX, z - pointZ);
    if (nearest && distance >= nearest.distance) continue;
    nearest = {
      distance,
      progress: start.progress + (end.progress - start.progress) * amount,
      x: pointX,
      z: pointZ,
      segmentIndex: index,
    };
  }
  return nearest;
}

export function isCanyonRimTrailClearing(x: number, z: number, padding = 0) {
  const nearest = nearestCanyonRimTrailPoint(x, z);
  if (!nearest) return false;
  const safePadding = Math.max(0, Number.isFinite(padding) ? padding : 0);
  return nearest.distance <=
    CANYON_LANDMARK.rimTrailShoulderWidth + safePadding;
}

export function canyonRimTrailLength() {
  return rimTrailLength;
}

export function isInsideCanyonDiscovery(x: number, z: number) {
  const local = canyonLocalCoordinates(x, z);
  const expandedLength = CANYON_LANDMARK.halfLength +
    CANYON_LANDMARK.discoveryPadding;
  const expandedWidth = CANYON_LANDMARK.footprintHalfWidth +
    CANYON_LANDMARK.discoveryPadding;
  return Math.hypot(
    local.longitudinal / expandedLength,
    local.lateral / expandedWidth,
  ) <= 1;
}
