import { describe, expect, it } from "vitest";
import { PreferencesStore } from "../../lib/game/persistence/PreferencesStore";
import type { StorageAdapter } from "../../lib/game/persistence/SaveStore";
import { DEFAULT_GAME_SETTINGS } from "../../lib/game/settings";

class MemoryStorage implements StorageAdapter {
  value: string | null = null;
  getItem() { return this.value; }
  setItem(_key: string, value: string) { this.value = value; }
}

describe("local preferences", () => {
  it("uses the migrated world horizon when no preference exists", () => {
    const settings = new PreferencesStore(new MemoryStorage()).load("unlimited");
    expect(settings.horizonMode).toBe("unlimited");
  });

  it("round-trips normalized view, audio, quality, and bindings", () => {
    const storage = new MemoryStorage();
    const store = new PreferencesStore(storage);
    const settings = {
      ...DEFAULT_GAME_SETTINGS,
      fov: 82,
      masterVolume: 0.44,
      quality: "ultra" as const,
      keyBindings: { ...DEFAULT_GAME_SETTINGS.keyBindings, flashlight: "KeyP" },
    };
    expect(store.save(settings)).toBe(true);
    expect(store.load()).toEqual(settings);
  });

  it("recovers from invalid versions and storage failures", () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({ version: 99, settings: { fov: 10 } });
    expect(new PreferencesStore(storage).load().fov).toBe(DEFAULT_GAME_SETTINGS.fov);

    const blocked: StorageAdapter = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(new PreferencesStore(blocked).load().quality).toBe("cinematic");
    expect(new PreferencesStore(blocked).save(DEFAULT_GAME_SETTINGS)).toBe(false);
    expect(new PreferencesStore(null).save(DEFAULT_GAME_SETTINGS)).toBe(false);
  });
});
