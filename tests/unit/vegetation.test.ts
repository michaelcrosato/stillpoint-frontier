import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ChunkManager } from "../../lib/game/world/ChunkManager";
import { worldMaterialDescriptor } from "../../lib/game/rendering/WorldMaterialLibrary";
import { VEGETATION_WIND_ATTRIBUTE } from "../../lib/game/rendering/VegetationWind";
import { BIOMES, type BiomeId } from "../../lib/game/world/macroWorld";
import {
  MAX_GROUNDCOVER_PER_CHUNK,
  VEGETATION_PROFILES,
  WOODY_SPECIES,
  createGroundcoverGeometry,
  createWoodyGeometry,
  groundcoverCount,
  selectWoodySpecies,
} from "../../lib/game/world/vegetation";

const BIOME_IDS = Object.keys(BIOMES) as BiomeId[];

function expectFiniteGeometry(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute("position");
  const colors = geometry.getAttribute("color");
  expect(positions.count).toBeGreaterThan(0);
  expect(colors.count).toBe(positions.count);
  for (const value of positions.array) expect(Number.isFinite(value)).toBe(true);
  expect(geometry.boundingSphere?.radius ?? 0).toBeGreaterThan(0);
  const windWeights = geometry.getAttribute(VEGETATION_WIND_ATTRIBUTE);
  expect(windWeights.count).toBe(positions.count);
  expect(Math.min(...windWeights.array)).toBe(0);
  expect(Math.max(...windWeights.array)).toBe(1);
}

describe("biome vegetation catalog", () => {
  it("gives every biome a bounded and visibly distinct flora profile", () => {
    const groundcoverKinds = new Set<string>();
    const referencedSpecies = new Set<string>();
    for (const biomeId of BIOME_IDS) {
      const profile = VEGETATION_PROFILES[biomeId];
      expect(profile).toBeDefined();
      expect(profile.groundcoverDensity).toBeGreaterThan(0);
      expect(profile.groundcoverColors).toHaveLength(3);
      expect(groundcoverCount(biomeId, 1)).toBeLessThanOrEqual(
        MAX_GROUNDCOVER_PER_CHUNK,
      );
      expect(groundcoverCount(biomeId, 0.52)).toBeLessThanOrEqual(
        groundcoverCount(biomeId, 1),
      );
      groundcoverKinds.add(profile.groundcover);
      profile.woody.forEach((speciesId) => {
        expect(WOODY_SPECIES[speciesId]).toBeDefined();
        referencedSpecies.add(speciesId);
      });
    }
    expect(groundcoverKinds.size).toBe(BIOME_IDS.length);
    expect(referencedSpecies.size).toBe(Object.keys(WOODY_SPECIES).length);
    expect(VEGETATION_PROFILES.glass_badlands.woody).toHaveLength(0);
  });

  it("selects deterministic native trees without cross-biome leakage", () => {
    for (const biomeId of BIOME_IDS) {
      const allowed = new Set(VEGETATION_PROFILES[biomeId].woody);
      const first = selectWoodySpecies(biomeId, 0);
      const last = selectWoodySpecies(biomeId, 0.999);
      if (allowed.size === 0) {
        expect(first).toBeNull();
        expect(last).toBeNull();
        continue;
      }
      expect(first?.id).toBe([...allowed][0]);
      expect(last?.id).toBe([...allowed][allowed.size - 1]);
      expect(allowed.has(first?.id ?? "" as never)).toBe(true);
      expect(allowed.has(last?.id ?? "" as never)).toBe(true);
      expect(selectWoodySpecies(biomeId, Number.NaN)?.id).toBe(first?.id);
    }
  });

  it("builds finite low-poly geometry for every woody and ground layer", () => {
    for (const species of Object.values(WOODY_SPECIES)) {
      const geometry = createWoodyGeometry(species);
      expectFiniteGeometry(geometry);
      expect(geometry.getAttribute("position").count).toBeLessThan(700);
      geometry.dispose();
    }
    for (const biomeId of BIOME_IDS) {
      const geometry = createGroundcoverGeometry(VEGETATION_PROFILES[biomeId]);
      expectFiniteGeometry(geometry);
      expect(geometry.getAttribute("position").count).toBeLessThan(800);
      geometry.dispose();
    }
  });

  it("keeps decorative flora render-only while every visible tree is harvestable", () => {
    const scene = new THREE.Scene();
    const world = new ChunkManager(scene, "performance");
    world.update(0, 8);
    const woodyMeshes: THREE.InstancedMesh[] = [];
    const decorativeMeshes: THREE.InstancedMesh[] = [];
    scene.traverse((object) => {
      if (!(object instanceof THREE.InstancedMesh)) return;
      if (object.userData.vegetationLayer === "woody") woodyMeshes.push(object);
      if (object.userData.vegetationLayer === "decorative") decorativeMeshes.push(object);
    });
    const treeTargets = world.targets.filter((target) =>
      target.id.startsWith("resource:tree:v2:"),
    );
    const gameplayMeshes = new Set(
      treeTargets.flatMap((target) =>
        target.instanceVisuals?.map((visual) => visual.mesh) ?? [],
      ),
    );
    const gameplayTreeInstances = [...gameplayMeshes].reduce(
      (sum, mesh) => sum + mesh.count,
      0,
    );
    expect(woodyMeshes.reduce((sum, mesh) => sum + mesh.count, 0)).toBeGreaterThan(0);
    expect(treeTargets).toHaveLength(gameplayTreeInstances);
    expect(treeTargets.every((target) =>
      target.item === "wood" &&
      target.instanceVisuals?.length === 1 &&
      world.colliders.some((collider) => collider.id === target.id),
    )).toBe(true);
    expect(decorativeMeshes.length).toBeGreaterThan(0);
    expect(decorativeMeshes.every((mesh) => mesh.castShadow === false)).toBe(true);
    expect(woodyMeshes.every((mesh) =>
      worldMaterialDescriptor(mesh.material as THREE.Material)?.windAmplitude === 0.42,
    )).toBe(true);
    expect(woodyMeshes.every((mesh) =>
      mesh.customDepthMaterial instanceof THREE.MeshDepthMaterial,
    )).toBe(true);
    expect(decorativeMeshes.every((mesh) =>
      worldMaterialDescriptor(mesh.material as THREE.Material)?.windAmplitude === 0.12,
    )).toBe(true);
    expect(decorativeMeshes.every((mesh) =>
      mesh.count === mesh.userData.performanceCount,
    )).toBe(true);
    world.setQuality("ultra");
    expect(decorativeMeshes.every((mesh) =>
      mesh.count === mesh.userData.highDetailCount && mesh.castShadow === false,
    )).toBe(true);
    world.setQuality("performance");
    expect(decorativeMeshes.every((mesh) =>
      mesh.count === mesh.userData.performanceCount,
    )).toBe(true);
    expect(world.targets.some((target) => target.id.includes("groundcover"))).toBe(false);
    expect(world.colliders.some((collider) => collider.id.includes("groundcover"))).toBe(false);
    world.dispose();
  });
});
