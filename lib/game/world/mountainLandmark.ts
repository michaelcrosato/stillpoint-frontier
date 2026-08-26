/**
 * One authored terrain landmark shared by terrain, paths, navigation, map UI,
 * discovery, and horizon presentation. This module deliberately has no
 * Three.js or terrain imports so every consumer can use it without cycles.
 */

export interface MountainTrailPoint {
  x: number;
  z: number;
  progress: number;
}

export const MOUNTAIN_LANDMARK = Object.freeze({
  id: "landmark:crownspire",
  trailheadId: "landmark:crownspire-trailhead",
  fastTravelId: "landmark:crownspire-trailhead",
  navigationSystemId: "authored-landmarks",
  name: "Crownspire",
  trailheadName: "Crownspire Trailhead",
  region: "Crownspire Range",
  note: "A towering alpine landmark with a marked switchback route to the summit.",
  center: Object.freeze({ x: -8_640, z: -4_800 }),
  summit: Object.freeze({ x: -8_640, z: -4_800 }),
  baseWaypoint: Object.freeze({ x: -14_208, z: -6_336 }),
  footprintRadius: 5_760,
  baseRelief: 980,
  summitCapRelief: 220,
  summitRelief: 1_200,
  trailWidth: 3.4,
  trailShoulderWidth: 16,
  discoveryRadius: 5_920,
} as const);

const CONTROL_SPECS = [
  { progress: 0, turn: 0 },
  { progress: 0.12, turn: 0.22 },
  { progress: 0.24, turn: -0.22 },
  { progress: 0.36, turn: 0.21 },
  { progress: 0.48, turn: -0.2 },
  { progress: 0.6, turn: 0.19 },
  { progress: 0.7, turn: -0.17 },
  { progress: 0.79, turn: 0.15 },
  { progress: 0.87, turn: 0.65 },
  { progress: 0.93, turn: 1.2 },
  { progress: 0.975, turn: 1.9 },
  { progress: 1, turn: 0 },
] as const;

const baseAngle = Math.atan2(
  MOUNTAIN_LANDMARK.baseWaypoint.z - MOUNTAIN_LANDMARK.center.z,
  MOUNTAIN_LANDMARK.baseWaypoint.x - MOUNTAIN_LANDMARK.center.x,
);

export const MOUNTAIN_TRAIL_POINTS: readonly MountainTrailPoint[] = Object.freeze(
  CONTROL_SPECS.map(({ progress, turn }, index) => {
    if (index === 0) {
      return Object.freeze({
        ...MOUNTAIN_LANDMARK.baseWaypoint,
        progress,
      });
    }
    if (index === CONTROL_SPECS.length - 1) {
      return Object.freeze({
        ...MOUNTAIN_LANDMARK.summit,
        progress,
      });
    }
    const radius = MOUNTAIN_LANDMARK.footprintRadius * (1 - progress);
    const angle = baseAngle + turn;
    return Object.freeze({
      x: MOUNTAIN_LANDMARK.center.x + Math.cos(angle) * radius,
      z: MOUNTAIN_LANDMARK.center.z + Math.sin(angle) * radius,
      progress,
    });
  }),
);

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function smootherstep(value: number) {
  const unit = clamp01(value);
  return unit * unit * unit * (unit * (unit * 6 - 15) + 10);
}

export function mountainDistance(x: number, z: number) {
  return Math.hypot(
    x - MOUNTAIN_LANDMARK.center.x,
    z - MOUNTAIN_LANDMARK.center.z,
  );
}

export function mountainFootprintInfluence(x: number, z: number) {
  const radius = MOUNTAIN_LANDMARK.footprintRadius;
  const distance = mountainDistance(x, z);
  if (distance >= radius) return 0;
  return smootherstep(1 - distance / radius);
}

/** Broad, asymmetric relief that remains resolvable on the 1,536 m HLOD grid. */
export function sampleMountainLift(x: number, z: number) {
  const radius = MOUNTAIN_LANDMARK.footprintRadius;
  const deltaX = x - MOUNTAIN_LANDMARK.center.x;
  const deltaZ = z - MOUNTAIN_LANDMARK.center.z;
  if (Math.abs(deltaX) >= radius || Math.abs(deltaZ) >= radius) return 0;
  const distance = Math.hypot(deltaX, deltaZ);
  if (distance >= radius) return 0;

  const normalizedRadius = distance / radius;
  const envelope = smootherstep(1 - normalizedRadius);
  const angle = Math.atan2(deltaZ, deltaX);
  const ridgeBand = Math.sin(Math.PI * clamp01((normalizedRadius - 0.035) / 0.965));
  const ridge = 1 + ridgeBand * (
    Math.sin(angle * 5 + 0.62) * 0.07 +
    Math.sin(angle * 3 - normalizedRadius * 8.5) * 0.035
  );
  const summitDistance = Math.hypot(
    x - MOUNTAIN_LANDMARK.summit.x,
    z - MOUNTAIN_LANDMARK.summit.z,
  );
  const summitCap = MOUNTAIN_LANDMARK.summitCapRelief *
    Math.exp(-(summitDistance * summitDistance) / (2 * 680 * 680));
  return Math.max(
    0,
    MOUNTAIN_LANDMARK.baseRelief * envelope * ridge + summitCap * envelope,
  );
}

/** Graduated alpine treeline without changing the underlying biome catalog. */
export function mountainWoodyVegetationFactor(x: number, z: number) {
  const elevation = sampleMountainLift(x, z) /
    MOUNTAIN_LANDMARK.summitRelief;
  return 1 - smootherstep((elevation - 0.36) / 0.3);
}

/** Low plants persist above the woody treeline, then yield to rock and snow. */
export function mountainGroundcoverFactor(x: number, z: number) {
  const elevation = sampleMountainLift(x, z) /
    MOUNTAIN_LANDMARK.summitRelief;
  return 1 - smootherstep((elevation - 0.48) / 0.28);
}

export interface MountainTrailSample {
  distance: number;
  progress: number;
  x: number;
  z: number;
  segmentIndex: number;
}

/** Bounded eleven-segment search, guarded by a broad early reject. */
export function nearestMountainTrailPoint(
  x: number,
  z: number,
): MountainTrailSample | null {
  const padding = MOUNTAIN_LANDMARK.trailShoulderWidth + 4;
  const minX = Math.min(
    MOUNTAIN_LANDMARK.center.x - MOUNTAIN_LANDMARK.footprintRadius,
    MOUNTAIN_LANDMARK.baseWaypoint.x,
  ) - padding;
  const maxX = MOUNTAIN_LANDMARK.center.x + MOUNTAIN_LANDMARK.footprintRadius + padding;
  const minZ = MOUNTAIN_LANDMARK.center.z - MOUNTAIN_LANDMARK.footprintRadius - padding;
  const maxZ = MOUNTAIN_LANDMARK.center.z + MOUNTAIN_LANDMARK.footprintRadius + padding;
  if (x < minX || x > maxX || z < minZ || z > maxZ) return null;

  let nearest: MountainTrailSample | null = null;
  for (let index = 0; index < MOUNTAIN_TRAIL_POINTS.length - 1; index += 1) {
    const start = MOUNTAIN_TRAIL_POINTS[index];
    const end = MOUNTAIN_TRAIL_POINTS[index + 1];
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

export function isMountainTrailClearing(x: number, z: number, padding = 0) {
  const nearest = nearestMountainTrailPoint(x, z);
  if (!nearest) return false;
  const safePadding = Math.max(0, Number.isFinite(padding) ? padding : 0);
  return nearest.distance <=
    MOUNTAIN_LANDMARK.trailShoulderWidth + safePadding;
}

/**
 * Adds the physical landform and flattens only the detailed trail shoulder.
 * trailDetailWeight is zero for coarse horizon samplers.
 */
export function applyMountainTerrainHeight(
  baseHeight: number,
  x: number,
  z: number,
  trailDetailWeight = 1,
) {
  if (!Number.isFinite(baseHeight)) return baseHeight;
  const rawLift = sampleMountainLift(x, z);
  if (rawLift <= 0 && !isMountainTrailClearing(x, z)) return baseHeight;

  let lift = rawLift;
  const detailWeight = clamp01(
    Number.isFinite(trailDetailWeight) ? trailDetailWeight : 0,
  );
  if (detailWeight > 0) {
    const trail = nearestMountainTrailPoint(x, z);
    if (trail) {
      const inner = MOUNTAIN_LANDMARK.trailWidth * 0.5;
      const outer = MOUNTAIN_LANDMARK.trailShoulderWidth;
      const trailBlend = 1 - smootherstep((trail.distance - inner) / (outer - inner));
      const centerlineLift = sampleMountainLift(trail.x, trail.z);
      lift += (
        centerlineLift - lift
      ) * trailBlend * detailWeight;
    }
  }
  return baseHeight + lift;
}

export function mountainTrailLength() {
  let length = 0;
  for (let index = 0; index < MOUNTAIN_TRAIL_POINTS.length - 1; index += 1) {
    const start = MOUNTAIN_TRAIL_POINTS[index];
    const end = MOUNTAIN_TRAIL_POINTS[index + 1];
    length += Math.hypot(end.x - start.x, end.z - start.z);
  }
  return length;
}
