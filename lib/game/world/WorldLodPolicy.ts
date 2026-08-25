export type WorldDetailLevel = 0 | 1 | 2 | 3 | 4;

export interface WorldLodPolicy {
  label: string;
  description: string;
  nearCellSize: number;
  detailBlendEnd: number;
  sceneryOuter: number;
  scenerySpacing: number;
  sceneryDensity: number;
  maxSceneryInstances: number;
  maxTerrainTriangles: number;
}

export const WORLD_DETAIL_LEVELS = [0, 1, 2, 3, 4] as const;
export const DEFAULT_WORLD_DETAIL_LEVEL: WorldDetailLevel = 2;

/**
 * World detail only changes render-only HLOD. It never expands the populated
 * chunk ring, collision, targets, interiors, wildlife, or citizen simulation.
 */
export const WORLD_DETAIL_PRESETS: Readonly<Record<WorldDetailLevel, WorldLodPolicy>> = {
  0: {
    label: "LOW",
    description: "COARSE TERRAIN",
    nearCellSize: 48,
    detailBlendEnd: 576,
    sceneryOuter: 432,
    scenerySpacing: 128,
    sceneryDensity: 0,
    maxSceneryInstances: 0,
    maxTerrainTriangles: 60_000,
  },
  1: {
    label: "BALANCED",
    description: "0.96 KM DETAIL",
    nearCellSize: 32,
    detailBlendEnd: 960,
    sceneryOuter: 912,
    scenerySpacing: 104,
    sceneryDensity: 0.46,
    maxSceneryInstances: 700,
    maxTerrainTriangles: 85_000,
  },
  2: {
    label: "HIGH",
    description: "1.34 KM DETAIL",
    nearCellSize: 24,
    detailBlendEnd: 1_344,
    sceneryOuter: 1_248,
    scenerySpacing: 88,
    sceneryDensity: 0.66,
    maxSceneryInstances: 1_200,
    maxTerrainTriangles: 120_000,
  },
  3: {
    label: "ULTRA",
    description: "1.63 KM DETAIL",
    nearCellSize: 16,
    detailBlendEnd: 1_632,
    sceneryOuter: 1_536,
    scenerySpacing: 72,
    sceneryDensity: 0.84,
    maxSceneryInstances: 1_800,
    maxTerrainTriangles: 190_000,
  },
  4: {
    label: "MAXIMUM",
    description: "1.92 KM DETAIL",
    nearCellSize: 12,
    detailBlendEnd: 1_920,
    sceneryOuter: 1_872,
    scenerySpacing: 60,
    sceneryDensity: 1,
    maxSceneryInstances: 2_600,
    maxTerrainTriangles: 300_000,
  },
};

export function normalizeWorldDetailLevel(
  value: unknown,
  fallback: WorldDetailLevel = DEFAULT_WORLD_DETAIL_LEVEL,
): WorldDetailLevel {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  return Math.min(4, Math.max(0, rounded)) as WorldDetailLevel;
}

export function worldLodPolicy(value: unknown): WorldLodPolicy {
  return WORLD_DETAIL_PRESETS[normalizeWorldDetailLevel(value)];
}
