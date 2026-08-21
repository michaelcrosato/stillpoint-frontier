import { BEACONS, type BeaconId } from "../config";
import {
  EMPTY_INVENTORY,
  ITEM_DEFINITIONS,
  type InventoryState,
  type ItemId,
} from "../gameplay/items";
import type { EntityDiff } from "../gameplay/interactions";

// Keep the legacy key so version-one saves migrate in place.
const SAVE_KEY = "stillpoint-frontier:survey:v1";
const VALID_BEACONS = new Set<string>(BEACONS.map((beacon) => beacon.id));
const VALID_ITEMS = new Set<string>(Object.keys(ITEM_DEFINITIONS));
const ENTITY_ID = /^[a-z0-9][a-z0-9:._-]{0,119}$/i;
const MAX_WORLD_DIFFS = 10_000;

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface FrontierSave {
  version: 2;
  scanned: BeaconId[];
  inventory: InventoryState;
  worldDiffs: Record<string, EntityDiff>;
}

export interface FrontierSaveInput {
  scanned: readonly BeaconId[];
  inventory: Readonly<InventoryState>;
  worldDiffs: Readonly<Record<string, EntityDiff>>;
}

function emptySave(): FrontierSave {
  return {
    version: 2,
    scanned: [],
    inventory: { ...EMPTY_INVENTORY },
    worldDiffs: {},
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
      };
      if (parsed.version === 1) {
        return { ...emptySave(), scanned: normalizeScanned(parsed.scanned) };
      }
      if (parsed.version !== 2) return emptySave();
      return {
        version: 2,
        scanned: normalizeScanned(parsed.scanned),
        inventory: normalizeInventory(parsed.inventory),
        worldDiffs: normalizeWorldDiffs(parsed.worldDiffs),
      };
    } catch {
      return emptySave();
    }
  }

  save(input: Readonly<FrontierSaveInput>) {
    if (!this.storage) return false;
    try {
      const payload: FrontierSave = {
        version: 2,
        scanned: normalizeScanned(input.scanned),
        inventory: normalizeInventory(input.inventory),
        worldDiffs: normalizeWorldDiffs(input.worldDiffs),
      };
      this.storage.setItem(SAVE_KEY, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }
}
