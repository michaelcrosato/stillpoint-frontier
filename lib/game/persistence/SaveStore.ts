import { BEACONS, type BeaconId } from "../config";

const SAVE_KEY = "stillpoint-frontier:survey:v1";
const VALID_BEACONS = new Set<string>(BEACONS.map((beacon) => beacon.id));

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SurveySave {
  version: 1;
  scanned: BeaconId[];
}

const EMPTY_SAVE: SurveySave = { version: 1, scanned: [] };

export class SaveStore {
  constructor(private readonly storage: StorageAdapter | null) {}

  load(): SurveySave {
    if (!this.storage) return { ...EMPTY_SAVE, scanned: [] };
    try {
      const raw = this.storage.getItem(SAVE_KEY);
      if (!raw) return { ...EMPTY_SAVE, scanned: [] };
      const parsed = JSON.parse(raw) as { version?: unknown; scanned?: unknown };
      if (parsed.version !== 1 || !Array.isArray(parsed.scanned)) {
        return { ...EMPTY_SAVE, scanned: [] };
      }
      const scanned = [...new Set(parsed.scanned)]
        .filter((id): id is BeaconId => typeof id === "string" && VALID_BEACONS.has(id))
        .sort(
          (left, right) =>
            BEACONS.findIndex((beacon) => beacon.id === left) -
            BEACONS.findIndex((beacon) => beacon.id === right),
        );
      return { version: 1, scanned };
    } catch {
      return { ...EMPTY_SAVE, scanned: [] };
    }
  }

  save(scanned: readonly BeaconId[]) {
    if (!this.storage) return false;
    try {
      const payload: SurveySave = { version: 1, scanned: [...scanned] };
      this.storage.setItem(SAVE_KEY, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }
}
