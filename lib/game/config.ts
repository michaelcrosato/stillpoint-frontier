export const GAME_TITLE = "Stillpoint Frontier";
export const WORLD_SEED = "STILL-0317";

export const CHUNK_SIZE = 96;
export const CHUNK_SEGMENTS = 18;
/** 9x9 visual ring: exactly twice the previous worst-direction terrain horizon. */
export const WORLD_CHUNK_LOAD_RADIUS = 4;
/** Keep colliders, targets, and resource queries inside the original 5x5 budget. */
export const GAMEPLAY_CHUNK_RADIUS = 2;
/** Ambient citizens remain independent from the expanded visual horizon. */
export const CITIZEN_CHUNK_LOAD_RADIUS = 2;
/** Sparse ambient wildlife uses its own render-only 5x5 simulation ring. */
export const ANIMAL_CHUNK_LOAD_RADIUS = 2;
export const WORLD_RESIDENT_CHUNKS = (WORLD_CHUNK_LOAD_RADIUS * 2 + 1) ** 2;
export const CITIZEN_RESIDENT_CHUNKS = (CITIZEN_CHUNK_LOAD_RADIUS * 2 + 1) ** 2;
export const ANIMAL_RESIDENT_CHUNKS = (ANIMAL_CHUNK_LOAD_RADIUS * 2 + 1) ** 2;
export const DETAILED_TERRAIN_HALF_EXTENT =
  (WORLD_CHUNK_LOAD_RADIUS + 0.5) * CHUNK_SIZE;
export const CAMERA_DRAW_DISTANCE = 1_840;
export const WAYPOINT_WORLD_MARKER_DISTANCE = 846;
export const PLAYER_HEIGHT = 1.72;
export const CROUCH_HEIGHT = 1.08;
export const PLAYER_RADIUS = 0.42;
/** Maximum authored rise the grounded controller can step onto in one sample. */
export const MAX_STEP_HEIGHT = 0.22;
export const WALK_SPEED = 6.4;
export const SPRINT_SPEED = 10.5;
export const CROUCH_SPEED = 3.35;
export const JUMP_SPEED = 7.1;
export const GRAVITY = 19.5;
export const STAMINA_DRAIN_RATE = 0.24;
export const STAMINA_REGEN_RATE = 0.18;
export const STAMINA_REGEN_DELAY = 0.65;
export const INTERACTION_DISTANCE = 6.25;

export type QualityLevel = "ultra" | "cinematic" | "performance";

export interface QualityPreset {
  label: string;
  pixelRatioCap: number;
  sunShadowMapSize: number;
  flashlightShadowMapSize: number;
  shadows: boolean;
  highDetail: boolean;
  postProcessing: {
    enabled: boolean;
    msaaSamples: number;
    bloomStrength: number;
    bloomRadius: number;
    bloomThreshold: number;
    gtao: boolean;
    gtaoResolutionScale: number;
    gradingStrength: number;
    vignetteStrength: number;
    ditherStrength: number;
  };
  environmentMap: {
    size: number;
    intensity: number;
  };
  worldEffects: {
    /** Shader-only breakup applied to tagged terrain and structure surfaces. */
    surfaceDetailStrength: number;
    /** Multiplier for weather-driven vegetation displacement. */
    vegetationWindStrength: number;
  };
}

/**
 * Rendering budgets live in one table so every subsystem agrees on what a
 * profile means. Ultra deliberately keeps the cinematic simulation budgets;
 * its extra cost is limited to image quality and shadow resolution.
 */
export const QUALITY_PRESETS: Readonly<Record<QualityLevel, QualityPreset>> = {
  ultra: {
    label: "ULTRA",
    pixelRatioCap: 2,
    sunShadowMapSize: 4096,
    flashlightShadowMapSize: 2048,
    shadows: true,
    highDetail: true,
    postProcessing: {
      enabled: true,
      msaaSamples: 4,
      bloomStrength: 0.24,
      bloomRadius: 0.32,
      bloomThreshold: 0.38,
      gtao: true,
      gtaoResolutionScale: 0.5,
      gradingStrength: 0.28,
      vignetteStrength: 0.1,
      ditherStrength: 0.55,
    },
    environmentMap: { size: 128, intensity: 0.82 },
    worldEffects: {
      surfaceDetailStrength: 1,
      vegetationWindStrength: 1,
    },
  },
  cinematic: {
    label: "CINEMATIC",
    pixelRatioCap: 1.75,
    sunShadowMapSize: 2048,
    flashlightShadowMapSize: 1024,
    shadows: true,
    highDetail: true,
    postProcessing: {
      enabled: true,
      msaaSamples: 2,
      bloomStrength: 0.17,
      bloomRadius: 0.24,
      bloomThreshold: 0.42,
      gtao: false,
      gtaoResolutionScale: 0.5,
      gradingStrength: 0.2,
      vignetteStrength: 0.075,
      ditherStrength: 0.42,
    },
    environmentMap: { size: 64, intensity: 0.68 },
    worldEffects: {
      surfaceDetailStrength: 0.78,
      vegetationWindStrength: 1,
    },
  },
  performance: {
    label: "PERFORMANCE",
    pixelRatioCap: 1,
    sunShadowMapSize: 2048,
    flashlightShadowMapSize: 1024,
    shadows: false,
    highDetail: false,
    postProcessing: {
      enabled: false,
      msaaSamples: 0,
      bloomStrength: 0,
      bloomRadius: 0,
      bloomThreshold: 1.3,
      gtao: false,
      gtaoResolutionScale: 0.5,
      gradingStrength: 0,
      vignetteStrength: 0,
      ditherStrength: 0,
    },
    environmentMap: { size: 32, intensity: 0.5 },
    worldEffects: {
      surfaceDetailStrength: 0.42,
      vegetationWindStrength: 0.78,
    },
  },
} as const;

export const QUALITY_LEVELS = ["performance", "cinematic", "ultra"] as const;
export const MAX_PIXEL_RATIO = QUALITY_PRESETS.cinematic.pixelRatioCap;
export const SHADOW_MAP_SIZE = QUALITY_PRESETS.cinematic.sunShadowMapSize;

export function isQualityLevel(value: unknown): value is QualityLevel {
  return value === "ultra" || value === "cinematic" || value === "performance";
}

export function qualityUsesShadows(quality: QualityLevel) {
  return QUALITY_PRESETS[quality].shadows;
}

export function qualityUsesHighDetail(quality: QualityLevel) {
  return QUALITY_PRESETS[quality].highDetail;
}

export type HorizonMode = "standard" | "extended" | "unlimited";

export interface HorizonRingDefinition {
  inner: number;
  outer: number;
  cellSize: number;
}

export interface HorizonPreset {
  label: string;
  drawDistanceMeters: number;
  /** Clear-weather multiplier; hazardous weather deliberately restores denser fog. */
  hazeMultiplier: number;
  rings: readonly HorizonRingDefinition[];
}

/**
 * View distance never expands the synchronous full-detail chunk ring. Extended
 * terrain is render-only HLOD: no props, interiors, collision, targets, or AI.
 * "Unlimited" means the finite atlas horizon rather than an infinite far plane.
 */
export const HORIZON_PRESETS: Readonly<Record<HorizonMode, HorizonPreset>> = {
  standard: {
    label: "STANDARD",
    drawDistanceMeters: CAMERA_DRAW_DISTANCE,
    hazeMultiplier: 1,
    rings: [{ inner: DETAILED_TERRAIN_HALF_EXTENT, outer: 1_920, cellSize: 48 }],
  },
  extended: {
    label: "EXTENDED",
    drawDistanceMeters: 12_000,
    hazeMultiplier: 0.2,
    rings: [
      { inner: DETAILED_TERRAIN_HALF_EXTENT, outer: 1_920, cellSize: 48 },
      { inner: 1_920, outer: 6_144, cellSize: 192 },
      { inner: 6_144, outer: 12_288, cellSize: 384 },
    ],
  },
  unlimited: {
    label: "UNLIMITED",
    drawDistanceMeters: 70_000,
    hazeMultiplier: 0.055,
    rings: [
      { inner: DETAILED_TERRAIN_HALF_EXTENT, outer: 1_920, cellSize: 48 },
      { inner: 1_920, outer: 6_144, cellSize: 192 },
      { inner: 6_144, outer: 24_576, cellSize: 768 },
      { inner: 24_576, outer: 49_152, cellSize: 1_536 },
    ],
  },
} as const;

export const DEFAULT_HORIZON_MODE: HorizonMode = "standard";

export function isHorizonMode(value: unknown): value is HorizonMode {
  return value === "standard" || value === "extended" || value === "unlimited";
}

export const BEACONS = [
  {
    id: "amber-relay",
    name: "Amber Relay",
    code: "SR-01",
    x: 38,
    z: -52,
    note: "A weather archive, sealed before the last migration.",
  },
  {
    id: "hollow-array",
    name: "Hollow Array",
    code: "SR-02",
    x: -112,
    z: -118,
    note: "Its alignment points below the horizon, not above it.",
  },
  {
    id: "meridian-vault",
    name: "Meridian Vault",
    code: "SR-03",
    x: 156,
    z: 76,
    note: "The final survey mark repeats a coordinate with no known place.",
  },
] as const;

export type BeaconId = (typeof BEACONS)[number]["id"];
