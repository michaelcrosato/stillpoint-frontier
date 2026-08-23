import {
  BEACONS,
  CAMERA_DRAW_DISTANCE,
  type BeaconId,
  type QualityLevel,
} from "./config";
import type {
  DayPhase,
  PrecipitationKind,
  WeatherId,
} from "./environment/model";
import {
  developerWeatherOptions,
  type DeveloperWeatherOption,
} from "./developer/environmentState";
import { EMPTY_INVENTORY, type InventoryState, type ItemId } from "./gameplay/items";
import type { NavigationGuidance } from "./navigation/NavigationService";

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

export interface EnvironmentSnapshot {
  totalMinutes: number;
  day: number;
  hour: number;
  minute: number;
  phase: DayPhase;
  weatherId: WeatherId;
  weatherLabel: string;
  precipitation: PrecipitationKind;
  temperatureC: number;
  windKph: number;
  windDirection: number;
  visibilityMeters: number;
}

export interface FastTravelSnapshot {
  id: string;
  name: string;
  kind: "megacity" | "city" | "town" | "village" | "relay";
}

export interface DeveloperToolsSnapshot {
  enabled: boolean;
  panelOpen: boolean;
  clockPaused: boolean;
  persistentWorldMinutes: number;
  weatherOverride: WeatherId | null;
  weatherOptions: DeveloperWeatherOption[];
}

export interface GameSnapshot {
  ready: boolean;
  started: boolean;
  paused: boolean;
  mapOpen: boolean;
  devTools: DeveloperToolsSnapshot;
  contextStatus: "ready" | "lost";
  position: { x: number; y: number; z: number };
  heading: number;
  navigation: NavigationGuidance | null;
  fps: number;
  chunk: { x: number; z: number };
  loadedChunks: number;
  drawDistanceMeters: number;
  citizenCount: number;
  crowdDensity: "WILDERNESS" | "QUIET" | "LOCAL" | "ACTIVE" | "BUSY" | "SURGE";
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
  environment: EnvironmentSnapshot;
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
  lastFastTravel: FastTravelSnapshot | null;
}

export const INITIAL_SNAPSHOT: GameSnapshot = {
  ready: false,
  started: false,
  paused: false,
  mapOpen: false,
  devTools: {
    enabled: false,
    panelOpen: false,
    clockPaused: false,
    persistentWorldMinutes: 450,
    weatherOverride: null,
    weatherOptions: developerWeatherOptions("grey_meadow"),
  },
  contextStatus: "ready",
  position: { x: 0, y: 0, z: 0 },
  heading: 0,
  navigation: null,
  fps: 60,
  chunk: { x: 0, z: 0 },
  loadedChunks: 0,
  drawDistanceMeters: CAMERA_DRAW_DISTANCE,
  citizenCount: 0,
  crowdDensity: "WILDERNESS",
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
  environment: {
    totalMinutes: 450,
    day: 1,
    hour: 7,
    minute: 30,
    phase: "day",
    weatherId: "fair",
    weatherLabel: "Meadow fair",
    precipitation: "none",
    temperatureC: 16,
    windKph: 12,
    windDirection: 0,
    visibilityMeters: 638,
  },
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
  lastFastTravel: null,
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
