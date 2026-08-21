import * as THREE from "three";
import {
  BEACONS,
  CHUNK_LOAD_RADIUS,
  CHUNK_SEGMENTS,
  CHUNK_SIZE,
  WORLD_SEED,
  type BeaconId,
  type QualityLevel,
} from "../config";
import type { EntityDiff } from "../gameplay/interactions";
import type { ItemId } from "../gameplay/items";
import { randomRange, seededRandom } from "../core/random";
import type { CircleCollider } from "../systems/collision";
import {
  WATER_LEVEL,
  WORLD_MODEL_SCALE,
  riverCenterX,
  riverWidth,
  sampleClimate,
  settlementInfluence,
  settlementsNear,
  type Settlement,
} from "./macroWorld";
import {
  distanceToPathSegment,
  settlementStreetSegmentsForChunk,
  worldPathSegmentsForChunk,
} from "./roads";
import {
  chunkCenter,
  chunkKey,
  chunksAround,
  sampleTerrainHeight,
  worldToChunk,
} from "./terrain";

export type WorldTargetKind = "beacon" | "pickup" | "resource";
export type WorldTargetAction = "scan" | "collect" | "harvest";

export interface WorldTarget {
  id: string;
  kind: WorldTargetKind;
  action: WorldTargetAction;
  name: string;
  position: THREE.Vector3;
  root: THREE.Group;
  maxDistance: number;
  hitsRequired: number;
  hits: number;
  item?: ItemId;
  yieldAmount?: number;
  beaconId?: BeaconId;
  code?: string;
  note?: string;
}

interface ChunkRuntime {
  key: string;
  root: THREE.Group;
  colliders: CircleCollider[];
  targets: WorldTarget[];
}

const SETTLEMENT_BUILDINGS = {
  megacity: { count: 44, height: 82, color: 0x343936 },
  city: { count: 28, height: 38, color: 0x4b4d48 },
  town: { count: 15, height: 14, color: 0x5c5548 },
  village: { count: 8, height: 7, color: 0x665c4b },
} as const;

function targetDiff(
  worldDiffs: Readonly<Record<string, EntityDiff>>,
  id: string,
): EntityDiff {
  return worldDiffs[id] ?? { hits: 0, removed: false };
}

export class ChunkManager {
  private loaded = new Map<string, ChunkRuntime>();
  private activeChunkKey = "";
  private scanned = new Set<BeaconId>();
  private colliderCache: CircleCollider[] = [];
  private targetCache: WorldTarget[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private quality: QualityLevel,
    private readonly worldDiffs: Record<string, EntityDiff> = {},
  ) {}

  update(playerX: number, playerZ: number) {
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
      this.disposeChunk(chunk);
      this.loaded.delete(key);
    }
    this.refreshCaches();
    return true;
  }

  setQuality(quality: QualityLevel) {
    this.quality = quality;
    for (const chunk of this.loaded.values()) {
      chunk.root.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh) {
          object.castShadow = quality === "cinematic" && object.userData.shadow !== false;
        }
      });
    }
  }

  markScanned(beaconId: BeaconId) {
    this.scanned.add(beaconId);
    const target = this.targetCache.find((candidate) => candidate.beaconId === beaconId);
    if (target) this.applyScannedAppearance(target.root);
  }

  applyEntityDiff(id: string, diff: EntityDiff) {
    this.worldDiffs[id] = { ...diff };
    const target = this.targetCache.find((candidate) => candidate.id === id);
    if (!target) return;
    target.hits = diff.hits;
    if (diff.removed) {
      target.root.visible = false;
      for (const chunk of this.loaded.values()) {
        chunk.colliders = chunk.colliders.filter((collider) => collider.id !== id);
      }
    } else {
      const remaining = Math.max(0.28, 1 - diff.hits / Math.max(1, target.hitsRequired) * 0.22);
      target.root.scale.y = remaining;
    }
    this.refreshCaches();
  }

  get colliders() {
    return this.colliderCache;
  }

  get targets() {
    return this.targetCache;
  }

  get loadedCount() {
    return this.loaded.size;
  }

  dispose() {
    for (const chunk of this.loaded.values()) this.disposeChunk(chunk);
    this.loaded.clear();
    this.refreshCaches();
  }

  private refreshCaches() {
    this.colliderCache = [...this.loaded.values()].flatMap((chunk) => chunk.colliders);
    this.targetCache = [...this.loaded.values()].flatMap((chunk) =>
      chunk.targets.filter((target) => !this.worldDiffs[target.id]?.removed),
    );
  }

  private loadChunk(chunkX: number, chunkZ: number) {
    const key = chunkKey(chunkX, chunkZ);
    const center = chunkCenter({ x: chunkX, z: chunkZ });
    const root = new THREE.Group();
    root.name = `chunk:${key}`;
    const climate = sampleClimate(center.x, center.z);

    const terrainGeometry = new THREE.PlaneGeometry(
      CHUNK_SIZE,
      CHUNK_SIZE,
      CHUNK_SEGMENTS,
      CHUNK_SEGMENTS,
    );
    terrainGeometry.rotateX(-Math.PI / 2);
    const terrainPositions = terrainGeometry.getAttribute("position");
    for (let index = 0; index < terrainPositions.count; index += 1) {
      const worldX = center.x + terrainPositions.getX(index);
      const worldZ = center.z + terrainPositions.getZ(index);
      terrainPositions.setY(index, sampleTerrainHeight(worldX, worldZ));
    }
    terrainGeometry.computeVertexNormals();

    const terrainMaterial = new THREE.MeshStandardMaterial({
      color: climate.biome.color,
      roughness: 0.96,
      metalness: 0.02,
      flatShading: true,
    });
    const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
    terrain.position.set(center.x, 0, center.z);
    terrain.receiveShadow = true;
    terrain.userData.shadow = false;
    root.add(terrain);

    const colliders: CircleCollider[] = [];
    const targets: WorldTarget[] = [];
    this.addWater(root, center.x, center.z);
    this.addRoads(root, center.x, center.z, key);
    this.addSettlementBuildings(root, center.x, center.z, key, colliders);
    this.addRockField(root, center.x, center.z, key, climate.biome.rockDensity, colliders);
    this.addForest(root, center.x, center.z, key, climate.biome.treeDensity);
    this.addRuinSlabs(root, center.x, center.z, key, colliders);
    this.addGatherables(
      root,
      center.x,
      center.z,
      key,
      climate.biome.treeDensity,
      climate.biome.rockDensity,
      climate.biome.primaryResource,
      colliders,
      targets,
    );

    for (const beacon of BEACONS) {
      const beaconChunk = worldToChunk(beacon.x, beacon.z);
      if (beaconChunk.x !== chunkX || beaconChunk.z !== chunkZ) continue;
      const target = this.createBeacon(beacon);
      root.add(target.root);
      targets.push(target);
      colliders.push({ id: `beacon:${beacon.id}`, x: beacon.x, z: beacon.z, radius: 1.25 });
      if (this.scanned.has(beacon.id)) this.applyScannedAppearance(target.root);
    }

    this.scene.add(root);
    this.loaded.set(key, { key, root, colliders, targets });
  }

  private addWater(root: THREE.Group, centerX: number, centerZ: number) {
    const half = CHUNK_SIZE / 2;
    const zSamples = [centerZ - half, centerZ, centerZ + half];
    const riverVisible = zSamples.some(
      (z) => Math.abs(centerX - riverCenterX(z)) <= half + riverWidth(z),
    );
    if (riverVisible) {
      const positions: number[] = [];
      for (const z of zSamples) {
        const riverX = riverCenterX(z);
        const width = riverWidth(z);
        const left = Math.max(centerX - half, riverX - width);
        const right = Math.min(centerX + half, riverX + width);
        positions.push(left, WATER_LEVEL, z, right, WATER_LEVEL, z);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4]);
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({
        color: 0x36575a,
        roughness: 0.32,
        metalness: 0.12,
        transparent: true,
        opacity: 0.86,
        side: THREE.DoubleSide,
      });
      const river = new THREE.Mesh(geometry, material);
      river.name = "greywater-river";
      river.receiveShadow = true;
      river.userData.shadow = false;
      root.add(river);
    }

    const coastStart = 4_900 * WORLD_MODEL_SCALE;
    if (centerZ + half > coastStart) {
      const depth = Math.min(CHUNK_SIZE, centerZ + half - coastStart);
      const geometry = new THREE.PlaneGeometry(CHUNK_SIZE, depth);
      geometry.rotateX(-Math.PI / 2);
      const material = new THREE.MeshStandardMaterial({
        color: 0x314d50,
        roughness: 0.28,
        transparent: true,
        opacity: 0.9,
      });
      const sea = new THREE.Mesh(geometry, material);
      sea.position.set(centerX, WATER_LEVEL, centerZ + half - depth / 2);
      sea.userData.shadow = false;
      root.add(sea);
    }
  }

  private addRoads(root: THREE.Group, centerX: number, centerZ: number, key: string) {
    const chunk = worldToChunk(centerX, centerZ);
    const recipes: Array<{
      x: number;
      z: number;
      length: number;
      width: number;
      angle: number;
      kind: "road" | "street";
    }> = [];
    for (const segment of worldPathSegmentsForChunk(chunk.x, chunk.z)) {
      const dx = segment.end.x - segment.start.x;
      const dz = segment.end.z - segment.start.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.5) continue;
      const count = Math.max(1, Math.ceil(distance / 14));
      for (let index = 0; index < count; index += 1) {
        const start = index / count;
        const end = (index + 1) / count;
        recipes.push({
          x: segment.start.x + dx * (start + end) * 0.5,
          z: segment.start.z + dz * (start + end) * 0.5,
          length: distance / count + 0.4,
          width: segment.width,
          angle: -Math.atan2(dz, dx),
          kind: segment.kind,
        });
      }
    }
    if (recipes.length === 0) return;

    const roads = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, vertexColors: true }),
      recipes.length,
    );
    roads.name = `roads:${key}`;
    roads.receiveShadow = true;
    roads.userData.shadow = false;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();
    recipes.forEach((recipe, index) => {
      const crossesRiver =
        recipe.kind === "road" &&
        Math.abs(recipe.x - riverCenterX(recipe.z)) < riverWidth(recipe.z) + recipe.width;
      position.set(
        recipe.x,
        crossesRiver
          ? WATER_LEVEL + 0.32
          : sampleTerrainHeight(recipe.x, recipe.z) + 0.06,
        recipe.z,
      );
      quaternion.setFromEuler(new THREE.Euler(0, recipe.angle, 0));
      scale.set(recipe.length, 0.1, recipe.width);
      matrix.compose(position, quaternion, scale);
      roads.setMatrixAt(index, matrix);
      roads.setColorAt(index, color.setHex(recipe.kind === "street" ? 0x3d3c36 : 0x4a4338));
    });
    roads.instanceMatrix.needsUpdate = true;
    if (roads.instanceColor) roads.instanceColor.needsUpdate = true;
    roads.computeBoundingSphere();
    root.add(roads);
  }

  private addSettlementBuildings(
    root: THREE.Group,
    centerX: number,
    centerZ: number,
    key: string,
    colliders: CircleCollider[],
  ) {
    const nearby = settlementsNear(centerX, centerZ, CHUNK_SIZE * 0.72);
    const chunk = worldToChunk(centerX, centerZ);
    const chunkStreets = settlementStreetSegmentsForChunk(chunk.x, chunk.z);
    for (const settlement of nearby) {
      const spec = SETTLEMENT_BUILDINGS[settlement.tier];
      const influence = Math.max(0.08, settlementInfluence(settlement, centerX, centerZ));
      const count = Math.max(2, Math.floor(spec.count * (0.35 + influence * 0.65)));
      const random = seededRandom(`${WORLD_SEED}:chunk:${key}:settlement:${settlement.id}:v1`);
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshStandardMaterial({
        color: spec.color,
        roughness: 0.78,
        metalness: settlement.tier === "megacity" ? 0.22 : 0.08,
      });
      const buildings = new THREE.InstancedMesh(geometry, material, count);
      buildings.name = `settlement:${settlement.id}:${key}`;
      buildings.castShadow = this.quality === "cinematic";
      buildings.receiveShadow = true;
      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion();
      const position = new THREE.Vector3();
      const scale = new THREE.Vector3();
      const streets = chunkStreets.filter((street) => street.settlementId === settlement.id);

      for (let index = 0; index < count; index += 1) {
        const width = randomRange(random, 4.5, settlement.tier === "megacity" ? 14 : 9);
        const depth = randomRange(random, 4.2, settlement.tier === "megacity" ? 13 : 8);
        let x = centerX;
        let z = centerZ;
        for (let attempt = 0; attempt < 10; attempt += 1) {
          x = centerX + randomRange(random, -CHUNK_SIZE * 0.43, CHUNK_SIZE * 0.43);
          z = centerZ + randomRange(random, -CHUNK_SIZE * 0.43, CHUNK_SIZE * 0.43);
          if (Math.abs(x - riverCenterX(z)) < riverWidth(z) + 8) x += CHUNK_SIZE * 0.33;
          const streetClearance = Math.max(width, depth) * 0.54 + 4.5;
          if (streets.some((street) => distanceToPathSegment({ x, z }, street) < streetClearance)) {
            continue;
          }
          break;
        }
        const radial = settlementInfluence(settlement, x, z);
        const height = randomRange(random, 3.5, Math.max(5, spec.height * (0.18 + radial * 0.82)));
        position.set(x, sampleTerrainHeight(x, z) + height / 2, z);
        quaternion.setFromEuler(new THREE.Euler(0, Math.round(random() * 3) * Math.PI * 0.5, 0));
        scale.set(width, height, depth);
        matrix.compose(position, quaternion, scale);
        buildings.setMatrixAt(index, matrix);
        if (index < 9) {
          colliders.push({
            id: `building:${settlement.id}:${key}:${index}`,
            x,
            z,
            radius: Math.max(width, depth) * 0.52,
          });
        }
      }
      buildings.instanceMatrix.needsUpdate = true;
      buildings.computeBoundingSphere();
      root.add(buildings);
      this.addSettlementMarker(root, settlement, centerX, centerZ);
    }
  }

  private addSettlementMarker(
    root: THREE.Group,
    settlement: Settlement,
    centerX: number,
    centerZ: number,
  ) {
    if (Math.abs(settlement.x - centerX) > CHUNK_SIZE / 2) return;
    if (Math.abs(settlement.z - centerZ) > CHUNK_SIZE / 2) return;
    const height = settlement.tier === "megacity" ? 125 : settlement.tier === "city" ? 58 : 18;
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(settlement.tier === "megacity" ? 18 : 8, height, 8),
      new THREE.MeshStandardMaterial({
        color: 0x242a28,
        emissive: settlement.tier === "megacity" ? 0x193834 : 0x000000,
        emissiveIntensity: 0.8,
        metalness: 0.48,
        roughness: 0.5,
      }),
    );
    marker.name = `landmark:${settlement.id}`;
    marker.position.set(
      settlement.x,
      sampleTerrainHeight(settlement.x, settlement.z) + height / 2,
      settlement.z,
    );
    marker.castShadow = this.quality === "cinematic";
    root.add(marker);
  }

  private addRockField(
    root: THREE.Group,
    centerX: number,
    centerZ: number,
    key: string,
    density: number,
    colliders: CircleCollider[],
  ) {
    const random = seededRandom(`${WORLD_SEED}:chunk:${key}:rocks:v1`);
    const count = Math.max(3, Math.floor(4 + density * 13 + random() * 4));
    const rocks = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0x4d4840, roughness: 1, flatShading: true }),
      count,
    );
    rocks.name = `rocks:${key}`;
    rocks.castShadow = this.quality === "cinematic";
    rocks.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    for (let index = 0; index < count; index += 1) {
      const x = centerX + randomRange(random, -CHUNK_SIZE * 0.45, CHUNK_SIZE * 0.45);
      const z = centerZ + randomRange(random, -CHUNK_SIZE * 0.45, CHUNK_SIZE * 0.45);
      const size = randomRange(random, 0.35, 1.75);
      position.set(x, sampleTerrainHeight(x, z) + size * 0.42, z);
      quaternion.setFromEuler(new THREE.Euler(random() * 2, random() * Math.PI, random()));
      scale.set(size * randomRange(random, 0.72, 1.18), size, size * 0.72);
      matrix.compose(position, quaternion, scale);
      rocks.setMatrixAt(index, matrix);
      if (size > 1.25 && Math.hypot(x, z - 8) > 7) {
        colliders.push({ id: `scenery-rock:${key}:${index}`, x, z, radius: size * 0.62 });
      }
    }
    rocks.instanceMatrix.needsUpdate = true;
    rocks.computeBoundingSphere();
    root.add(rocks);
  }

  private addForest(
    root: THREE.Group,
    centerX: number,
    centerZ: number,
    key: string,
    density: number,
  ) {
    const random = seededRandom(`${WORLD_SEED}:chunk:${key}:forest:v1`);
    const count = Math.floor(density * 18 + random() * 3);
    if (count === 0) return;
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.28, 0.42, 3.6, 6),
      new THREE.MeshStandardMaterial({ color: 0x393329, roughness: 1 }),
      count,
    );
    const canopies = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1.75, 4.8, 7),
      new THREE.MeshStandardMaterial({ color: 0x283b2e, roughness: 1, flatShading: true }),
      count,
    );
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    for (let index = 0; index < count; index += 1) {
      const x = centerX + randomRange(random, -CHUNK_SIZE * 0.46, CHUNK_SIZE * 0.46);
      const z = centerZ + randomRange(random, -CHUNK_SIZE * 0.46, CHUNK_SIZE * 0.46);
      const size = randomRange(random, 0.78, 1.38);
      const baseY = sampleTerrainHeight(x, z);
      quaternion.setFromEuler(new THREE.Euler(0, random() * Math.PI * 2, 0));
      scale.set(size, size, size);
      position.set(x, baseY + 1.8 * size, z);
      matrix.compose(position, quaternion, scale);
      trunks.setMatrixAt(index, matrix);
      position.set(x, baseY + 5.0 * size, z);
      matrix.compose(position, quaternion, scale);
      canopies.setMatrixAt(index, matrix);
    }
    for (const mesh of [trunks, canopies]) {
      mesh.name = `forest:${key}`;
      mesh.castShadow = this.quality === "cinematic";
      mesh.receiveShadow = true;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      root.add(mesh);
    }
  }

  private addRuinSlabs(
    root: THREE.Group,
    centerX: number,
    centerZ: number,
    key: string,
    colliders: CircleCollider[],
  ) {
    const random = seededRandom(`${WORLD_SEED}:chunk:${key}:ruins:v1`);
    const count = random() > 0.58 ? 3 + Math.floor(random() * 3) : 0;
    if (count === 0) return;
    const ruins = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.65, 5, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x262825, roughness: 0.78, metalness: 0.28 }),
      count,
    );
    ruins.name = `ruins:${key}`;
    ruins.castShadow = this.quality === "cinematic";
    ruins.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const originX = centerX + randomRange(random, -28, 28);
    const originZ = centerZ + randomRange(random, -28, 28);
    for (let index = 0; index < count; index += 1) {
      const x = originX + index * randomRange(random, 3.2, 5.6);
      const z = originZ + randomRange(random, -2, 2);
      const heightScale = randomRange(random, 0.58, 1.35);
      position.set(x, sampleTerrainHeight(x, z) + 2.25 * heightScale, z);
      quaternion.setFromEuler(new THREE.Euler(0, randomRange(random, -0.35, 0.35), 0));
      scale.set(1, heightScale, randomRange(random, 0.72, 1.1));
      matrix.compose(position, quaternion, scale);
      ruins.setMatrixAt(index, matrix);
      if (Math.hypot(x, z - 8) > 8) {
        colliders.push({ id: `ruin:${key}:${index}`, x, z, radius: 1.2 });
      }
    }
    ruins.instanceMatrix.needsUpdate = true;
    ruins.computeBoundingSphere();
    root.add(ruins);
  }

  private addGatherables(
    root: THREE.Group,
    centerX: number,
    centerZ: number,
    key: string,
    treeDensity: number,
    rockDensity: number,
    primaryResource: ItemId,
    colliders: CircleCollider[],
    targets: WorldTarget[],
  ) {
    const pickupRandom = seededRandom(`${WORLD_SEED}:chunk:${key}:pickups:v1`);
    const pickupX = key === "0:0" ? 2.3 : centerX + randomRange(pickupRandom, -35, 35);
    const pickupZ = key === "0:0" ? 5.4 : centerZ + randomRange(pickupRandom, -35, 35);
    const pickupId = `pickup:${primaryResource}:v1:${key}:0`;
    this.registerGatherable(
      root,
      targets,
      colliders,
      this.createPickup(pickupId, pickupX, pickupZ, primaryResource),
    );

    if (rockDensity > 0.28) {
      const rockRandom = seededRandom(`${WORLD_SEED}:chunk:${key}:resource-rock:v1`);
      const x = key === "0:0" ? 4.2 : centerX + randomRange(rockRandom, -34, 34);
      const z = key === "0:0" ? 0.8 : centerZ + randomRange(rockRandom, -34, 34);
      const item: ItemId = primaryResource === "ore" ? "ore" : "stone";
      this.registerGatherable(
        root,
        targets,
        colliders,
        this.createRockResource(`resource:rock:v1:${key}:0`, x, z, item),
      );
    }

    if (treeDensity > 0.15) {
      const treeRandom = seededRandom(`${WORLD_SEED}:chunk:${key}:resource-tree:v1`);
      const x = key === "0:0" ? -3.2 : centerX + randomRange(treeRandom, -34, 34);
      const z = key === "0:0" ? -0.4 : centerZ + randomRange(treeRandom, -34, 34);
      this.registerGatherable(
        root,
        targets,
        colliders,
        this.createTreeResource(`resource:tree:v1:${key}:0`, x, z),
      );
    }
  }

  private registerGatherable(
    root: THREE.Group,
    targets: WorldTarget[],
    colliders: CircleCollider[],
    target: WorldTarget,
  ) {
    const diff = targetDiff(this.worldDiffs, target.id);
    target.hits = diff.hits;
    root.add(target.root);
    targets.push(target);
    if (diff.removed) {
      target.root.visible = false;
      return;
    }
    if (diff.hits > 0) {
      target.root.scale.y = Math.max(
        0.28,
        1 - diff.hits / Math.max(1, target.hitsRequired) * 0.22,
      );
    }
    if (target.kind === "resource") {
      colliders.push({
        id: target.id,
        x: target.root.position.x,
        z: target.root.position.z,
        radius: target.item === "wood" ? 0.72 : 0.92,
      });
    }
  }

  private createPickup(id: string, x: number, z: number, item: ItemId): WorldTarget {
    const root = new THREE.Group();
    root.name = id;
    root.position.set(x, sampleTerrainHeight(x, z) + 0.48, z);
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.34, 0),
      new THREE.MeshStandardMaterial({
        color: 0xd58a45,
        emissive: 0x713713,
        emissiveIntensity: 1.2,
        roughness: 0.42,
        metalness: 0.35,
      }),
    );
    mesh.rotation.set(0.25, 0.7, 0.1);
    root.add(mesh);
    return {
      id,
      kind: "pickup",
      action: "collect",
      name: item === "relic" ? "Old-world salvage" : `Loose ${item}`,
      item,
      yieldAmount: 1,
      hitsRequired: 1,
      hits: 0,
      maxDistance: 5.2,
      position: root.position.clone(),
      root,
    };
  }

  private createRockResource(id: string, x: number, z: number, item: ItemId): WorldTarget {
    const root = new THREE.Group();
    root.name = id;
    root.position.set(x, sampleTerrainHeight(x, z), z);
    const mesh = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1.25, 0),
      new THREE.MeshStandardMaterial({ color: item === "ore" ? 0x5d625d : 0x514c43, roughness: 1 }),
    );
    mesh.position.y = 0.72;
    mesh.scale.set(1.25, 0.8, 1);
    mesh.castShadow = this.quality === "cinematic";
    mesh.receiveShadow = true;
    root.add(mesh);
    return {
      id,
      kind: "resource",
      action: "harvest",
      name: item === "ore" ? "Ore-bearing rock" : "Stone outcrop",
      item,
      yieldAmount: 3,
      hitsRequired: 3,
      hits: 0,
      maxDistance: 6.25,
      position: new THREE.Vector3(x, root.position.y + 0.75, z),
      root,
    };
  }

  private createTreeResource(id: string, x: number, z: number): WorldTarget {
    const root = new THREE.Group();
    root.name = id;
    root.position.set(x, sampleTerrainHeight(x, z), z);
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.58, 4, 7),
      new THREE.MeshStandardMaterial({ color: 0x40372a, roughness: 1 }),
    );
    trunk.position.y = 2;
    const canopy = new THREE.Mesh(
      new THREE.ConeGeometry(2.15, 5.6, 7),
      new THREE.MeshStandardMaterial({ color: 0x2d4433, roughness: 1, flatShading: true }),
    );
    canopy.position.y = 5.5;
    for (const mesh of [trunk, canopy]) {
      mesh.castShadow = this.quality === "cinematic";
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    return {
      id,
      kind: "resource",
      action: "harvest",
      name: "Workable pine",
      item: "wood",
      yieldAmount: 4,
      hitsRequired: 3,
      hits: 0,
      maxDistance: 6.4,
      position: new THREE.Vector3(x, root.position.y + 2.2, z),
      root,
    };
  }

  private createBeacon(beacon: (typeof BEACONS)[number]): WorldTarget {
    const root = new THREE.Group();
    root.name = `beacon:${beacon.id}`;
    root.position.set(beacon.x, sampleTerrainHeight(beacon.x, beacon.z), beacon.z);
    root.userData.beaconId = beacon.id;
    const dark = new THREE.MeshStandardMaterial({
      color: 0x171a18,
      roughness: 0.55,
      metalness: 0.66,
    });
    const signal = new THREE.MeshStandardMaterial({
      color: 0xb8672f,
      emissive: 0x9b3f14,
      emissiveIntensity: 1.5,
      roughness: 0.36,
      metalness: 0.35,
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, 0.7, 8), dark);
    base.position.y = 0.35;
    root.add(base);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.82, 8.6, 0.82), dark);
    spine.position.y = 4.65;
    spine.rotation.y = Math.PI / 4;
    root.add(spine);
    const signalCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.58, 0), signal);
    signalCore.name = "signal-core";
    signalCore.position.y = 8.8;
    root.add(signalCore);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.11, 8, 32), dark);
    ring.position.y = 6.5;
    ring.rotation.x = Math.PI / 2;
    root.add(ring);
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = this.quality === "cinematic";
        object.receiveShadow = true;
      }
    });
    return {
      id: `beacon:${beacon.id}`,
      kind: "beacon",
      action: "scan",
      name: beacon.name,
      beaconId: beacon.id,
      code: beacon.code,
      note: beacon.note,
      hitsRequired: 1,
      hits: 0,
      maxDistance: 6.25,
      position: new THREE.Vector3(beacon.x, root.position.y + 3.2, beacon.z),
      root,
    };
  }

  private applyScannedAppearance(root: THREE.Group) {
    const signalCore = root.getObjectByName("signal-core");
    if (!(signalCore instanceof THREE.Mesh)) return;
    const material = signalCore.material as THREE.MeshStandardMaterial;
    material.color.setHex(0x91b69b);
    material.emissive.setHex(0x4f9b70);
    material.emissiveIntensity = 2.1;
  }

  private disposeChunk(chunk: ChunkRuntime) {
    this.scene.remove(chunk.root);
    chunk.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    });
  }
}
