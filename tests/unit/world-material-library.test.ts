import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  WorldMaterialLibrary,
  tagWorldMaterial,
  worldMaterialDescriptor,
} from "../../lib/game/rendering/WorldMaterialLibrary";

describe("world material library", () => {
  it("applies wet PBR policy and restores shared materials after the last root", () => {
    const material = tagWorldMaterial(
      new THREE.MeshStandardMaterial({ roughness: 0.9, envMapIntensity: 1 }),
      {
        role: "road",
        weatherExposure: 1,
        wetRoughness: 0.3,
        environmentScale: 0.8,
        wetReflectionBoost: 0.5,
      },
    );
    const first = new THREE.Mesh(new THREE.BoxGeometry(), material);
    const second = new THREE.Mesh(new THREE.BoxGeometry(), material);
    const library = new WorldMaterialLibrary();
    library.track(first);
    library.track(second);
    library.present({ surfaceWetness: 1 });
    expect(material.roughness).toBeCloseTo(0.3);
    expect(material.envMapIntensity).toBeCloseTo(1.2);
    library.untrack(first);
    expect(material.roughness).toBeCloseTo(0.3);
    library.untrack(second);
    expect(material.roughness).toBeCloseTo(0.9);
    expect(material.envMapIntensity).toBe(1);
    first.geometry.dispose();
    second.geometry.dispose();
    material.dispose();
  });

  it("ignores untagged materials and applies current weather to new roots", () => {
    const plain = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    const tagged = tagWorldMaterial(
      new THREE.MeshPhysicalMaterial({ roughness: 0.7 }),
      { role: "metal", weatherExposure: 0.5, wetRoughness: 0.3 },
    );
    const root = new THREE.Group();
    root.add(
      new THREE.Mesh(new THREE.BoxGeometry(), plain),
      new THREE.Mesh(new THREE.BoxGeometry(), tagged),
    );
    const library = new WorldMaterialLibrary();
    library.present({ surfaceWetness: Number.POSITIVE_INFINITY });
    library.present({ surfaceWetness: 1 });
    library.track(root);
    expect(plain.roughness).toBe(0.8);
    expect(tagged.roughness).toBeCloseTo(0.5);
    library.dispose();
    expect(tagged.roughness).toBe(0.7);
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    plain.dispose();
    tagged.dispose();
  });

  it("preserves descriptors through clones and never owns materials", () => {
    const material = tagWorldMaterial(
      new THREE.MeshStandardMaterial(),
      { role: "terrain", weatherExposure: 1 },
    );
    const clone = material.clone();
    expect(worldMaterialDescriptor(clone)).toMatchObject({
      role: "terrain",
      weatherExposure: 1,
    });
    const dispose = vi.spyOn(material, "dispose");
    const library = new WorldMaterialLibrary();
    library.track(new THREE.Mesh(new THREE.BoxGeometry(), material));
    library.dispose();
    library.dispose();
    expect(dispose).not.toHaveBeenCalled();
    material.dispose();
    clone.dispose();
  });

  it("composes reversible wind without replacing stable shadow materials", () => {
    const material = tagWorldMaterial(
      new THREE.MeshStandardMaterial({ roughness: 1 }),
      {
        role: "vegetation",
        detail: false,
        windAmplitude: 0.42,
      },
    );
    const originalCompile = material.onBeforeCompile;
    const geometry = new THREE.BoxGeometry();
    const mesh = new THREE.InstancedMesh(geometry, material, 1);
    mesh.castShadow = true;
    const library = new WorldMaterialLibrary();
    library.track(mesh);
    expect(material.onBeforeCompile).not.toBe(originalCompile);
    expect(mesh.customDepthMaterial).toBeUndefined();
    expect(mesh.customDistanceMaterial).toBeUndefined();
    library.present({
      surfaceWetness: 0.5,
      effectSeconds: 12,
      windKph: 30,
      windDirection: 90,
    });
    expect(library.diagnostics).toMatchObject({
      vegetationWind: true,
      windMaterials: 1,
    });
    library.setFeatures({
      surfaceDetail: false,
      vegetationWind: false,
      cloudShadows: false,
      wetSurfaces: false,
    });
    expect(library.diagnostics).toMatchObject({
      surfaceDetail: false,
      vegetationWind: false,
      detailMaterials: 0,
      windMaterials: 0,
    });
    expect(material.onBeforeCompile).toBe(originalCompile);
    library.untrack(mesh);
    expect(material.onBeforeCompile).toBe(originalCompile);
    mesh.dispose();
    geometry.dispose();
    material.dispose();
  });

  it("installs role-default detail once across shared roots", () => {
    const material = tagWorldMaterial(
      new THREE.MeshStandardMaterial(),
      { role: "terrain", weatherExposure: 1 },
    );
    const originalCompile = material.onBeforeCompile;
    const first = new THREE.Mesh(new THREE.PlaneGeometry(), material);
    const second = new THREE.Mesh(new THREE.PlaneGeometry(), material);
    const library = new WorldMaterialLibrary();
    library.track(first);
    const installedCompile = material.onBeforeCompile;
    library.track(second);
    expect(installedCompile).not.toBe(originalCompile);
    expect(material.onBeforeCompile).toBe(installedCompile);
    expect(library.diagnostics.detailMaterials).toBe(1);
    library.untrack(first);
    expect(material.onBeforeCompile).toBe(installedCompile);
    library.untrack(second);
    expect(material.onBeforeCompile).toBe(originalCompile);
    first.geometry.dispose();
    second.geometry.dispose();
    material.dispose();
  });

  it("keeps disabled shader features off the material compile path", () => {
    const material = tagWorldMaterial(
      new THREE.MeshStandardMaterial(),
      { role: "terrain", windAmplitude: 0.25 },
    );
    const originalCompile = material.onBeforeCompile;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material);
    const library = new WorldMaterialLibrary();
    library.setFeatures({
      surfaceDetail: false,
      vegetationWind: false,
      cloudShadows: false,
      wetSurfaces: false,
    });
    library.track(mesh);
    expect(material.onBeforeCompile).toBe(originalCompile);
    expect(library.diagnostics).toMatchObject({
      detailMaterials: 0,
      windMaterials: 0,
    });

    library.setFeatures({
      surfaceDetail: true,
      vegetationWind: true,
      cloudShadows: true,
      wetSurfaces: true,
    });
    expect(material.onBeforeCompile).not.toBe(originalCompile);
    expect(library.diagnostics).toMatchObject({
      detailMaterials: 1,
      windMaterials: 1,
    });

    library.setFeatures({
      surfaceDetail: false,
      vegetationWind: false,
      cloudShadows: false,
      wetSurfaces: false,
    });
    expect(material.onBeforeCompile).toBe(originalCompile);
    library.dispose();
    mesh.geometry.dispose();
    material.dispose();
  });

  it("keeps cloud shade and wet pooling independently active without micro-detail", () => {
    const material = tagWorldMaterial(
      new THREE.MeshStandardMaterial({ roughness: 0.9, envMapIntensity: 1 }),
      { role: "terrain", weatherExposure: 1, wetRoughness: 0.3 },
    );
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material);
    const library = new WorldMaterialLibrary();
    library.setFeatures({
      surfaceDetail: false,
      vegetationWind: false,
      cloudShadows: true,
      wetSurfaces: true,
    });
    library.track(mesh);
    library.present({
      surfaceWetness: 1,
      effectSeconds: 25,
      windDirection: 90,
      cloudOffset: new THREE.Vector2(8, -5),
      cloudCover: 0.8,
      daylight: 0.9,
    });
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: "#include <common>",
      fragmentShader: [
        "#include <common>",
        "void main() {",
        "#include <color_fragment>",
        "#include <roughnessmap_fragment>",
        "#include <normal_fragment_maps>",
        "}",
      ].join("\n"),
    };
    material.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.uStillpointDetailEnabled.value).toBe(0);
    expect(shader.uniforms.uStillpointCloudShadows.value).toBeGreaterThan(0);
    expect(shader.uniforms.uStillpointCloudOffset.value.toArray()).toEqual([8, -5]);
    expect(shader.uniforms.uStillpointWetPooling.value).toBeGreaterThan(0);
    expect(material.roughness).toBeCloseTo(0.3);

    library.setFeatures({
      surfaceDetail: false,
      vegetationWind: false,
      cloudShadows: true,
      wetSurfaces: false,
    });
    expect(material.roughness).toBeCloseTo(0.9);
    expect(library.diagnostics).toMatchObject({
      detailMaterials: 0,
      cloudShadowMaterials: 1,
      wetSurfaceMaterials: 0,
    });
    library.dispose();
    mesh.geometry.dispose();
    material.dispose();
  });
});
