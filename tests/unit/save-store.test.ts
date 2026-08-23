import { describe, expect, it } from "vitest";
import { EMPTY_INVENTORY } from "../../lib/game/gameplay/items";
import { SaveStore, type StorageAdapter } from "../../lib/game/persistence/SaveStore";

class MemoryStorage implements StorageAdapter {
  value: string | null = null;
  getItem() {
    return this.value;
  }
  setItem(_key: string, value: string) {
    this.value = value;
  }
}

const saveInput = {
  scanned: ["meridian-vault", "amber-relay"] as const,
  inventory: { ...EMPTY_INVENTORY, stone: 7, wood: 3 },
  worldDiffs: {
    "resource:rock:v1:0:0:0": { hits: 3, removed: true },
    "resource:tree:v1:0:0:0": { hits: 1, removed: false },
  },
  manualWaypoint: { x: 12_400, z: -8_200 },
};

describe("versioned frontier saves", () => {
  it("round-trips discoveries, inventory, and sparse world changes", () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage);
    expect(store.save(saveInput)).toBe(true);
    expect(store.load()).toEqual({
      version: 3,
      scanned: ["amber-relay", "meridian-vault"],
      inventory: { ...EMPTY_INVENTORY, stone: 7, wood: 3 },
      worldDiffs: saveInput.worldDiffs,
      manualWaypoint: saveInput.manualWaypoint,
    });
  });

  it("migrates version-one survey discoveries without losing them", () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({
      version: 1,
      scanned: ["hollow-array", "invented", "hollow-array", 7],
    });
    expect(new SaveStore(storage).load()).toEqual({
      version: 3,
      scanned: ["hollow-array"],
      inventory: EMPTY_INVENTORY,
      worldDiffs: {},
      manualWaypoint: null,
    });
  });

  it("rejects invalid inventory and world-diff fields independently", () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({
      version: 2,
      scanned: ["amber-relay"],
      inventory: { stone: 4, wood: -1, invented: 99, ore: 2.5 },
      worldDiffs: {
        "valid:entity": { hits: 2, removed: false },
        "invalid id with spaces": { hits: 1, removed: true },
        "invalid:hits": { hits: -2, removed: false },
      },
    });
    const result = new SaveStore(storage).load();
    expect(result.inventory).toEqual({ ...EMPTY_INVENTORY, stone: 4 });
    expect(result.worldDiffs).toEqual({ "valid:entity": { hits: 2, removed: false } });
    expect(result.manualWaypoint).toBeNull();
  });

  it("migrates version-two world state and validates version-three waypoints", () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({
      version: 3,
      scanned: [],
      inventory: {},
      worldDiffs: {},
      manualWaypoint: { x: 2_500, z: -7_500 },
    });
    expect(new SaveStore(storage).load().manualWaypoint).toEqual({ x: 2_500, z: -7_500 });

    storage.value = JSON.stringify({
      version: 3,
      manualWaypoint: { x: 9_000_000, z: Number.NaN },
    });
    expect(new SaveStore(storage).load().manualWaypoint).toBeNull();
  });

  it.each(["not json", JSON.stringify({ version: 99, scanned: ["amber-relay"] })])(
    "recovers safely from invalid data: %s",
    (value) => {
      const storage = new MemoryStorage();
      storage.value = value;
      expect(new SaveStore(storage).load()).toEqual({
        version: 3,
        scanned: [],
        inventory: EMPTY_INVENTORY,
        worldDiffs: {},
        manualWaypoint: null,
      });
    },
  );

  it("runs without browser storage in deterministic tests", () => {
    const store = new SaveStore(null);
    expect(store.load().version).toBe(3);
    expect(store.save(saveInput)).toBe(false);
  });

  it("contains storage permission failures", () => {
    const storage: StorageAdapter = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const store = new SaveStore(storage);
    expect(store.load().worldDiffs).toEqual({});
    expect(store.save(saveInput)).toBe(false);
  });
});
