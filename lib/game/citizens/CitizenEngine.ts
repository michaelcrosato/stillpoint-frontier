import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CHUNK_LOAD_RADIUS, type QualityLevel } from "../config";
import {
  crowdDensityForCount,
  generateCitizenChunk,
  sampleCitizenPose,
  visibleCitizenCount,
  type CitizenRecipe,
  type CrowdDensity,
} from "./citizenRecipes";
import { chunkKey, chunksAround, worldToChunk } from "../world/terrain";

interface CitizenChunkRuntime {
  key: string;
  recipes: CitizenRecipe[];
  mesh: THREE.InstancedMesh | null;
}

const MODEL_HEIGHT = 1.8;

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

function createCitizenGeometry() {
  const leftLeg = coloredPart(new THREE.BoxGeometry(0.15, 0.62, 0.16), 0x373733);
  leftLeg.translate(-0.12, 0.31, 0);
  const rightLeg = coloredPart(new THREE.BoxGeometry(0.15, 0.62, 0.16), 0x373733);
  rightLeg.translate(0.12, 0.31, 0);
  const torso = coloredPart(new THREE.BoxGeometry(0.5, 0.82, 0.27), 0xd5d0c4);
  torso.translate(0, 1.01, 0);
  const head = coloredPart(new THREE.OctahedronGeometry(0.23, 0), 0xd0a47f);
  head.scale(0.86, 1.06, 0.9);
  head.translate(0, 1.61, 0);
  const geometry = mergeGeometries([leftLeg, rightLeg, torso, head], false);
  for (const part of [leftLeg, rightLeg, torso, head]) part.dispose();
  if (!geometry) throw new Error("Citizen geometry could not be assembled");
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Ambient population renderer. Citizens are derivable scene decoration: they
 * never enter interaction targets, collision caches, save data, or future NPC
 * state. One instanced draw per resident chunk keeps thousands inexpensive.
 */
export class CitizenEngine {
  private readonly geometry = createCitizenGeometry();
  private readonly material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.02,
    flatShading: true,
    vertexColors: true,
  });
  private readonly loaded = new Map<string, CitizenChunkRuntime>();
  private activeChunkKey = "";
  private elapsedSeconds = 0;
  private updateAccumulator = 0;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    private quality: QualityLevel,
  ) {}

  update(playerX: number, playerZ: number, deltaSeconds: number, paused: boolean) {
    const streamed = this.updateStreaming(playerX, playerZ);
    const safeDelta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (!paused) this.elapsedSeconds += safeDelta;
    this.updateAccumulator += safeDelta;
    const interval = 1 / this.updateHz;
    if (!streamed && this.updateAccumulator < interval) return;
    this.updateAccumulator %= interval;
    this.updateMatrices();
  }

  updateStreaming(playerX: number, playerZ: number) {
    if (this.disposed) return false;
    const center = worldToChunk(playerX, playerZ);
    const nextActiveKey = chunkKey(center.x, center.z);
    if (nextActiveKey === this.activeChunkKey && this.loaded.size > 0) return false;
    this.activeChunkKey = nextActiveKey;
    const desired = new Set<string>();
    for (const coordinate of chunksAround(center, CHUNK_LOAD_RADIUS)) {
      const key = chunkKey(coordinate.x, coordinate.z);
      desired.add(key);
      if (!this.loaded.has(key)) this.loadChunk(coordinate.x, coordinate.z);
    }
    for (const [key, chunk] of this.loaded) {
      if (desired.has(key)) continue;
      this.unloadChunk(chunk);
      this.loaded.delete(key);
    }
    this.updateMatrices();
    return true;
  }

  setQuality(quality: QualityLevel) {
    if (this.quality === quality) return;
    this.quality = quality;
    this.updateMatrices();
  }

  get visibleCount() {
    let total = 0;
    for (const chunk of this.loaded.values()) total += chunk.mesh?.count ?? 0;
    return total;
  }

  get recipeCount() {
    let total = 0;
    for (const chunk of this.loaded.values()) total += chunk.recipes.length;
    return total;
  }

  get density(): CrowdDensity {
    return crowdDensityForCount(this.visibleCount);
  }

  get updateHz() {
    return this.quality === "cinematic" ? 20 : 12;
  }

  get loadedCount() {
    return this.loaded.size;
  }

  debugSnapshot(maxIds = 64) {
    const ids = [...this.loaded.values()]
      .flatMap((chunk) => chunk.recipes.slice(0, chunk.mesh?.count ?? 0).map((recipe) => recipe.id))
      .sort()
      .slice(0, Math.max(0, maxIds));
    return {
      visible: this.visibleCount,
      generated: this.recipeCount,
      density: this.density,
      chunks: this.loadedCount,
      updateHz: this.updateHz,
      ids,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const chunk of this.loaded.values()) this.unloadChunk(chunk);
    this.loaded.clear();
    this.geometry.dispose();
    this.material.dispose();
  }

  private loadChunk(chunkX: number, chunkZ: number) {
    const key = chunkKey(chunkX, chunkZ);
    const recipes = generateCitizenChunk(chunkX, chunkZ);
    let mesh: THREE.InstancedMesh | null = null;
    if (recipes.length > 0) {
      mesh = new THREE.InstancedMesh(this.geometry, this.material, recipes.length);
      mesh.name = `ambient-citizens:${key}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.userData.shadow = false;
      const color = new THREE.Color();
      recipes.forEach((recipe, index) => {
        mesh?.setColorAt(index, color.setHex(recipe.palette));
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.scene.add(mesh);
    }
    this.loaded.set(key, { key, recipes, mesh });
  }

  private unloadChunk(chunk: CitizenChunkRuntime) {
    if (!chunk.mesh) return;
    this.scene.remove(chunk.mesh);
    chunk.mesh.dispose();
  }

  private updateMatrices() {
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const chunk of this.loaded.values()) {
      const mesh = chunk.mesh;
      if (!mesh) continue;
      const visible = visibleCitizenCount(chunk.recipes.length, this.quality);
      mesh.count = visible;
      for (let index = 0; index < visible; index += 1) {
        const recipe = chunk.recipes[index];
        const pose = sampleCitizenPose(recipe, this.elapsedSeconds);
        position.set(pose.x, pose.y, pose.z);
        quaternion.setFromAxisAngle(up, pose.yaw);
        scale.set(recipe.width, recipe.height / MODEL_HEIGHT, recipe.depth);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(index, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }
}
