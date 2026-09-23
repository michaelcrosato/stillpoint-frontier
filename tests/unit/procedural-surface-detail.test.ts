import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  SURFACE_DETAIL_PERIOD_METERS,
  installProceduralSurfaceDetail,
  surfaceDetailProfile,
  wrapSurfaceDetailCoordinate,
} from "../../lib/game/rendering/ProceduralSurfaceDetail";
import {
  createSharedWorldUniforms,
  renewSharedWorldBinding,
} from "../../lib/game/rendering/SharedWorldUniforms";

function compileMaterial(material: THREE.Material) {
  const shader: {
    uniforms: Record<string, { value: unknown }>;
    vertexShader: string;
    fragmentShader: string;
  } = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <project_vertex>",
    fragmentShader: [
      "#include <common>",
      "void main() {",
      "#include <color_fragment>",
      "#include <roughnessmap_fragment>",
      "#include <normal_fragment_maps>",
      "}",
    ].join("\n"),
  };
  material.onBeforeCompile(
    shader as Parameters<THREE.Material["onBeforeCompile"]>[0],
    {} as THREE.WebGLRenderer,
  );
  return shader;
}

describe("procedural surface detail", () => {
  it("wraps huge and negative coordinates into one stable world period", () => {
    for (const value of [-48_000.25, -256, -0.25, 0, 255.75, 48_000.25]) {
      const wrapped = wrapSurfaceDetailCoordinate(value);
      expect(wrapped).toBeGreaterThanOrEqual(0);
      expect(wrapped).toBeLessThan(SURFACE_DETAIL_PERIOD_METERS);
      expect(wrapSurfaceDetailCoordinate(value + SURFACE_DETAIL_PERIOD_METERS))
        .toBeCloseTo(wrapped);
    }
    expect(wrapSurfaceDetailCoordinate(Number.NaN)).toBe(0);
  });

  it("provides bounded role profiles and explicit opt-out", () => {
    const terrain = surfaceDetailProfile("terrain", {
      colorStrength: 99,
      frequency: 193,
      fadeStart: 80,
      fadeEnd: 20,
    });
    expect(terrain).toMatchObject({ colorStrength: 0.2, fadeStart: 80 });
    expect((terrain?.frequency ?? 1) % 4).toBe(0);
    expect(terrain?.fadeEnd).toBeGreaterThan(terrain?.fadeStart ?? 0);
    expect(surfaceDetailProfile("glass")).toBeNull();
    expect(surfaceDetailProfile("terrain", false)).toBeNull();
  });

  it("chains and restores a fragment-only material shader hook", () => {
    const material = new THREE.MeshStandardMaterial();
    const previousCompile = vi.fn<THREE.Material["onBeforeCompile"]>();
    const previousCacheKey = () => "base";
    material.onBeforeCompile = previousCompile;
    material.customProgramCacheKey = previousCacheKey;
    const installed = installProceduralSurfaceDetail(
      material,
      surfaceDetailProfile("terrain")!,
    );
    const cacheKey = material.customProgramCacheKey();
    const shader = compileMaterial(material);
    expect(previousCompile).toHaveBeenCalledOnce();
    expect(shader.vertexShader).toBe(
      "#include <common>\n#include <project_vertex>",
    );
    expect(shader.fragmentShader).toContain("stillpointSurfaceDetail");
    expect(shader.fragmentShader).toContain("stillpointGradient");
    expect(shader.fragmentShader).toContain("stillpointCloudField");
    expect(shader.fragmentShader).toContain("uStillpointCloudOffset * 4.0");
    expect(shader.fragmentShader).toContain("stillpointWetPoolAmount");
    expect(shader.fragmentShader).toContain("stillpointDetailDistance < 432.0");
    expect(shader.fragmentShader).toContain(
      "uStillpointDetailEnabled > 0.0001",
    );
    expect(shader.fragmentShader).toContain(
      "stillpointDetailDistance < uStillpointDetailFade.y",
    );
    expect(shader.fragmentShader).not.toContain("gl_Position");
    expect(shader.uniforms.uStillpointDetailEnabled).toBe(
      installed.uniforms.uStillpointDetailEnabled,
    );
    expect(shader.uniforms.uStillpointCloudShadows).toBe(
      installed.uniforms.uStillpointCloudShadows,
    );
    expect(shader.uniforms.uStillpointCloudOffset).toBe(
      installed.uniforms.uStillpointCloudOffset,
    );
    expect(shader.uniforms.uStillpointWetPooling).toBe(
      installed.uniforms.uStillpointWetPooling,
    );
    expect(material.customProgramCacheKey()).toContain(
      "stillpoint-surface-detail-v3",
    );
    installed.dispose();
    expect(material.onBeforeCompile).toBe(previousCompile);
    expect(material.customProgramCacheKey).toBe(previousCacheKey);
    const reinstalled = installProceduralSurfaceDetail(
      material,
      surfaceDetailProfile("terrain")!,
    );
    // Same content, same key: three reuses the program, and the reinstalled
    // hook hands it the very uniform objects it was compiled with.
    expect(material.customProgramCacheKey()).toBe(cacheKey);
    expect(reinstalled.uniforms.uStillpointDetailFrequency).toBe(
      installed.uniforms.uStillpointDetailFrequency,
    );
    expect(reinstalled.uniforms.uStillpointSurfaceWetness).toBe(
      installed.uniforms.uStillpointSurfaceWetness,
    );
    reinstalled.dispose();
    material.dispose();
  });

  it("gives materials with the same hook one program key", () => {
    const shared = createSharedWorldUniforms();
    const first = new THREE.MeshStandardMaterial();
    const second = new THREE.MeshStandardMaterial();
    const a = installProceduralSurfaceDetail(first, surfaceDetailProfile("terrain")!, shared);
    a.dispose();
    installProceduralSurfaceDetail(first, surfaceDetailProfile("terrain")!, shared);
    installProceduralSurfaceDetail(second, surfaceDetailProfile("terrain")!, shared);
    expect(first.customProgramCacheKey()).toBe(second.customProgramCacheKey());
    first.dispose();
    second.dispose();
  });

  it("re-keys every hooked material when its shared binding is renewed", () => {
    const shared = createSharedWorldUniforms();
    const material = new THREE.MeshStandardMaterial();
    installProceduralSurfaceDetail(material, surfaceDetailProfile("terrain")!, shared);
    const before = material.customProgramCacheKey();
    renewSharedWorldBinding(shared);
    expect(material.customProgramCacheKey()).not.toBe(before);
    material.dispose();
  });
});
