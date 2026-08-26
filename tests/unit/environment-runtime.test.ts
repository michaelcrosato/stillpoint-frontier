import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  createEnvironment,
  stormLightningFlash,
} from "../../lib/game/environment";

describe("environment visual runtime", () => {
  it("produces deterministic storm-only lightning pulses", () => {
    const samples = Array.from({ length: 1_240 }, (_, index) =>
      stormLightningFlash(index / 100, "storm", 1),
    );
    expect(Math.max(...samples)).toBeGreaterThan(0.9);
    expect(samples).toEqual(
      Array.from({ length: 1_240 }, (_, index) =>
        stormLightningFlash(index / 100, "storm", 1),
      ),
    );
    expect(stormLightningFlash(4, "rain", 1)).toBe(0);
    expect(stormLightningFlash(4, "storm", 1, false)).toBe(0);
    expect(stormLightningFlash(Number.NaN, "storm", 0)).toBe(0);
  });

  it("drives sky, celestial, cloud, and live shadow quality state", () => {
    const scene = new THREE.Scene();
    const renderer = {
      toneMappingExposure: 1,
      capabilities: { maxTextureSize: 8192 },
    } as unknown as THREE.WebGLRenderer;
    const environment = createEnvironment(scene, renderer, "cinematic");
    const sky = scene.getObjectByName("atmosphere-sky") as THREE.Mesh;
    const precipitation = scene.getObjectByName("biome-precipitation") as THREE.Points;
    expect(sky).toBeInstanceOf(THREE.Mesh);
    expect((sky.material as THREE.ShaderMaterial).fragmentShader).toContain("cloudFbm");
    expect((sky.material as THREE.ShaderMaterial).fragmentShader).toContain("sunDisc");
    expect((sky.material as THREE.ShaderMaterial).fragmentShader).toContain("lightningFlash");
    expect(environment.sun.shadow.mapSize.width).toBe(2048);
    expect(environment.sun.castShadow).toBe(true);

    const allocatedShadow = new THREE.WebGLRenderTarget(2048, 2048);
    const disposeAllocatedShadow = vi.spyOn(allocatedShadow, "dispose");
    environment.sun.shadow.map = allocatedShadow;
    environment.setQuality("ultra");
    expect(environment.sun.shadow.mapSize.width).toBe(4096);
    expect(environment.sun.shadow.map).toBeNull();
    expect(disposeAllocatedShadow).toHaveBeenCalledTimes(1);
    expect(environment.sun.shadow.bias).toBeCloseTo(-0.00008);
    expect(environment.sun.shadow.normalBias).toBeCloseTo(0.015);
    expect(precipitation.geometry.drawRange.count).toBe(720);
    environment.setQuality("performance");
    expect(environment.sun.castShadow).toBe(false);
    expect(precipitation.geometry.drawRange.count).toBe(280);

    const position = new THREE.Vector3(10, 4, -8);
    const before = environment.getVisualState().effectSeconds;
    const cloudBefore = environment.getVisualState().cloudOffset.clone();
    environment.tick(position, 2, true);
    environment.present(position, 1 / 60);
    expect(environment.getVisualState().effectSeconds).toBe(before + 2);
    const cloudAfterTick = environment.getVisualState().cloudOffset.clone();
    expect(cloudAfterTick.distanceTo(cloudBefore)).toBeGreaterThan(0);
    expect(environment.getVisualState().sunDirection.length()).toBeCloseTo(1);
    environment.tick(position, 4, false);
    environment.present(position, 1 / 60);
    expect(environment.getVisualState().effectSeconds).toBe(before + 2);
    expect(environment.getVisualState().cloudOffset.equals(cloudAfterTick)).toBe(true);
    expect(renderer.toneMappingExposure).toBeGreaterThan(0);

    environment.setDeveloperMode(true);
    expect(environment.setDeveloperWeather("rain")).toBe(true);
    environment.sync(position, true);
    environment.tick(position, 30, true);
    environment.present(position, 0);
    const wet = environment.getVisualState().surfaceWetness;
    expect(wet).toBeGreaterThan(0);
    expect(wet).toBeLessThanOrEqual(1);
    environment.tick(position, 30, false);
    environment.present(position, 0);
    expect(environment.getVisualState().surfaceWetness).toBe(wet);
    expect(environment.setDeveloperWeather("fair")).toBe(true);
    environment.sync(position, true);
    environment.tick(position, 120, true);
    environment.present(position, 0);
    expect(environment.getVisualState().surfaceWetness).toBeLessThan(wet);

    environment.dispose();
    expect(scene.getObjectByName("atmosphere-sky")).toBeUndefined();
  });
});
