import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Engine } from "../../lib/game/Engine";
import { SaveStore, createEmptyFrontierSave } from "../../lib/game/persistence/SaveStore";
import { NavigationService } from "../../lib/game/navigation/NavigationService";

describe("survey availability after write failures", () => {
  it("keeps the older survey loadable after storage quota rejects a newer write", () => {
    let stored: string | null = null;
    let blocked = false;
    const store = new SaveStore({
      getItem: () => stored,
      setItem: (_key, value) => { if (blocked) throw new Error("Quota exceeded"); stored = value; },
    });
    const save = createEmptyFrontierSave();
    expect(store.save({ ...save, inventory: { ...save.inventory, stone: 12 } })).toBe(true);
    const previous = stored;
    const engine = Object.create(Engine.prototype) as { persist(): boolean; hasSurveySave: boolean; saveStatus: string; sessionMode: string };
    Object.assign(engine, {
      ...save, sessionMode: "survey", saveStore: store,
      navigation: new NavigationService(), benchmarkTravelOrigin: null,
      developerPlayer: { fly: false },
      environment: { getPersistentWorldMinutes: () => 720 },
      player: { position: new THREE.Vector3(0, 2, 8), yaw: 0, pitch: 0,
        condition: { health: 100, wetness: 0, coldStress: 0 } },
      hasSurveySave: true,
    });
    blocked = true;
    expect(engine.persist()).toBe(false);
    expect(engine.saveStatus).toBe("unavailable");
    expect(engine.hasSurveySave).toBe(true);
    expect(stored).toBe(previous);
    expect(store.load().inventory.stone).toBe(12);
    engine.sessionMode = "developer";
    expect(engine.persist()).toBe(false);
    expect(stored).toBe(previous);
  });
});
