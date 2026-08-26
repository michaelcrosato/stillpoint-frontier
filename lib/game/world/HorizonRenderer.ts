import * as THREE from "three";
import {
  CHUNK_SIZE,
  DETAILED_TERRAIN_HALF_EXTENT,
  HORIZON_PRESETS,
  WORLD_SEED,
  type HorizonMode,
  type HorizonRingDefinition,
} from "../config";
import { seededRandom } from "../core/random";
import { BLOOM_LAYER } from "../rendering/Bloom";
import type { GraphicsFeatureState } from "../rendering/GraphicsFeatures";
import {
  SETTLEMENTS,
  WATER_LEVEL,
  WORLD_HALF_EXTENT,
  type SettlementTier,
} from "./macroWorld";
import {
  chunkCenter,
  sampleHorizonTerrainHeight,
  sampleTerrainHeightLod,
  worldToChunk,
} from "./terrain";
import {
  MOUNTAIN_LANDMARK,
  sampleMountainLift,
} from "./mountainLandmark";
import {
  proceduralSurfaceColor,
  terrainSurfaceColor,
} from "./surfaceVariation";
import {
  DEFAULT_WORLD_DETAIL_LEVEL,
  normalizeWorldDetailLevel,
  worldLodPolicy,
  type WorldDetailLevel,
  type WorldLodPolicy,
} from "./WorldLodPolicy";
import {
  horizonSceneryRecipes,
  type HorizonSceneryRecipe,
} from "./sceneryLod";

const TERRAIN_DEPRESSION = 0.08;
const HORIZON_SKIRT_DEPTH = 18;
const SETTLEMENT_SECTORS = 8;
const MAX_HORIZON_LIGHTS = 320;
const MOUNTAIN_PROXY_RADIAL_SEGMENTS = 24;
const MOUNTAIN_PROXY_RING_RATIOS = [0.12, 0.28, 0.46, 0.68, 0.78] as const;
const MOUNTAIN_PROXY_BASE_COLOR = new THREE.Color(0x5f625f);

interface PatchBounds {
  side: "north" | "south" | "west" | "east";
  tile: number;
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

interface HorizonSettlementRecipe {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  yaw: number;
  color: number;
  sector: number;
  tier: SettlementTier;
}

interface TerrainRingRuntime {
  anchorX: number;
  anchorZ: number;
  meshes: THREE.Mesh[];
  triangles: number;
}

export interface HorizonDiagnostics {
  mode: HorizonMode;
  detailLevel: WorldDetailLevel;
  detailDistanceMeters: number;
  nearCellSize: number;
  terrainTiles: number;
  terrainTriangles: number;
  settlementInstances: number;
  settlementLightInstances: number;
  settlementLightDrawCalls: number;
  sceneryInstances: number;
  sceneryDrawCalls: number;
  landmarkProxyVisible: boolean;
  landmarkProxyTriangles: number;
  rebuilds: number;
  anchor: { x: number; z: number } | null;
}

const TIER_PROXY_COUNTS: Readonly<Record<SettlementTier, number>> = {
  village: 2,
  town: 6,
  city: 12,
  megacity: 48,
};

const TIER_COLORS: Readonly<Record<SettlementTier, number>> = {
  village: 0x756b5b,
  town: 0x66645d,
  city: 0x5d6263,
  megacity: 0x555d61,
};

const TIER_HEIGHTS: Readonly<Record<SettlementTier, readonly [number, number]>> = {
  village: [4, 9],
  town: [7, 18],
  city: [14, 42],
  megacity: [24, 118],
};

const TIER_LIGHT_COUNTS: Readonly<Record<SettlementTier, number>> = {
  village: 0,
  town: 1,
  city: 2,
  megacity: 4,
};

function clampToWorld(value: number) {
  return THREE.MathUtils.clamp(value, -WORLD_HALF_EXTENT, WORLD_HALF_EXTENT);
}

function createMountainProxyGeometry() {
  const positions: number[] = [
    0,
    sampleMountainLift(
      MOUNTAIN_LANDMARK.center.x,
      MOUNTAIN_LANDMARK.center.z,
    ),
    0,
  ];
  const indices: number[] = [];

  for (const [ringIndex, ratio] of MOUNTAIN_PROXY_RING_RATIOS.entries()) {
    const radius = MOUNTAIN_LANDMARK.footprintRadius * ratio;
    const tapersToBase = ringIndex === MOUNTAIN_PROXY_RING_RATIOS.length - 1;
    for (let segment = 0; segment < MOUNTAIN_PROXY_RADIAL_SEGMENTS; segment += 1) {
      const angle = (segment / MOUNTAIN_PROXY_RADIAL_SEGMENTS) * Math.PI * 2;
      const localX = Math.cos(angle) * radius;
      const localZ = Math.sin(angle) * radius;
      positions.push(
        localX,
        tapersToBase
          ? 0
          : sampleMountainLift(
              MOUNTAIN_LANDMARK.center.x + localX,
              MOUNTAIN_LANDMARK.center.z + localZ,
            ),
        localZ,
      );
    }
  }

  const firstRing = 1;
  for (let segment = 0; segment < MOUNTAIN_PROXY_RADIAL_SEGMENTS; segment += 1) {
    const next = (segment + 1) % MOUNTAIN_PROXY_RADIAL_SEGMENTS;
    indices.push(0, firstRing + next, firstRing + segment);
  }
  for (let ring = 0; ring < MOUNTAIN_PROXY_RING_RATIOS.length - 1; ring += 1) {
    const inner = 1 + ring * MOUNTAIN_PROXY_RADIAL_SEGMENTS;
    const outer = inner + MOUNTAIN_PROXY_RADIAL_SEGMENTS;
    for (let segment = 0; segment < MOUNTAIN_PROXY_RADIAL_SEGMENTS; segment += 1) {
      const next = (segment + 1) % MOUNTAIN_PROXY_RADIAL_SEGMENTS;
      indices.push(
        inner + segment,
        inner + next,
        outer + segment,
        inner + next,
        outer + next,
        outer + segment,
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.mountainProxy = {
    triangles: indices.length / 3,
    vertices: positions.length / 3,
  };
  return geometry;
}

function patchBounds(
  anchorX: number,
  anchorZ: number,
  ring: HorizonRingDefinition,
): PatchBounds[] {
  const patches: PatchBounds[] = [];
  const divisions = 4;
  for (let tile = 0; tile < divisions; tile += 1) {
    const acrossStart = THREE.MathUtils.lerp(-ring.outer, ring.outer, tile / divisions);
    const acrossEnd = THREE.MathUtils.lerp(
      -ring.outer,
      ring.outer,
      (tile + 1) / divisions,
    );
    patches.push(
      {
        side: "north",
        tile,
        xMin: anchorX + acrossStart,
        xMax: anchorX + acrossEnd,
        zMin: anchorZ - ring.outer,
        zMax: anchorZ - ring.inner,
      },
      {
        side: "south",
        tile,
        xMin: anchorX + acrossStart,
        xMax: anchorX + acrossEnd,
        zMin: anchorZ + ring.inner,
        zMax: anchorZ + ring.outer,
      },
    );

    const middleStart = THREE.MathUtils.lerp(-ring.inner, ring.inner, tile / divisions);
    const middleEnd = THREE.MathUtils.lerp(
      -ring.inner,
      ring.inner,
      (tile + 1) / divisions,
    );
    patches.push(
      {
        side: "west",
        tile,
        xMin: anchorX - ring.outer,
        xMax: anchorX - ring.inner,
        zMin: anchorZ + middleStart,
        zMax: anchorZ + middleEnd,
      },
      {
        side: "east",
        tile,
        xMin: anchorX + ring.inner,
        xMax: anchorX + ring.outer,
        zMin: anchorZ + middleStart,
        zMax: anchorZ + middleEnd,
      },
    );
  }
  return patches;
}

function blendedSurfaceHeight(
  x: number,
  z: number,
  anchorX: number,
  anchorZ: number,
  cellSize: number,
  policy: Readonly<WorldLodPolicy>,
) {
  const distance = Math.max(Math.abs(x - anchorX), Math.abs(z - anchorZ));
  if (distance >= policy.detailBlendEnd) {
    return sampleHorizonTerrainHeight(x, z);
  }
  const detailedHeight = Math.max(
    WATER_LEVEL,
    sampleTerrainHeightLod(x, z, cellSize),
  );
  const blendStart = Math.max(
    DETAILED_TERRAIN_HALF_EXTENT,
    policy.detailBlendEnd - Math.max(CHUNK_SIZE, cellSize * 6),
  );
  if (distance <= blendStart) return detailedHeight;
  const horizonHeight = sampleHorizonTerrainHeight(x, z);
  const amount = THREE.MathUtils.smoothstep(
    distance,
    blendStart,
    policy.detailBlendEnd,
  );
  return THREE.MathUtils.lerp(detailedHeight, horizonHeight, amount);
}

function pushTerrainColor(
  colors: number[],
  color: THREE.Color,
  x: number,
  z: number,
  height: number,
  cellSize: number,
  slope: number,
) {
  terrainSurfaceColor(color, x, z, height, cellSize, slope);
  colors.push(color.r, color.g, color.b);
}

function appendSkirt(
  edge: readonly number[],
  positions: number[],
  colors: number[],
  indices: number[],
) {
  if (edge.length < 2) return;
  const skirt: number[] = [];
  for (const topIndex of edge) {
    const offset = topIndex * 3;
    skirt.push(positions.length / 3);
    positions.push(
      positions[offset],
      positions[offset + 1] - HORIZON_SKIRT_DEPTH,
      positions[offset + 2],
    );
    colors.push(
      colors[offset] * 0.56,
      colors[offset + 1] * 0.56,
      colors[offset + 2] * 0.56,
    );
  }
  for (let index = 0; index < edge.length - 1; index += 1) {
    const topA = edge[index];
    const topB = edge[index + 1];
    const bottomA = skirt[index];
    const bottomB = skirt[index + 1];
    indices.push(topA, bottomA, topB, topB, bottomA, bottomB);
  }
}

function buildPatchGeometry(
  bounds: PatchBounds,
  ring: HorizonRingDefinition,
  anchorX: number,
  anchorZ: number,
  verticalOffset: number,
  policy: Readonly<WorldLodPolicy>,
) {
  const width = bounds.xMax - bounds.xMin;
  const depth = bounds.zMax - bounds.zMin;
  const segmentsX = Math.max(1, Math.round(width / ring.cellSize));
  const segmentsZ = Math.max(1, Math.round(depth / ring.cellSize));
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const surfaceColor = new THREE.Color();

  for (let zIndex = 0; zIndex <= segmentsZ; zIndex += 1) {
    const rawZ = THREE.MathUtils.lerp(bounds.zMin, bounds.zMax, zIndex / segmentsZ);
    const z = clampToWorld(rawZ);
    for (let xIndex = 0; xIndex <= segmentsX; xIndex += 1) {
      const rawX = THREE.MathUtils.lerp(bounds.xMin, bounds.xMax, xIndex / segmentsX);
      const x = clampToWorld(rawX);
      const height = blendedSurfaceHeight(
        x,
        z,
        anchorX,
        anchorZ,
        ring.cellSize,
        policy,
      );
      positions.push(x, height - TERRAIN_DEPRESSION - verticalOffset, z);
    }
  }

  const row = segmentsX + 1;
  for (let zIndex = 0; zIndex <= segmentsZ; zIndex += 1) {
    for (let xIndex = 0; xIndex <= segmentsX; xIndex += 1) {
      const index = zIndex * row + xIndex;
      const leftIndex = zIndex * row + Math.max(0, xIndex - 1);
      const rightIndex = zIndex * row + Math.min(segmentsX, xIndex + 1);
      const topIndex = Math.max(0, zIndex - 1) * row + xIndex;
      const bottomIndex = Math.min(segmentsZ, zIndex + 1) * row + xIndex;
      const xSpan = Math.max(
        0.001,
        positions[rightIndex * 3] - positions[leftIndex * 3],
      );
      const zSpan = Math.max(
        0.001,
        positions[bottomIndex * 3 + 2] - positions[topIndex * 3 + 2],
      );
      const dx =
        (positions[rightIndex * 3 + 1] - positions[leftIndex * 3 + 1]) / xSpan;
      const dz =
        (positions[bottomIndex * 3 + 1] - positions[topIndex * 3 + 1]) / zSpan;
      const height = positions[index * 3 + 1] + TERRAIN_DEPRESSION + verticalOffset;
      pushTerrainColor(
        colors,
        surfaceColor,
        positions[index * 3],
        positions[index * 3 + 2],
        height,
        ring.cellSize,
        THREE.MathUtils.clamp(Math.hypot(dx, dz) / 1.25, 0, 1),
      );
    }
  }

  for (let zIndex = 0; zIndex < segmentsZ; zIndex += 1) {
    const centerZ = THREE.MathUtils.lerp(
      bounds.zMin,
      bounds.zMax,
      (zIndex + 0.5) / segmentsZ,
    );
    if (centerZ < -WORLD_HALF_EXTENT || centerZ > WORLD_HALF_EXTENT) continue;
    for (let xIndex = 0; xIndex < segmentsX; xIndex += 1) {
      const centerX = THREE.MathUtils.lerp(
        bounds.xMin,
        bounds.xMax,
        (xIndex + 0.5) / segmentsX,
      );
      if (centerX < -WORLD_HALF_EXTENT || centerX > WORLD_HALF_EXTENT) continue;
      const a = zIndex * row + xIndex;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  if (indices.length === 0) return null;

  const top = Array.from({ length: segmentsX + 1 }, (_, index) => index);
  const bottom = Array.from(
    { length: segmentsX + 1 },
    (_, index) => segmentsZ * row + index,
  );
  const left = Array.from({ length: segmentsZ + 1 }, (_, index) => index * row);
  const right = Array.from(
    { length: segmentsZ + 1 },
    (_, index) => index * row + segmentsX,
  );
  appendSkirt(top, positions, colors, indices);
  appendSkirt(bottom, positions, colors, indices);
  appendSkirt(left, positions, colors, indices);
  appendSkirt(right, positions, colors, indices);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function horizonSettlementRecipes(
  anchorX: number,
  anchorZ: number,
  drawDistanceMeters: number,
): HorizonSettlementRecipe[] {
  const recipes: HorizonSettlementRecipe[] = [];
  const facadeColor = new THREE.Color();
  for (const settlement of SETTLEMENTS) {
    const random = seededRandom(`${WORLD_SEED}:horizon:${settlement.id}:v1`);
    const count = TIER_PROXY_COUNTS[settlement.tier];
    const [minimumHeight, maximumHeight] = TIER_HEIGHTS[settlement.tier];
    for (let index = 0; index < count; index += 1) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * settlement.radius * 0.72;
      const x = settlement.x + Math.cos(angle) * radius;
      const z = settlement.z + Math.sin(angle) * radius;
      const distance = Math.hypot(x - anchorX, z - anchorZ);
      const detailedDistance = Math.max(
        Math.abs(x - anchorX),
        Math.abs(z - anchorZ),
      );
      if (
        detailedDistance <= DETAILED_TERRAIN_HALF_EXTENT + 72 ||
        distance > drawDistanceMeters ||
        Math.abs(x) > WORLD_HALF_EXTENT ||
        Math.abs(z) > WORLD_HALF_EXTENT
      ) {
        continue;
      }
      const height = THREE.MathUtils.lerp(minimumHeight, maximumHeight, random() ** 1.8);
      const footprint = Math.max(3.2, height * THREE.MathUtils.lerp(0.16, 0.34, random()));
      const bearing = (Math.atan2(x - anchorX, z - anchorZ) + Math.PI * 2) % (Math.PI * 2);
      recipes.push({
        x,
        y: sampleHorizonTerrainHeight(x, z),
        z,
        width: footprint * THREE.MathUtils.lerp(0.72, 1.28, random()),
        height,
        depth: footprint * THREE.MathUtils.lerp(0.72, 1.28, random()),
        yaw: random() * Math.PI,
        color: proceduralSurfaceColor(
          facadeColor,
          TIER_COLORS[settlement.tier],
          "building",
          x,
          z,
        ).getHex(),
        sector: Math.min(
          SETTLEMENT_SECTORS - 1,
          Math.floor((bearing / (Math.PI * 2)) * SETTLEMENT_SECTORS),
        ),
        tier: settlement.tier,
      });
    }
  }
  return recipes;
}

export class HorizonRenderer {
  private readonly group = new THREE.Group();
  private readonly terrainMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.96,
    metalness: 0.02,
    flatShading: true,
    vertexColors: true,
    fog: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  private readonly settlementGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly settlementMaterial = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    vertexColors: true,
    fog: true,
  });
  private readonly settlementLightMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.45,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
    toneMapped: false,
  });
  private readonly sceneryMaterial = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    vertexColors: true,
    fog: true,
  });
  private readonly sceneryTrunkGeometry = new THREE.CylinderGeometry(0.18, 0.26, 1, 5);
  private readonly sceneryCrownGeometry = new THREE.ConeGeometry(1, 2, 5);
  private readonly sceneryRockGeometry = new THREE.DodecahedronGeometry(1, 0);
  private readonly mountainProxyGeometry = createMountainProxyGeometry();
  private readonly mountainProxyMaterial = new THREE.MeshBasicMaterial({
    color: 0x747772,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
    side: THREE.FrontSide,
  });
  private readonly mountainProxy = new THREE.Mesh(
    this.mountainProxyGeometry,
    this.mountainProxyMaterial,
  );
  private terrainRings = new Map<number, TerrainRingRuntime>();
  private settlementMeshes: THREE.InstancedMesh[] = [];
  private settlementLightMeshes: THREE.Points[] = [];
  private sceneryMeshes: THREE.InstancedMesh[] = [];
  private mode: HorizonMode;
  private detailLevel: WorldDetailLevel;
  private anchor: { x: number; z: number } | null = null;
  private settlementInstances = 0;
  private settlementLightInstances = 0;
  private horizonLightsEnabled = true;
  private horizonLightVisibility = 0;
  private wetSurfacesEnabled = true;
  private surfaceWetness = 0;
  private sceneryInstances = 0;
  private mountainProxyRangeOpacity = 0;
  private mountainProxyAtmosphereOpacity = 0.56;
  private lastPlayerPosition: { x: number; y: number; z: number } | null = null;
  private rebuilds = 0;

  constructor(
    private readonly scene: THREE.Scene,
    mode: HorizonMode,
    detailLevel: WorldDetailLevel = DEFAULT_WORLD_DETAIL_LEVEL,
  ) {
    this.mode = mode;
    this.detailLevel = normalizeWorldDetailLevel(detailLevel);
    this.settlementLightMaterial.color.setRGB(1.65, 1.35, 1.05);
    this.group.name = "horizon-hlod";
    this.group.renderOrder = -1;
    this.mountainProxy.name = `horizon-${MOUNTAIN_LANDMARK.id}`;
    this.mountainProxy.castShadow = false;
    this.mountainProxy.receiveShadow = false;
    this.mountainProxy.frustumCulled = true;
    this.mountainProxy.renderOrder = -1.5;
    this.mountainProxy.visible = false;
    this.mountainProxy.userData.shadow = false;
    this.group.add(this.mountainProxy);
    this.scene.add(this.group);
  }

  setMode(mode: HorizonMode) {
    if (mode === this.mode) return false;
    this.mode = mode;
    if (this.anchor) {
      if (this.lastPlayerPosition) {
        this.updateMountainProxy(
          this.lastPlayerPosition.x,
          this.lastPlayerPosition.z,
          this.lastPlayerPosition.y,
        );
      }
      this.rebuildAll();
    }
    return true;
  }

  setDetailLevel(detailLevel: WorldDetailLevel) {
    const normalized = normalizeWorldDetailLevel(detailLevel);
    if (normalized === this.detailLevel) return false;
    this.detailLevel = normalized;
    if (this.anchor) {
      const nearRing = this.terrainRings.get(0);
      if (nearRing) {
        this.disposeTerrainRing(nearRing);
        this.terrainRings.delete(0);
      }
      this.reconcileTerrainRings();
      this.rebuildScenery();
      this.rebuilds += 1;
    }
    return true;
  }

  setGraphicsFeatures(
    features: Pick<GraphicsFeatureState, "horizonLights" | "wetSurfaces">,
  ) {
    const lightsChanged = this.horizonLightsEnabled !== features.horizonLights;
    const wetChanged = this.wetSurfacesEnabled !== features.wetSurfaces;
    if (!lightsChanged && !wetChanged) return;
    this.horizonLightsEnabled = features.horizonLights;
    this.wetSurfacesEnabled = features.wetSurfaces;
    if (lightsChanged) this.updateHorizonLightPresentation();
    if (wetChanged) this.updateTerrainWetness();
  }

  presentEnvironment(state: {
    surfaceWetness: number;
    night?: number;
    cloudCover?: number;
    dust?: number;
    precipitationRate?: number;
    fogDensity?: number;
    horizonColor?: THREE.Color;
  }) {
    this.surfaceWetness = THREE.MathUtils.clamp(
      Number.isFinite(state.surfaceWetness) ? state.surfaceWetness : 0,
      0,
      1,
    );
    this.updateTerrainWetness();
    const night = THREE.MathUtils.clamp(
      Number.isFinite(state.night) ? (state.night as number) : 0,
      0,
      1,
    );
    const cloudCover = THREE.MathUtils.clamp(
      Number.isFinite(state.cloudCover) ? (state.cloudCover as number) : 0,
      0,
      1,
    );
    this.horizonLightVisibility = THREE.MathUtils.clamp(
      ((night - 0.06) / 0.7) * (1 + cloudCover * 0.12),
      0,
      1,
    );
    this.updateHorizonLightPresentation();
    const dust = THREE.MathUtils.clamp(
      Number.isFinite(state.dust) ? (state.dust as number) : 0,
      0,
      1,
    );
    const precipitation = THREE.MathUtils.clamp(
      Number.isFinite(state.precipitationRate)
        ? (state.precipitationRate as number)
        : 0,
      0,
      1,
    );
    const fogDensity = Number.isFinite(state.fogDensity)
      ? Math.max(0, state.fogDensity as number)
      : 0.0032;
    const fogClarity = 1 - THREE.MathUtils.smoothstep(
      fogDensity,
      0.0042,
      0.008,
    );
    const clarity = THREE.MathUtils.clamp(
      (1 - cloudCover * 0.18 - dust * 0.92 - precipitation * 0.62) *
        fogClarity,
      0.015,
      1,
    );
    this.mountainProxyAtmosphereOpacity =
      THREE.MathUtils.lerp(0.012, 0.62, clarity) *
      THREE.MathUtils.lerp(0.74, 1, night);
    if (state.horizonColor) {
      this.mountainProxyMaterial.color
        .copy(state.horizonColor)
        .lerp(MOUNTAIN_PROXY_BASE_COLOR, 0.46);
    }
    this.updateMountainProxyPresentation();
  }

  update(playerX: number, playerZ: number, playerY?: number) {
    const resolvedPlayerY = Number.isFinite(playerY)
      ? (playerY as number)
      : sampleHorizonTerrainHeight(playerX, playerZ);
    this.lastPlayerPosition = { x: playerX, y: resolvedPlayerY, z: playerZ };
    this.updateMountainProxy(playerX, playerZ, resolvedPlayerY);
    const coordinate = worldToChunk(playerX, playerZ);
    const center = chunkCenter(coordinate);
    if (this.anchor?.x === center.x && this.anchor.z === center.z) return false;
    this.anchor = center;
    this.reconcileTerrainRings();
    this.rebuildSettlements(HORIZON_PRESETS[this.mode].drawDistanceMeters);
    this.rebuildScenery();
    this.rebuilds += 1;
    return true;
  }

  get diagnostics(): HorizonDiagnostics {
    const policy = worldLodPolicy(this.detailLevel);
    return {
      mode: this.mode,
      detailLevel: this.detailLevel,
      detailDistanceMeters: policy.detailBlendEnd,
      nearCellSize: policy.nearCellSize,
      terrainTiles: [...this.terrainRings.values()].reduce(
        (total, ring) => total + ring.meshes.length,
        0,
      ),
      terrainTriangles: [...this.terrainRings.values()].reduce(
        (total, ring) => total + ring.triangles,
        0,
      ),
      settlementInstances: this.settlementInstances,
      settlementLightInstances: this.settlementLightInstances,
      settlementLightDrawCalls: this.settlementLightMeshes.length,
      sceneryInstances: this.sceneryInstances,
      sceneryDrawCalls: this.sceneryMeshes.length,
      landmarkProxyVisible: this.mountainProxy.visible,
      landmarkProxyTriangles:
        (this.mountainProxyGeometry.index?.count ?? 0) / 3,
      rebuilds: this.rebuilds,
      anchor: this.anchor ? { ...this.anchor } : null,
    };
  }

  dispose() {
    this.clearRuntimeMeshes();
    this.scene.remove(this.group);
    this.terrainMaterial.dispose();
    this.settlementGeometry.dispose();
    this.settlementMaterial.dispose();
    this.settlementLightMaterial.dispose();
    this.sceneryTrunkGeometry.dispose();
    this.sceneryCrownGeometry.dispose();
    this.sceneryRockGeometry.dispose();
    this.sceneryMaterial.dispose();
    this.mountainProxyGeometry.dispose();
    this.mountainProxyMaterial.dispose();
  }

  private updateMountainProxy(
    playerX: number,
    playerZ: number,
    playerY: number,
  ) {
    const deltaX = MOUNTAIN_LANDMARK.center.x - playerX;
    const deltaZ = MOUNTAIN_LANDMARK.center.z - playerZ;
    const distance = Math.hypot(deltaX, deltaZ);
    if (!Number.isFinite(distance) || distance < 1) {
      this.mountainProxyRangeOpacity = 0;
      this.updateMountainProxyPresentation();
      return;
    }

    const preset = HORIZON_PRESETS[this.mode];
    const terrainCoverage = preset.rings[preset.rings.length - 1].outer;
    const outsideTerrain = THREE.MathUtils.smoothstep(
      distance,
      terrainCoverage * 0.78,
      terrainCoverage * 0.96,
    );
    const outsideLandform = THREE.MathUtils.smoothstep(
      distance,
      MOUNTAIN_LANDMARK.footprintRadius * 0.48,
      MOUNTAIN_LANDMARK.footprintRadius * 0.72,
    );
    this.mountainProxyRangeOpacity = outsideTerrain * outsideLandform;
    if (this.mountainProxyRangeOpacity <= 0.002) {
      this.updateMountainProxyPresentation();
      return;
    }

    const proxyRadius = MOUNTAIN_LANDMARK.footprintRadius *
      MOUNTAIN_PROXY_RING_RATIOS[MOUNTAIN_PROXY_RING_RATIOS.length - 1];
    const maxVirtualDistance = preset.drawDistanceMeters * 0.88 /
      (1 + proxyRadius / distance);
    const virtualDistance = Math.min(distance, maxVirtualDistance);
    const scale = virtualDistance / distance;
    const mountainBase = sampleHorizonTerrainHeight(
      MOUNTAIN_LANDMARK.center.x,
      MOUNTAIN_LANDMARK.center.z,
    ) - sampleMountainLift(
      MOUNTAIN_LANDMARK.center.x,
      MOUNTAIN_LANDMARK.center.z,
    );
    this.mountainProxy.position.set(
      playerX + deltaX * scale,
      playerY + (mountainBase - playerY) * scale,
      playerZ + deltaZ * scale,
    );
    this.mountainProxy.scale.setScalar(scale);
    this.updateMountainProxyPresentation();
  }

  private updateMountainProxyPresentation() {
    const opacity = this.mountainProxyRangeOpacity *
      this.mountainProxyAtmosphereOpacity;
    this.mountainProxyMaterial.opacity = opacity;
    this.mountainProxy.visible = opacity > 0.002;
  }

  private clearRuntimeMeshes() {
    for (const ring of this.terrainRings.values()) this.disposeTerrainRing(ring);
    this.terrainRings.clear();
    this.clearSettlementMeshes();
    this.clearSceneryMeshes();
  }

  private clearSettlementMeshes() {
    for (const mesh of this.settlementMeshes) {
      this.group.remove(mesh);
      mesh.dispose();
    }
    for (const points of this.settlementLightMeshes) {
      this.group.remove(points);
      points.geometry.dispose();
    }
    this.settlementMeshes = [];
    this.settlementLightMeshes = [];
    this.settlementInstances = 0;
    this.settlementLightInstances = 0;
  }

  private clearSceneryMeshes() {
    for (const mesh of this.sceneryMeshes) {
      this.group.remove(mesh);
      mesh.dispose();
    }
    this.sceneryMeshes = [];
    this.sceneryInstances = 0;
  }

  private disposeTerrainRing(ring: TerrainRingRuntime) {
    for (const mesh of ring.meshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
  }

  private rebuildAll() {
    if (!this.anchor) return;
    this.clearRuntimeMeshes();
    this.reconcileTerrainRings();
    this.rebuildSettlements(HORIZON_PRESETS[this.mode].drawDistanceMeters);
    this.rebuildScenery();
    this.rebuilds += 1;
  }

  private reconcileTerrainRings() {
    if (!this.anchor) return;
    const preset = HORIZON_PRESETS[this.mode];
    const policy = worldLodPolicy(this.detailLevel);
    for (const [ringIndex, runtime] of this.terrainRings) {
      if (ringIndex < preset.rings.length) continue;
      this.disposeTerrainRing(runtime);
      this.terrainRings.delete(ringIndex);
    }

    for (const [ringIndex, ring] of preset.rings.entries()) {
      const effectiveCellSize = ringIndex === 0
        ? policy.nearCellSize
        : ring.cellSize;
      const snap = ringIndex === 0
        ? CHUNK_SIZE
        : Math.max(CHUNK_SIZE, effectiveCellSize);
      const anchorX = Math.round(this.anchor.x / snap) * snap;
      const anchorZ = Math.round(this.anchor.z / snap) * snap;
      const existing = this.terrainRings.get(ringIndex);
      if (existing?.anchorX === anchorX && existing.anchorZ === anchorZ) continue;
      if (existing) this.disposeTerrainRing(existing);

      const overlap = ringIndex === 0
        ? effectiveCellSize
        : effectiveCellSize * 1.08;
      const renderRing: HorizonRingDefinition = {
        ...ring,
        cellSize: effectiveCellSize,
        inner:
          ringIndex === 0
            ? ring.inner
            : Math.max(DETAILED_TERRAIN_HALF_EXTENT, ring.inner - overlap),
        outer: ring.outer + overlap,
      };
      const meshes: THREE.Mesh[] = [];
      let triangles = 0;
      for (const bounds of patchBounds(anchorX, anchorZ, renderRing)) {
        const geometry = buildPatchGeometry(
          bounds,
          renderRing,
          anchorX,
          anchorZ,
          ringIndex * 0.34,
          policy,
        );
        if (!geometry) continue;
        const mesh = new THREE.Mesh(geometry, this.terrainMaterial);
        mesh.name = `horizon-terrain:${ringIndex}:${bounds.side}:${bounds.tile}`;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.frustumCulled = true;
        mesh.renderOrder = -1;
        mesh.userData.shadow = false;
        triangles += (geometry.index?.count ?? 0) / 3;
        meshes.push(mesh);
        this.group.add(mesh);
      }
      this.terrainRings.set(ringIndex, { anchorX, anchorZ, meshes, triangles });
    }
  }

  private rebuildScenery() {
    if (!this.anchor) return;
    this.clearSceneryMeshes();
    const recipes = horizonSceneryRecipes(
      this.anchor.x,
      this.anchor.z,
      worldLodPolicy(this.detailLevel),
    );
    const trees = recipes.filter(
      (recipe): recipe is Extract<HorizonSceneryRecipe, { kind: "tree" }> =>
        recipe.kind === "tree",
    );
    const rocks = recipes.filter(
      (recipe): recipe is Extract<HorizonSceneryRecipe, { kind: "rock" }> =>
        recipe.kind === "rock",
    );
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();

    const prepareMesh = (
      name: string,
      geometry: THREE.BufferGeometry,
      count: number,
    ) => {
      const mesh = new THREE.InstancedMesh(
        geometry,
        this.sceneryMaterial,
        count,
      );
      mesh.name = name;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
      mesh.renderOrder = -0.5;
      mesh.userData.shadow = false;
      return mesh;
    };
    const finishMesh = (mesh: THREE.InstancedMesh) => {
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      this.sceneryMeshes.push(mesh);
      this.group.add(mesh);
    };

    if (trees.length > 0) {
      const trunks = prepareMesh(
        "horizon-scenery:tree-trunks",
        this.sceneryTrunkGeometry,
        trees.length,
      );
      const crowns = prepareMesh(
        "horizon-scenery:tree-crowns",
        this.sceneryCrownGeometry,
        trees.length,
      );
      trees.forEach((recipe, index) => {
        rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, recipe.yaw);
        position.set(recipe.x, recipe.y + recipe.height * 0.25, recipe.z);
        scale.set(recipe.width * 0.5, recipe.height * 0.5, recipe.width * 0.5);
        matrix.compose(position, rotation, scale);
        trunks.setMatrixAt(index, matrix);
        trunks.setColorAt(index, color.setHex(recipe.trunkColor));

        position.set(recipe.x, recipe.y + recipe.height * 0.69, recipe.z);
        scale.set(recipe.width, recipe.height * 0.31, recipe.width);
        matrix.compose(position, rotation, scale);
        crowns.setMatrixAt(index, matrix);
        crowns.setColorAt(index, color.setHex(recipe.foliageColor));
      });
      finishMesh(trunks);
      finishMesh(crowns);
    }

    if (rocks.length > 0) {
      const rockMesh = prepareMesh(
        "horizon-scenery:rocks",
        this.sceneryRockGeometry,
        rocks.length,
      );
      rocks.forEach((recipe, index) => {
        position.set(recipe.x, recipe.y + recipe.height * 0.45, recipe.z);
        rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, recipe.yaw);
        scale.set(recipe.width, recipe.height * 0.72, recipe.width * 0.78);
        matrix.compose(position, rotation, scale);
        rockMesh.setMatrixAt(index, matrix);
        rockMesh.setColorAt(index, color.setHex(recipe.color));
      });
      finishMesh(rockMesh);
    }
    this.sceneryInstances = recipes.length;
  }

  private rebuildSettlements(drawDistanceMeters: number) {
    if (!this.anchor) return;
    this.clearSettlementMeshes();
    const sectors = Array.from(
      { length: SETTLEMENT_SECTORS },
      () => [] as HorizonSettlementRecipe[],
    );
    for (const recipe of horizonSettlementRecipes(
      this.anchor.x,
      this.anchor.z,
      drawDistanceMeters,
    )) {
      sectors[recipe.sector].push(recipe);
    }

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();
    for (const [sectorIndex, recipes] of sectors.entries()) {
      if (recipes.length === 0) continue;
      const mesh = new THREE.InstancedMesh(
        this.settlementGeometry,
        this.settlementMaterial,
        recipes.length,
      );
      mesh.name = `horizon-settlements:${sectorIndex}`;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
      mesh.renderOrder = -1;
      mesh.userData.shadow = false;
      recipes.forEach((recipe, index) => {
        position.set(recipe.x, recipe.y + recipe.height * 0.5, recipe.z);
        rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, recipe.yaw);
        scale.set(recipe.width, recipe.height, recipe.depth);
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(index, matrix);
        mesh.setColorAt(index, color.setHex(recipe.color));
      });
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      this.settlementInstances += recipes.length;
      this.settlementMeshes.push(mesh);
      this.group.add(mesh);
    }
    this.rebuildSettlementLights(sectors);
  }

  private rebuildSettlementLights(
    sectors: ReadonlyArray<ReadonlyArray<HorizonSettlementRecipe>>,
  ) {
    if (!this.anchor) return;
    let remaining = MAX_HORIZON_LIGHTS;
    const color = new THREE.Color();
    for (const [sectorIndex, recipes] of sectors.entries()) {
      if (remaining <= 0) break;
      const positions: number[] = [];
      const colors: number[] = [];
      for (const recipe of recipes) {
        if (remaining <= 0) break;
        const random = seededRandom(
          `${WORLD_SEED}:horizon-light:v1:${Math.round(recipe.x * 10)}:${Math.round(recipe.z * 10)}`,
        );
        const lightCount = Math.min(TIER_LIGHT_COUNTS[recipe.tier], remaining);
        const towardX = this.anchor.x - recipe.x;
        const towardZ = this.anchor.z - recipe.z;
        const towardLength = Math.max(0.001, Math.hypot(towardX, towardZ));
        const facingX = towardX / towardLength;
        const facingZ = towardZ / towardLength;
        const sideX = -facingZ;
        const sideZ = facingX;
        const facadeRadius = Math.hypot(recipe.width, recipe.depth) * 0.51 + 0.18;
        for (let index = 0; index < lightCount; index += 1) {
          const rooftop = recipe.tier === "megacity" && index === lightCount - 1;
          if (rooftop) {
            positions.push(
              recipe.x,
              recipe.y + recipe.height + 0.7 + random() * 1.4,
              recipe.z,
            );
            color.setRGB(1, 0.055, 0.018);
          } else {
            const lateral =
              (random() - 0.5) * Math.min(recipe.width, recipe.depth) * 0.54;
            positions.push(
              recipe.x + facingX * facadeRadius + sideX * lateral,
              recipe.y + recipe.height * (0.28 + random() * 0.58),
              recipe.z + facingZ * facadeRadius + sideZ * lateral,
            );
            color.setHSL(0.075 + random() * 0.065, 0.82, 0.7);
          }
          colors.push(color.r, color.g, color.b);
          remaining -= 1;
        }
      }
      if (positions.length === 0) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(colors, 3),
      );
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const points = new THREE.Points(geometry, this.settlementLightMaterial);
      points.name = `horizon-settlement-lights:${sectorIndex}`;
      points.castShadow = false;
      points.receiveShadow = false;
      points.frustumCulled = true;
      points.renderOrder = -0.25;
      points.userData.shadow = false;
      points.layers.enable(BLOOM_LAYER);
      this.settlementLightInstances += positions.length / 3;
      this.settlementLightMeshes.push(points);
      this.group.add(points);
    }
    this.updateHorizonLightPresentation();
  }

  private updateHorizonLightPresentation() {
    const visible = this.horizonLightsEnabled && this.horizonLightVisibility > 0.01;
    this.settlementLightMaterial.opacity = visible
      ? this.horizonLightVisibility * 0.82
      : 0;
    for (const points of this.settlementLightMeshes) points.visible = visible;
  }

  private updateTerrainWetness() {
    const wetness = this.wetSurfacesEnabled ? this.surfaceWetness : 0;
    this.terrainMaterial.roughness = THREE.MathUtils.lerp(0.96, 0.55, wetness);
    this.terrainMaterial.envMapIntensity = 0.72 * (1 + 0.48 * wetness);
  }
}
