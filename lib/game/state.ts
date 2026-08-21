import { BEACONS, type BeaconId, type QualityLevel } from "./config";
import { EMPTY_INVENTORY, type InventoryState, type ItemId } from "./gameplay/items";

export interface NearbyTargetSnapshot {
  id: string;
  kind: "beacon" | "pickup" | "resource";
  action: "scan" | "collect" | "harvest";
  name: string;
  item: ItemId | null;
  hits: number;
  hitsRequired: number;
  beaconId: BeaconId | null;
}

export interface LastGatherSnapshot {
  targetName: string;
  item: ItemId;
  quantity: number;
  result: "hit" | "collected" | "depleted";
  remainingHits: number;
}

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
  inventory: InventoryState;
  worldChanges: number;
  grounded: boolean;
  crouching: boolean;
  sprinting: boolean;
  stamina: number;
  biome: { id: string; name: string; region: string };
  nearestSettlement: {
    id: string;
    name: string;
    tier: "megacity" | "city" | "town" | "village";
    distance: number;
    economy: string;
    reason: string;
  };
  nearbyTarget: NearbyTargetSnapshot | null;
  nearbyBeacon: BeaconId | null;
  nearbyDistance: number | null;
  lastDiscovery: BeaconId | null;
  lastGather: LastGatherSnapshot | null;
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
  inventory: { ...EMPTY_INVENTORY },
  worldChanges: 0,
  grounded: true,
  crouching: false,
  sprinting: false,
  stamina: 1,
  biome: { id: "grey_meadow", name: "Grey Meadow", region: "Red Basin Marches" },
  nearestSettlement: {
    id: "dustmere",
    name: "Dustmere",
    tier: "village",
    distance: 0,
    economy: "goats · dry farming · relay salvage",
    reason: "A basin settlement.",
  },
  nearbyTarget: null,
  nearbyBeacon: null,
  nearbyDistance: null,
  lastDiscovery: null,
  lastGather: null,
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
