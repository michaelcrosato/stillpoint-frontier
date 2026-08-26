import { CHUNK_SIZE, WORLD_SEED } from "../config";
import { hashString } from "../core/random";
import {
  WATER_LEVEL,
  distanceToRiver,
  riverWidth,
  sampleMacroElevation,
  smoothstep,
  WORLD_MODEL_SCALE,
} from "./macroWorld";
import { applyCanopyBenchmarkTerrainHeight } from "./benchmarkZone";
import { applyMountainTerrainHeight } from "./mountainLandmark";

const seedPhase = (hashString(WORLD_SEED) % 4096) / 4096;

function coastalDropAt(z: number) {
  return smoothstep(4_900, 5_900, z / WORLD_MODEL_SCALE) * 38;
}

function terrainHeightWithDetailWeight(
  x: number,
  z: number,
  detailWeight: number,
) {
  const broad = Math.sin(x * 0.013 + seedPhase * 4.2) * 1.65;
  const cross = Math.cos(z * 0.015 - seedPhase * 2.1) * 1.3;
  const ridge = Math.sin((x + z) * 0.006 + seedPhase) * 2.4;
  const detail =
    Math.sin(x * 0.071) * Math.cos(z * 0.063) * 0.38 * detailWeight;
  const land =
    sampleMacroElevation(x, z) + broad + cross + ridge + detail - coastalDropAt(z);
  const riverBlend = smoothstep(riverWidth(z) + 28, riverWidth(z) - 4, distanceToRiver(x, z));
  const riverBed = WATER_LEVEL - 1.7 - Math.sin(z * 0.004) * 0.35;
  return applyMountainTerrainHeight(
    applyCanopyBenchmarkTerrainHeight(
      land * (1 - riverBlend) + riverBed * riverBlend,
      x,
      z,
    ),
    x,
    z,
    detailWeight,
  );
}

/** Continuous analytic terrain: adjacent chunks always share exact edge heights. */
export function sampleTerrainHeight(x: number, z: number): number {
  return terrainHeightWithDetailWeight(x, z, 1);
}

/**
 * Analytic terrain with its shortest wave low-pass filtered for a requested
 * grid size. This keeps coarse HLOD vertices from undersampling that wave into
 * the large stripes visible in the middle distance.
 */
export function sampleTerrainHeightLod(x: number, z: number, cellSize: number) {
  const safeCellSize = Number.isFinite(cellSize) ? Math.max(0, cellSize) : 0;
  const detailWeight = 1 - smoothstep(22, 44, safeCellSize);
  return terrainHeightWithDetailWeight(x, z, detailWeight);
}

/**
 * Low-frequency surface used by the render-only horizon clipmap. River and sea
 * samples resolve to the water surface, avoiding both distant trench aliasing
 * and the need for a second full-world water mesh.
 */
export function sampleHorizonTerrainHeight(x: number, z: number): number {
  const land = sampleMacroElevation(x, z) - coastalDropAt(z);
  const riverBlend = smoothstep(
    riverWidth(z) + 28,
    riverWidth(z) - 4,
    distanceToRiver(x, z),
  );
  const surface = land * (1 - riverBlend) + WATER_LEVEL * riverBlend;
  return applyMountainTerrainHeight(
    applyCanopyBenchmarkTerrainHeight(
      Math.max(WATER_LEVEL, surface),
      x,
      z,
    ),
    x,
    z,
    0,
  );
}

export interface ChunkCoordinate {
  x: number;
  z: number;
}

export function worldToChunk(x: number, z: number): ChunkCoordinate {
  return {
    x: Math.floor((x + CHUNK_SIZE / 2) / CHUNK_SIZE),
    z: Math.floor((z + CHUNK_SIZE / 2) / CHUNK_SIZE),
  };
}

export function chunkKey(x: number, z: number) {
  return `${x}:${z}`;
}

export function chunkCenter(coordinate: ChunkCoordinate) {
  return {
    x: coordinate.x * CHUNK_SIZE,
    z: coordinate.z * CHUNK_SIZE,
  };
}

export function chunksAround(center: ChunkCoordinate, radius: number) {
  const coordinates: ChunkCoordinate[] = [];
  for (let dz = -radius; dz <= radius; dz += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      coordinates.push({ x: center.x + dx, z: center.z + dz });
    }
  }
  return coordinates;
}
