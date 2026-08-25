import { describe, expect, it } from "vitest";
import { EMPTY_INVENTORY } from "../../lib/game/gameplay/items";
import { WORLD_START_MINUTES } from "../../lib/game/environment/model";
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
  doorStates: {
    "spawn-field-unit-01:front": true,
    "spawn-survey-house-02:front": false,
    "spawn-meridian-tower-03:front": true,
  },
  manualWaypoint: { x: 12_400, z: -8_200 },
  worldMinutes: 2_345.5,
  horizonMode: "unlimited" as const,
  player: {
    x: 12.5,
    y: 3.25,
    z: -8,
    yaw: 0.75,
    pitch: -0.12,
    health: 82,
    wetness: 0.35,
    coldStress: 0.18,
  },
  discoveredLocations: [
    "settlement:dustmere",
    "landmark:field-unit-compound",
  ],
};

describe("versioned frontier saves", () => {
  it("round-trips discoveries, inventory, and sparse world changes", () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage);
    expect(store.save(saveInput)).toBe(true);
    expect(store.load()).toEqual({
      version: 7,
      scanned: ["amber-relay", "meridian-vault"],
      inventory: { ...EMPTY_INVENTORY, stone: 7, wood: 3 },
      worldDiffs: saveInput.worldDiffs,
      doorStates: saveInput.doorStates,
      manualWaypoint: saveInput.manualWaypoint,
      worldMinutes: saveInput.worldMinutes,
      horizonMode: "unlimited",
      player: saveInput.player,
      discoveredLocations: [
        "landmark:field-unit-compound",
        "settlement:dustmere",
      ],
    });
  });

  it("migrates version-one survey discoveries without losing them", () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({
      version: 1,
      scanned: ["hollow-array", "invented", "hollow-array", 7],
    });
    expect(new SaveStore(storage).load()).toEqual({
      version: 7,
      scanned: ["hollow-array"],
      inventory: EMPTY_INVENTORY,
      worldDiffs: {},
      doorStates: {},
      manualWaypoint: null,
      worldMinutes: WORLD_START_MINUTES,
      horizonMode: "standard",
      player: null,
      discoveredLocations: [],
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
    expect(result.doorStates).toEqual({});
    expect(result.manualWaypoint).toBeNull();
    expect(result.worldMinutes).toBe(WORLD_START_MINUTES);
    expect(result.horizonMode).toBe("standard");
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
    expect(new SaveStore(storage).load().worldMinutes).toBe(WORLD_START_MINUTES);
    expect(new SaveStore(storage).load().horizonMode).toBe("standard");

    storage.value = JSON.stringify({
      version: 3,
      manualWaypoint: { x: 9_000_000, z: Number.NaN },
    });
    expect(new SaveStore(storage).load().manualWaypoint).toBeNull();
  });

  it("validates the version-four world clock independently", () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({
      version: 4,
      scanned: [],
      inventory: {},
      worldDiffs: {},
      manualWaypoint: null,
      worldMinutes: 8_765.25,
    });
    expect(new SaveStore(storage).load().worldMinutes).toBe(8_765.25);

    storage.value = JSON.stringify({ version: 4, worldMinutes: -1 });
    expect(new SaveStore(storage).load().worldMinutes).toBe(WORLD_START_MINUTES);

    expect(new SaveStore(storage).save({ ...saveInput, worldMinutes: 99_000_000 })).toBe(true);
    expect(new SaveStore(storage).load().worldMinutes).toBe(10_000_000);
  });

  it("migrates and validates sparse version-five door state", () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({
      version: 5,
      scanned: [],
      inventory: {},
      worldDiffs: {},
      doorStates: {
        "spawn-field-unit-01:front": true,
        "spawn-survey-house-02:front": false,
        "bad id": true,
        "wrong:value": "open",
      },
      manualWaypoint: null,
      worldMinutes: WORLD_START_MINUTES,
    });
    expect(new SaveStore(storage).load().doorStates).toEqual({
      "spawn-field-unit-01:front": true,
      "spawn-survey-house-02:front": false,
    });

    storage.value = JSON.stringify({ version: 4, doorStates: { old: true } });
    expect(new SaveStore(storage).load().doorStates).toEqual({});
  });

  it("persists valid horizon modes and sanitizes corrupt version-six preferences", () => {
    const storage = new MemoryStorage();
    for (const horizonMode of ["standard", "extended", "unlimited"] as const) {
      expect(new SaveStore(storage).save({ ...saveInput, horizonMode })).toBe(true);
      expect(new SaveStore(storage).load().horizonMode).toBe(horizonMode);
    }

    storage.value = JSON.stringify({ version: 6, horizonMode: "infinite" });
    expect(new SaveStore(storage).load().horizonMode).toBe("standard");
  });

  it.each(["not json", JSON.stringify({ version: 99, scanned: ["amber-relay"] })])(
    "recovers safely from invalid data: %s",
    (value) => {
      const storage = new MemoryStorage();
      storage.value = value;
      expect(new SaveStore(storage).load()).toEqual({
        version: 7,
        scanned: [],
        inventory: EMPTY_INVENTORY,
        worldDiffs: {},
        doorStates: {},
        manualWaypoint: null,
        worldMinutes: WORLD_START_MINUTES,
        horizonMode: "standard",
        player: null,
        discoveredLocations: [],
      });
    },
  );

  it("runs without browser storage in deterministic tests", () => {
    const store = new SaveStore(null);
    expect(store.load().version).toBe(7);
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
