import { BEACONS, type BeaconId, type QualityLevel } from "./config";

export interface GameSnapshot {
  ready: boolean;
  started: boolean;
  paused: boolean;
  mapOpen: boolean;
  contextStatus: "ready" | "lost";
  position: { x: number; y: number; z: number };
  heading: number;
  fps: number;
  chunk: { x: number; z: number };
  loadedChunks: number;
  triangles: number;
  geometries: number;
  textures: number;
  quality: QualityLevel;
  scanned: BeaconId[];
  nearbyBeacon: BeaconId | null;
  nearbyDistance: number | null;
  lastDiscovery: BeaconId | null;
}

export const INITIAL_SNAPSHOT: GameSnapshot = {
  ready: false,
  started: false,
  paused: false,
  mapOpen: false,
  contextStatus: "ready",
  position: { x: 0, y: 0, z: 0 },
  heading: 0,
  fps: 60,
  chunk: { x: 0, z: 0 },
  loadedChunks: 0,
  triangles: 0,
  geometries: 0,
  textures: 0,
  quality: "cinematic",
  scanned: [],
  nearbyBeacon: null,
  nearbyDistance: null,
  lastDiscovery: null,
};

export function addDiscovery(
  scanned: readonly BeaconId[],
  beaconId: BeaconId,
): BeaconId[] {
  return scanned.includes(beaconId) ? [...scanned] : [...scanned, beaconId];
}

export function nextUnscannedBeacon(scanned: readonly BeaconId[]) {
  return BEACONS.find((beacon) => !scanned.includes(beacon.id)) ?? null;
}
