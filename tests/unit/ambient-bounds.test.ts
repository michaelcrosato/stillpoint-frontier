import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { AnimalEngine } from "../../lib/game/animals/AnimalEngine";
import { MOUNTAIN_LANDMARK } from "../../lib/game/world/mountainLandmark";
import { CANYON_LANDMARK } from "../../lib/game/world/canyonLandmark";

function expectVisibleInstancesInsideBounds(scene: THREE.Scene) {
  const matrix = new THREE.Matrix4();
  const instance = new THREE.Sphere();
  let checked = 0;
  for (const object of scene.children) {
    if (!(object instanceof THREE.InstancedMesh) || object.count === 0) continue;
    expect(object.frustumCulled).toBe(true);
    const bounds = object.boundingSphere;
    expect(bounds).not.toBeNull();
    object.geometry.computeBoundingSphere();
    for (let index = 0; index < object.count; index += 1) {
      object.getMatrixAt(index, matrix);
      instance.copy(object.geometry.boundingSphere!).applyMatrix4(matrix);
      expect(
        instance.center.distanceTo(bounds!.center) + instance.radius,
        `${object.name} instance ${index} at height ${instance.center.y.toFixed(2)}`,
      ).toBeLessThanOrEqual(bounds!.radius + 0.001);
      checked += 1;
    }
  }
  return checked;
}

describe("ambient instance culling bounds", () => {
  it.each([
    ["compound", { x: 0, z: 8 }],
    ["Crownspire", MOUNTAIN_LANDMARK.center],
    ["Sunscar", CANYON_LANDMARK.center],
  ] as const)("keeps moving wildlife inside its bounds at %s", (_name, position) => {
    const scene = new THREE.Scene();
    const animals = new AnimalEngine(scene, "performance");
    try {
      for (const location of [position, { x: 0, z: 8 }, position]) {
        animals.updateStreaming(location.x, location.z);
        for (const quality of ["performance", "cinematic"] as const) {
          animals.setQuality(quality);
          for (const delta of [1 / 60, 23]) {
            animals.update(location.x, location.z, delta, false);
            animals.present(1 / 120);
            expect(expectVisibleInstancesInsideBounds(scene)).toBeGreaterThan(0);
          }
        }
      }
    } finally {
      animals.dispose();
    }
  });
});
