import { CHUNK_SIZE, WORLD_SEED } from "../config";
import { seededRandom } from "../core/random";

export const CANOPY_BENCHMARK_ZONE = {
  id: "canopy-load-lab",
  label: "Canopy Load Lab",
  center: { x: 6_144, z: -5_760 },
  arrival: { x: 6_144, z: -5_930 },
  forestRadius: 420,
  // Keep the nearest authored trees outside the standard camera range when
  // the fixture streams in or out. Extended horizons can still see the cheap
  // far-tree LOD approach instead of a close-range wall of popping geometry.
  activationRadius: 2_400,
  unloadRadius: 2_640,
  lakeRadius: 94,
  lakeSurfaceOverlap: 0.75,
  shorelineRadius: 132,
  lakeSurfaceY: 6,
  lakeRenderOffset: 0.018,
  lakeBedY: 4.72,
  tileSize: 120,
  nearLodDistance: 150,
  midLodDistance: 330,
} as const;

export const CANOPY_BENCHMARK_LEVELS = [
  {
    id: "baseline",
    label: "BASELINE",
    trees: 0,
    groundcover: 0,
    rocks: 0,
    reeds: 0,
  },
  {
    id: "reference",
    label: "REFERENCE",
    trees: 1_500,
    groundcover: 6_000,
    rocks: 250,
    reeds: 512,
  },
  {
    id: "dense",
    label: "DENSE",
    trees: 3_000,
    groundcover: 12_000,
    rocks: 400,
    reeds: 1_024,
  },
  {
    id: "heavy",
    label: "HEAVY",
    trees: 6_000,
    groundcover: 24_000,
    rocks: 700,
    reeds: 1_536,
  },
  {
    id: "extreme",
    label: "EXTREME",
    trees: 12_000,
    groundcover: 48_000,
    rocks: 1_100,
    reeds: 2_048,
  },
  {
    id: "overload",
    label: "OVERLOAD",
    trees: 20_000,
    groundcover: 80_000,
    rocks: 1_600,
    reeds: 4_096,
  },
] as const;

export type CanopyBenchmarkLevel = 0 | 1 | 2 | 3 | 4 | 5;
export type CanopyBenchmarkLevelDefinition =
  (typeof CANOPY_BENCHMARK_LEVELS)[number];

export interface CanopyBenchmarkPoint {
  x: number;
  z: number;
  scale: number;
  yaw: number;
  tint: number;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function smootherstep(value: number) {
  const unit = clamp01(value);
  return unit * unit * unit * (unit * (unit * 6 - 15) + 10);
}

export function normalizeCanopyBenchmarkLevel(
  value: number,
): CanopyBenchmarkLevel {
  if (!Number.isFinite(value)) return 2;
  return Math.min(5, Math.max(0, Math.round(value))) as CanopyBenchmarkLevel;
}

export function canopyBenchmarkDistance(x: number, z: number) {
  return Math.hypot(
    x - CANOPY_BENCHMARK_ZONE.center.x,
    z - CANOPY_BENCHMARK_ZONE.center.z,
  );
}

export function isCanopyBenchmarkLake(
  x: number,
  z: number,
  padding = 0,
) {
  const safePadding = Number.isFinite(padding) ? padding : 0;
  const radius = CANOPY_BENCHMARK_ZONE.lakeRadius + safePadding;
  if (radius <= 0) return false;
  const deltaX = x - CANOPY_BENCHMARK_ZONE.center.x;
  const deltaZ = z - CANOPY_BENCHMARK_ZONE.center.z;
  if (Math.abs(deltaX) >= radius || Math.abs(deltaZ) >= radius) return false;
  return Math.hypot(deltaX, deltaZ) < radius;
}

/**
 * Keeps the lake, the shore overlook, and one readable approach through the
 * canopy free of procedural props. This is render/test policy only: it does
 * not add a collider, target, discovery, or persistence record.
 */
export function isCanopyBenchmarkClearing(
  x: number,
  z: number,
  padding = 0,
) {
  const safePadding = Math.max(0, Number.isFinite(padding) ? padding : 0);
  const zone = CANOPY_BENCHMARK_ZONE;
  const deltaX = x - zone.center.x;
  const deltaZ = z - zone.center.z;
  if (
    Math.abs(deltaX) >= zone.shorelineRadius + safePadding ||
    deltaZ < -212 - safePadding ||
    deltaZ >= zone.shorelineRadius + safePadding
  ) {
    return false;
  }
  if (canopyBenchmarkDistance(x, z) < zone.shorelineRadius + safePadding) {
    return true;
  }
  if (
    Math.hypot(x - zone.arrival.x, z - zone.arrival.z) < 12 + safePadding
  ) {
    return true;
  }
  const withinApproach =
    z >= zone.center.z - 212 - safePadding &&
    z <= zone.center.z - zone.shorelineRadius + 8 + safePadding;
  return withinApproach && Math.abs(x - zone.center.x) < 7 + safePadding;
}

/**
 * Smooth, analytic lake bowl used by detailed terrain, collision, and HLOD.
 * It is exactly the original height at and beyond the shoreline radius.
 */
export function applyCanopyBenchmarkTerrainHeight(
  baseHeight: number,
  x: number,
  z: number,
) {
  if (!Number.isFinite(baseHeight)) return baseHeight;
  const zone = CANOPY_BENCHMARK_ZONE;
  const deltaX = x - zone.center.x;
  const deltaZ = z - zone.center.z;
  if (
    Math.abs(deltaX) >= zone.shorelineRadius ||
    Math.abs(deltaZ) >= zone.shorelineRadius
  ) {
    return baseHeight;
  }
  const distance = canopyBenchmarkDistance(x, z);
  if (distance >= zone.shorelineRadius) return baseHeight;

  const lakeUnit = clamp01(distance / zone.lakeRadius);
  const bowlHeight =
    zone.lakeBedY +
    smootherstep(lakeUnit) * (zone.lakeSurfaceY - zone.lakeBedY);
  if (distance <= zone.lakeRadius) return Math.min(baseHeight, bowlHeight);

  const shoreUnit =
    (distance - zone.lakeRadius) /
    (zone.shorelineRadius - zone.lakeRadius);
  const shoreBlend = smootherstep(shoreUnit);
  return Math.min(
    baseHeight,
    zone.lakeSurfaceY * (1 - shoreBlend) + baseHeight * shoreBlend,
  );
}

export function canopyBenchmarkTileKey(x: number, z: number) {
  const zone = CANOPY_BENCHMARK_ZONE;
  const half = zone.forestRadius;
  const tilesPerAxis = Math.ceil((half * 2) / zone.tileSize);
  const tileX = Math.min(
    tilesPerAxis - 1,
    Math.max(0, Math.floor((x - (zone.center.x - half)) / zone.tileSize)),
  );
  const tileZ = Math.min(
    tilesPerAxis - 1,
    Math.max(0, Math.floor((z - (zone.center.z - half)) / zone.tileSize)),
  );
  return `${tileX}:${tileZ}`;
}

export function generateCanopyBenchmarkPoints(
  kind: "trees" | "groundcover" | "rocks",
  count: number,
): CanopyBenchmarkPoint[] {
  const safeCount = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  const random = seededRandom(
    `${WORLD_SEED}:canopy-benchmark:v1:${kind}:capacity`,
  );
  const zone = CANOPY_BENCHMARK_ZONE;
  const points: CanopyBenchmarkPoint[] = [];
  const minimumRadius = zone.shorelineRadius + (kind === "trees" ? 4 : 1.5);
  const attemptsLimit = safeCount * 24 + 64;
  let attempts = 0;
  while (points.length < safeCount && attempts < attemptsLimit) {
    attempts += 1;
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(
      minimumRadius * minimumRadius +
        random() *
          (zone.forestRadius * zone.forestRadius -
            minimumRadius * minimumRadius),
    );
    const x = zone.center.x + Math.cos(angle) * radius;
    const z = zone.center.z + Math.sin(angle) * radius;
    const padding = kind === "trees" ? 1.8 : kind === "rocks" ? 1.1 : 0.3;
    if (isCanopyBenchmarkClearing(x, z, padding)) continue;
    points.push({
      x,
      z,
      scale:
        kind === "trees"
          ? 0.72 + random() * 0.82
          : kind === "rocks"
            ? 0.3 + random() * 1.15
            : 0.58 + random() * 0.94,
      yaw: random() * Math.PI * 2,
      tint: 0.84 + random() * 0.22,
    });
  }
  return points;
}

export function generateCanopyBenchmarkReeds(count: number) {
  const safeCount = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  const random = seededRandom(
    `${WORLD_SEED}:canopy-benchmark:v1:reeds:capacity`,
  );
  const zone = CANOPY_BENCHMARK_ZONE;
  return Array.from({ length: safeCount }, () => {
    const angle = random() * Math.PI * 2;
    const radius = zone.lakeRadius + 1.5 + random() * 13;
    return {
      x: zone.center.x + Math.cos(angle) * radius,
      z: zone.center.z + Math.sin(angle) * radius,
      scale: 0.55 + random() * 0.8,
      yaw: angle + (random() - 0.5) * 0.6,
      tint: 0.84 + random() * 0.2,
    } satisfies CanopyBenchmarkPoint;
  });
}

export function canopyBenchmarkArrivalChunk() {
  return {
    x: Math.floor((CANOPY_BENCHMARK_ZONE.arrival.x + CHUNK_SIZE / 2) / CHUNK_SIZE),
    z: Math.floor((CANOPY_BENCHMARK_ZONE.arrival.z + CHUNK_SIZE / 2) / CHUNK_SIZE),
  };
}
