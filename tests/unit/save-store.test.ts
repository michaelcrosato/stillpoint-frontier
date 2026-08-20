import { describe, expect, it } from "vitest";
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

describe("versioned survey saves", () => {
  it("round-trips discoveries in directive order", () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage);
    expect(store.save(["meridian-vault", "amber-relay"])).toBe(true);
    expect(store.load()).toEqual({ version: 1, scanned: ["amber-relay", "meridian-vault"] });
  });

  it("deduplicates and rejects unknown identifiers", () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({
      version: 1,
      scanned: ["hollow-array", "invented", "hollow-array", 7],
    });
    expect(new SaveStore(storage).load().scanned).toEqual(["hollow-array"]);
  });

  it.each(["not json", JSON.stringify({ version: 99, scanned: ["amber-relay"] })])(
    "recovers safely from invalid data: %s",
    (value) => {
      const storage = new MemoryStorage();
      storage.value = value;
      expect(new SaveStore(storage).load()).toEqual({ version: 1, scanned: [] });
    },
  );

  it("runs without browser storage in deterministic tests", () => {
    const store = new SaveStore(null);
    expect(store.load()).toEqual({ version: 1, scanned: [] });
    expect(store.save(["amber-relay"])).toBe(false);
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
    expect(store.load()).toEqual({ version: 1, scanned: [] });
    expect(store.save(["amber-relay"])).toBe(false);
  });
});
