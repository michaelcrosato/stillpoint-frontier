import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { QUALITY_PRESETS } from "../../lib/game/config";
import { createEnvironment } from "../../lib/game/environment";
import { PlayerFlashlight } from "../../lib/game/equipment/PlayerFlashlight";
import {
  shadowDepthBias,
  sunShadowBiases,
} from "../../lib/game/rendering/ShadowBias";

function fakeRenderer(reversedDepthBuffer: boolean, maxTextureSize = 8192) {
  return {
    toneMappingExposure: 1,
    capabilities: { maxTextureSize, reversedDepthBuffer },
  } as unknown as THREE.WebGLRenderer;
}

describe("shadow bias", () => {
  it("pushes the fragment toward the light for either depth convention", () => {
    expect(shadowDepthBias(0.00015, false)).toBe(-0.00015);
    expect(shadowDepthBias(0.00015, true)).toBe(0.00015);
  });

  it("keeps normalBias at or above half a shadow texel", () => {
    for (const quality of ["ultra", "cinematic"] as const) {
      const texel = 176 / QUALITY_PRESETS[quality].sunShadowMapSize;
      expect(sunShadowBiases(quality, true).normalBias).toBeGreaterThanOrEqual(texel / 2);
    }
  });

  it("sizes normalBias from the shadow map the GPU could actually allocate", () => {
    const texel = 176 / 2048;
    expect(sunShadowBiases("ultra", true, 2048).normalBias).toBeGreaterThanOrEqual(texel / 2);
  });

  it("biases the sun toward the light under the renderer's depth convention", () => {
    for (const reversed of [false, true]) {
      const environment = createEnvironment(new THREE.Scene(), fakeRenderer(reversed), "cinematic");
      expect(Math.sign(environment.sun.shadow.bias)).toBe(reversed ? 1 : -1);
      environment.setQuality("ultra");
      expect(Math.sign(environment.sun.shadow.bias)).toBe(reversed ? 1 : -1);
      environment.dispose();
    }
  });

  it("uses the clamped shadow map size for the sun's normalBias", () => {
    const environment = createEnvironment(new THREE.Scene(), fakeRenderer(true, 2048), "ultra");
    expect(environment.sun.shadow.mapSize.width).toBe(2048);
    expect(environment.sun.shadow.normalBias).toBeGreaterThanOrEqual(176 / 2048 / 2);
    environment.dispose();
  });

  it("biases the flashlight toward the light under the renderer's depth convention", () => {
    for (const reversed of [false, true]) {
      const scene = new THREE.Scene();
      const flashlight = new PlayerFlashlight(scene, "cinematic", reversed);
      const core = scene.getObjectByName("player-phone-light:core") as THREE.SpotLight;
      expect(Math.sign(core.shadow.bias)).toBe(reversed ? 1 : -1);
      flashlight.setQuality("ultra");
      expect(Math.sign(core.shadow.bias)).toBe(reversed ? 1 : -1);
      flashlight.dispose();
    }
  });
});
