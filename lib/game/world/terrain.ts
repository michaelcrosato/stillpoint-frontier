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

const seedPhase = (hashString(WORLD_SEED) % 4096) / 4096;

/** Continuous analytic terrain: adjacent chunks always share exact edge heights. */
export function sampleTerrainHeight(x: number, z: number): number {
  const broad = Math.sin(x * 0.013 + seedPhase * 4.2) * 1.65;
  const cross = Math.cos(z * 0.015 - seedPhase * 2.1) * 1.3;
  const ridge = Math.sin((x + z) * 0.006 + seedPhase) * 2.4;
  const detail = Math.sin(x * 0.071) * Math.cos(z * 0.063) * 0.38;
  const coastalDrop = smoothstep(4_900, 5_900, z / WORLD_MODEL_SCALE) * 38;
  const land = sampleMacroElevation(x, z) + broad + cross + ridge + detail - coastalDrop;
  const riverBlend = smoothstep(riverWidth(z) + 28, riverWidth(z) - 4, distanceToRiver(x, z));
  const riverBed = WATER_LEVEL - 1.7 - Math.sin(z * 0.004) * 0.35;
  return land * (1 - riverBlend) + riverBed * riverBlend;
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
