import * as THREE from "three";
import {
  BEACONS,
  CHUNK_SEGMENTS,
  CHUNK_SIZE,
  CROUCH_HEIGHT,
  GAMEPLAY_CHUNK_RADIUS,
  PLAYER_HEIGHT,
  WORLD_CHUNK_LOAD_RADIUS,
  WORLD_SEED,
  qualityUsesHighDetail,
  qualityUsesShadows,
  type BeaconId,
  type QualityLevel,
} from "../config";
import type { EntityDiff } from "../gameplay/interactions";
import type { EnvironmentVisualState } from "../environment";
import type { ItemId } from "../gameplay/items";
import type { CraftingStationKind } from "../gameplay/crafting";
import type { ScanCandidate } from "../gameplay/fieldGuide";
import type { ContainerState, ContainerStates, LootTableId } from "../gameplay/loot";
import type { RestSiteDefinition } from "../gameplay/resting";
import { updateAuthoredNpcTarget } from "../npcs/authoredNpc";
import { randomRange, seededRandom } from "../core/random";
import {
  PlanarCollisionIndex,
  colliderIntersectsVerticalRange,
  isColliderLineOfSightClear,
  isPlanarPositionClear,
  isTerrainLineOfSightClear,
  type PlanarCollider,
  type SpatialPosition,
} from "../systems/collision";
import type { AuthoredDoorRuntime } from "./authoredDoor";
import {
  INSPECTABLES,
  createInspectableTarget,
  type InspectionRecord,
} from "./inspectables";
import {
  WATER_LEVEL,
  WORLD_MODEL_SCALE,
  riverCenterX,
  riverWidth,
  sampleClimate,
  settlementInfluence,
  settlementsNear,
  type BiomeId,
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
import {
  SPAWN_BUILDING,
  createSpawnBuilding,
  spawnBuildingSupportCandidates,
} from "./spawnBuilding";
import {
  TWO_STORY_BUILDING,
  createTwoStoryBuilding,
  selectWalkableSupport,
  twoStorySupportCandidates,
} from "./twoStoryBuilding";
import {
  TEN_STORY_BUILDING,
  createTenStoryBuilding,
  tenStorySupportCandidates,
} from "./tenStoryBuilding";
import {
  applyPlacedRuntimeLighting,
  createPlacedRuntime,
  nearbyCampModifiers,
  normalizePlacedEntities,
  type PlacedEntity,
  type PlacedRuntime,
} from "./deployments";
import { createSpawnGameplayFeatures } from "./spawnFeatures";
import {
  VEGETATION_PROFILES,
  createGroundcoverGeometry,
  createWoodyGeometry,
  groundcoverCount,
  selectWoodySpecies,
  vegetationMaterial,
  type GroundcoverKind,
  type WoodySpeciesDefinition,
} from "./vegetation";
import { WaterSurfaceRuntime } from "./WaterSurface";
import {
  proceduralSurfaceColor,
  terrainSurfaceColor,
} from "./surfaceVariation";

export type WorldTargetKind =
  | "beacon"
  | "pickup"
  | "resource"
  | "door"
  | "inspectable"
  | "station"
  | "container"
  | "rest"
  | "npc"
  | "scannable"
  | "animal";
export type WorldTargetAction =
  | "scan"
  | "collect"
  | "harvest"
  | "toggle"
  | "inspect"
  | "craft"
  | "loot"
  | "rest"
  | "talk";

export interface InstancedTargetVisual {
  mesh: THREE.InstancedMesh;
  index: number;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  groundY: number;
}

export interface WorldTarget {
  id: string;
  kind: WorldTargetKind;
  action: WorldTargetAction;
  name: string;
  position: THREE.Vector3;
  root: THREE.Group;
  maxDistance: number;
  /** Horizontal interaction volume used for forgiving resource selection. */
  interactionRadius?: number;
  hitsRequired: number;
  hits: number;
  /** Per-instance handles keep procedural resources batched into a few draw calls. */
  instanceVisuals?: readonly InstancedTargetVisual[];
  item?: ItemId;
  yieldAmount?: number;
  beaconId?: BeaconId;
  code?: string;
  note?: string;
  doorId?: string;
  open?: boolean;
  inspection?: InspectionRecord;
  fieldGuideId?: string;
  stationId?: string;
  stationKind?: CraftingStationKind;
  containerId?: string;
  lootTableId?: LootTableId;
  empty?: boolean;
  restSite?: RestSiteDefinition;
  npcId?: string;
}

export interface WorldLineOfSightOptions {
  ignoredColliderIds?: readonly string[];
  maxVerticalDelta?: number;
  checkTerrain?: boolean;
  requireSameSupport?: boolean;
  supportTolerance?: number;
}

interface ChunkRuntime {
  key: string;
  chunkX: number;
  chunkZ: number;
  root: THREE.Group;
  colliders: PlanarCollider[];
  targets: WorldTarget[];
  doors: AuthoredDoorRuntime[];
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

const GROUNDCOVER_GUIDE: Readonly<Record<GroundcoverKind, { id: string; name: string }>> = {
  reeds: { id: "guide:flora:river-reed:v1", name: "Greywater reed" },
  ferns: { id: "guide:flora:sable-fern:v1", name: "Sablewood fern" },
  heather: { id: "guide:flora:crown-heather:v1", name: "Crown heather" },
  sage: { id: "guide:flora:steppe-sage:v1", name: "Warden sage" },
  succulents: { id: "guide:flora:badland-succulent:v1", name: "Glassland succulent" },
  dune_grass: { id: "guide:flora:coast-dunegrass:v1", name: "Salt dunegrass" },
  meadow: { id: "guide:flora:meadow-grass:v1", name: "Grey meadow grass" },
};

const OPENING_RESERVATIONS = [
  { x: 0, z: 8, radius: 4.5 },
  { x: 2.3, z: 5.4, radius: 1.1 },
  { x: 4.2, z: 0.8, radius: 2.4 },
  { x: -3.2, z: -0.4, radius: 1.45 },
  {
    x: SPAWN_BUILDING.x,
    z: SPAWN_BUILDING.z,
    radius: SPAWN_BUILDING.clearanceRadius,
  },
  {
    x: TWO_STORY_BUILDING.x,
    z: TWO_STORY_BUILDING.z,
    radius: TWO_STORY_BUILDING.clearanceRadius,
  },
  {
    x: TEN_STORY_BUILDING.x,
    z: TEN_STORY_BUILDING.z,
    radius: TEN_STORY_BUILDING.clearanceRadius,
  },
] as const;

function targetDiff(
  worldDiffs: Readonly<Record<string, EntityDiff>>,
  id: string,
): EntityDiff {
  return worldDiffs[id] ?? { hits: 0, removed: false };
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
  private nightLightingStrength = 0;
  private worldMinutes = 450;
  private placedRecords: PlacedEntity[] = [];
  private placedRuntime: PlacedRuntime;
  private placedLightFocusX = 0;
  private placedLightFocusZ = 0;
  private disposed = false;
  private readonly waterSurface: WaterSurfaceRuntime;
  private readonly sharedMaterials: Set<THREE.Material>;

  constructor(
    private readonly scene: THREE.Scene,
    private quality: QualityLevel,
    private readonly worldDiffs: Record<string, EntityDiff> = {},
    private readonly doorStates: Record<string, boolean> = {},
    private containerStates: ContainerStates = {},
    placedEntities: readonly PlacedEntity[] = [],
  ) {
    this.waterSurface = new WaterSurfaceRuntime(this.quality);
    this.sharedMaterials = new Set([this.waterSurface.material]);
    this.placedRecords = normalizePlacedEntities(placedEntities);
    this.placedRuntime = createPlacedRuntime(this.placedRecords, this.quality);
    this.scene.add(this.placedRuntime.root);
  }

  update(playerX: number, playerZ: number) {
    if (this.disposed) return false;
    if (
      Math.hypot(
        playerX - this.placedLightFocusX,
        playerZ - this.placedLightFocusZ,
      ) >= 2
    ) {
      this.placedLightFocusX = playerX;
      this.placedLightFocusZ = playerZ;
      this.applyPlacedLighting();
    }
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
    this.waterSurface.setQuality(quality);
    const roots = [
      ...[...this.loaded.values()].map((chunk) => chunk.root),
      this.placedRuntime.root,
    ];
    for (const root of roots) {
      root.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh) {
          object.castShadow = qualityUsesShadows(quality) && object.userData.shadow !== false;
          if (
            object instanceof THREE.InstancedMesh &&
            object.userData.vegetationLayer === "decorative"
          ) {
            const storedHighDetailCount = Number(object.userData.highDetailCount);
            const storedPerformanceCount = Number(object.userData.performanceCount);
            const highDetailCount = Number.isFinite(storedHighDetailCount)
              ? storedHighDetailCount
              : object.count;
            const performanceCount = Number.isFinite(storedPerformanceCount)
              ? storedPerformanceCount
              : object.count;
            object.count = qualityUsesHighDetail(quality)
              ? highDetailCount
              : performanceCount;
          }
        }
      });
    }
    this.applyPlacedLighting();
  }

  presentEnvironment(state: Readonly<EnvironmentVisualState>) {
    this.waterSurface.present(state);
  }

  setWorldMinutes(totalMinutes: number) {
    if (!Number.isFinite(totalMinutes)) return;
    this.worldMinutes = Math.max(0, totalMinutes);
    for (const chunk of this.loaded.values()) {
      for (const target of chunk.targets) {
        if (target.kind === "npc") updateAuthoredNpcTarget(target, this.worldMinutes);
      }
    }
  }

  setContainerStates(states: Readonly<ContainerStates>) {
    this.containerStates = Object.fromEntries(
      Object.entries(states).map(([id, state]) => [id, {
        opened: state.opened,
        looted: state.looted,
        remaining: { ...state.remaining },
      }]),
    );
    for (const chunk of this.loaded.values()) {
      for (const target of chunk.targets) {
        if (!target.containerId) continue;
        const state = this.containerStates[target.containerId];
        target.empty = Boolean(state && Object.keys(state.remaining).length === 0);
        this.applyContainerAppearance(target, state);
      }
    }
    this.refreshCaches();
  }

  setPlacedEntities(records: readonly PlacedEntity[]) {
    if (this.disposed) return;
    this.disposeObjectTree(this.placedRuntime.root);
    this.placedRecords = normalizePlacedEntities(records);
    this.placedRuntime = createPlacedRuntime(this.placedRecords, this.quality);
    this.scene.add(this.placedRuntime.root);
    this.applyPlacedLighting();
    this.refreshCaches();
  }

  get placedEntities() {
    return this.placedRecords.map((record) => ({ ...record }));
  }

  get scanCandidates(): ScanCandidate[] {
    return this.targetCache
      .filter((target) => Boolean(target.fieldGuideId))
      .map((target) => ({
        id: target.id,
        entryId: target.fieldGuideId!,
        name: target.name,
        position: {
          x: target.position.x,
          y: target.position.y,
          z: target.position.z,
        },
        maxDistance: Math.max(18, target.maxDistance),
      }));
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
    this.applyPlacedLighting();
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
    this.applyTargetVisualState(target, diff);
    if (diff.removed) {
      for (const chunk of this.loaded.values()) {
        chunk.colliders = chunk.colliders.filter((collider) => collider.id !== id);
      }
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
    minY?: number,
    maxY?: number,
  ) {
    const candidates = this.collisionIndex.querySweep(current, desired, radius);
    if (minY === undefined && maxY === undefined) return candidates;
    return candidates.filter((collider) =>
      colliderIntersectsVerticalRange(
        collider,
        minY ?? Number.NEGATIVE_INFINITY,
        maxY ?? Number.POSITIVE_INFINITY,
      ),
    );
  }

  hasLineOfSight(
    origin: Readonly<SpatialPosition>,
    target: Readonly<SpatialPosition>,
    options: Readonly<WorldLineOfSightOptions> = {},
  ) {
    if (this.disposed) return false;
    const maxVerticalDelta = options.maxVerticalDelta ?? Infinity;
    if (
      Number.isNaN(maxVerticalDelta) ||
      maxVerticalDelta < 0 ||
      Math.abs(target.y - origin.y) > maxVerticalDelta
    ) {
      return false;
    }
    if (options.requireSameSupport) {
      const tolerance = options.supportTolerance ?? 0.85;
      if (!Number.isFinite(tolerance) || tolerance < 0) return false;
      const originSupport = this.sampleGroundHeight(origin.x, origin.z, origin.y);
      const targetSupport = this.sampleGroundHeight(target.x, target.z, target.y);
      if (Math.abs(targetSupport - originSupport) > tolerance) return false;
    }
    const candidates = this.collisionIndex.querySweep(origin, target, 0);
    if (!isColliderLineOfSightClear(
      origin,
      target,
      candidates,
      new Set(options.ignoredColliderIds ?? []),
    )) {
      return false;
    }
    return options.checkTerrain === false || isTerrainLineOfSightClear(
      origin,
      target,
      sampleTerrainHeight,
    );
  }

  get targets() {
    return this.targetCache;
  }

  get loadedCount() {
    return this.loaded.size;
  }

  get doorsSnapshot() {
    return [...this.loaded.values()].flatMap((chunk) =>
      chunk.doors.map((door) => ({ id: door.id, open: door.isOpen })),
    );
  }

  sampleGroundHeight(x: number, z: number, referenceY?: number) {
    const supports = [
      ...spawnBuildingSupportCandidates(x, z),
      ...twoStorySupportCandidates(x, z),
      ...tenStorySupportCandidates(x, z),
    ];
    return selectWalkableSupport(supports, referenceY) ?? sampleTerrainHeight(x, z);
  }

  canStandAt(x: number, z: number, feetY: number, radius: number) {
    const position = { x, z };
    const blockers = this.queryColliders(
      position,
      position,
      radius,
      feetY + CROUCH_HEIGHT,
      feetY + PLAYER_HEIGHT,
    );
    return isPlanarPositionClear(position, blockers, radius);
  }

  isShelteredAt(x: number, z: number, feetY: number) {
    const overheadSupports = [
      ...spawnBuildingSupportCandidates(x, z),
      ...twoStorySupportCandidates(x, z),
      ...tenStorySupportCandidates(x, z),
    ];
    if (overheadSupports.some((height) => height > feetY + PLAYER_HEIGHT * 0.72)) {
      return true;
    }
    return nearbyCampModifiers(this.placedRecords, x, z, feetY).sheltered;
  }

  restorePersistentState(
    worldDiffs: Readonly<Record<string, EntityDiff>>,
    doorStates: Readonly<Record<string, boolean>>,
    scanned: readonly BeaconId[],
    playerX: number,
    playerZ: number,
    containerStates: Readonly<ContainerStates> = this.containerStates,
    placedEntities: readonly PlacedEntity[] = this.placedRecords,
  ) {
    for (const key of Object.keys(this.worldDiffs)) delete this.worldDiffs[key];
    Object.assign(this.worldDiffs, worldDiffs);
    for (const key of Object.keys(this.doorStates)) delete this.doorStates[key];
    Object.assign(this.doorStates, doorStates);
    this.setContainerStates(containerStates);
    this.setPlacedEntities(placedEntities);
    this.scanned = new Set(scanned);
    for (const chunk of this.loaded.values()) this.disposeChunk(chunk);
    this.loaded.clear();
    this.activeChunkKey = "";
    this.update(playerX, playerZ);
    for (const beaconId of scanned) this.markScanned(beaconId);
  }

  toggleDoor(
    id: string,
    playerPosition: { x: number; y: number; z: number },
    playerRadius: number,
  ): "opened" | "closed" | "blocked" | null {
    for (const chunk of this.loaded.values()) {
      const door = chunk.doors.find((candidate) => candidate.id === id);
      if (!door) continue;
      const nextOpen = !door.isOpen;
      if (!nextOpen) {
        const closedCollider = door.colliderFor(false);
        const verticallyOverlapping = colliderIntersectsVerticalRange(
          closedCollider,
          playerPosition.y,
          playerPosition.y + PLAYER_HEIGHT,
        );
        if (
          verticallyOverlapping &&
          !isPlanarPositionClear(playerPosition, [closedCollider], playerRadius)
        ) {
          return "blocked";
        }
      }
      door.setOpen(nextOpen);
      this.doorStates[id] = nextOpen;
      const target = chunk.targets.find((candidate) => candidate.doorId === id);
      if (target) target.open = nextOpen;
      this.refreshCaches();
      return nextOpen ? "opened" : "closed";
    }
    return null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const chunk of this.loaded.values()) this.disposeChunk(chunk);
    this.loaded.clear();
    this.disposeObjectTree(this.placedRuntime.root);
    this.placedRuntime = {
      root: new THREE.Group(),
      targets: [],
      colliders: [],
      lights: [],
    };
    this.placedRecords = [];
    this.waterSurface.dispose();
    this.refreshCaches();
  }

  private refreshCaches() {
    if (this.disposed) {
      this.colliderCache = [];
      this.targetCache = [];
      this.collisionIndex.rebuild([]);
      return;
    }
    const simulationChunks = [...this.loaded.values()].filter(
      (chunk) =>
        Math.abs(chunk.chunkX - this.activeChunkX) <= GAMEPLAY_CHUNK_RADIUS &&
        Math.abs(chunk.chunkZ - this.activeChunkZ) <= GAMEPLAY_CHUNK_RADIUS,
    );
    const nearbyPlacedColliders = this.placedRuntime.colliders.filter((collider) => {
      const chunk = worldToChunk(collider.x, collider.z);
      return (
        Math.abs(chunk.x - this.activeChunkX) <= GAMEPLAY_CHUNK_RADIUS &&
        Math.abs(chunk.z - this.activeChunkZ) <= GAMEPLAY_CHUNK_RADIUS
      );
    });
    const nearbyPlacedTargets = this.placedRuntime.targets.filter((target) => {
      const chunk = worldToChunk(target.position.x, target.position.z);
      return (
        Math.abs(chunk.x - this.activeChunkX) <= GAMEPLAY_CHUNK_RADIUS &&
        Math.abs(chunk.z - this.activeChunkZ) <= GAMEPLAY_CHUNK_RADIUS
      );
    });
    this.colliderCache = [
      ...simulationChunks.flatMap((chunk) => chunk.colliders),
      ...nearbyPlacedColliders,
    ];
    this.collisionIndex.rebuild(this.colliderCache);
    this.targetCache = [
      ...simulationChunks.flatMap((chunk) =>
        chunk.targets.filter((target) => !this.worldDiffs[target.id]?.removed),
      ),
      ...nearbyPlacedTargets,
    ];
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
    const terrainColors = new Float32Array(terrainPositions.count * 3);
    const terrainColor = new THREE.Color();
    for (let index = 0; index < terrainPositions.count; index += 1) {
      const worldX = center.x + terrainPositions.getX(index);
      const worldZ = center.z + terrainPositions.getZ(index);
      const height = sampleTerrainHeight(worldX, worldZ);
      terrainPositions.setY(index, height);
      terrainSurfaceColor(terrainColor, worldX, worldZ, height).toArray(
        terrainColors,
        index * 3,
      );
    }
    terrainGeometry.setAttribute("color", new THREE.BufferAttribute(terrainColors, 3));
    terrainGeometry.computeVertexNormals();

    const terrainMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.96,
      metalness: 0.02,
      flatShading: true,
      vertexColors: true,
    });
    const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
    terrain.name = `terrain:${key}`;
    terrain.position.set(center.x, 0, center.z);
    terrain.receiveShadow = true;
    terrain.userData.shadow = false;
    root.add(terrain);

    const colliders: PlanarCollider[] = [];
    const targets: WorldTarget[] = [];
    const doors: AuthoredDoorRuntime[] = [];
    this.addWater(root, center.x, center.z);
    this.addRoads(root, center.x, center.z, key);
    if (key === SPAWN_BUILDING.chunkKey) {
      const authoredBuildings = [
        createSpawnBuilding(
          this.quality,
          this.doorStates[SPAWN_BUILDING.doorId] ?? false,
        ),
        createTwoStoryBuilding(
          this.quality,
          this.doorStates[TWO_STORY_BUILDING.doorId] ?? false,
        ),
        createTenStoryBuilding(
          this.quality,
          this.doorStates[TEN_STORY_BUILDING.doorId] ?? false,
        ),
      ];
      for (const building of authoredBuildings) {
        root.add(building.root);
        colliders.push(...building.colliders);
        doors.push(...building.doors);
        for (const door of building.doors) targets.push(this.createDoorTarget(door));
      }
      for (const definition of INSPECTABLES) {
        const target = createInspectableTarget(definition, this.quality);
        root.add(target.root);
        targets.push(target);
      }
      const gameplayFeatures = createSpawnGameplayFeatures(
        this.quality,
        this.worldMinutes,
        this.containerStates,
      );
      root.add(gameplayFeatures.root);
      colliders.push(...gameplayFeatures.colliders);
      targets.push(...gameplayFeatures.targets);
    }
    this.addSettlementBuildings(
      root,
      center.x,
      center.z,
      key,
      colliders,
      nightLighting,
    );
    this.addRockField(
      root,
      center.x,
      center.z,
      key,
      climate.biome.rockDensity,
      climate.biome.primaryResource,
      colliders,
      targets,
    );
    this.addVegetation(
      root,
      center.x,
      center.z,
      key,
      climate.biome.id,
      climate.biome.treeDensity,
      colliders,
      targets,
    );
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

    // Procedural placement always sees the complete deterministic collider set,
    // including saved depleted resources. Prune only after generation so a
    // removed tree or rock can never reshuffle its neighbors on reload.
    for (let index = colliders.length - 1; index >= 0; index -= 1) {
      if (this.worldDiffs[colliders[index].id]?.removed) colliders.splice(index, 1);
    }
    for (const target of targets) {
      if (target.containerId) {
        this.applyContainerAppearance(target, this.containerStates[target.containerId]);
      }
    }

    this.scene.add(root);
    const runtime = {
      key,
      chunkX,
      chunkZ,
      root,
      colliders,
      targets,
      doors,
      nightLighting,
    };
    this.loaded.set(key, runtime);
    this.applyNightLighting(nightLighting);
  }

  private createDoorTarget(door: AuthoredDoorRuntime): WorldTarget {
    return {
      id: door.id,
      kind: "door",
      action: "toggle",
      name: door.name,
      position: door.targetPosition.clone(),
      root: door.pivot,
      maxDistance: 4.25,
      hitsRequired: 0,
      hits: 0,
      doorId: door.id,
      open: door.isOpen,
    };
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
      const river = new THREE.Mesh(geometry, this.waterSurface.material);
      river.name = "greywater-river";
      river.receiveShadow = true;
      river.userData.shadow = false;
      this.waterSurface.bind(river, "river");
      root.add(river);
    }

    const coastStart = 4_900 * WORLD_MODEL_SCALE;
    if (centerZ + half > coastStart) {
      const depth = Math.min(CHUNK_SIZE, centerZ + half - coastStart);
      const geometry = new THREE.PlaneGeometry(CHUNK_SIZE, depth);
      geometry.rotateX(-Math.PI / 2);
      const sea = new THREE.Mesh(geometry, this.waterSurface.material);
      sea.name = "salt-coast-water";
      sea.position.set(centerX, WATER_LEVEL, centerZ + half - depth / 2);
      sea.userData.shadow = false;
      this.waterSurface.bind(sea, "sea");
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
      roads.setColorAt(
        index,
        proceduralSurfaceColor(
          color,
          recipe.kind === "street" ? 0x3d3c36 : 0x4a4338,
          "road",
          recipe.x,
          recipe.z,
        ),
      );
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
    nightLighting: ChunkNightLighting,
  ) {
    const nearby = settlementsNear(centerX, centerZ, CHUNK_SIZE * 0.72);
    for (const settlement of nearby) {
      const spec = SETTLEMENT_BUILDINGS[settlement.tier];
      const influence = Math.max(0.08, settlementInfluence(settlement, centerX, centerZ));
      const count = Math.max(2, Math.floor(spec.count * (0.35 + influence * 0.65)));
      const random = seededRandom(`${WORLD_SEED}:chunk:${key}:settlement:${settlement.id}:v1`);
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.78,
        metalness: settlement.tier === "megacity" ? 0.22 : 0.08,
        vertexColors: true,
      });
      const buildings = new THREE.InstancedMesh(geometry, material, count);
      buildings.name = `settlement:${settlement.id}:${key}`;
      buildings.castShadow = qualityUsesShadows(this.quality);
      buildings.receiveShadow = true;
      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion();
      const position = new THREE.Vector3();
      const scale = new THREE.Vector3();
      const facadeColor = new THREE.Color();
      const maxWindowBands =
        settlement.tier === "megacity"
          ? 5
          : settlement.tier === "city"
            ? 4
            : settlement.tier === "town"
              ? 2
              : 1;
      const windowGeometry = new THREE.PlaneGeometry(1, 1);
      const windowMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const windows = new THREE.InstancedMesh(
        windowGeometry,
        windowMaterial,
        count * maxWindowBands * 4,
      );
      windows.name = `city-windows:${settlement.id}:${key}`;
      windows.castShadow = false;
      windows.receiveShadow = false;
      windows.userData.shadow = false;
      windows.visible = false;
      windows.renderOrder = 3;
      const windowRandom = seededRandom(
        `${WORLD_SEED}:chunk:${key}:settlement:${settlement.id}:windows:v1`,
      );
      const windowMatrix = new THREE.Matrix4();
      const windowQuaternion = new THREE.Quaternion();
      const windowPosition = new THREE.Vector3();
      const windowScale = new THREE.Vector3();
      const windowColor = new THREE.Color();
      const windowPalette = [0xffc36f, 0xffdfa0, 0xa9cccf, 0xe8b87c] as const;
      const occupiedChance =
        settlement.tier === "megacity"
          ? 0.72
          : settlement.tier === "city"
            ? 0.64
            : settlement.tier === "town"
              ? 0.54
              : 0.42;
      let renderedCount = 0;
      let renderedWindows = 0;

      for (let index = 0; index < count; index += 1) {
        const width = randomRange(random, 4.5, settlement.tier === "megacity" ? 14 : 9);
        const depth = randomRange(random, 4.2, settlement.tier === "megacity" ? 13 : 8);
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
        if (!placement) continue;
        const { x, z } = placement;
        const radial = settlementInfluence(settlement, x, z);
        const height = randomRange(random, 3.5, Math.max(5, spec.height * (0.18 + radial * 0.82)));
        const rotation = Math.round(random() * 3) * Math.PI * 0.5;
        const groundY = sampleTerrainHeight(x, z);
        position.set(x, groundY + height / 2, z);
        quaternion.setFromEuler(new THREE.Euler(0, rotation, 0));
        scale.set(width, height, depth);
        matrix.compose(position, quaternion, scale);
        buildings.setMatrixAt(renderedCount, matrix);
        buildings.setColorAt(
          renderedCount,
          proceduralSurfaceColor(
            facadeColor,
            spec.color,
            "building",
            x,
            z,
          ),
        );
        colliders.push({
          shape: "box",
          id: `building:${settlement.id}:${key}:${renderedCount}`,
          x,
          z,
          halfWidth: width * 0.5,
          halfDepth: depth * 0.5,
          rotation,
        });

        const bandCount = Math.min(
          maxWindowBands,
          Math.max(1, Math.floor(height / 7)),
        );
        const stripHeight = THREE.MathUtils.clamp(height * 0.035, 0.22, 0.52);
        for (let band = 0; band < bandCount; band += 1) {
          const windowY = groundY + (height * (band + 1)) / (bandCount + 1);
          for (let face = 0; face < 4; face += 1) {
            if (windowRandom() > occupiedChance) continue;
            const faceRotation = rotation + face * Math.PI * 0.5;
            const usesDepth = face % 2 === 0;
            const offset = (usesDepth ? depth : width) * 0.5 + 0.025;
            const facadeWidth = usesDepth ? width : depth;
            windowPosition.set(
              x + Math.sin(faceRotation) * offset,
              windowY,
              z + Math.cos(faceRotation) * offset,
            );
            windowQuaternion.setFromEuler(new THREE.Euler(0, faceRotation, 0));
            windowScale.set(
              facadeWidth * randomRange(windowRandom, 0.42, 0.72),
              stripHeight,
              1,
            );
            windowMatrix.compose(windowPosition, windowQuaternion, windowScale);
            windows.setMatrixAt(renderedWindows, windowMatrix);
            windows.setColorAt(
              renderedWindows,
              windowColor.setHex(
                windowPalette[
                  Math.floor(windowRandom() * windowPalette.length)
                ] ?? windowPalette[0],
              ),
            );
            renderedWindows += 1;
          }
        }
        renderedCount += 1;
      }
      buildings.count = renderedCount;
      buildings.instanceMatrix.needsUpdate = true;
      if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true;
      buildings.computeBoundingSphere();
      root.add(buildings);
      if (renderedWindows > 0) {
        windows.count = renderedWindows;
        windows.instanceMatrix.needsUpdate = true;
        if (windows.instanceColor) windows.instanceColor.needsUpdate = true;
        windows.computeBoundingSphere();
        root.add(windows);
        nightLighting.windowMeshes.push(windows);
        nightLighting.windowCount += renderedWindows;
      } else {
        windowGeometry.dispose();
        windowMaterial.dispose();
        windows.dispose();
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
    marker.castShadow = qualityUsesShadows(this.quality);
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
      mesh.visible = strength > 0.015;
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.opacity = 0.12 + strength * 0.88;
    }
    for (const { light, baseIntensity } of nightLighting.areaLights) {
      light.intensity = baseIntensity * strength;
      light.visible = strength > 0.015;
    }
  }

  private applyPlacedLighting() {
    applyPlacedRuntimeLighting(
      this.placedRuntime,
      this.quality,
      this.nightLightingStrength,
      this.placedLightFocusX,
      this.placedLightFocusZ,
    );
  }

  private addRockField(
    root: THREE.Group,
    centerX: number,
    centerZ: number,
    key: string,
    density: number,
    primaryResource: ItemId,
    colliders: PlanarCollider[],
    targets: WorldTarget[],
  ) {
    const random = seededRandom(`${WORLD_SEED}:chunk:${key}:rocks:v1`);
    const count = Math.max(3, Math.floor(4 + density * 13 + random() * 4));
    const rocks = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 1,
        flatShading: true,
        vertexColors: true,
      }),
      count,
    );
    rocks.name = `rocks:${key}`;
    rocks.castShadow = qualityUsesShadows(this.quality);
    rocks.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const rockColor = new THREE.Color();
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
      const groundY = sampleTerrainHeight(x, z);
      position.set(x, groundY + size * 0.42, z);
      quaternion.setFromEuler(new THREE.Euler(random() * 2, random() * Math.PI, random()));
      scale.set(scaleX, size, scaleZ);
      matrix.compose(position, quaternion, scale);
      const instanceIndex = renderedCount;
      rocks.setMatrixAt(instanceIndex, matrix);
      rocks.setColorAt(
        instanceIndex,
        proceduralSurfaceColor(
          rockColor,
          primaryResource === "ore" ? 0x555b55 : 0x4d4840,
          "rock",
          x,
          z,
        ),
      );
      const id = `resource:rock:v2:${key}:${index}`;
      colliders.push({
        shape: "circle",
        id,
        x,
        z,
        radius: colliderRadius,
      });
      const item: ItemId = primaryResource === "ore" ? "ore" : "stone";
      const targetRoot = new THREE.Group();
      targetRoot.name = id;
      targetRoot.position.set(x, groundY, z);
      this.registerInstancedResource(targets, {
        id,
        kind: "resource",
        action: "harvest",
        name: item === "ore" ? "Ore-bearing rock" : "Stone outcrop",
        item,
        yieldAmount: 3,
        hitsRequired: 3,
        hits: 0,
        maxDistance: 7.5,
        interactionRadius: colliderRadius,
        position: new THREE.Vector3(x, groundY + size * 0.6, z),
        root: targetRoot,
        instanceVisuals: [{
          mesh: rocks,
          index: instanceIndex,
          position: position.clone(),
          quaternion: quaternion.clone(),
          scale: scale.clone(),
          groundY,
        }],
      });
      renderedCount += 1;
    }
    rocks.count = renderedCount;
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    rocks.computeBoundingSphere();
    root.add(rocks);
  }

  private addVegetation(
    root: THREE.Group,
    centerX: number,
    centerZ: number,
    key: string,
    biomeId: BiomeId,
    density: number,
    colliders: PlanarCollider[],
    targets: WorldTarget[],
  ) {
    const random = seededRandom(`${WORLD_SEED}:chunk:${key}:forest:v1`);
    const count = Math.floor(density * 18 + random() * 3);
    const placed: Array<{
      id: string;
      x: number;
      z: number;
      baseY: number;
      size: number;
      species: WoodySpeciesDefinition;
      quaternion: THREE.Quaternion;
    }> = [];
    const matrix = new THREE.Matrix4();
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
      const id = `resource:tree:v2:${key}:${index}`;
      const styleRandom = seededRandom(
        `${WORLD_SEED}:chunk:${key}:forest-style:v1:${index}`,
      );
      const species = selectWoodySpecies(biomeId, styleRandom());
      if (!species) continue;
      colliders.push({
        shape: "circle",
        id,
        x,
        z,
        radius: colliderRadius,
      });
      placed.push({
        id,
        x,
        z,
        baseY,
        size,
        species,
        quaternion: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0, random() * Math.PI * 2, 0),
        ),
      });
    }

    const speciesGroups = new Map<string, typeof placed>();
    for (const tree of placed) {
      const group = speciesGroups.get(tree.species.id) ?? [];
      group.push(tree);
      speciesGroups.set(tree.species.id, group);
    }
    const visualById = new Map<string, InstancedTargetVisual>();
    for (const group of speciesGroups.values()) {
      const species = group[0].species;
      const trees = new THREE.InstancedMesh(
        createWoodyGeometry(species),
        vegetationMaterial(),
        group.length,
      );
      trees.name = `forest:${key}:${species.id}`;
      trees.userData.vegetationLayer = "woody";
      trees.userData.speciesId = species.id;
      trees.castShadow = qualityUsesShadows(this.quality);
      trees.receiveShadow = true;
      group.forEach((tree, instanceIndex) => {
        const position = new THREE.Vector3(tree.x, tree.baseY, tree.z);
        const scale = new THREE.Vector3(tree.size, tree.size, tree.size);
        matrix.compose(position, tree.quaternion, scale);
        trees.setMatrixAt(instanceIndex, matrix);
        visualById.set(tree.id, {
          mesh: trees,
          index: instanceIndex,
          position,
          quaternion: tree.quaternion.clone(),
          scale,
          groundY: tree.baseY,
        });
      });
      trees.instanceMatrix.needsUpdate = true;
      trees.computeBoundingSphere();
      root.add(trees);
    }

    for (const tree of placed) {
      const visual = visualById.get(tree.id);
      if (!visual) continue;
      const targetRoot = new THREE.Group();
      targetRoot.name = tree.id;
      targetRoot.position.set(tree.x, tree.baseY, tree.z);
      this.registerInstancedResource(targets, {
        id: tree.id,
        kind: "resource",
        action: "harvest",
        name: tree.species.harvestName,
        item: "wood",
        yieldAmount: 4,
        hitsRequired: 3,
        hits: 0,
        maxDistance: 8.4,
        interactionRadius: Math.max(0.75, 1.25 * tree.size),
        position: new THREE.Vector3(
          tree.x,
          tree.baseY + 2.2 * tree.size,
          tree.z,
        ),
        root: targetRoot,
        instanceVisuals: [visual],
      });
    }

    const profile = VEGETATION_PROFILES[biomeId];
    const maximumDecorativeCount = groundcoverCount(biomeId, 1);
    const performanceDecorativeCount = groundcoverCount(biomeId, 0.52);
    if (maximumDecorativeCount > 0) {
      const groundRandom = seededRandom(
        `${WORLD_SEED}:chunk:${key}:groundcover:v1:${profile.groundcover}`,
      );
      const groundcover = new THREE.InstancedMesh(
        createGroundcoverGeometry(profile),
        vegetationMaterial(),
        maximumDecorativeCount,
      );
      groundcover.name = `groundcover:${key}:${profile.groundcover}`;
      groundcover.userData.vegetationLayer = "decorative";
      groundcover.userData.groundcoverKind = profile.groundcover;
      groundcover.castShadow = false;
      groundcover.receiveShadow = true;
      groundcover.userData.shadow = false;
      const quaternion = new THREE.Quaternion();
      const position = new THREE.Vector3();
      const scale = new THREE.Vector3();
      let representative: THREE.Vector3 | null = null;
      let rendered = 0;
      for (let index = 0; index < maximumDecorativeCount; index += 1) {
        const placement = this.findSolidPlacement(
          groundRandom,
          centerX,
          centerZ,
          key,
          0.08,
          colliders,
          CHUNK_SIZE * 0.48,
          20,
        );
        if (!placement) continue;
        const localClimate = sampleClimate(placement.x, placement.z);
        if (localClimate.biome.id !== biomeId && groundRandom() > 0.28) continue;
        const size = randomRange(groundRandom, 0.7, 1.45);
        position.set(
          placement.x,
          sampleTerrainHeight(placement.x, placement.z),
          placement.z,
        );
        representative ??= position.clone();
        quaternion.setFromEuler(
          new THREE.Euler(0, groundRandom() * Math.PI * 2, 0),
        );
        scale.set(
          size * randomRange(groundRandom, 0.78, 1.2),
          size,
          size * randomRange(groundRandom, 0.78, 1.2),
        );
        matrix.compose(position, quaternion, scale);
        groundcover.setMatrixAt(rendered, matrix);
        rendered += 1;
      }
      groundcover.count = rendered;
      groundcover.userData.highDetailCount = rendered;
      groundcover.userData.performanceCount = Math.min(
        rendered,
        performanceDecorativeCount,
      );
      groundcover.count = qualityUsesHighDetail(this.quality)
        ? groundcover.userData.highDetailCount
        : groundcover.userData.performanceCount;
      groundcover.instanceMatrix.needsUpdate = true;
      groundcover.computeBoundingSphere();
      root.add(groundcover);
      if (representative) {
        const guide = GROUNDCOVER_GUIDE[profile.groundcover];
        const scanRoot = new THREE.Group();
        scanRoot.name = `scan-subject:flora:${profile.groundcover}:${key}`;
        scanRoot.position.copy(representative);
        root.add(scanRoot);
        targets.push({
          id: scanRoot.name,
          kind: "scannable",
          action: "scan",
          name: guide.name,
          position: representative.clone().add(new THREE.Vector3(0, 0.45, 0)),
          root: scanRoot,
          maxDistance: 15,
          hitsRequired: 0,
          hits: 0,
          fieldGuideId: guide.id,
        });
      }
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
    ruins.castShadow = qualityUsesShadows(this.quality);
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

  private registerInstancedResource(
    targets: WorldTarget[],
    target: WorldTarget,
  ) {
    if (target.item && !target.fieldGuideId) {
      target.fieldGuideId = `guide:resource:${target.item}:v1`;
    }
    const diff = targetDiff(this.worldDiffs, target.id);
    if (diff.hits > 0 || diff.removed) {
      this.applyTargetVisualState(target, diff);
    }
    targets.push(target);
  }

  private applyTargetVisualState(target: WorldTarget, diff: EntityDiff) {
    target.hits = diff.hits;
    const remaining = Math.max(
      0.28,
      1 - (diff.hits / Math.max(1, target.hitsRequired)) * 0.22,
    );
    if (target.instanceVisuals?.length) {
      const matrix = new THREE.Matrix4();
      for (const visual of target.instanceVisuals) {
        const position = visual.position.clone();
        const scale = visual.scale.clone();
        if (diff.removed) {
          scale.setScalar(0);
          position.y = visual.groundY;
        } else {
          position.y =
            visual.groundY + (visual.position.y - visual.groundY) * remaining;
          scale.y *= remaining;
        }
        matrix.compose(position, visual.quaternion, scale);
        visual.mesh.setMatrixAt(visual.index, matrix);
        visual.mesh.instanceMatrix.needsUpdate = true;
      }
      target.root.visible = !diff.removed;
      return;
    }

    target.root.visible = !diff.removed;
    target.root.scale.y = diff.removed ? 1 : remaining;
  }

  private registerGatherable(
    root: THREE.Group,
    targets: WorldTarget[],
    colliders: PlanarCollider[],
    target: WorldTarget,
  ) {
    if (target.item && !target.fieldGuideId) {
      target.fieldGuideId = `guide:resource:${target.item}:v1`;
    }
    const diff = targetDiff(this.worldDiffs, target.id);
    if (diff.hits > 0 || diff.removed) {
      this.applyTargetVisualState(target, diff);
    }
    root.add(target.root);
    targets.push(target);
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
    mesh.castShadow = qualityUsesShadows(this.quality);
    mesh.receiveShadow = true;
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
      fieldGuideId: `guide:resource:${item}:v1`,
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
      new THREE.MeshStandardMaterial({
        color: proceduralSurfaceColor(
          new THREE.Color(),
          item === "ore" ? 0x5d625d : 0x514c43,
          "rock",
          x,
          z,
        ),
        roughness: 1,
      }),
    );
    mesh.position.y = 0.72;
    mesh.scale.set(1.25, 0.8, 1);
    mesh.castShadow = qualityUsesShadows(this.quality);
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
      maxDistance: 7.5,
      interactionRadius: 1.56,
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
      mesh.castShadow = qualityUsesShadows(this.quality);
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
      maxDistance: 8.4,
      interactionRadius: 1.25,
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
        object.castShadow = qualityUsesShadows(this.quality);
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
      fieldGuideId: `guide:landmark:${beacon.id}:v1`,
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

  private applyContainerAppearance(
    target: WorldTarget,
    state: Readonly<ContainerState> | undefined,
  ) {
    const empty = Boolean(state && Object.keys(state.remaining).length === 0);
    target.empty = empty;
    target.root.userData.opened = Boolean(state?.opened);
    target.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        material.emissive.setHex(state?.opened ? 0x20271f : 0x000000);
        material.emissiveIntensity = state?.opened ? (empty ? 0.12 : 0.28) : 0;
      }
    });
  }

  private disposeObjectTree(root: THREE.Object3D) {
    this.scene.remove(root);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh)) return;
      if (object instanceof THREE.InstancedMesh) object.dispose();
      geometries.add(object.geometry);
      const source = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of source) {
        if (!this.sharedMaterials.has(material)) materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }

  private disposeChunk(chunk: ChunkRuntime) {
    this.disposeObjectTree(chunk.root);
  }
}
