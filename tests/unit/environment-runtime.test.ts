import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createEnvironment } from "../../lib/game/environment";

describe("environment visual runtime", () => {
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
    environment.tick(position, 2, true);
    environment.present(position, 1 / 60);
    expect(environment.getVisualState().effectSeconds).toBe(before + 2);
    expect(environment.getVisualState().sunDirection.length()).toBeCloseTo(1);
    environment.tick(position, 4, false);
    environment.present(position, 1 / 60);
    expect(environment.getVisualState().effectSeconds).toBe(before + 2);
    expect(renderer.toneMappingExposure).toBeGreaterThan(0);

    environment.dispose();
    expect(scene.getObjectByName("atmosphere-sky")).toBeUndefined();
  });
});
