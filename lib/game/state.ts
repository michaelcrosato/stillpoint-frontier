import {
  BEACONS,
  CAMERA_DRAW_DISTANCE,
  DEFAULT_HORIZON_MODE,
  type BeaconId,
  type HorizonMode,
  type QualityLevel,
} from "./config";
import type { AudioDiagnostics } from "./audio/port";
import type {
  DayPhase,
  PrecipitationKind,
  WeatherId,
} from "./environment/model";
import {
  developerWeatherOptions,
  type DeveloperWeatherOption,
} from "./developer/environmentState";
import { createEmptyInventory, type InventoryState, type ItemId } from "./gameplay/items";
import type { CraftingStationKind, RecipeId } from "./gameplay/crafting";
import type { ContractJournalState } from "./gameplay/contracts";
import type { ContainerStates } from "./gameplay/loot";
import type { RestSiteDefinition } from "./gameplay/resting";
import type { InteractionPromptDescriptor } from "./gameplay/interactionPrompt";
import {
  MAX_HEALTH,
  type DamageNotice,
  type PlayerConditionTag,
} from "./gameplay/playerCondition";
import type {
  NavigationGuidance,
  NavigationTarget,
} from "./navigation/NavigationService";
import { DEFAULT_GAME_SETTINGS, type GameSettings } from "./settings";
import type { InspectionRecord } from "./world/inspectables";
import { WORLD_DETAIL_PRESETS } from "./world/WorldLodPolicy";
import {
  getDiscoverableLocation,
  type DiscoverableLocation,
} from "./world/locationDiscovery";
import {
  initialGraphicsBenchmarkSnapshot,
  type GraphicsBenchmarkSnapshot,
} from "./developer/GraphicsBenchmark";
import type { ForestStressDiagnostics } from "./developer/ForestStressTest";
import {
  DEFAULT_GRAPHICS_FEATURES,
  type GraphicsFeatureState,
} from "./rendering/GraphicsFeatures";

export interface NearbyTargetSnapshot {
  id: string;
  kind:
    | "beacon"
    | "pickup"
    | "resource"
    | "door"
    | "inspectable"
    | "station"
    | "container"
    | "rest"
    | "npc"
    | "scannable"
    | "animal";
  action:
    | "scan"
    | "collect"
    | "harvest"
    | "toggle"
    | "inspect"
    | "craft"
    | "loot"
    | "rest"
    | "talk";
  name: string;
  item: ItemId | null;
  hits: number;
  hitsRequired: number;
  beaconId: BeaconId | null;
  open: boolean | null;
  empty: boolean | null;
  fieldGuideId: string | null;
}

export type OperationsTab = "contracts" | "crafting" | "fieldGuide";

export type FeatureOverlayState =
  | null
  | { kind: "operations"; tab: OperationsTab; station: CraftingStationKind }
  | { kind: "dialogue"; npcId: string }
  | { kind: "container"; containerId: string }
  | { kind: "rest"; site: RestSiteDefinition };

export interface FeatureNotice {
  type: "contract" | "craft" | "scan" | "loot" | "rest" | "placement" | "item";
  title: string;
  detail: string;
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
  clockState: "running" | "paused" | "frozen" | "test_hold";
  gameMinutesPerRealSecond: number;
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
  graphicsFeatures: GraphicsFeatureState;
}

export interface GameSnapshot {
  ready: boolean;
  started: boolean;
  paused: boolean;
  mapOpen: boolean;
  inventoryOpen: boolean;
  settingsOpen: boolean;
  inspectionOpen: boolean;
  activeInspection: InspectionRecord | null;
  featureOverlay: FeatureOverlayState;
  devTools: DeveloperToolsSnapshot;
  contextStatus: "ready" | "lost";
  position: { x: number; y: number; z: number };
  heading: number;
  navigation: NavigationGuidance | null;
  navigationTargets: NavigationTarget[];
  fps: number;
  chunk: { x: number; z: number };
  loadedChunks: number;
  drawDistanceMeters: number;
  horizonMode: HorizonMode;
  horizonTiles: number;
  horizonTriangles: number;
  horizonSettlementInstances: number;
  horizonSceneryInstances: number;
  horizonDetailDistanceMeters: number;
  horizonNearCellSize: number;
  citizenCount: number;
  citizenActivity: number;
  animalCount: number;
  animalSpecies: number;
  crowdDensity: "WILDERNESS" | "QUIET" | "LOCAL" | "ACTIVE" | "BUSY" | "SURGE";
  triangles: number;
  drawCalls: number;
  geometries: number;
  textures: number;
  drawingBufferWidth: number;
  drawingBufferHeight: number;
  pixelRatio: number;
  cpuRenderMilliseconds: number;
  gpuRenderMilliseconds: number | null;
  gpuTimerSupported: boolean;
  gpuTimerStatus: "unsupported" | "ready" | "pending" | "disjoint";
  graphicsBenchmark: GraphicsBenchmarkSnapshot;
  forestStress: ForestStressDiagnostics;
  quality: QualityLevel;
  scanned: BeaconId[];
  inventory: InventoryState;
  inventoryWeight: number;
  inventoryItemCount: number;
  worldChanges: number;
  grounded: boolean;
  crouching: boolean;
  sprinting: boolean;
  stamina: number;
  health: number;
  maxHealth: number;
  wetness: number;
  coldStress: number;
  apparentTemperatureC: number;
  sheltered: boolean;
  conditions: PlayerConditionTag[];
  incapacitated: boolean;
  lastDamage: DamageNotice | null;
  flashlightOn: boolean;
  settings: GameSettings;
  saveStatus: "saved" | "unsaved" | "unavailable";
  lastSavedAt: number | null;
  audio: AudioDiagnostics;
  scanner: {
    active: boolean;
    focusId: string | null;
    focusEntryId: string | null;
    focusName: string | null;
    progress: number;
  };
  contractJournal: ContractJournalState;
  fieldGuideEntryIds: string[];
  containerStates: ContainerStates;
  placedEntityCount: number;
  unlockedRecipeIds: RecipeId[];
  lastFeatureNotice: FeatureNotice | null;
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
  interactionPrompt: InteractionPromptDescriptor | null;
  nearbyBeacon: BeaconId | null;
  nearbyDistance: number | null;
  lastDiscovery: BeaconId | null;
  lastGather: LastGatherSnapshot | null;
  lastFastTravel: FastTravelSnapshot | null;
  currentLocation: DiscoverableLocation;
  discoveredLocationIds: string[];
  lastLocationDiscovery: DiscoverableLocation | null;
}

export const INITIAL_SNAPSHOT: GameSnapshot = {
  ready: false,
  started: false,
  paused: false,
  mapOpen: false,
  inventoryOpen: false,
  settingsOpen: false,
  inspectionOpen: false,
  activeInspection: null,
  featureOverlay: null,
  devTools: {
    enabled: false,
    panelOpen: false,
    clockPaused: false,
    persistentWorldMinutes: 450,
    weatherOverride: null,
    weatherOptions: developerWeatherOptions("grey_meadow"),
    graphicsFeatures: { ...DEFAULT_GRAPHICS_FEATURES },
  },
  contextStatus: "ready",
  position: { x: 0, y: 0, z: 0 },
  heading: 0,
  navigation: null,
  navigationTargets: [],
  fps: 60,
  chunk: { x: 0, z: 0 },
  loadedChunks: 0,
  drawDistanceMeters: CAMERA_DRAW_DISTANCE,
  horizonMode: DEFAULT_HORIZON_MODE,
  horizonTiles: 0,
  horizonTriangles: 0,
  horizonSettlementInstances: 0,
  horizonSceneryInstances: 0,
  horizonDetailDistanceMeters:
    WORLD_DETAIL_PRESETS[DEFAULT_GAME_SETTINGS.worldDetail].detailBlendEnd,
  horizonNearCellSize:
    WORLD_DETAIL_PRESETS[DEFAULT_GAME_SETTINGS.worldDetail].nearCellSize,
  citizenCount: 0,
  citizenActivity: 0,
  animalCount: 0,
  animalSpecies: 0,
  crowdDensity: "WILDERNESS",
  triangles: 0,
  drawCalls: 0,
  geometries: 0,
  textures: 0,
  drawingBufferWidth: 0,
  drawingBufferHeight: 0,
  pixelRatio: 1,
  cpuRenderMilliseconds: 0,
  gpuRenderMilliseconds: null,
  gpuTimerSupported: false,
  gpuTimerStatus: "unsupported",
  graphicsBenchmark: initialGraphicsBenchmarkSnapshot(),
  forestStress: {
    id: "canopy-load-lab",
    label: "Canopy Load Lab",
    active: false,
    level: 2,
    levelLabel: "DENSE",
    distanceMeters: -1,
    trees: 0,
    groundcover: 0,
    rocks: 0,
    reeds: 0,
    authoredInstances: 0,
    allocatedInstances: 0,
    activeLodInstances: 0,
    estimatedActiveLodTriangles: 0,
    estimatedActiveLodDrawCalls: 0,
    tiles: 0,
    nearTiles: 0,
    midTiles: 0,
    farTiles: 0,
    rebuilds: 0,
    buildMilliseconds: 0,
    renderOnly: true,
  },
  quality: "cinematic",
  scanned: [],
  inventory: createEmptyInventory(),
  inventoryWeight: 0,
  inventoryItemCount: 0,
  worldChanges: 0,
  grounded: true,
  crouching: false,
  sprinting: false,
  stamina: 1,
  health: MAX_HEALTH,
  maxHealth: MAX_HEALTH,
  wetness: 0,
  coldStress: 0,
  apparentTemperatureC: 16,
  sheltered: false,
  conditions: [],
  incapacitated: false,
  lastDamage: null,
  flashlightOn: false,
  settings: {
    ...DEFAULT_GAME_SETTINGS,
    keyBindings: { ...DEFAULT_GAME_SETTINGS.keyBindings },
  },
  saveStatus: "unavailable",
  lastSavedAt: null,
  audio: {
    available: false,
    unlocked: false,
    state: "uninitialized",
    cueCount: 0,
    spatialCueCount: 0,
    listenerUpdates: 0,
    lastCue: null,
  },
  scanner: {
    active: false,
    focusId: null,
    focusEntryId: null,
    focusName: null,
    progress: 0,
  },
  contractJournal: { contracts: {}, activeContractId: null },
  fieldGuideEntryIds: [],
  containerStates: {},
  placedEntityCount: 0,
  unlockedRecipeIds: [],
  lastFeatureNotice: null,
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
    clockState: "paused",
    gameMinutesPerRealSecond: 1,
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
  interactionPrompt: null,
  nearbyBeacon: null,
  nearbyDistance: null,
  lastDiscovery: null,
  lastGather: null,
  lastFastTravel: null,
  currentLocation: getDiscoverableLocation("landmark:field-unit-compound")!,
  discoveredLocationIds: [],
  lastLocationDiscovery: null,
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
