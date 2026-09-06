import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { Engine } from "../../lib/game/Engine";
import { DEFAULT_GAME_SETTINGS } from "../../lib/game/settings";
import { PreferencesStore } from "../../lib/game/persistence/PreferencesStore";

describe("display preference isolation", () => {
  it.each([false, true])("does not save survey progress from settings (started: %s)", (started) => {
    let preferences: string | null = null;
    const store = new PreferencesStore({
      getItem: () => preferences,
      setItem: (_key, value) => { preferences = value; },
    });
    const persist = vi.fn();
    const engine = Object.create(Engine.prototype) as Engine;
    Object.assign(engine, {
      started,
      sessionMode: "survey",
      settings: { ...DEFAULT_GAME_SETTINGS },
      horizonMode: DEFAULT_GAME_SETTINGS.horizonMode,
      quality: DEFAULT_GAME_SETTINGS.quality,
      runtime: {},
      player: { position: new THREE.Vector3() },
      camera: new THREE.PerspectiveCamera(),
      playerCamera: new THREE.PerspectiveCamera(),
      cameraRig: { setDistance: vi.fn(), setIsometricAngle: vi.fn() },
      graphicsBenchmark: { invalidate: vi.fn() },
      horizon: { setMode: vi.fn(), setDetailLevel: vi.fn() },
      environment: { setHorizonMode: vi.fn(), sync: vi.fn(), present: vi.fn() },
      input: { setBindings: vi.fn() },
      audio: { setLevels: vi.fn() },
      preferencesStore: store,
      persist,
      emitSnapshot: vi.fn(),
    });
    expect(engine.setHorizonMode("unlimited")).toBe(true);
    expect(store.load().horizonMode).toBe("unlimited");
    engine.resetSettings();
    expect(store.load()).toEqual(DEFAULT_GAME_SETTINGS);
    expect(persist).not.toHaveBeenCalled();
  });
});
