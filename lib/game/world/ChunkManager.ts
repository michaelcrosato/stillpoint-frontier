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
import { randomRange, seededRandom } from "../core/random";
import type { CircleCollider } from "../systems/collision";
import {
  chunkCenter,
  chunkKey,
  sampleTerrainHeight,
  worldToChunk,
} from "./terrain";

export interface WorldInteractable {
  id: BeaconId;
  name: string;
  code: string;
  note: string;
  position: THREE.Vector3;
  root: THREE.Group;
}

interface ChunkRuntime {
  key: string;
  root: THREE.Group;
  colliders: CircleCollider[];
  interactables: WorldInteractable[];
}

const TERRAIN_COLORS = [0x826e52, 0x75634c, 0x8d7857, 0x6d604e];

export class ChunkManager {
  private loaded = new Map<string, ChunkRuntime>();
  private activeChunkKey = "";
  private scanned = new Set<BeaconId>();

  constructor(
    private readonly scene: THREE.Scene,
    private quality: QualityLevel,
  ) {}

  update(playerX: number, playerZ: number) {
    const center = worldToChunk(playerX, playerZ);
    const nextActiveKey = chunkKey(center.x, center.z);
    if (nextActiveKey === this.activeChunkKey && this.loaded.size > 0) return false;
    this.activeChunkKey = nextActiveKey;

    const desired = new Set<string>();
    for (let dz = -CHUNK_LOAD_RADIUS; dz <= CHUNK_LOAD_RADIUS; dz += 1) {
      for (let dx = -CHUNK_LOAD_RADIUS; dx <= CHUNK_LOAD_RADIUS; dx += 1) {
        const x = center.x + dx;
        const z = center.z + dz;
        const key = chunkKey(x, z);
        desired.add(key);
        if (!this.loaded.has(key)) this.loadChunk(x, z);
      }
    }

    for (const [key, chunk] of this.loaded) {
      if (desired.has(key)) continue;
      this.disposeChunk(chunk);
      this.loaded.delete(key);
    }
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
    const interactable = this.interactables.find((candidate) => candidate.id === beaconId);
    if (interactable) this.applyScannedAppearance(interactable.root);
  }

  get colliders() {
    return [...this.loaded.values()].flatMap((chunk) => chunk.colliders);
  }

  get interactables() {
    return [...this.loaded.values()].flatMap((chunk) => chunk.interactables);
  }

  get loadedCount() {
    return this.loaded.size;
  }

  dispose() {
    for (const chunk of this.loaded.values()) this.disposeChunk(chunk);
    this.loaded.clear();
  }

  private loadChunk(chunkX: number, chunkZ: number) {
    const key = chunkKey(chunkX, chunkZ);
    const center = chunkCenter({ x: chunkX, z: chunkZ });
    const root = new THREE.Group();
    root.name = `chunk:${key}`;

    const random = seededRandom(`${WORLD_SEED}:chunk:${key}`);
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
      color: TERRAIN_COLORS[Math.floor(random() * TERRAIN_COLORS.length)],
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
    this.addRockField(root, random, center.x, center.z, key, colliders);
    this.addRuinSlabs(root, random, center.x, center.z, key, colliders);

    const interactables: WorldInteractable[] = [];
    for (const beacon of BEACONS) {
      const beaconChunk = worldToChunk(beacon.x, beacon.z);
      if (beaconChunk.x !== chunkX || beaconChunk.z !== chunkZ) continue;
      const interactable = this.createBeacon(beacon);
      root.add(interactable.root);
      interactables.push(interactable);
      colliders.push({
        id: `beacon:${beacon.id}`,
        x: beacon.x,
        z: beacon.z,
        radius: 1.25,
      });
      if (this.scanned.has(beacon.id)) this.applyScannedAppearance(interactable.root);
    }

    this.scene.add(root);
    this.loaded.set(key, { key, root, colliders, interactables });
  }

  private addRockField(
    root: THREE.Group,
    random: () => number,
    centerX: number,
    centerZ: number,
    key: string,
    colliders: CircleCollider[],
  ) {
    const count = 13 + Math.floor(random() * 8);
    const geometry = new THREE.DodecahedronGeometry(1, 0);
    const material = new THREE.MeshStandardMaterial({
      color: 0x4d4840,
      roughness: 1,
      flatShading: true,
    });
    const rocks = new THREE.InstancedMesh(geometry, material, count);
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
      const size = randomRange(random, 0.45, 2.15);
      position.set(x, sampleTerrainHeight(x, z) + size * 0.42, z);
      quaternion.setFromEuler(
        new THREE.Euler(random() * 2.4, random() * Math.PI, random() * 1.2),
      );
      scale.set(size * randomRange(random, 0.7, 1.25), size, size * 0.72);
      matrix.compose(position, quaternion, scale);
      rocks.setMatrixAt(index, matrix);
      if (size > 1.15 && Math.hypot(x, z - 8) > 7) {
        colliders.push({ id: `rock:${key}:${index}`, x, z, radius: size * 0.66 });
      }
    }
    rocks.instanceMatrix.needsUpdate = true;
    rocks.computeBoundingSphere();
    root.add(rocks);
  }

  private addRuinSlabs(
    root: THREE.Group,
    random: () => number,
    centerX: number,
    centerZ: number,
    key: string,
    colliders: CircleCollider[],
  ) {
    const count = random() > 0.54 ? 3 + Math.floor(random() * 3) : 0;
    if (count === 0) return;

    const geometry = new THREE.BoxGeometry(0.65, 5, 2.2);
    const material = new THREE.MeshStandardMaterial({
      color: 0x262825,
      roughness: 0.78,
      metalness: 0.28,
    });
    const ruins = new THREE.InstancedMesh(geometry, material, count);
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

  private createBeacon(beacon: (typeof BEACONS)[number]): WorldInteractable {
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
    base.receiveShadow = true;
    root.add(base);

    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.82, 8.6, 0.82), dark);
    spine.position.y = 4.65;
    spine.rotation.y = Math.PI / 4;
    spine.castShadow = this.quality === "cinematic";
    root.add(spine);

    const signalCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.58, 0), signal);
    signalCore.name = "signal-core";
    signalCore.position.y = 8.8;
    root.add(signalCore);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.11, 8, 32), dark);
    ring.position.y = 6.5;
    ring.rotation.x = Math.PI / 2;
    ring.rotation.y = Math.PI / 5;
    root.add(ring);

    const finGeometry = new THREE.BoxGeometry(0.12, 2.4, 0.8);
    for (let index = 0; index < 3; index += 1) {
      const fin = new THREE.Mesh(finGeometry, dark);
      const angle = (index / 3) * Math.PI * 2;
      fin.position.set(Math.cos(angle) * 1.45, 3.2, Math.sin(angle) * 1.45);
      fin.rotation.y = -angle;
      root.add(fin);
    }

    root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = this.quality === "cinematic";
        object.receiveShadow = true;
      }
    });

    return {
      ...beacon,
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
