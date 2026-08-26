import * as THREE from "three";
import { WORLD_SEED } from "../config";
import { hashString } from "../core/random";
import { WATER_LEVEL, sampleClimate } from "./macroWorld";
import {
  MOUNTAIN_LANDMARK,
  mountainFootprintInfluence,
  sampleMountainLift,
} from "./mountainLandmark";
import {
  canyonDepthRatio,
  sampleCanyonDepth,
} from "./canyonLandmark";
import {
  sampleHorizonTerrainHeight,
  sampleTerrainHeight,
  sampleTerrainHeightLod,
} from "./terrain";

export type ProceduralSurfaceKind = "building" | "road" | "rock";

export interface TerrainSurfaceFactors {
  noise: number;
  slope: number;
  moisture: number;
  elevation: number;
}

const seedPhase = (hashString(`${WORLD_SEED}:surface-variation:v1`) % 65_521) / 65_521;
const CATEGORY_SALT: Readonly<Record<ProceduralSurfaceKind, number>> = {
  building: 1.7,
  road: 4.3,
  rock: 7.9,
};
const SURFACE_RANGES = {
  building: { hue: 0.008, saturation: 0.025, lightness: 0.11 },
  road: { hue: 0.004, saturation: 0.018, lightness: 0.075 },
  rock: { hue: 0.01, saturation: 0.03, lightness: 0.16 },
} as const;
const MOUNTAIN_STONE = new THREE.Color(0x686a67);
const MOUNTAIN_SNOW = new THREE.Color(0xd8d9d2);
const CANYON_RIM = new THREE.Color(0x9a6748);
const CANYON_WALL = new THREE.Color(0x704333);
const CANYON_GORGE = new THREE.Color(0x352d2a);

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

/** Continuous absolute-world noise: no chunk key, anchor, or instance order. */
export function sampleSurfaceNoise(
  x: number,
  z: number,
  salt = 0,
  cellSize = 0,
) {
  const safeX = finite(x);
  const safeZ = finite(z);
  const safeCellSize = Math.max(0, finite(cellSize));
  const phase = seedPhase * Math.PI * 2 + finite(salt);
  const broadWeight = 1 - THREE.MathUtils.smoothstep(safeCellSize, 82, 124);
  const broad =
    Math.sin(safeX * 0.021 + safeZ * 0.014 + phase) * 0.5 * broadWeight;
  const crossWeight = 1 - THREE.MathUtils.smoothstep(safeCellSize, 58, 84);
  const detailWeight = 1 - THREE.MathUtils.smoothstep(safeCellSize, 18, 30);
  const cross =
    Math.cos(safeZ * 0.037 - safeX * 0.011 - phase * 0.71) * 0.3 * crossWeight;
  const detail =
    Math.sin((safeX - safeZ) * 0.083 + phase * 1.37) * 0.2 * detailWeight;
  return THREE.MathUtils.clamp((broad + cross + detail) * 0.5 + 0.5, 0, 1);
}

export function sampleTerrainSlope(x: number, z: number, cellSize = 0) {
  const safeX = finite(x);
  const safeZ = finite(z);
  const safeCellSize = Math.max(0, finite(cellSize));
  const interval = Math.max(3.5, safeCellSize * 0.5);
  const sampleHeight = safeCellSize >= 96
    ? sampleHorizonTerrainHeight
    : safeCellSize > 0
    ? (sampleX: number, sampleZ: number) =>
        sampleTerrainHeightLod(sampleX, sampleZ, safeCellSize)
    : sampleTerrainHeight;
  const dx = (
    sampleHeight(safeX + interval, safeZ) -
    sampleHeight(safeX - interval, safeZ)
  ) / (interval * 2);
  const dz = (
    sampleHeight(safeX, safeZ + interval) -
    sampleHeight(safeX, safeZ - interval)
  ) / (interval * 2);
  return THREE.MathUtils.clamp(Math.hypot(dx, dz) / 1.25, 0, 1);
}

export function terrainSurfaceFactors(
  x: number,
  z: number,
  height: number,
  cellSize = 0,
  slopeOverride?: number,
): TerrainSurfaceFactors {
  const safeX = finite(x);
  const safeZ = finite(z);
  const safeHeight = finite(height);
  const climate = sampleClimate(safeX, safeZ);
  return {
    noise: sampleSurfaceNoise(safeX, safeZ, 0, cellSize),
    slope: typeof slopeOverride === "number" && Number.isFinite(slopeOverride)
      ? THREE.MathUtils.clamp(slopeOverride, 0, 1)
      : sampleTerrainSlope(safeX, safeZ, cellSize),
    moisture: climate.moisture,
    elevation: THREE.MathUtils.clamp((safeHeight + 18) / 92, 0, 1),
  };
}

export function terrainSurfaceColor(
  target: THREE.Color,
  x: number,
  z: number,
  height: number,
  cellSize = 0,
  slopeOverride?: number,
) {
  const safeHeight = finite(height);
  const factors = terrainSurfaceFactors(
    x,
    z,
    safeHeight,
    cellSize,
    slopeOverride,
  );
  const canyonDepth = sampleCanyonDepth(finite(x), finite(z));
  if (canyonDepth > 0.001) {
    const depth = canyonDepthRatio(finite(x), finite(z));
    const wallAmount = THREE.MathUtils.smoothstep(depth, 0.025, 0.64);
    const gorgeAmount = THREE.MathUtils.smoothstep(depth, 0.62, 0.94);
    const strata =
      Math.sin(canyonDepth * 0.071 + factors.noise * 5.4) * 0.018 +
      Math.sin(canyonDepth * 0.021 - factors.noise * 2.1) * 0.012;
    target.copy(CANYON_RIM);
    target.lerp(CANYON_WALL, wallAmount * 0.92);
    target.lerp(CANYON_GORGE, gorgeAmount * 0.86);
    target.offsetHSL(
      (factors.noise - 0.5) * 0.01,
      -factors.slope * 0.04,
      strata + (factors.noise - 0.5) * 0.045 - factors.slope * 0.045,
    );
    return target;
  }
  if (safeHeight <= WATER_LEVEL + 0.04) {
    target.setHex(0x36575a);
    target.offsetHSL(0, -0.025, (factors.noise - 0.5) * 0.035);
    return target;
  }
  target.setHex(sampleClimate(finite(x), finite(z)).biome.color);
  target.offsetHSL(
    (factors.moisture - 0.5) * -0.012,
    factors.moisture * 0.045 - factors.slope * 0.075,
    (factors.noise - 0.5) * 0.15 - factors.slope * 0.085 + factors.elevation * 0.045,
  );
  const mountainInfluence = mountainFootprintInfluence(finite(x), finite(z));
  if (mountainInfluence > 0) {
    const mountainElevation = THREE.MathUtils.clamp(
      sampleMountainLift(finite(x), finite(z)) /
        MOUNTAIN_LANDMARK.summitRelief,
      0,
      1,
    );
    const stoneAmount = THREE.MathUtils.smoothstep(
      mountainElevation,
      0.08,
      0.42,
    );
    const snowAmount = THREE.MathUtils.smoothstep(
      mountainElevation,
      0.66,
      0.9,
    ) * THREE.MathUtils.lerp(1, 0.62, factors.slope);
    target.lerp(
      MOUNTAIN_STONE,
      mountainInfluence * stoneAmount * 0.9,
    );
    target.lerp(
      MOUNTAIN_SNOW,
      mountainInfluence * snowAmount * 0.94,
    );
    target.offsetHSL(0, -0.015, (factors.noise - 0.5) * 0.055);
  }
  return target;
}

export function proceduralSurfaceColor(
  target: THREE.Color,
  baseColor: number,
  kind: ProceduralSurfaceKind,
  x: number,
  z: number,
) {
  const noise = sampleSurfaceNoise(x, z, CATEGORY_SALT[kind]);
  const range = SURFACE_RANGES[kind];
  const centered = noise - 0.5;
  target.setHex(baseColor);
  target.offsetHSL(
    centered * range.hue,
    centered * range.saturation,
    centered * range.lightness,
  );
  return target;
}
