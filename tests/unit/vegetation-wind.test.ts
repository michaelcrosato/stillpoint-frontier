import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  VEGETATION_WIND_ATTRIBUTE,
  installVegetationWind,
  prepareVegetationGeometry,
  vegetationWindStrength,
} from "../../lib/game/rendering/VegetationWind";

function compileMaterial(material: THREE.Material) {
  const shader: {
    uniforms: Record<string, { value: unknown }>;
    vertexShader: string;
    fragmentShader: string;
  } = {
    uniforms: {},
    vertexShader: "#include <common>\nvoid main(){\n#include <project_vertex>\n}",
    fragmentShader: "#include <common>\nvoid main(){}",
  };
  material.onBeforeCompile(
    shader as Parameters<THREE.Material["onBeforeCompile"]>[0],
    {} as THREE.WebGLRenderer,
  );
  return shader;
}

describe("vegetation wind", () => {
  it("maps calm through storm wind to a finite bounded response", () => {
    expect(vegetationWindStrength(-10)).toBe(0);
    expect(vegetationWindStrength(2)).toBe(0);
    expect(vegetationWindStrength(18)).toBeGreaterThan(0);
    expect(vegetationWindStrength(18)).toBeLessThan(1);
    expect(vegetationWindStrength(100)).toBe(1);
    expect(vegetationWindStrength(Number.NaN)).toBe(0);
  });

  it("anchors roots, weights crowns, and expands static culling bounds", () => {
    const geometry = new THREE.BoxGeometry(1, 4, 1);
    geometry.translate(0, 2, 0);
    geometry.computeBoundingSphere();
    const originalRadius = geometry.boundingSphere?.radius ?? 0;
    prepareVegetationGeometry(geometry, 0.42);
    const position = geometry.getAttribute("position");
    const weights = geometry.getAttribute(VEGETATION_WIND_ATTRIBUTE);
    let lowestWeight = 1;
    let highestWeight = 0;
    for (let index = 0; index < position.count; index += 1) {
      if (position.getY(index) <= 0.001) lowestWeight = Math.min(lowestWeight, weights.getX(index));
      if (position.getY(index) >= 3.999) highestWeight = Math.max(highestWeight, weights.getX(index));
    }
    expect(lowestWeight).toBe(0);
    expect(highestWeight).toBe(1);
    expect(geometry.boundingSphere?.radius ?? 0).toBeGreaterThan(originalRadius);
    expect(geometry.userData.stillpointMaximumWindSway).toBe(0.42);
    geometry.dispose();
  });

  it("installs live deformation uniforms on the visible material", () => {
    const material = new THREE.MeshStandardMaterial();
    const wind = installVegetationWind(material, 0.42);
    const cacheKey = material.customProgramCacheKey();
    const beautyShader = compileMaterial(material);
    expect(beautyShader.vertexShader).toContain("stillpointWindWeight");
    expect(beautyShader.vertexShader).toContain("stillpointWorldOrigin");
    expect(beautyShader.vertexShader).toContain("stillpointAxisXLength");
    expect(beautyShader.vertexShader).not.toContain("inverse(mat3");
    expect(beautyShader.uniforms.uStillpointWindTime).toBe(
      wind.uniforms.uStillpointWindTime,
    );
    const peerMaterial = new THREE.MeshStandardMaterial();
    const peerWind = installVegetationWind(peerMaterial, 0.42);
    expect(peerMaterial.customProgramCacheKey()).toBe(cacheKey);
    wind.dispose();
    const reinstalled = installVegetationWind(material, 0.42);
    expect(material.customProgramCacheKey()).not.toBe(cacheKey);
    reinstalled.dispose();
    peerWind.dispose();
    peerMaterial.dispose();
    material.dispose();
  });
});
