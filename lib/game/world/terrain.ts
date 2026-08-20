import { CHUNK_SIZE, WORLD_SEED } from "../config";
import { hashString } from "../core/random";

const seedPhase = (hashString(WORLD_SEED) % 4096) / 4096;

/** Continuous analytic terrain: adjacent chunks always share exact edge heights. */
export function sampleTerrainHeight(x: number, z: number): number {
  const broad = Math.sin(x * 0.013 + seedPhase * 4.2) * 2.15;
  const cross = Math.cos(z * 0.015 - seedPhase * 2.1) * 1.65;
  const ridge = Math.sin((x + z) * 0.006 + seedPhase) * 3.1;
  const detail = Math.sin(x * 0.071) * Math.cos(z * 0.063) * 0.38;
  return broad + cross + ridge + detail;
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
