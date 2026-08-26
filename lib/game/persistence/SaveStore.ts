import {
  BEACONS,
  DEFAULT_HORIZON_MODE,
  isHorizonMode,
  type BeaconId,
  type HorizonMode,
} from "../config";
import {
  EMPTY_INVENTORY,
  ITEM_DEFINITIONS,
  type InventoryState,
  type ItemId,
} from "../gameplay/items";
import type { EntityDiff } from "../gameplay/interactions";
import { MAX_HEALTH } from "../gameplay/playerCondition";
import {
  createFeatureProgress,
  normalizeFeatureProgress,
  type FeatureProgressState,
} from "../gameplay/progression";
import {
  MAX_WORLD_MINUTES,
  WORLD_START_MINUTES,
} from "../environment/model";
import { WORLD_HALF_EXTENT } from "../world/macroWorld";
import { isKnownLocationId } from "../world/locationDiscovery";

// Keep the legacy key so version-one saves migrate in place.
const SAVE_KEY = "stillpoint-frontier:survey:v1";
const VALID_BEACONS = new Set<string>(BEACONS.map((beacon) => beacon.id));
const VALID_ITEMS = new Set<string>(Object.keys(ITEM_DEFINITIONS));
const ENTITY_ID = /^[a-z0-9][a-z0-9:._-]{0,119}$/i;
const MAX_WORLD_DIFFS = 10_000;
const MAX_DOOR_STATES = 256;
const MAX_DISCOVERED_LOCATIONS = 128;
const CURRENT_SAVE_VERSION = 8;

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface FrontierSave {
  version: 8;
  scanned: BeaconId[];
  inventory: InventoryState;
  worldDiffs: Record<string, EntityDiff>;
  doorStates: Record<string, boolean>;
  manualWaypoint: SavedMapWaypoint | null;
  worldMinutes: number;
  horizonMode: HorizonMode;
  player: SavedPlayerState | null;
  discoveredLocations: string[];
  featureProgress: FeatureProgressState;
}

export interface FrontierSaveInput {
  scanned: readonly BeaconId[];
  inventory: Readonly<InventoryState>;
  worldDiffs: Readonly<Record<string, EntityDiff>>;
  doorStates: Readonly<Record<string, boolean>>;
  manualWaypoint: Readonly<SavedMapWaypoint> | null;
  worldMinutes: number;
  horizonMode: HorizonMode;
  player?: Readonly<SavedPlayerState> | null;
  discoveredLocations?: readonly string[];
  featureProgress?: Readonly<FeatureProgressState>;
}

export interface SavedMapWaypoint {
  x: number;
  z: number;
}

export interface SavedPlayerState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  wetness: number;
  coldStress: number;
}

export function createEmptyFrontierSave(): FrontierSave {
  return {
    version: 8,
    scanned: [],
    inventory: { ...EMPTY_INVENTORY },
    worldDiffs: {},
    doorStates: {},
    manualWaypoint: null,
    worldMinutes: WORLD_START_MINUTES,
    horizonMode: DEFAULT_HORIZON_MODE,
    player: null,
    discoveredLocations: [],
    featureProgress: createFeatureProgress(),
  };
}

function normalizeDoorStates(value: unknown): Record<string, boolean> {
  const doorStates: Record<string, boolean> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return doorStates;
  for (const [id, open] of Object.entries(value).slice(0, MAX_DOOR_STATES)) {
    if (!ENTITY_ID.test(id) || typeof open !== "boolean") continue;
    doorStates[id] = open;
  }
  return doorStates;
}

function normalizeScanned(value: unknown): BeaconId[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value)]
    .filter((id): id is BeaconId => typeof id === "string" && VALID_BEACONS.has(id))
    .sort(
      (left, right) =>
        BEACONS.findIndex((beacon) => beacon.id === left) -
        BEACONS.findIndex((beacon) => beacon.id === right),
    );
}

function normalizeInventory(value: unknown): InventoryState {
  const inventory = { ...EMPTY_INVENTORY };
  if (!value || typeof value !== "object") return inventory;
  for (const [item, quantity] of Object.entries(value)) {
    if (!VALID_ITEMS.has(item)) continue;
    if (!Number.isSafeInteger(quantity) || (quantity as number) < 0) continue;
    inventory[item as ItemId] = Math.min(
      quantity as number,
      ITEM_DEFINITIONS[item as ItemId].stackLimit,
    );
  }
  return inventory;
}

function normalizeWorldDiffs(value: unknown): Record<string, EntityDiff> {
  const worldDiffs: Record<string, EntityDiff> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return worldDiffs;
  for (const [id, rawDiff] of Object.entries(value).slice(0, MAX_WORLD_DIFFS)) {
    if (!ENTITY_ID.test(id) || !rawDiff || typeof rawDiff !== "object") continue;
    const { hits, removed } = rawDiff as { hits?: unknown; removed?: unknown };
    if (!Number.isSafeInteger(hits) || (hits as number) < 0 || (hits as number) > 64) continue;
    if (typeof removed !== "boolean") continue;
    worldDiffs[id] = { hits: hits as number, removed };
  }
  return worldDiffs;
}

function normalizeManualWaypoint(value: unknown): SavedMapWaypoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { x, z } = value as { x?: unknown; z?: unknown };
  if (typeof x !== "number" || typeof z !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  if (Math.abs(x) > WORLD_HALF_EXTENT || Math.abs(z) > WORLD_HALF_EXTENT) return null;
  return { x, z };
}

function normalizeWorldMinutes(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return WORLD_START_MINUTES;
  }
  return Math.min(value, MAX_WORLD_MINUTES);
}

function normalizeHorizonMode(value: unknown): HorizonMode {
  return isHorizonMode(value) ? value : DEFAULT_HORIZON_MODE;
}

function normalizePlayerState(value: unknown): SavedPlayerState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Partial<Record<keyof SavedPlayerState, unknown>>;
  if (
    typeof source.x !== "number" ||
    typeof source.y !== "number" ||
    typeof source.z !== "number" ||
    typeof source.yaw !== "number" ||
    !Number.isFinite(source.x) ||
    !Number.isFinite(source.y) ||
    !Number.isFinite(source.z) ||
    !Number.isFinite(source.yaw) ||
    Math.abs(source.x) > WORLD_HALF_EXTENT ||
    Math.abs(source.z) > WORLD_HALF_EXTENT ||
    source.y < -100 ||
    source.y > 5_000
  ) {
    return null;
  }
  const wrap = (source.yaw + Math.PI) % (Math.PI * 2);
  const yaw = (wrap < 0 ? wrap + Math.PI * 2 : wrap) - Math.PI;
  const pitch = typeof source.pitch === "number" && Number.isFinite(source.pitch)
    ? Math.min(Math.PI * 0.48, Math.max(-Math.PI * 0.48, source.pitch))
    : 0;
  const normalizeMeter = (candidate: unknown, fallback: number, maximum: number) =>
    typeof candidate === "number" && Number.isFinite(candidate)
      ? Math.min(maximum, Math.max(0, candidate))
      : fallback;
  return {
    x: source.x,
    y: source.y,
    z: source.z,
    yaw,
    pitch,
    health: normalizeMeter(source.health, MAX_HEALTH, MAX_HEALTH),
    wetness: normalizeMeter(source.wetness, 0, 1),
    coldStress: normalizeMeter(source.coldStress, 0, 1),
  };
}

function normalizeDiscoveredLocations(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value)]
    .filter(isKnownLocationId)
    .slice(0, MAX_DISCOVERED_LOCATIONS)
    .sort();
}

export class SaveStore {
  constructor(private readonly storage: StorageAdapter | null) {}

  hasSave() {
    if (!this.storage) return false;
    try {
      const raw = this.storage.getItem(SAVE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as { version?: unknown };
      return Boolean(
        parsed &&
        typeof parsed === "object" &&
        Number.isSafeInteger(parsed.version) &&
        (parsed.version as number) >= 1 &&
        (parsed.version as number) <= CURRENT_SAVE_VERSION,
      );
    } catch {
      return false;
    }
  }

  load(): FrontierSave {
    if (!this.storage) return createEmptyFrontierSave();
    try {
      const raw = this.storage.getItem(SAVE_KEY);
      if (!raw) return createEmptyFrontierSave();
      const parsed = JSON.parse(raw) as {
        version?: unknown;
        scanned?: unknown;
        inventory?: unknown;
        worldDiffs?: unknown;
        doorStates?: unknown;
        manualWaypoint?: unknown;
        worldMinutes?: unknown;
        horizonMode?: unknown;
        player?: unknown;
        discoveredLocations?: unknown;
        featureProgress?: unknown;
      };
      const version = typeof parsed.version === "number" && Number.isSafeInteger(parsed.version)
        ? parsed.version
        : 0;
      if (version === 1) {
        return { ...createEmptyFrontierSave(), scanned: normalizeScanned(parsed.scanned) };
      }
      if (version < 2 || version > CURRENT_SAVE_VERSION) return createEmptyFrontierSave();
      return {
        version: 8,
        scanned: normalizeScanned(parsed.scanned),
        inventory: normalizeInventory(parsed.inventory),
        worldDiffs: normalizeWorldDiffs(parsed.worldDiffs),
        doorStates: version >= 5 ? normalizeDoorStates(parsed.doorStates) : {},
        manualWaypoint: version >= 3 ? normalizeManualWaypoint(parsed.manualWaypoint) : null,
        worldMinutes: version >= 4
          ? normalizeWorldMinutes(parsed.worldMinutes)
          : WORLD_START_MINUTES,
        horizonMode: version >= 6
          ? normalizeHorizonMode(parsed.horizonMode)
          : DEFAULT_HORIZON_MODE,
        player: version >= 7 ? normalizePlayerState(parsed.player) : null,
        discoveredLocations: version >= 7
          ? normalizeDiscoveredLocations(parsed.discoveredLocations)
          : [],
        featureProgress: version >= 8
          ? normalizeFeatureProgress(parsed.featureProgress)
          : createFeatureProgress(),
      };
    } catch {
      return createEmptyFrontierSave();
    }
  }

  save(input: Readonly<FrontierSaveInput>) {
    if (!this.storage) return false;
    try {
      // Never replace data written by a newer client with this client's
      // defaults. A future save remains intact until a compatible build loads.
      const existing = this.storage.getItem(SAVE_KEY);
      if (existing) {
        try {
          const parsed = JSON.parse(existing) as { version?: unknown };
          if (
            Number.isSafeInteger(parsed?.version) &&
            (parsed.version as number) > CURRENT_SAVE_VERSION
          ) return false;
        } catch {
          // A malformed legacy payload is recoverable and may be replaced.
        }
      }
      const payload: FrontierSave = {
        version: 8,
        scanned: normalizeScanned(input.scanned),
        inventory: normalizeInventory(input.inventory),
        worldDiffs: normalizeWorldDiffs(input.worldDiffs),
        doorStates: normalizeDoorStates(input.doorStates),
        manualWaypoint: normalizeManualWaypoint(input.manualWaypoint),
        worldMinutes: normalizeWorldMinutes(input.worldMinutes),
        horizonMode: normalizeHorizonMode(input.horizonMode),
        player: normalizePlayerState(input.player),
        discoveredLocations: normalizeDiscoveredLocations(input.discoveredLocations),
        featureProgress: normalizeFeatureProgress(input.featureProgress),
      };
      this.storage.setItem(SAVE_KEY, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }
}
