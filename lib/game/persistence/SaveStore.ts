import { BEACONS, type BeaconId } from "../config";
import {
  EMPTY_INVENTORY,
  ITEM_DEFINITIONS,
  type InventoryState,
  type ItemId,
} from "../gameplay/items";
import type { EntityDiff } from "../gameplay/interactions";
import { WORLD_START_MINUTES } from "../environment/model";
import { WORLD_HALF_EXTENT } from "../world/macroWorld";

// Keep the legacy key so version-one saves migrate in place.
const SAVE_KEY = "stillpoint-frontier:survey:v1";
const VALID_BEACONS = new Set<string>(BEACONS.map((beacon) => beacon.id));
const VALID_ITEMS = new Set<string>(Object.keys(ITEM_DEFINITIONS));
const ENTITY_ID = /^[a-z0-9][a-z0-9:._-]{0,119}$/i;
const MAX_WORLD_DIFFS = 10_000;
const MAX_WORLD_MINUTES = 10_000_000;

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface FrontierSave {
  version: 4;
  scanned: BeaconId[];
  inventory: InventoryState;
  worldDiffs: Record<string, EntityDiff>;
  manualWaypoint: SavedMapWaypoint | null;
  worldMinutes: number;
}

export interface FrontierSaveInput {
  scanned: readonly BeaconId[];
  inventory: Readonly<InventoryState>;
  worldDiffs: Readonly<Record<string, EntityDiff>>;
  manualWaypoint: Readonly<SavedMapWaypoint> | null;
  worldMinutes: number;
}

export interface SavedMapWaypoint {
  x: number;
  z: number;
}

function emptySave(): FrontierSave {
  return {
    version: 4,
    scanned: [],
    inventory: { ...EMPTY_INVENTORY },
    worldDiffs: {},
    manualWaypoint: null,
    worldMinutes: WORLD_START_MINUTES,
  };
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
    inventory[item as ItemId] = Math.min(quantity as number, 999_999);
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

export class SaveStore {
  constructor(private readonly storage: StorageAdapter | null) {}

  load(): FrontierSave {
    if (!this.storage) return emptySave();
    try {
      const raw = this.storage.getItem(SAVE_KEY);
      if (!raw) return emptySave();
      const parsed = JSON.parse(raw) as {
        version?: unknown;
        scanned?: unknown;
        inventory?: unknown;
        worldDiffs?: unknown;
        manualWaypoint?: unknown;
        worldMinutes?: unknown;
      };
      if (parsed.version === 1) {
        return { ...emptySave(), scanned: normalizeScanned(parsed.scanned) };
      }
      if (parsed.version !== 2 && parsed.version !== 3 && parsed.version !== 4) {
        return emptySave();
      }
      return {
        version: 4,
        scanned: normalizeScanned(parsed.scanned),
        inventory: normalizeInventory(parsed.inventory),
        worldDiffs: normalizeWorldDiffs(parsed.worldDiffs),
        manualWaypoint:
          parsed.version === 3 || parsed.version === 4
            ? normalizeManualWaypoint(parsed.manualWaypoint)
            : null,
        worldMinutes:
          parsed.version === 4
            ? normalizeWorldMinutes(parsed.worldMinutes)
            : WORLD_START_MINUTES,
      };
    } catch {
      return emptySave();
    }
  }

  save(input: Readonly<FrontierSaveInput>) {
    if (!this.storage) return false;
    try {
      const payload: FrontierSave = {
        version: 4,
        scanned: normalizeScanned(input.scanned),
        inventory: normalizeInventory(input.inventory),
        worldDiffs: normalizeWorldDiffs(input.worldDiffs),
        manualWaypoint: normalizeManualWaypoint(input.manualWaypoint),
        worldMinutes: normalizeWorldMinutes(input.worldMinutes),
      };
      this.storage.setItem(SAVE_KEY, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }
}
