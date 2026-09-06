import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { EnvironmentVisualState } from "../../lib/game/environment";
import { EnvironmentMapRuntime } from "../../lib/game/rendering/EnvironmentMapRuntime";

const atmosphere = {
  skyColor: new THREE.Color(0x587682),
  horizonColor: new THREE.Color(0xc5aa80),
  sunColor: new THREE.Color(0xffe0b2),
  sunDirection: new THREE.Vector3(0, 1, 0),
  cloudCover: 0,
  daylight: 1,
  goldenHour: 0,
  dust: 0,
} as EnvironmentVisualState;

function createRenderer() {
  const previousTarget = new THREE.WebGLRenderTarget(8, 8);
  let target: THREE.WebGLRenderTarget | null = previousTarget;
  let cubeFace = 2;
  let mipLevel = 1;
  const renderer = {
    autoClear: true,
    toneMapping: THREE.ACESFilmicToneMapping,
    xr: { enabled: true },
    state: { buffers: { depth: { getReversed: () => false } } },
    getRenderTarget: () => target,
    getActiveCubeFace: () => cubeFace,
    getActiveMipmapLevel: () => mipLevel,
    getClearColor: (color: THREE.Color) => color.setHex(0x123456),
    setRenderTarget: (next: THREE.WebGLRenderTarget | null, face = 0, mip = 0) => {
      target = next;
      cubeFace = face;
      mipLevel = mip;
    },
    render: vi.fn(),
  };
  const expectRestored = () => {
    expect(target).toBe(previousTarget);
    expect(cubeFace).toBe(2);
    expect(mipLevel).toBe(1);
    expect(renderer.autoClear).toBe(true);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.xr.enabled).toBe(true);
  };
  return { renderer, expectRestored, previousTarget };
}

describe("environment reflection failure isolation", () => {
  it.each([1, 13])("restores renderer state when PMREM draw %i throws", (failingDraw) => {
    const { renderer, expectRestored, previousTarget } = createRenderer();
    let draws = 0;
    renderer.render.mockImplementation(() => {
      if (++draws === failingDraw) throw new Error("PMREM draw failed");
    });
    const scene = new THREE.Scene();
    const runtime = new EnvironmentMapRuntime(renderer as unknown as THREE.WebGLRenderer, scene, "cinematic");
    try {
      expect(() => runtime.present(atmosphere)).not.toThrow();
      expect(renderer.render).toHaveBeenCalledTimes(failingDraw);
      expectRestored();
      expect(scene.environment).toBeNull();
      runtime.present(atmosphere);
      expect(renderer.render).toHaveBeenCalledTimes(failingDraw);
    } finally {
      runtime.dispose();
      previousTarget.dispose();
    }
  });

  it("retains the last successful reflection when its replacement fails", () => {
    const { renderer, expectRestored, previousTarget } = createRenderer();
    const scene = new THREE.Scene();
    const runtime = new EnvironmentMapRuntime(renderer as unknown as THREE.WebGLRenderer, scene, "cinematic");
    try {
      runtime.present(atmosphere);
      const reflection = scene.environment;
      expect(reflection).not.toBeNull();
      expect(runtime.diagnostics.revision).toBe(1);
      expectRestored();

      renderer.render.mockImplementation(() => { throw new Error("Replacement failed"); });
      expect(() => runtime.present({ ...atmosphere, cloudCover: 1 })).not.toThrow();
      expect(scene.environment).toBe(reflection);
      expect(runtime.diagnostics.active).toBe(true);
      expect(runtime.diagnostics.revision).toBe(1);
      expectRestored();
    } finally {
      runtime.dispose();
      previousTarget.dispose();
    }
    expect(scene.environment).toBeNull();
  });
});
