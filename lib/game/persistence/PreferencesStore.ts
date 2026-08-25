import type { StorageAdapter } from "./SaveStore";
import {
  DEFAULT_GAME_SETTINGS,
  normalizeGameSettings,
  type GameSettings,
} from "../settings";
import type { HorizonMode } from "../config";

const PREFERENCES_KEY = "stillpoint-frontier:preferences:v1";

export interface StoredPreferences {
  version: 1;
  settings: GameSettings;
}

export class PreferencesStore {
  constructor(private readonly storage: StorageAdapter | null) {}

  load(horizonFallback: HorizonMode = DEFAULT_GAME_SETTINGS.horizonMode): GameSettings {
    if (!this.storage) return normalizeGameSettings(null, horizonFallback);
    try {
      const raw = this.storage.getItem(PREFERENCES_KEY);
      if (!raw) return normalizeGameSettings(null, horizonFallback);
      const parsed = JSON.parse(raw) as { version?: unknown; settings?: unknown };
      if (parsed.version !== 1) return normalizeGameSettings(null, horizonFallback);
      return normalizeGameSettings(parsed.settings, horizonFallback);
    } catch {
      return normalizeGameSettings(null, horizonFallback);
    }
  }

  save(settings: Readonly<GameSettings>) {
    if (!this.storage) return false;
    try {
      const payload: StoredPreferences = {
        version: 1,
        settings: normalizeGameSettings(settings, settings.horizonMode),
      };
      this.storage.setItem(PREFERENCES_KEY, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }
}
