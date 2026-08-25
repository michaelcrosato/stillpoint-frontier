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
});
