import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { AnimalEngine } from "../../lib/game/animals/AnimalEngine";
import { ANIMAL_SPECIES } from "../../lib/game/animals/animalRecipes";
import { CitizenEngine } from "../../lib/game/citizens/CitizenEngine";
import { BLOB_SHADOW_LIFT, BlobShadows } from "../../lib/game/rendering/BlobShadows";

function blobs(scene = new THREE.Scene()) {
  return new BlobShadows(scene, { name: "test-blobs", capacity: 4, fadeStart: 20, fadeEnd: 60 });
}

function blobCentre(shadows: BlobShadows, index: number) {
  const matrix = new THREE.Matrix4();
  shadows.mesh.getMatrixAt(index, matrix);
  return new THREE.Vector3().setFromMatrixPosition(matrix);
}

describe("blob shadows", () => {
  it("puts one blob at each agent's feet, sized from the agent", () => {
    const shadows = blobs();
    shadows.begin(new THREE.Vector3(0, 2, 0));
    shadows.add(3, 1.5, -4, 0.6);
    shadows.end();
    expect(shadows.mesh.count).toBe(1);
    const centre = blobCentre(shadows, 0);
    expect(centre.x).toBeCloseTo(3, 5);
    expect(centre.y).toBeCloseTo(1.5 + BLOB_SHADOW_LIFT, 5);
    expect(centre.z).toBeCloseTo(-4, 5);
    const matrix = new THREE.Matrix4();
    shadows.mesh.getMatrixAt(0, matrix);
    const scale = new THREE.Vector3();
    matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    expect(scale.x).toBeCloseTo(1.2);
    expect(scale.z).toBeCloseTo(1.2);
    shadows.dispose();
  });

  it("fades with distance and skips agents beyond the fade", () => {
    const shadows = blobs();
    shadows.begin(new THREE.Vector3());
    expect(shadows.add(5, 0, 0, 0.5)).toBe(true);
    expect(shadows.add(40, 0, 0, 0.5)).toBe(true);
    expect(shadows.add(200, 0, 0, 0.5)).toBe(false);
    shadows.end();
    expect(shadows.mesh.count).toBe(2);
    expect(shadows.strengthAt(0)).toBeCloseTo(1);
    expect(shadows.strengthAt(1)).toBeGreaterThan(0);
    expect(shadows.strengthAt(1)).toBeLessThan(1);
    shadows.dispose();
  });

  it("stops at its capacity", () => {
    const shadows = blobs();
    shadows.begin(new THREE.Vector3());
    for (let index = 0; index < 6; index += 1) shadows.add(index, 0, 0, 0.5);
    shadows.end();
    expect(shadows.mesh.count).toBe(4);
    shadows.dispose();
  });

  it("releases its mesh, geometry and material", () => {
    const scene = new THREE.Scene();
    const shadows = blobs(scene);
    const disposeGeometry = vi.spyOn(shadows.mesh.geometry, "dispose");
    const disposeMaterial = vi.spyOn(shadows.mesh.material, "dispose");
    expect(scene.getObjectByName("test-blobs")).toBe(shadows.mesh);
    shadows.dispose();
    expect(scene.getObjectByName("test-blobs")).toBeUndefined();
    expect(disposeGeometry).toHaveBeenCalledTimes(1);
    expect(disposeMaterial).toHaveBeenCalledTimes(1);
  });
});

describe("agent grounding", () => {
  it("grounds every nearby visible citizen and follows the crowd's visibility", () => {
    const scene = new THREE.Scene();
    const citizens = new CitizenEngine(scene, "cinematic");
    citizens.setWorldMinutes(12 * 60);
    citizens.update(0, 8, 0, false);
    citizens.present(0, new THREE.Vector3(0, 2, 8));
    const crowd = scene.children.find(
      (child): child is THREE.InstancedMesh =>
        child instanceof THREE.InstancedMesh && child.name.startsWith("ambient-citizens:") && child.count > 0,
    );
    expect(crowd).toBeDefined();
    const first = new THREE.Matrix4();
    crowd!.getMatrixAt(0, first);
    const citizen = new THREE.Vector3().setFromMatrixPosition(first);
    citizens.present(0, citizen.clone().add(new THREE.Vector3(0, 2, 0)));
    const shadows = scene.getObjectByName("citizen-blob-shadows") as THREE.InstancedMesh;
    expect(shadows).toBeInstanceOf(THREE.InstancedMesh);
    expect(shadows.count).toBeGreaterThan(0);
    const blob = new THREE.Matrix4();
    const centres = Array.from({ length: shadows.count }, (_, index) => {
      shadows.getMatrixAt(index, blob);
      return new THREE.Vector3().setFromMatrixPosition(blob);
    });
    expect(centres.some((centre) => Math.hypot(centre.x - citizen.x, centre.z - citizen.z) < 1e-3)).toBe(true);
    expect(shadows.count).toBeLessThanOrEqual(citizens.visibleCount);
    citizens.dispose();
    expect(scene.getObjectByName("citizen-blob-shadows")).toBeUndefined();
  });

  it("grounds walking animals but not flying ones", () => {
    const scene = new THREE.Scene();
    const animals = new AnimalEngine(scene, "cinematic");
    animals.update(0, 8, 0, false);
    animals.present(0, new THREE.Vector3(0, 2, 8));
    const shadows = scene.getObjectByName("animal-blob-shadows") as THREE.InstancedMesh;
    expect(shadows).toBeInstanceOf(THREE.InstancedMesh);
    const grounded = Object.entries(animals.debugSnapshot().bySpecies)
      .filter(([speciesId]) => !ANIMAL_SPECIES[speciesId as keyof typeof ANIMAL_SPECIES].flying)
      .reduce((total, [, count]) => total + count, 0);
    expect(shadows.count).toBeLessThanOrEqual(grounded);
    animals.dispose();
    expect(scene.getObjectByName("animal-blob-shadows")).toBeUndefined();
  });
});
