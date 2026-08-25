import * as THREE from "three";
import { WORLD_SEED } from "../config";
import { hashString } from "../core/random";
import { WATER_LEVEL, sampleClimate } from "./macroWorld";
import { sampleTerrainHeight } from "./terrain";

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

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

/** Continuous absolute-world noise: no chunk key, anchor, or instance order. */
export function sampleSurfaceNoise(x: number, z: number, salt = 0) {
  const safeX = finite(x);
  const safeZ = finite(z);
  const phase = seedPhase * Math.PI * 2 + finite(salt);
  const broad = Math.sin(safeX * 0.021 + safeZ * 0.014 + phase) * 0.5;
  const cross = Math.cos(safeZ * 0.037 - safeX * 0.011 - phase * 0.71) * 0.3;
  const detail = Math.sin((safeX - safeZ) * 0.083 + phase * 1.37) * 0.2;
  return THREE.MathUtils.clamp((broad + cross + detail) * 0.5 + 0.5, 0, 1);
}

export function sampleTerrainSlope(x: number, z: number) {
  const safeX = finite(x);
  const safeZ = finite(z);
  const interval = 3.5;
  const dx = (
    sampleTerrainHeight(safeX + interval, safeZ) -
    sampleTerrainHeight(safeX - interval, safeZ)
  ) / (interval * 2);
  const dz = (
    sampleTerrainHeight(safeX, safeZ + interval) -
    sampleTerrainHeight(safeX, safeZ - interval)
  ) / (interval * 2);
  return THREE.MathUtils.clamp(Math.hypot(dx, dz) / 1.25, 0, 1);
}

export function terrainSurfaceFactors(
  x: number,
  z: number,
  height: number,
): TerrainSurfaceFactors {
  const safeX = finite(x);
  const safeZ = finite(z);
  const safeHeight = finite(height);
  return {
    noise: sampleSurfaceNoise(safeX, safeZ),
    slope: sampleTerrainSlope(safeX, safeZ),
    moisture: sampleClimate(safeX, safeZ).moisture,
    elevation: THREE.MathUtils.clamp((safeHeight + 18) / 92, 0, 1),
  };
}

export function terrainSurfaceColor(
  target: THREE.Color,
  x: number,
  z: number,
  height: number,
) {
  const safeHeight = finite(height);
  const factors = terrainSurfaceFactors(x, z, safeHeight);
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
