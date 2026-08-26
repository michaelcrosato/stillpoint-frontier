import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { EnvironmentVisualState } from "../../lib/game/environment";
import { WaterSurfaceRuntime } from "../../lib/game/world/WaterSurface";

function visualState(overrides: Partial<EnvironmentVisualState> = {}): EnvironmentVisualState {
  return {
    effectSeconds: 14.5,
    cloudOffset: new THREE.Vector2(2, -3),
    cloudCover: 0.35,
    precipitationRate: 0.2,
    daylight: 0.8,
    goldenHour: 0.15,
    night: 0.2,
    dust: 0.1,
    surfaceWetness: 0.3,
    lightningFlash: 0,
    windKph: 28,
    windDirection: 90,
    sunDirection: new THREE.Vector3(0.4, 0.8, 0.2).normalize(),
    moonDirection: new THREE.Vector3(-0.4, -0.8, -0.2).normalize(),
    sunColor: new THREE.Color(0xffd5a0),
    skyColor: new THREE.Color(0x587682),
    horizonColor: new THREE.Color(0xc5aa80),
    ...overrides,
  };
}

describe("shared seamless water surface", () => {
  it("provides every uniform required by Three's fog refresh path", () => {
    const runtime = new WaterSurfaceRuntime("ultra");
    expect(runtime.material.fog).toBe(true);
    expect(runtime.uniforms.fogColor?.value).toBeInstanceOf(THREE.Color);
    expect(runtime.uniforms.fogDensity?.value).toBeTypeOf("number");
    expect(runtime.uniforms.fogNear?.value).toBeTypeOf("number");
    expect(runtime.uniforms.fogFar?.value).toBeTypeOf("number");
    runtime.dispose();
  });

  it("uses absolute world coordinates and follows atmosphere state", () => {
    const runtime = new WaterSurfaceRuntime("cinematic");
    expect(runtime.material.name).toBe("shared-world-water");
    expect(runtime.material.vertexShader).toContain("modelMatrix * vec4(position");
    expect(runtime.material.fragmentShader).toContain("vWorldPosition.xz");
    expect(runtime.material.fragmentShader).toContain("fresnel");
    expect(runtime.material.fragmentShader).toContain("windMagnitude");
    expect(runtime.material.fragmentShader).toContain("reflect(-normalize(uSunDirection)");
    runtime.present(visualState());
    expect(runtime.uniforms.uTime.value).toBe(14.5);
    expect(runtime.uniforms.uWind.value.x).toBeCloseTo(0, 5);
    expect(runtime.uniforms.uWind.value.y).toBeGreaterThan(0);
    expect(runtime.uniforms.uCloudCover.value).toBe(0.35);
    expect(runtime.uniforms.uSunDirection.value.length()).toBeCloseTo(1);
    runtime.setQuality("performance");
    expect(runtime.uniforms.uDetail.value).toBe(0);
    runtime.setQuality("ultra");
    expect(runtime.uniforms.uDetail.value).toBe(1);
  });

  it("binds river and sea classification per draw while sharing one material", () => {
    const runtime = new WaterSurfaceRuntime("performance");
    const river = new THREE.Mesh(new THREE.PlaneGeometry(), runtime.material);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(), runtime.material);
    runtime.bind(river, "river");
    runtime.bind(sea, "sea");
    expect(river.material).toBe(sea.material);
    river.onBeforeRender({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    expect(runtime.uniforms.uWaterKind.value).toBe(0);
    sea.onBeforeRender({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    expect(runtime.uniforms.uWaterKind.value).toBe(1);
    expect(runtime.material.uniformsNeedUpdate).toBe(true);
    river.geometry.dispose();
    sea.geometry.dispose();
    runtime.dispose();
  });

  it("sanitizes hostile values and disposes exactly once", () => {
    const runtime = new WaterSurfaceRuntime("ultra");
    const dispose = vi.spyOn(runtime.material, "dispose");
    runtime.present(visualState({
      effectSeconds: Number.NaN,
      cloudCover: Number.POSITIVE_INFINITY,
      precipitationRate: -8,
      daylight: 5,
      dust: Number.NaN,
      windKph: Number.NaN,
      windDirection: Number.NaN,
      sunDirection: new THREE.Vector3(),
    }));
    expect(runtime.uniforms.uTime.value).toBe(0);
    expect(runtime.uniforms.uCloudCover.value).toBe(0);
    expect(runtime.uniforms.uPrecipitation.value).toBe(0);
    expect(runtime.uniforms.uDaylight.value).toBe(1);
    expect(runtime.uniforms.uSunDirection.value.toArray()).toEqual([0, 1, 0]);
    runtime.dispose();
    runtime.dispose();
    runtime.present(visualState());
    runtime.setQuality("cinematic");
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
