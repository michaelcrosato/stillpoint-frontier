import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  BEACONS,
  CHUNK_SEGMENTS,
  CHUNK_SIZE,
  GAMEPLAY_CHUNK_RADIUS,
  WORLD_CHUNK_LOAD_RADIUS,
  WORLD_SEED,
  type BeaconId,
  type QualityLevel,
} from "../config";
import type { EntityDiff } from "../gameplay/interactions";
import type { ItemId } from "../gameplay/items";
import { randomRange, seededRandom } from "../core/random";
import {
  PlanarCollisionIndex,
  colliderOverlapsVerticalSpan,
  isPlanarPositionClear,
  type PlanarCollider,
} from "../systems/collision";
import {
  BUILDING_DOOR_HEIGHT,
  BUILDING_DOOR_WIDTH,
  BUILDING_PARAPET_HEIGHT,
  BUILDING_SLAB_THICKNESS,
  BUILDING_STEP_HEIGHT,
  BUILDING_WALL_THICKNESS,
  BUILDING_WINDOW_HEIGHT,
  BUILDING_WINDOW_SILL,
  buildingBasementSupportY,
  buildingCeilingY,
  buildingContainsPoint,
  buildingEntranceApronCollider,
  buildingGroundSupportY,
  buildingLevelStops,
  buildingLocalToWorld,
  buildingPlacementCollider,
  buildingRoofSupportY,
  buildingStructuralColliders,
  createBuildingRecipe,
  entranceFacingRotation,
  nearestBuildingStop,
  type BuildingRecipe,
  type BuildingTraversal,
} from "./buildings";
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
  worldPathSegmentsForChunk,
} from "./roads";
import {
  chunkCenter,
  chunkKey,
  chunksAround,
  sampleTerrainHeight,
  worldToChunk,
} from "./terrain";

export type WorldTargetKind = "beacon" | "pickup" | "resource" | "traversal";
export type WorldTargetAction = "scan" | "collect" | "harvest" | "traverse";

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
  traversal?: BuildingTraversal;
}

export interface BuildingInteriorStatus {
  id: string;
  name: string;
  level: string;
  floorCount: number;
  hasBasement: boolean;
  roofAccess: boolean;
}

export function worldTargetInteractionPosition(
  target: WorldTarget,
  playerY: number,
  out: THREE.Vector3,
) {
  if (!target.traversal) return out.copy(target.position);
  const origin = nearestBuildingStop(
    target.traversal.stops,
    playerY,
    target.traversal.direction,
  );
  if (!origin || origin.distance > 0.75) return null;
  return out.set(target.position.x, origin.stop.y + 1.05, target.position.z);
}

interface ChunkRuntime {
  key: string;
  chunkX: number;
  chunkZ: number;
  root: THREE.Group;
  colliders: PlanarCollider[];
  targets: WorldTarget[];
  buildings: BuildingRecipe[];
  interiorDetails: THREE.Object3D[];
  nightLighting: ChunkNightLighting;
}

interface SettlementAreaLight {
  light: THREE.PointLight;
  baseIntensity: number;
}

interface ChunkNightLighting {
  windowMeshes: THREE.InstancedMesh[];
  areaLights: SettlementAreaLight[];
  windowCount: number;
}

const SETTLEMENT_BUILDINGS = {
  megacity: { count: 44, height: 82, color: 0x343936 },
  city: { count: 28, height: 38, color: 0x4b4d48 },
  town: { count: 15, height: 14, color: 0x5c5548 },
  village: { count: 8, height: 7, color: 0x665c4b },
} as const;

const OPENING_RESERVATIONS = [
  { x: 0, z: 8, radius: 4.5 },
  { x: 2.3, z: 5.4, radius: 1.1 },
  { x: 4.2, z: 0.8, radius: 2.4 },
  { x: -3.2, z: -0.4, radius: 1.45 },
] as const;

function targetDiff(
  worldDiffs: Readonly<Record<string, EntityDiff>>,
  id: string,
): EntityDiff {
  return worldDiffs[id] ?? { hits: 0, removed: false };
}

const MAX_BUILDING_FLOORS = 30;

function createStairGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  // Eighteen risers keep the tallest 3.3 m storey below a 0.19 m rise while
  // preserving a compact U-shaped core.
  const stepsPerFlight = 9;
  const tread = 0.8 / stepsPerFlight;
  for (let index = 0; index < stepsPerFlight; index += 1) {
    const firstTop = (index + 1) / (stepsPerFlight * 2);
    const first = new THREE.BoxGeometry(0.42, firstTop, tread);
    first.translate(-0.27, firstTop * 0.5, -0.4 + (index + 0.5) * tread);
    parts.push(first);

    const secondTop = 0.5 + (index + 1) / (stepsPerFlight * 2);
    const second = new THREE.BoxGeometry(0.42, secondTop, tread);
    second.translate(0.27, secondTop * 0.5, 0.4 - (index + 0.5) * tread);
    parts.push(second);
  }
  const landing = new THREE.BoxGeometry(1, 0.06, 0.18);
  landing.translate(0, 0.47, 0.41);
  parts.push(landing);
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error("Building stair geometry could not be assembled");
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildingFacadeVertexShader() {
  return `
    attribute float aDoorFace;
    attribute float aFloorCount;
    attribute float aFacadeSeed;
    varying vec2 vFacadeUv;
    varying vec2 vFacadeSize;
    varying float vDoorFace;
    varying float vFloorCount;
    varying float vFacadeSeed;
    varying vec3 vFacadeNormal;
    #include <fog_pars_vertex>

    void main() {
      vFacadeUv = uv;
      vFacadeSize = vec2(
        length(instanceMatrix[0].xyz),
        length(instanceMatrix[1].xyz)
      );
      vDoorFace = aDoorFace;
      vFloorCount = aFloorCount;
      vFacadeSeed = aFacadeSeed;
      mat4 instanceModelView = modelViewMatrix * instanceMatrix;
      vec4 mvPosition = instanceModelView * vec4(position, 1.0);
      vFacadeNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }
  `;
}

function buildingOpeningShaderSource() {
  return `
    float facadeWindowMask() {
      float columns = max(1.0, floor(vFacadeSize.x / 1.45 + 0.5));
      float floorHeight = vFacadeSize.y / max(1.0, vFloorCount);
      float metricY = min(vFacadeSize.y - 0.001, vFacadeUv.y * vFacadeSize.y);
      float floorY = mod(metricY, floorHeight);
      float columnUv = fract(vFacadeUv.x * columns);
      float horizontal = step(0.18, columnUv) * step(columnUv, 0.82);
      float vertical =
        step(${BUILDING_WINDOW_SILL.toFixed(2)}, floorY) *
        step(floorY, ${(BUILDING_WINDOW_SILL + BUILDING_WINDOW_HEIGHT).toFixed(2)});
      return horizontal * vertical;
    }

    float facadeDoorMask() {
      float halfDoorUv = ${BUILDING_DOOR_WIDTH.toFixed(2)} / max(1.0, vFacadeSize.x) * 0.5;
      float centered = 1.0 - step(halfDoorUv, abs(vFacadeUv.x - 0.5));
      float metricY = vFacadeUv.y * vFacadeSize.y;
      float belowHeader = 1.0 - step(${BUILDING_DOOR_HEIGHT.toFixed(2)}, metricY);
      return vDoorFace * centered * belowHeader;
    }
  `;
}

function createBuildingFacadeMaterial(color: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uFacadeColor: { value: new THREE.Color(color) },
    },
    side: THREE.DoubleSide,
    fog: true,
    vertexShader: buildingFacadeVertexShader(),
    fragmentShader: `
      uniform vec3 uFacadeColor;
      varying vec2 vFacadeUv;
      varying vec2 vFacadeSize;
      varying float vDoorFace;
      varying float vFloorCount;
      varying float vFacadeSeed;
      varying vec3 vFacadeNormal;
      #include <fog_pars_fragment>
      ${buildingOpeningShaderSource()}

      void main() {
        if (facadeWindowMask() > 0.5 || facadeDoorMask() > 0.5) discard;
        vec3 normal = gl_FrontFacing ? normalize(vFacadeNormal) : -normalize(vFacadeNormal);
        vec3 lightDirection = normalize(vec3(0.38, 0.82, 0.31));
        float diffuse = max(0.0, dot(normal, lightDirection));
        float variation = 0.94 + 0.08 * fract(sin(vFacadeSeed * 91.17) * 43758.5453);
        gl_FragColor = vec4(uFacadeColor * variation * (0.62 + diffuse * 0.3), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

function createBuildingWindowMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uNight: { value: 0 },
      uDayColor: { value: new THREE.Color(0x203033) },
      uWarmColor: { value: new THREE.Color(0xffc36f) },
      uCoolColor: { value: new THREE.Color(0x9fc5ca) },
      // Exposed for renderer diagnostics and kept in lockstep with the metric
      // shader constants used to punch each opening.
      uWindowSill: { value: BUILDING_WINDOW_SILL },
      uWindowHeight: { value: BUILDING_WINDOW_HEIGHT },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    vertexShader: buildingFacadeVertexShader(),
    fragmentShader: `
      uniform float uNight;
      uniform vec3 uDayColor;
      uniform vec3 uWarmColor;
      uniform vec3 uCoolColor;
      varying vec2 vFacadeUv;
      varying vec2 vFacadeSize;
      varying float vDoorFace;
      varying float vFloorCount;
      varying float vFacadeSeed;
      varying vec3 vFacadeNormal;
      #include <fog_pars_fragment>
      ${buildingOpeningShaderSource()}

      float hash(vec2 value) {
        return fract(sin(dot(value, vec2(12.9898, 78.233))) * 43758.5453);
      }

      void main() {
        float columns = max(1.0, floor(vFacadeSize.x / 1.45 + 0.5));
        float floorHeight = vFacadeSize.y / max(1.0, vFloorCount);
        vec2 cell = vec2(
          floor(vFacadeUv.x * columns),
          floor(vFacadeUv.y * vFacadeSize.y / floorHeight)
        );
        if (facadeWindowMask() < 0.5 || facadeDoorMask() > 0.5) discard;
        float variation = hash(cell + vec2(vFacadeSeed, vFacadeSeed * 0.37));
        float occupied = step(0.42, variation);
        vec3 nightColor = mix(uWarmColor, uCoolColor, step(0.78, variation));
        vec3 afterDark = mix(uDayColor * 0.34, nightColor * 1.12, occupied);
        vec3 color = mix(uDayColor, afterDark, uNight);
        float alpha = mix(0.32, mix(0.2, 0.88, occupied), uNight);
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

function markChunkManagerShared<
  T extends THREE.BufferGeometry | THREE.Material,
>(resource: T): T {
  resource.userData.chunkManagerShared = true;
  return resource;
}

export class ChunkManager {
  private loaded = new Map<string, ChunkRuntime>();
  private activeChunkKey = "";
  private activeChunkX = 0;
  private activeChunkZ = 0;
  private scanned = new Set<BeaconId>();
  private colliderCache: PlanarCollider[] = [];
  private readonly collisionIndex = new PlanarCollisionIndex(16);
  private targetCache: WorldTarget[] = [];
  private buildingCache: BuildingRecipe[] = [];
  private nightLightingStrength = 0;
  private sharedBuildingResourcesDisposed = false;
  private readonly sharedBuildingBoxGeometry = markChunkManagerShared(
    new THREE.BoxGeometry(1, 1, 1),
  );
  private readonly sharedBuildingStairGeometry = markChunkManagerShared(
    createStairGeometry(),
  );
  private readonly sharedBuildingStairMaterial = markChunkManagerShared(
    new THREE.MeshStandardMaterial({
      color: 0x77756c,
      roughness: 0.74,
      metalness: 0.2,
    }),
  );
  private readonly sharedBuildingWindowMaterial = markChunkManagerShared(
    createBuildingWindowMaterial(),
  );
  private readonly sharedBuildingShellMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly sharedBuildingFloorMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly sharedBuildingDoorMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly sharedBuildingFacadeMaterials = new Map<string, THREE.ShaderMaterial>();

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
    this.activeChunkX = center.x;
    this.activeChunkZ = center.z;

    const desired = new Set<string>();
    for (const coordinate of chunksAround(center, WORLD_CHUNK_LOAD_RADIUS)) {
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

  setNightLighting(night: number) {
    const safeNight = Number.isFinite(night)
      ? THREE.MathUtils.clamp(night, 0, 1)
      : 0;
    const strength = THREE.MathUtils.smoothstep(safeNight, 0.16, 0.92);
    if (Math.abs(strength - this.nightLightingStrength) < 0.002) return;
    this.nightLightingStrength = strength;
    for (const chunk of this.loaded.values()) {
      this.applyNightLighting(chunk.nightLighting);
    }
  }

  get nightLightingSnapshot() {
    const windowMeshes = [...this.loaded.values()].flatMap(
      (chunk) => chunk.nightLighting.windowMeshes,
    );
    const areaLights = [...this.loaded.values()].flatMap(
      (chunk) => chunk.nightLighting.areaLights,
    );
    return {
      strength: this.nightLightingStrength,
      windows: [...this.loaded.values()].reduce(
        (sum, chunk) => sum + chunk.nightLighting.windowCount,
        0,
      ),
      visibleWindowMeshes: windowMeshes.filter((mesh) => mesh.visible).length,
      litWindowMeshes:
        this.nightLightingStrength > 0.015 ? windowMeshes.length : 0,
      areaLights: areaLights.length,
      activeAreaLights: areaLights.filter(({ light }) => light.intensity > 0).length,
    };
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

  queryColliders(
    current: { x: number; z: number },
    desired: { x: number; z: number },
    radius: number,
    minY = Number.NEGATIVE_INFINITY,
    maxY = Number.POSITIVE_INFINITY,
  ) {
    return this.collisionIndex
      .querySweep(current, desired, radius)
      .filter((collider) => colliderOverlapsVerticalSpan(collider, minY, maxY));
  }

  get targets() {
    return this.targetCache;
  }

  get buildings() {
    return this.buildingCache;
  }

  samplePlayerSupportHeight(
    x: number,
    z: number,
    currentY: number,
    verticalVelocity: number,
    grounded: boolean,
  ) {
    const terrainY = sampleTerrainHeight(x, z);
    const stepAllowance =
      grounded && verticalVelocity <= 0
        ? BUILDING_STEP_HEIGHT
        : verticalVelocity < 0
          ? Math.min(1.2, 0.05 + Math.abs(verticalVelocity) / 60)
          : 0.05;
    const maximumSupportY = currentY + stepAllowance;
    let supportY = Number.NEGATIVE_INFINITY;
    let insideBuilding = false;

    for (const recipe of this.buildingCache) {
      if (!buildingContainsPoint(recipe, x, z)) continue;
      insideBuilding = true;
      for (const stop of buildingLevelStops(recipe)) {
        if (stop.y <= maximumSupportY && stop.y > supportY) supportY = stop.y;
      }
      const roofY = buildingRoofSupportY(recipe);
      if (roofY <= maximumSupportY && roofY > supportY) supportY = roofY;
    }

    if (insideBuilding) {
      return Number.isFinite(supportY) ? supportY : currentY;
    }
    return terrainY <= maximumSupportY ? terrainY : currentY;
  }

  samplePlayerCeilingHeight(x: number, z: number, playerY: number) {
    let ceilingY = Number.POSITIVE_INFINITY;
    for (const recipe of this.buildingCache) {
      if (!buildingContainsPoint(recipe, x, z)) continue;
      ceilingY = Math.min(ceilingY, buildingCeilingY(recipe, playerY));
    }
    return ceilingY;
  }

  getInteriorStatus(x: number, z: number, playerY: number): BuildingInteriorStatus | null {
    for (const recipe of this.buildingCache) {
      if (!buildingContainsPoint(recipe, x, z)) continue;
      const stop = nearestBuildingStop(buildingLevelStops(recipe), playerY);
      if (!stop || stop.distance > 0.85) continue;
      return {
        id: recipe.id,
        name: recipe.displayName,
        level: stop.stop.label,
        floorCount: recipe.floorCount,
        hasBasement: recipe.hasBasement,
        roofAccess: recipe.roofAccess,
      };
    }
    return null;
  }

  isPlayerSheltered(x: number, z: number, playerY: number) {
    return this.buildingCache.some((recipe) => {
      if (!buildingContainsPoint(recipe, x, z)) return false;
      const lowerY = recipe.hasBasement
        ? buildingBasementSupportY(recipe) - 0.05
        : buildingGroundSupportY(recipe) - 0.05;
      return playerY >= lowerY && playerY < buildingRoofSupportY(recipe) - 0.05;
    });
  }

  get loadedCount() {
    return this.loaded.size;
  }

  dispose() {
    for (const chunk of this.loaded.values()) this.disposeChunk(chunk);
    this.loaded.clear();
    this.refreshCaches();
    this.disposeSharedBuildingResources();
  }

  private getSharedBuildingMaterial(
    kind: "shell" | "floor" | "door" | "facade",
    settlement: Settlement,
    color: number,
  ) {
    const key = settlement.tier;
    if (kind === "shell") {
      let material = this.sharedBuildingShellMaterials.get(key);
      if (!material) {
        material = markChunkManagerShared(new THREE.MeshStandardMaterial({
          color,
          roughness: 0.78,
          metalness: settlement.tier === "megacity" ? 0.22 : 0.08,
        }));
        this.sharedBuildingShellMaterials.set(key, material);
      }
      return material;
    }
    if (kind === "floor") {
      let material = this.sharedBuildingFloorMaterials.get(key);
      if (!material) {
        material = markChunkManagerShared(new THREE.MeshStandardMaterial({
          color: settlement.tier === "megacity" ? 0x262b29 : 0x49473f,
          roughness: 0.88,
          metalness: 0.04,
        }));
        this.sharedBuildingFloorMaterials.set(key, material);
      }
      return material;
    }
    if (kind === "door") {
      let material = this.sharedBuildingDoorMaterials.get(key);
      if (!material) {
        material = markChunkManagerShared(new THREE.MeshStandardMaterial({
          color: settlement.tier === "megacity" ? 0x655448 : 0x73573d,
          roughness: 0.7,
          metalness: settlement.tier === "megacity" ? 0.24 : 0.08,
        }));
        this.sharedBuildingDoorMaterials.set(key, material);
      }
      return material;
    }
    let material = this.sharedBuildingFacadeMaterials.get(key);
    if (!material) {
      material = markChunkManagerShared(createBuildingFacadeMaterial(color));
      this.sharedBuildingFacadeMaterials.set(key, material);
    }
    return material;
  }

  private disposeSharedBuildingResources() {
    if (this.sharedBuildingResourcesDisposed) return;
    this.sharedBuildingResourcesDisposed = true;
    this.sharedBuildingBoxGeometry.dispose();
    this.sharedBuildingStairGeometry.dispose();
    this.sharedBuildingStairMaterial.dispose();
    this.sharedBuildingWindowMaterial.dispose();
    for (const materials of [
      this.sharedBuildingShellMaterials,
      this.sharedBuildingFloorMaterials,
      this.sharedBuildingDoorMaterials,
      this.sharedBuildingFacadeMaterials,
    ]) {
      for (const material of materials.values()) material.dispose();
      materials.clear();
    }
  }

  private refreshCaches() {
    for (const chunk of this.loaded.values()) {
      const detailed =
        Math.abs(chunk.chunkX - this.activeChunkX) <= GAMEPLAY_CHUNK_RADIUS &&
        Math.abs(chunk.chunkZ - this.activeChunkZ) <= GAMEPLAY_CHUNK_RADIUS;
      for (const object of chunk.interiorDetails) object.visible = detailed;
    }
    const simulationChunks = [...this.loaded.values()].filter(
      (chunk) =>
        Math.abs(chunk.chunkX - this.activeChunkX) <= GAMEPLAY_CHUNK_RADIUS &&
        Math.abs(chunk.chunkZ - this.activeChunkZ) <= GAMEPLAY_CHUNK_RADIUS,
    );
    this.colliderCache = simulationChunks.flatMap((chunk) => chunk.colliders);
    this.collisionIndex.rebuild(this.colliderCache);
    this.targetCache = simulationChunks.flatMap((chunk) =>
      chunk.targets.filter((target) => !this.worldDiffs[target.id]?.removed),
    );
    this.buildingCache = simulationChunks.flatMap((chunk) => chunk.buildings);
  }

  private loadChunk(chunkX: number, chunkZ: number) {
    const key = chunkKey(chunkX, chunkZ);
    const center = chunkCenter({ x: chunkX, z: chunkZ });
    const root = new THREE.Group();
    root.name = `chunk:${key}`;
    const climate = sampleClimate(center.x, center.z);
    const nightLighting: ChunkNightLighting = {
      windowMeshes: [],
      areaLights: [],
      windowCount: 0,
    };

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

    const colliders: PlanarCollider[] = [];
    const targets: WorldTarget[] = [];
    const buildings: BuildingRecipe[] = [];
    const interiorDetails: THREE.Object3D[] = [];
    this.addWater(root, center.x, center.z);
    this.addRoads(root, center.x, center.z, key);
    this.addSettlementBuildings(
      root,
      center.x,
      center.z,
      key,
      colliders,
      targets,
      buildings,
      interiorDetails,
      nightLighting,
    );
    this.addRockField(root, center.x, center.z, key, climate.biome.rockDensity, colliders);
    this.addForest(root, center.x, center.z, key, climate.biome.treeDensity, colliders);
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
      colliders.push({
        shape: "circle",
        id: `beacon:${beacon.id}`,
        x: beacon.x,
        z: beacon.z,
        radius: 2.8,
      });
      if (this.scanned.has(beacon.id)) this.applyScannedAppearance(target.root);
    }

    this.scene.add(root);
    const runtime = {
      key,
      chunkX,
      chunkZ,
      root,
      colliders,
      targets,
      buildings,
      interiorDetails,
      nightLighting,
    };
    this.loaded.set(key, runtime);
    this.applyNightLighting(nightLighting);
  }

  private findSolidPlacement(
    random: () => number,
    centerX: number,
    centerZ: number,
    key: string,
    radius: number,
    colliders: readonly PlanarCollider[],
    maxOffset = CHUNK_SIZE * 0.44,
    attempts = 48,
  ) {
    const chunk = worldToChunk(centerX, centerZ);
    const paths = worldPathSegmentsForChunk(chunk.x, chunk.z);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const x = centerX + randomRange(random, -maxOffset, maxOffset);
      const z = centerZ + randomRange(random, -maxOffset, maxOffset);
      if (Math.abs(x - riverCenterX(z)) <= riverWidth(z) + radius + 1.25) continue;
      if (
        key === "0:0" &&
        OPENING_RESERVATIONS.some(
          (reservation) =>
            Math.hypot(x - reservation.x, z - reservation.z) <
            radius + reservation.radius,
        )
      ) {
        continue;
      }
      if (
        BEACONS.some(
          (beacon) => Math.hypot(x - beacon.x, z - beacon.z) < radius + 3.1,
        )
      ) {
        continue;
      }
      if (
        paths.some(
          (path) =>
            distanceToPathSegment({ x, z }, path) <
            path.width * 0.5 + radius + 1.25,
        )
      ) {
        continue;
      }
      if (!isPlanarPositionClear({ x, z }, colliders, radius + 0.2)) continue;
      return { x, z };
    }
    return null;
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
    colliders: PlanarCollider[],
    targets: WorldTarget[],
    buildings: BuildingRecipe[],
    interiorDetails: THREE.Object3D[],
    nightLighting: ChunkNightLighting,
  ) {
    const chunk = worldToChunk(centerX, centerZ);
    const paths = worldPathSegmentsForChunk(chunk.x, chunk.z);
    const nearby = settlementsNear(centerX, centerZ, CHUNK_SIZE * 0.72);
    for (const settlement of nearby) {
      const spec = SETTLEMENT_BUILDINGS[settlement.tier];
      const influence = Math.max(0.08, settlementInfluence(settlement, centerX, centerZ));
      const count = Math.max(2, Math.floor(spec.count * (0.35 + influence * 0.65)));
      const random = seededRandom(`${WORLD_SEED}:chunk:${key}:settlement:${settlement.id}:v2`);
      const shellGeometry = this.sharedBuildingBoxGeometry;
      const shellMaterial = this.getSharedBuildingMaterial(
        "shell",
        settlement,
        spec.color,
      );
      const shells = new THREE.InstancedMesh(shellGeometry, shellMaterial, count * 8);
      shells.name = `settlement-shells:${settlement.id}:${key}`;
      shells.castShadow = this.quality === "cinematic";
      shells.receiveShadow = true;

      const floorGeometry = this.sharedBuildingBoxGeometry;
      const floorMaterial = this.getSharedBuildingMaterial(
        "floor",
        settlement,
        spec.color,
      );
      const floors = new THREE.InstancedMesh(
        floorGeometry,
        floorMaterial,
        count * (MAX_BUILDING_FLOORS * 4 + 6),
      );
      floors.name = `settlement-floors:${settlement.id}:${key}`;
      floors.castShadow = false;
      floors.receiveShadow = true;
      floors.userData.shadow = false;

      const doorGeometry = this.sharedBuildingBoxGeometry;
      const doorMaterial = this.getSharedBuildingMaterial(
        "door",
        settlement,
        spec.color,
      );
      const doors = new THREE.InstancedMesh(doorGeometry, doorMaterial, count);
      doors.name = `settlement-doors:${settlement.id}:${key}`;
      doors.castShadow = this.quality === "cinematic";
      doors.receiveShadow = true;

      const stairGeometry = this.sharedBuildingStairGeometry;
      const stairMaterial = this.sharedBuildingStairMaterial;
      const stairs = new THREE.InstancedMesh(
        stairGeometry,
        stairMaterial,
        count * (MAX_BUILDING_FLOORS + 2),
      );
      stairs.name = `settlement-stairs:${settlement.id}:${key}`;
      stairs.castShadow = false;
      stairs.receiveShadow = true;
      stairs.userData.shadow = false;

      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion();
      const position = new THREE.Vector3();
      const scale = new THREE.Vector3();
      const facadeGeometry = new THREE.PlaneGeometry(1, 1);
      const facadeMaterial = this.getSharedBuildingMaterial(
        "facade",
        settlement,
        spec.color,
      );
      const facadeDoorFaceAttribute = new THREE.InstancedBufferAttribute(
        new Float32Array(count * 4),
        1,
      );
      const facadeFloorCountAttribute = new THREE.InstancedBufferAttribute(
        new Float32Array(count * 4),
        1,
      );
      const facadeSeedAttribute = new THREE.InstancedBufferAttribute(
        new Float32Array(count * 4),
        1,
      );
      facadeGeometry.setAttribute("aDoorFace", facadeDoorFaceAttribute);
      facadeGeometry.setAttribute("aFloorCount", facadeFloorCountAttribute);
      facadeGeometry.setAttribute("aFacadeSeed", facadeSeedAttribute);
      const facades = new THREE.InstancedMesh(
        facadeGeometry,
        facadeMaterial,
        count * 4,
      );
      facades.name = `settlement-facades:${settlement.id}:${key}`;
      facades.castShadow = this.quality === "cinematic";
      facades.receiveShadow = true;

      const windowGeometry = new THREE.PlaneGeometry(1, 1);
      const windowMaterial = this.sharedBuildingWindowMaterial;
      const windowDoorFaceAttribute = new THREE.InstancedBufferAttribute(
        new Float32Array(count * 4),
        1,
      );
      const windowFloorCountAttribute = new THREE.InstancedBufferAttribute(
        new Float32Array(count * 4),
        1,
      );
      const windowSeedAttribute = new THREE.InstancedBufferAttribute(
        new Float32Array(count * 4),
        1,
      );
      windowGeometry.setAttribute("aDoorFace", windowDoorFaceAttribute);
      windowGeometry.setAttribute("aFloorCount", windowFloorCountAttribute);
      windowGeometry.setAttribute("aFacadeSeed", windowSeedAttribute);
      const windows = new THREE.InstancedMesh(
        windowGeometry,
        windowMaterial,
        count * 4,
      );
      windows.name = `city-windows:${settlement.id}:${key}`;
      windows.castShadow = false;
      windows.receiveShadow = false;
      windows.userData.shadow = false;
      windows.visible = true;
      windows.renderOrder = 3;

      let renderedShells = 0;
      let renderedFloors = 0;
      let renderedDoors = 0;
      let renderedStairs = 0;
      let renderedFacades = 0;

      const setBox = (
        mesh: THREE.InstancedMesh,
        instanceIndex: number,
        recipe: BuildingRecipe,
        localX: number,
        y: number,
        localZ: number,
        width: number,
        height: number,
        depth: number,
        rotationOffset = 0,
      ) => {
        const world = buildingLocalToWorld(recipe, localX, localZ);
        position.set(world.x, y, world.z);
        quaternion.setFromEuler(new THREE.Euler(0, recipe.rotation + rotationOffset, 0));
        scale.set(width, height, depth);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(instanceIndex, matrix);
      };

      const finalize = (
        mesh: THREE.InstancedMesh,
        rendered: number,
        geometry: THREE.BufferGeometry,
        material: THREE.Material,
      ) => {
        if (rendered <= 0) {
          mesh.dispose();
          if (geometry.userData.chunkManagerShared !== true) geometry.dispose();
          if (material.userData.chunkManagerShared !== true) material.dispose();
          return false;
        }
        mesh.count = rendered;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        root.add(mesh);
        return true;
      };

      for (let candidateIndex = 0; candidateIndex < count; candidateIndex += 1) {
        const towerCandidate = settlement.tier === "megacity" && random() < 0.24;
        const width = towerCandidate
          ? randomRange(random, 11, 20)
          : randomRange(random, 4.5, settlement.tier === "megacity" ? 14 : 9);
        const depth = towerCandidate
          ? randomRange(random, 10, 18)
          : randomRange(random, 4.2, settlement.tier === "megacity" ? 13 : 8);
        let site: {
          x: number;
          z: number;
          entranceRotation: number;
          groundY: number;
        } | null = null;
        for (let siteAttempt = 0; siteAttempt < 5; siteAttempt += 1) {
          const placement = this.findSolidPlacement(
            random,
            centerX,
            centerZ,
            key,
            Math.hypot(width, depth) * 0.5,
            colliders,
            CHUNK_SIZE * 0.43,
            64,
          );
          if (!placement) break;
          const fallbackRotation = Math.round(random() * 3) * Math.PI * 0.5;
          const entranceRotation = entranceFacingRotation(
            placement.x,
            placement.z,
            paths,
            fallbackRotation,
          );
          const entrance = buildingLocalToWorld(
            { x: placement.x, z: placement.z, rotation: entranceRotation },
            0,
            depth * 0.5,
          );
          const groundY = sampleTerrainHeight(entrance.x, entrance.z);
          const sampleInset = BUILDING_WALL_THICKNESS + 0.12;
          const footprintSamples = [
            [-width * 0.5 + sampleInset, -depth * 0.5 + sampleInset],
            [width * 0.5 - sampleInset, -depth * 0.5 + sampleInset],
            [-width * 0.5 + sampleInset, depth * 0.5 - sampleInset],
            [width * 0.5 - sampleInset, depth * 0.5 - sampleInset],
            [0, 0],
          ] as const;
          const highestTerrain = Math.max(
            ...footprintSamples.map(([localX, localZ]) => {
              const sample = buildingLocalToWorld(
                { x: placement.x, z: placement.z, rotation: entranceRotation },
                localX,
                localZ,
              );
              return sampleTerrainHeight(sample.x, sample.z);
            }),
          );
          // A raised foundation can bridge low ground, but terrain must never
          // poke through the finished ground-floor slab.
          if (highestTerrain > groundY + BUILDING_SLAB_THICKNESS * 0.6) continue;
          site = {
            x: placement.x,
            z: placement.z,
            entranceRotation,
            groundY,
          };
          break;
        }
        if (!site) continue;
        const { x, z, entranceRotation, groundY } = site;
        const radial = settlementInfluence(settlement, x, z);
        const localClimate = sampleClimate(x, z);
        const desiredHeight = randomRange(
          random,
          3.5,
          Math.max(5, spec.height * (0.18 + radial * 0.82)),
        );
        const recipe = createBuildingRecipe({
          id: `building:${settlement.id}:${key}:${candidateIndex}`,
          settlementId: settlement.id,
          settlementName: settlement.name,
          tier: settlement.tier,
          chunkKey: key,
          candidateIndex,
          x,
          z,
          fallbackRotation: entranceRotation,
          width,
          depth,
          desiredHeight,
          foundationY: groundY,
          allowBasement:
            groundY > WATER_LEVEL + 4 && localClimate.riverDistance > 60,
          basementRoll: random(),
          roofRoll: random(),
          paths: [],
        });
        buildings.push(recipe);
        colliders.push(
          buildingPlacementCollider(recipe),
          buildingEntranceApronCollider(recipe),
          ...buildingStructuralColliders(recipe),
        );

        const wall = BUILDING_WALL_THICKNESS;
        const groundSupportY = buildingGroundSupportY(recipe);
        const roofSupportY = buildingRoofSupportY(recipe);
        const shellBottomY = recipe.hasBasement
          ? buildingBasementSupportY(recipe)
          : groundSupportY - 1;
        const frontZ = recipe.depth * 0.5 - wall * 0.5;
        const backZ = -frontZ;
        const sideX = recipe.width * 0.5 - wall * 0.5;
        const foundationHeight = groundSupportY - shellBottomY;
        const foundationCenterY = shellBottomY + foundationHeight * 0.5;
        // A continuous foundation closes basement walls beneath the street-level
        // doorway and masks modest terrain relief under raised ground floors.
        setBox(shells, renderedShells++, recipe, -sideX, foundationCenterY, 0, wall, foundationHeight, recipe.depth);
        setBox(shells, renderedShells++, recipe, sideX, foundationCenterY, 0, wall, foundationHeight, recipe.depth);
        setBox(shells, renderedShells++, recipe, 0, foundationCenterY, frontZ, recipe.width, foundationHeight, wall);
        setBox(shells, renderedShells++, recipe, 0, foundationCenterY, backZ, recipe.width, foundationHeight, wall);

        if (recipe.roofAccess) {
          const parapetY = roofSupportY + BUILDING_PARAPET_HEIGHT * 0.5;
          setBox(shells, renderedShells++, recipe, -sideX, parapetY, 0, wall, BUILDING_PARAPET_HEIGHT, recipe.depth);
          setBox(shells, renderedShells++, recipe, sideX, parapetY, 0, wall, BUILDING_PARAPET_HEIGHT, recipe.depth);
          setBox(shells, renderedShells++, recipe, 0, parapetY, frontZ, recipe.width, BUILDING_PARAPET_HEIGHT, wall);
          setBox(shells, renderedShells++, recipe, 0, parapetY, backZ, recipe.width, BUILDING_PARAPET_HEIGHT, wall);
        }

        const slabWidth = Math.max(1, recipe.width - wall * 2);
        const slabDepth = Math.max(1, recipe.depth - wall * 2);
        const stops = buildingLevelStops(recipe);
        const stairWidth = Math.min(2.2, Math.max(1.1, recipe.width - 1.15));
        const stairDepth = Math.min(3.2, Math.max(2.2, recipe.depth - 1.15));
        const openingWidth = Math.min(slabWidth - 0.6, stairWidth * 1.06);
        const openingDepth = Math.min(slabDepth - 0.6, stairDepth * 0.98);
        const addSlab = (supportY: number, hasOpening: boolean) => {
          const slabY = supportY - BUILDING_SLAB_THICKNESS * 0.5;
          if (!hasOpening) {
            setBox(
              floors,
              renderedFloors++,
              recipe,
              0,
              slabY,
              0,
              slabWidth,
              BUILDING_SLAB_THICKNESS,
              slabDepth,
            );
            return;
          }
          const sideWidth = (slabWidth - openingWidth) * 0.5;
          const endDepth = (slabDepth - openingDepth) * 0.5;
          const sideOffset = openingWidth * 0.5 + sideWidth * 0.5;
          const endOffset = openingDepth * 0.5 + endDepth * 0.5;
          setBox(floors, renderedFloors++, recipe, -sideOffset, slabY, 0, sideWidth, BUILDING_SLAB_THICKNESS, slabDepth);
          setBox(floors, renderedFloors++, recipe, sideOffset, slabY, 0, sideWidth, BUILDING_SLAB_THICKNESS, slabDepth);
          setBox(floors, renderedFloors++, recipe, 0, slabY, -endOffset, openingWidth, BUILDING_SLAB_THICKNESS, endDepth);
          setBox(floors, renderedFloors++, recipe, 0, slabY, endOffset, openingWidth, BUILDING_SLAB_THICKNESS, endDepth);
        };
        if (recipe.hasBasement) {
          addSlab(buildingBasementSupportY(recipe), false);
        }
        for (let floorIndex = 0; floorIndex < recipe.floorCount; floorIndex += 1) {
          const stopIndex = floorIndex + (recipe.hasBasement ? 1 : 0);
          addSlab(
            groundSupportY + floorIndex * recipe.floorHeight,
            stopIndex > 0,
          );
        }
        addSlab(roofSupportY, recipe.roofAccess);

        setBox(
          doors,
          renderedDoors++,
          recipe,
          -recipe.doorWidth * 0.48,
          groundSupportY + recipe.doorHeight * 0.5,
          recipe.depth * 0.5 - recipe.doorWidth * 0.46,
          0.08,
          recipe.doorHeight - 0.05,
          recipe.doorWidth * 0.92,
        );

        const facadeHeight = recipe.height;
        for (let face = 0; face < 4; face += 1) {
          const faceRotation = recipe.rotation + face * Math.PI * 0.5;
          const usesDepth = face % 2 === 0;
          const offset = (usesDepth ? recipe.depth : recipe.width) * 0.5 + 0.006;
          const facadeWidth = usesDepth ? recipe.width : recipe.depth;
          position.set(
            recipe.x + Math.sin(faceRotation) * offset,
            groundSupportY + recipe.height * 0.5,
            recipe.z + Math.cos(faceRotation) * offset,
          );
          quaternion.setFromEuler(new THREE.Euler(0, faceRotation, 0));
          scale.set(facadeWidth, facadeHeight, 1);
          matrix.compose(position, quaternion, scale);
          facades.setMatrixAt(renderedFacades, matrix);
          windows.setMatrixAt(renderedFacades, matrix);
          const doorFace = face === 0 ? 1 : 0;
          const facadeSeed = candidateIndex * 4 + face + 1;
          facadeDoorFaceAttribute.setX(renderedFacades, doorFace);
          facadeFloorCountAttribute.setX(renderedFacades, recipe.floorCount);
          facadeSeedAttribute.setX(renderedFacades, facadeSeed);
          windowDoorFaceAttribute.setX(renderedFacades, doorFace);
          windowFloorCountAttribute.setX(renderedFacades, recipe.floorCount);
          windowSeedAttribute.setX(renderedFacades, facadeSeed);
          renderedFacades += 1;
        }
        nightLighting.windowCount +=
          recipe.floorCount *
          (Math.max(1, Math.floor(recipe.width / 1.45 + 0.5)) * 2 +
            Math.max(1, Math.floor(recipe.depth / 1.45 + 0.5)) * 2);

        for (let stopIndex = 0; stopIndex < stops.length - 1; stopIndex += 1) {
          const lower = stops[stopIndex];
          const upper = stops[stopIndex + 1];
          setBox(
            stairs,
            renderedStairs++,
            recipe,
            0,
            lower.y,
            -Math.min(0.75, recipe.depth * 0.14),
            stairWidth,
            upper.y - lower.y,
            stairDepth,
          );
        }

        if (stops.length > 1) {
          const columnOffset = Math.min(0.62, Math.max(0.35, recipe.width * 0.16));
          const landingZ = -Math.min(0.72, recipe.depth * 0.15);
          const upPosition = buildingLocalToWorld(recipe, -columnOffset, landingZ);
          const downPosition = buildingLocalToWorld(recipe, columnOffset, landingZ);
          const targetY = stops[0].y + 1.05;
          targets.push(
            {
              id: `${recipe.id}:stairs:up`,
              kind: "traversal",
              action: "traverse",
              name: `${recipe.displayName} stairs`,
              position: new THREE.Vector3(upPosition.x, targetY, upPosition.z),
              root,
              maxDistance: 2.55,
              hitsRequired: 1,
              hits: 0,
              traversal: {
                direction: 1,
                stops,
                destinationX: downPosition.x,
                destinationZ: downPosition.z,
              },
            },
            {
              id: `${recipe.id}:stairs:down`,
              kind: "traversal",
              action: "traverse",
              name: `${recipe.displayName} stairs`,
              position: new THREE.Vector3(downPosition.x, targetY, downPosition.z),
              root,
              maxDistance: 2.55,
              hitsRequired: 1,
              hits: 0,
              traversal: {
                direction: -1,
                stops,
                destinationX: upPosition.x,
                destinationZ: upPosition.z,
              },
            },
          );
        }
      }

      finalize(shells, renderedShells, shellGeometry, shellMaterial);
      if (finalize(floors, renderedFloors, floorGeometry, floorMaterial)) {
        interiorDetails.push(floors);
      }
      finalize(doors, renderedDoors, doorGeometry, doorMaterial);
      if (finalize(stairs, renderedStairs, stairGeometry, stairMaterial)) {
        interiorDetails.push(stairs);
      }
      if (finalize(facades, renderedFacades, facadeGeometry, facadeMaterial)) {
        facadeDoorFaceAttribute.needsUpdate = true;
        facadeFloorCountAttribute.needsUpdate = true;
        facadeSeedAttribute.needsUpdate = true;
      }
      if (finalize(windows, renderedFacades, windowGeometry, windowMaterial)) {
        windowDoorFaceAttribute.needsUpdate = true;
        windowFloorCountAttribute.needsUpdate = true;
        windowSeedAttribute.needsUpdate = true;
        nightLighting.windowMeshes.push(windows);
      }
      this.addSettlementMarker(
        root,
        settlement,
        centerX,
        centerZ,
        colliders,
        nightLighting,
      );
    }
  }

  private addSettlementMarker(
    root: THREE.Group,
    settlement: Settlement,
    centerX: number,
    centerZ: number,
    colliders: PlanarCollider[],
    nightLighting: ChunkNightLighting,
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
    const baseIntensity =
      settlement.tier === "megacity"
        ? 900
        : settlement.tier === "city"
          ? 460
          : settlement.tier === "town"
            ? 190
            : 80;
    const range =
      settlement.tier === "megacity"
        ? 380
        : settlement.tier === "city"
          ? 220
          : settlement.tier === "town"
            ? 120
            : 72;
    const areaLight = new THREE.PointLight(0xffbd75, 0, range, 1.65);
    areaLight.name = `settlement-night-light:${settlement.id}`;
    areaLight.position.set(
      settlement.x,
      sampleTerrainHeight(settlement.x, settlement.z) + Math.min(18, height * 0.32),
      settlement.z,
    );
    areaLight.castShadow = false;
    root.add(areaLight);
    nightLighting.areaLights.push({ light: areaLight, baseIntensity });
    colliders.push({
      shape: "box",
      id: `landmark:${settlement.id}`,
      x: settlement.x,
      z: settlement.z,
      halfWidth: settlement.tier === "megacity" ? 9 : 4,
      halfDepth: 4,
      rotation: 0,
    });
  }

  private applyNightLighting(nightLighting: ChunkNightLighting) {
    const strength = this.nightLightingStrength;
    for (const mesh of nightLighting.windowMeshes) {
      mesh.visible = true;
      const material = mesh.material;
      if (
        material instanceof THREE.ShaderMaterial &&
        material.uniforms.uNight
      ) {
        material.uniforms.uNight.value = strength;
      }
    }
    for (const { light, baseIntensity } of nightLighting.areaLights) {
      light.intensity = baseIntensity * strength;
      light.visible = strength > 0.015;
    }
  }

  private addRockField(
    root: THREE.Group,
    centerX: number,
    centerZ: number,
    key: string,
    density: number,
    colliders: PlanarCollider[],
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
    let renderedCount = 0;
    for (let index = 0; index < count; index += 1) {
      const size = randomRange(random, 0.35, 1.75);
      const scaleX = size * randomRange(random, 0.72, 1.18);
      const scaleZ = size * 0.72;
      const colliderRadius = Math.max(scaleX, size, scaleZ);
      const placement = this.findSolidPlacement(
        random,
        centerX,
        centerZ,
        key,
        colliderRadius,
        colliders,
      );
      if (!placement) continue;
      const { x, z } = placement;
      position.set(x, sampleTerrainHeight(x, z) + size * 0.42, z);
      quaternion.setFromEuler(new THREE.Euler(random() * 2, random() * Math.PI, random()));
      scale.set(scaleX, size, scaleZ);
      matrix.compose(position, quaternion, scale);
      rocks.setMatrixAt(renderedCount, matrix);
      colliders.push({
        shape: "circle",
        id: `scenery-rock:${key}:${renderedCount}`,
        x,
        z,
        radius: colliderRadius,
      });
      renderedCount += 1;
    }
    rocks.count = renderedCount;
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
    colliders: PlanarCollider[],
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
    let renderedCount = 0;
    for (let index = 0; index < count; index += 1) {
      const size = randomRange(random, 0.78, 1.38);
      const colliderRadius = 0.42 * size;
      const placement = this.findSolidPlacement(
        random,
        centerX,
        centerZ,
        key,
        colliderRadius,
        colliders,
        CHUNK_SIZE * 0.46,
      );
      if (!placement) continue;
      const { x, z } = placement;
      const baseY = sampleTerrainHeight(x, z);
      quaternion.setFromEuler(new THREE.Euler(0, random() * Math.PI * 2, 0));
      scale.set(size, size, size);
      position.set(x, baseY + 1.8 * size, z);
      matrix.compose(position, quaternion, scale);
      trunks.setMatrixAt(renderedCount, matrix);
      position.set(x, baseY + 5.0 * size, z);
      matrix.compose(position, quaternion, scale);
      canopies.setMatrixAt(renderedCount, matrix);
      colliders.push({
        shape: "circle",
        id: `scenery-tree:${key}:${renderedCount}`,
        x,
        z,
        radius: colliderRadius,
      });
      renderedCount += 1;
    }
    trunks.count = renderedCount;
    canopies.count = renderedCount;
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
    colliders: PlanarCollider[],
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
    let renderedCount = 0;
    for (let index = 0; index < count; index += 1) {
      const heightScale = randomRange(random, 0.58, 1.35);
      const depthScale = randomRange(random, 0.72, 1.1);
      const rotation = randomRange(random, -0.35, 0.35);
      const colliderRadius = Math.hypot(0.325, 1.1 * depthScale);
      const placement = this.findSolidPlacement(
        random,
        centerX,
        centerZ,
        key,
        colliderRadius,
        colliders,
        32,
      );
      if (!placement) continue;
      const { x, z } = placement;
      position.set(x, sampleTerrainHeight(x, z) + 2.25 * heightScale, z);
      quaternion.setFromEuler(new THREE.Euler(0, rotation, 0));
      scale.set(1, heightScale, depthScale);
      matrix.compose(position, quaternion, scale);
      ruins.setMatrixAt(renderedCount, matrix);
      colliders.push({
        shape: "box",
        id: `ruin:${key}:${renderedCount}`,
        x,
        z,
        halfWidth: 0.325,
        halfDepth: 1.1 * depthScale,
        rotation,
      });
      renderedCount += 1;
    }
    ruins.count = renderedCount;
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
    colliders: PlanarCollider[],
    targets: WorldTarget[],
  ) {
    const pickupRandom = seededRandom(`${WORLD_SEED}:chunk:${key}:pickups:v1`);
    const pickupPlacement = key === "0:0"
      ? { x: 2.3, z: 5.4 }
      : this.findSolidPlacement(
          pickupRandom,
          centerX,
          centerZ,
          key,
          0.65,
          colliders,
          35,
        );
    const pickupId = `pickup:${primaryResource}:v1:${key}:0`;
    if (pickupPlacement) {
      this.registerGatherable(
        root,
        targets,
        colliders,
        this.createPickup(pickupId, pickupPlacement.x, pickupPlacement.z, primaryResource),
      );
    }

    if (rockDensity > 0.28) {
      const rockRandom = seededRandom(`${WORLD_SEED}:chunk:${key}:resource-rock:v1`);
      const placement = key === "0:0"
        ? { x: 4.2, z: 0.8 }
        : this.findSolidPlacement(
            rockRandom,
            centerX,
            centerZ,
            key,
            1.56,
            colliders,
            34,
          );
      const item: ItemId = primaryResource === "ore" ? "ore" : "stone";
      if (placement) {
        this.registerGatherable(
          root,
          targets,
          colliders,
          this.createRockResource(
            `resource:rock:v1:${key}:0`,
            placement.x,
            placement.z,
            item,
          ),
        );
      }
    }

    if (treeDensity > 0.15) {
      const treeRandom = seededRandom(`${WORLD_SEED}:chunk:${key}:resource-tree:v1`);
      const placement = key === "0:0"
        ? { x: -3.2, z: -0.4 }
        : this.findSolidPlacement(
            treeRandom,
            centerX,
            centerZ,
            key,
            0.58,
            colliders,
            34,
          );
      if (placement) {
        this.registerGatherable(
          root,
          targets,
          colliders,
          this.createTreeResource(
            `resource:tree:v1:${key}:0`,
            placement.x,
            placement.z,
          ),
        );
      }
    }
  }

  private registerGatherable(
    root: THREE.Group,
    targets: WorldTarget[],
    colliders: PlanarCollider[],
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
        shape: "circle",
        id: target.id,
        x: target.root.position.x,
        z: target.root.position.z,
        radius: target.item === "wood" ? 0.58 : 1.56,
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
      if (object instanceof THREE.InstancedMesh) object.dispose();
      if (object.geometry.userData.chunkManagerShared !== true) {
        object.geometry.dispose();
      }
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material.userData.chunkManagerShared !== true) material.dispose();
      }
    });
  }
}
