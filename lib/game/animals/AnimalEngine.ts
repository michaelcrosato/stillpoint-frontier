import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  ANIMAL_CHUNK_LOAD_RADIUS,
  CHUNK_SIZE,
  QUALITY_LEVELS,
  type QualityLevel,
} from "../config";
import {
  ANIMAL_SPECIES,
  MAX_RESIDENT_ANIMALS,
  generateAnimalChunk,
  sampleAnimalPose,
  visibleAnimalCount,
  type AnimalRecipe,
  type AnimalSpeciesDefinition,
  type AnimalSpeciesId,
  type AnimalPose,
} from "./animalRecipes";
import type { ScanCandidate } from "../gameplay/fieldGuide";
import {
  applyAnimalReactionPose,
  createAnimalReactionState,
  reactionProfile,
  stepAnimalReaction,
  type AnimalReactionState,
} from "./reactions";
import {
  DEFAULT_ANIMAL_GROUND_NAVIGATION,
  resampleGroundAnimalPose,
  resolveGroundAnimalMovement,
  type AnimalGroundNavigation,
  type GroundAnimalDimensions,
} from "./groundMotion";
import { chunkKey, chunksAround, worldToChunk } from "../world/terrain";

function coloredPart(source: THREE.BufferGeometry, color: number) {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  source.dispose();
  const tint = new THREE.Color(color);
  const colors = new Float32Array(geometry.getAttribute("position").count * 3);
  for (let index = 0; index < colors.length; index += 3) {
    colors[index] = tint.r;
    colors[index + 1] = tint.g;
    colors[index + 2] = tint.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function createAnimalGeometry(species: AnimalSpeciesDefinition) {
  const parts: THREE.BufferGeometry[] = [];
  const add = (
    source: THREE.BufferGeometry,
    color: number,
    x: number,
    y: number,
    z: number,
    sx = 1,
    sy = 1,
    sz = 1,
    rotateZ = 0,
  ) => {
    const part = coloredPart(source, color);
    part.scale(sx, sy, sz);
    if (rotateZ) part.rotateZ(rotateZ);
    part.translate(x, y, z);
    parts.push(part);
  };
  const leg = (x: number, z: number, height: number) =>
    add(new THREE.BoxGeometry(0.11, height, 0.12), species.accentColor, x, height / 2, z);

  switch (species.body) {
    case "grazer":
      add(new THREE.DodecahedronGeometry(0.54, 0), species.bodyColor, 0, 0.83, 0, 1.35, 0.78, 0.72);
      add(new THREE.BoxGeometry(0.24, 0.72, 0.24), species.bodyColor, 0, 1.13, -0.47, 1, 1, 0.85, -0.2);
      add(new THREE.DodecahedronGeometry(0.3, 0), species.accentColor, 0, 1.47, -0.68, 1, 0.78, 1.2);
      leg(-0.34, -0.27, 0.62);
      leg(0.34, -0.27, 0.62);
      leg(-0.34, 0.28, 0.62);
      leg(0.34, 0.28, 0.62);
      break;
    case "stocky":
      add(new THREE.DodecahedronGeometry(0.58, 0), species.bodyColor, 0, 0.58, 0, 1.35, 0.78, 0.82);
      add(new THREE.DodecahedronGeometry(0.34, 0), species.accentColor, 0, 0.65, -0.64, 1.1, 0.82, 1.15);
      leg(-0.34, -0.27, 0.4);
      leg(0.34, -0.27, 0.4);
      leg(-0.34, 0.27, 0.4);
      leg(0.34, 0.27, 0.4);
      break;
    case "small":
      add(new THREE.DodecahedronGeometry(0.35, 0), species.bodyColor, 0, 0.32, 0, 1.25, 0.76, 0.78);
      add(new THREE.DodecahedronGeometry(0.24, 0), species.accentColor, 0, 0.5, -0.38, 0.9, 0.9, 1.05);
      add(new THREE.ConeGeometry(0.08, 0.34, 5), species.accentColor, -0.1, 0.83, -0.35, 1, 1, 0.7);
      add(new THREE.ConeGeometry(0.08, 0.34, 5), species.accentColor, 0.1, 0.83, -0.35, 1, 1, 0.7);
      break;
    case "reptile":
      add(new THREE.DodecahedronGeometry(0.34, 0), species.bodyColor, 0, 0.18, 0, 1.45, 0.4, 0.72);
      add(new THREE.DodecahedronGeometry(0.2, 0), species.accentColor, 0, 0.2, -0.42, 1, 0.65, 1.1);
      add(new THREE.ConeGeometry(0.17, 0.88, 6), species.bodyColor, 0, 0.17, 0.66, 0.72, 1, 0.72, Math.PI / 2);
      break;
    case "bird":
      add(new THREE.DodecahedronGeometry(0.3, 0), species.bodyColor, 0, 0.18, 0, 1.1, 0.72, 1.25);
      add(new THREE.BoxGeometry(0.92, 0.07, 0.34), species.accentColor, -0.42, 0.22, 0.02, 1, 1, 1, 0.1);
      add(new THREE.BoxGeometry(0.92, 0.07, 0.34), species.accentColor, 0.42, 0.22, 0.02, 1, 1, 1, -0.1);
      add(new THREE.DodecahedronGeometry(0.18, 0), species.bodyColor, 0, 0.35, -0.32, 0.85, 0.85, 1);
      break;
  }

  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error("Animal geometry could not be assembled");
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function groundDimensions(
  species: Readonly<AnimalSpeciesDefinition>,
  scale: number,
): GroundAnimalDimensions {
  const safeScale = Number.isFinite(scale) ? Math.max(0.1, scale) : species.scale;
  switch (species.body) {
    case "grazer":
      return { radius: 0.58 * safeScale, height: 1.72 * safeScale };
    case "stocky":
      return { radius: 0.56 * safeScale, height: 1.08 * safeScale };
    case "reptile":
      return { radius: 0.34 * safeScale, height: 0.48 * safeScale };
    case "small":
      return { radius: 0.32 * safeScale, height: 0.9 * safeScale };
    case "bird":
      return { radius: 0.34 * safeScale, height: 0.7 * safeScale };
  }
}

/**
 * Sparse, non-interactive wildlife. Rigid analytic poses avoid skeletons and
 * animation clips while render-frame interpolation keeps movement smooth.
 */
export class AnimalEngine {
  private readonly material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.96,
    metalness: 0,
    flatShading: true,
    vertexColors: true,
  });
  private readonly geometries = new Map<AnimalSpeciesId, THREE.BufferGeometry>();
  private readonly meshes = new Map<AnimalSpeciesId, THREE.InstancedMesh>();
  private readonly loaded = new Map<string, AnimalRecipe[]>();
  private readonly visibleRecipes = new Map<AnimalSpeciesId, AnimalRecipe[]>();
  private activeChunkKey = "";
  private elapsedSeconds = 0;
  private playerX = 0;
  private playerZ = 0;
  private readonly reactions = new Map<string, AnimalReactionState>();
  private readonly presentedPoses = new Map<string, AnimalPose>();
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    private quality: QualityLevel,
    private readonly groundNavigation: Readonly<AnimalGroundNavigation> =
      DEFAULT_ANIMAL_GROUND_NAVIGATION,
  ) {
    const maximumResidentAnimals = Math.max(
      ...QUALITY_LEVELS.map((level) => MAX_RESIDENT_ANIMALS[level]),
    );
    for (const species of Object.values(ANIMAL_SPECIES)) {
      const geometry = createAnimalGeometry(species);
      const mesh = new THREE.InstancedMesh(
        geometry,
        this.material,
        maximumResidentAnimals,
      );
      mesh.name = `ambient-animals:${species.id}`;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.userData.shadow = false;
      mesh.userData.nonInteractive = true;
      mesh.userData.speciesId = species.id;
      this.geometries.set(species.id, geometry);
      this.meshes.set(species.id, mesh);
      this.scene.add(mesh);
    }
  }

  update(playerX: number, playerZ: number, deltaSeconds: number, paused: boolean) {
    this.playerX = playerX;
    this.playerZ = playerZ;
    this.updateStreaming(playerX, playerZ);
    const safeDelta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (!paused) {
      this.elapsedSeconds += safeDelta;
      this.updateReactions(safeDelta);
    }
  }

  present(interpolationSeconds = 0) {
    const safeInterpolation = Number.isFinite(interpolationSeconds)
      ? Math.min(0.1, Math.max(0, interpolationSeconds))
      : 0;
    const presentationTime = this.elapsedSeconds + safeInterpolation;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [speciesId, mesh] of this.meshes) {
      const recipes = this.visibleRecipes.get(speciesId) ?? [];
      mesh.count = recipes.length;
      recipes.forEach((recipe, index) => {
        const basePose = sampleAnimalPose(recipe, presentationTime);
        const reaction = this.reactions.get(recipe.id) ?? createAnimalReactionState(recipe);
        const reactedPose = applyAnimalReactionPose(basePose, reaction);
        const pose = ANIMAL_SPECIES[recipe.speciesId].flying
          ? reactedPose
          : resampleGroundAnimalPose(reactedPose, this.groundNavigation);
        this.presentedPoses.set(recipe.id, pose);
        position.set(pose.x, pose.y, pose.z);
        quaternion.setFromAxisAngle(up, pose.yaw);
        scale.setScalar(recipe.scale);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(index, matrix);
      });
      if (recipes.length > 0) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  updateStreaming(playerX: number, playerZ: number) {
    if (this.disposed) return false;
    const center = worldToChunk(playerX, playerZ);
    const nextActiveKey = chunkKey(center.x, center.z);
    if (nextActiveKey === this.activeChunkKey && this.loaded.size > 0) return false;
    this.activeChunkKey = nextActiveKey;
    const desired = new Set<string>();
    for (const coordinate of chunksAround(center, ANIMAL_CHUNK_LOAD_RADIUS)) {
      const key = chunkKey(coordinate.x, coordinate.z);
      desired.add(key);
      if (!this.loaded.has(key)) {
        this.loaded.set(key, generateAnimalChunk(coordinate.x, coordinate.z));
      }
    }
    for (const key of this.loaded.keys()) {
      if (!desired.has(key)) this.loaded.delete(key);
    }
    const radius = (ANIMAL_CHUNK_LOAD_RADIUS + 1.15) * CHUNK_SIZE;
    for (const mesh of this.meshes.values()) {
      mesh.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(center.x * CHUNK_SIZE, 8, center.z * CHUNK_SIZE),
        radius,
      );
    }
    this.rebuildVisibleRecipes();
    this.present();
    return true;
  }

  setQuality(quality: QualityLevel) {
    if (quality === this.quality) return;
    this.quality = quality;
    this.rebuildVisibleRecipes();
    this.present();
  }

  get visibleCount() {
    let total = 0;
    for (const recipes of this.visibleRecipes.values()) total += recipes.length;
    return total;
  }

  get generatedCount() {
    let total = 0;
    for (const recipes of this.loaded.values()) total += recipes.length;
    return total;
  }

  get loadedCount() {
    return this.loaded.size;
  }

  get visibleSpeciesCount() {
    return [...this.visibleRecipes.values()].filter((recipes) => recipes.length > 0).length;
  }

  scanCandidates(): ScanCandidate[] {
    const candidates: ScanCandidate[] = [];
    for (const [speciesId, recipes] of this.visibleRecipes) {
      const species = ANIMAL_SPECIES[speciesId];
      for (const recipe of recipes) {
        const pose = this.presentedPoses.get(recipe.id) ?? sampleAnimalPose(recipe, this.elapsedSeconds);
        candidates.push({
          id: recipe.id,
          entryId: `guide:animal:${speciesId}:v1`,
          name: species.label,
          position: { x: pose.x, y: pose.y + species.scale, z: pose.z },
          maxDistance: 45,
        });
      }
    }
    return candidates;
  }

  debugSnapshot(maxIds = 96) {
    const bySpecies: Record<string, number> = {};
    for (const [speciesId, recipes] of this.visibleRecipes) {
      if (recipes.length > 0) bySpecies[speciesId] = recipes.length;
    }
    const ids = [...this.visibleRecipes.values()]
      .flatMap((recipes) => recipes.map((recipe) => recipe.id))
      .sort()
      .slice(0, Math.max(0, maxIds));
    const reactions: Record<string, number> = {};
    for (const state of this.reactions.values()) {
      reactions[state.mode] = (reactions[state.mode] ?? 0) + 1;
    }
    return {
      visible: this.visibleCount,
      generated: this.generatedCount,
      species: this.visibleSpeciesCount,
      chunks: this.loadedCount,
      updateHz: 60,
      ids,
      bySpecies,
      reactions,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of this.meshes.values()) {
      this.scene.remove(mesh);
      mesh.dispose();
    }
    this.meshes.clear();
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometries.clear();
    this.material.dispose();
    this.loaded.clear();
    this.visibleRecipes.clear();
    this.reactions.clear();
    this.presentedPoses.clear();
  }

  private rebuildVisibleRecipes() {
    this.visibleRecipes.clear();
    const all = [...this.loaded.values()].flat().sort((a, b) => a.id.localeCompare(b.id));
    const visible = all.slice(0, visibleAnimalCount(all.length, this.quality));
    for (const recipe of visible) {
      const recipes = this.visibleRecipes.get(recipe.speciesId) ?? [];
      recipes.push(recipe);
      this.visibleRecipes.set(recipe.speciesId, recipes);
      if (!this.reactions.has(recipe.id)) {
        this.reactions.set(recipe.id, createAnimalReactionState(recipe));
      }
    }
    const visibleIds = new Set(visible.map((recipe) => recipe.id));
    for (const id of this.reactions.keys()) {
      if (!visibleIds.has(id)) this.reactions.delete(id);
    }
    for (const id of this.presentedPoses.keys()) {
      if (!visibleIds.has(id)) this.presentedPoses.delete(id);
    }
  }

  private updateReactions(deltaSeconds: number) {
    for (const [speciesId, recipes] of this.visibleRecipes) {
      const species = ANIMAL_SPECIES[speciesId];
      const profile = reactionProfile(species.body, species.flying);
      for (const recipe of recipes) {
        const current = this.reactions.get(recipe.id) ?? createAnimalReactionState(recipe);
        const basePose = sampleAnimalPose(recipe, this.elapsedSeconds);
        const next = stepAnimalReaction(
          current,
          basePose,
          { x: this.playerX, z: this.playerZ },
          profile,
          deltaSeconds,
        );
        if (species.flying) {
          this.reactions.set(recipe.id, next);
          continue;
        }

        const currentPose = applyAnimalReactionPose(basePose, current);
        const desiredPose = applyAnimalReactionPose(basePose, next);
        const resolved = resolveGroundAnimalMovement(
          recipe.id,
          currentPose,
          desiredPose,
          groundDimensions(species, recipe.scale),
          this.groundNavigation,
        );
        this.reactions.set(recipe.id, {
          ...next,
          offsetX: resolved.x - basePose.x,
          offsetZ: resolved.z - basePose.z,
        });
      }
    }
  }
}
