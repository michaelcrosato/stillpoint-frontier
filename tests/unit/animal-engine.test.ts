import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ANIMAL_RESIDENT_CHUNKS } from "../../lib/game/config";
import { AnimalEngine } from "../../lib/game/animals/AnimalEngine";
import { MAX_RESIDENT_ANIMALS } from "../../lib/game/animals/animalRecipes";

function firstVisibleMesh(scene: THREE.Scene) {
  return scene.children.find(
    (child): child is THREE.InstancedMesh =>
      child instanceof THREE.InstancedMesh &&
      child.name.startsWith("ambient-animals:") &&
      child.count > 0,
  );
}

describe("ambient animal renderer", () => {
  it("streams sparse instanced wildlife with smooth rigid movement and clean disposal", () => {
    const scene = new THREE.Scene();
    const animals = new AnimalEngine(scene, "cinematic");
    animals.updateStreaming(0, 8);
    const initial = animals.debugSnapshot();
    expect(initial.chunks).toBe(ANIMAL_RESIDENT_CHUNKS);
    expect(initial.visible).toBeGreaterThan(0);
    expect(initial.visible).toBeLessThanOrEqual(MAX_RESIDENT_ANIMALS.cinematic);
    expect(initial.species).toBeGreaterThan(1);
    const meshes = scene.children.filter(
      (child): child is THREE.InstancedMesh =>
        child instanceof THREE.InstancedMesh && child.name.startsWith("ambient-animals:"),
    );
    expect(meshes.length).toBeGreaterThanOrEqual(initial.species);
    for (const mesh of meshes) {
      expect(mesh.frustumCulled).toBe(true);
      expect(Number.isFinite(mesh.boundingSphere?.radius ?? Number.NaN)).toBe(true);
      expect(mesh.castShadow).toBe(false);
      expect(mesh.receiveShadow).toBe(false);
      expect(mesh.userData.nonInteractive).toBe(true);
    }

    const mesh = firstVisibleMesh(scene);
    expect(mesh).toBeDefined();
    if (!mesh) return;
    animals.update(0, 8, 1 / 60, false);
    animals.present(0);
    const fixed = new THREE.Matrix4();
    mesh.getMatrixAt(0, fixed);
    animals.present(1 / 120);
    const interpolated = new THREE.Matrix4();
    mesh.getMatrixAt(0, interpolated);
    expect(interpolated.equals(fixed)).toBe(false);

    animals.present(0);
    const beforePause = new THREE.Matrix4();
    mesh.getMatrixAt(0, beforePause);
    animals.update(0, 8, 1, true);
    animals.present(0);
    const afterPause = new THREE.Matrix4();
    mesh.getMatrixAt(0, afterPause);
    expect(afterPause.equals(beforePause)).toBe(true);

    const originalIds = animals.debugSnapshot().ids;
    animals.setQuality("performance");
    expect(animals.visibleCount).toBeLessThanOrEqual(initial.visible);
    expect(animals.visibleCount).toBeLessThanOrEqual(MAX_RESIDENT_ANIMALS.performance);
    animals.updateStreaming(12_000, -9_000);
    expect(animals.loadedCount).toBe(ANIMAL_RESIDENT_CHUNKS);
    animals.updateStreaming(0, 8);
    animals.setQuality("cinematic");
    expect(animals.debugSnapshot().ids).toEqual(originalIds);

    animals.dispose();
    animals.dispose();
    expect(scene.children.some((child) => child.name.startsWith("ambient-animals:")))
      .toBe(false);
  });
});
