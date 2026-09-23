import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createEnvironment } from "../../lib/game/environment";
import { PlayerFlashlight } from "../../lib/game/equipment/PlayerFlashlight";

function stubRenderer() {
  return {
    toneMappingExposure: 1,
    capabilities: { maxTextureSize: 8192, reversedDepthBuffer: true },
  } as unknown as THREE.WebGLRenderer;
}

function allocatedMap(size: number) {
  const map = new THREE.WebGLRenderTarget(size, size);
  return { map, dispose: vi.spyOn(map, "dispose") };
}

describe("shadow map lifecycle across quality changes", () => {
  it("releases the sun's map when a preset disables shadows", () => {
    const environment = createEnvironment(new THREE.Scene(), stubRenderer(), "cinematic");
    const { map, dispose } = allocatedMap(2048);
    environment.sun.shadow.map = map;
    environment.setQuality("performance");
    expect(environment.sun.castShadow).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(environment.sun.shadow.map).toBeNull();
    environment.dispose();
  });

  it("re-allocates and renders the sun's map on the way back up", () => {
    const environment = createEnvironment(new THREE.Scene(), stubRenderer(), "ultra");
    environment.sun.shadow.map = allocatedMap(4096).map;
    environment.setQuality("performance");
    environment.sun.shadow.needsUpdate = false;
    environment.setQuality("ultra");
    expect(environment.sun.castShadow).toBe(true);
    expect(environment.sun.shadow.mapSize.width).toBe(4096);
    expect(environment.sun.shadow.needsUpdate).toBe(true);
    environment.dispose();
  });

  it("renders the sun's map again when re-enabled at an unchanged size", () => {
    // Performance and Cinematic share a 2048 map, so no size change can
    // trigger the update; with shadow.autoUpdate off, three skips a light
    // whose map is null unless needsUpdate is set.
    const environment = createEnvironment(new THREE.Scene(), stubRenderer(), "cinematic");
    environment.sun.shadow.map = allocatedMap(2048).map;
    environment.setQuality("performance");
    environment.sun.shadow.needsUpdate = false;
    environment.setQuality("cinematic");
    expect(environment.sun.castShadow).toBe(true);
    expect(environment.sun.shadow.map).toBeNull();
    expect(environment.sun.shadow.needsUpdate).toBe(true);
    environment.dispose();
  });

  it("releases the flashlight's map when a preset disables shadows", () => {
    const scene = new THREE.Scene();
    const flashlight = new PlayerFlashlight(scene, "cinematic", true);
    const core = scene.getObjectByName("player-phone-light:core") as THREE.SpotLight;
    const { map, dispose } = allocatedMap(1024);
    core.shadow.map = map;
    flashlight.setQuality("performance");
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(core.shadow.map).toBeNull();
    core.shadow.needsUpdate = false;
    flashlight.setQuality("cinematic");
    expect(core.shadow.needsUpdate).toBe(true);
    flashlight.dispose();
  });

  it("keeps the flashlight's map while the beam is only switched off", () => {
    const scene = new THREE.Scene();
    const flashlight = new PlayerFlashlight(scene, "cinematic", true);
    const core = scene.getObjectByName("player-phone-light:core") as THREE.SpotLight;
    const { map, dispose } = allocatedMap(1024);
    core.shadow.map = map;
    flashlight.setEnabled(true);
    flashlight.setEnabled(false);
    expect(dispose).not.toHaveBeenCalled();
    expect(core.shadow.map).toBe(map);
    flashlight.dispose();
  });
});
