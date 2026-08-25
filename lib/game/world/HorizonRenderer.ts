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
import {
  SETTLEMENTS,
  WATER_LEVEL,
  WORLD_HALF_EXTENT,
  type SettlementTier,
} from "./macroWorld";
import {
  chunkCenter,
  sampleHorizonTerrainHeight,
  sampleTerrainHeight,
  worldToChunk,
} from "./terrain";
import {
  proceduralSurfaceColor,
  terrainSurfaceColor,
} from "./surfaceVariation";

const TERRAIN_DEPRESSION = 0.08;
const DETAIL_BLEND_END = 960;
const HORIZON_SKIRT_DEPTH = 18;
const SETTLEMENT_SECTORS = 8;

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
}

interface TerrainRingRuntime {
  anchorX: number;
  anchorZ: number;
  meshes: THREE.Mesh[];
  triangles: number;
}

export interface HorizonDiagnostics {
  mode: HorizonMode;
  terrainTiles: number;
  terrainTriangles: number;
  settlementInstances: number;
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

function clampToWorld(value: number) {
  return THREE.MathUtils.clamp(value, -WORLD_HALF_EXTENT, WORLD_HALF_EXTENT);
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

function blendedSurfaceHeight(x: number, z: number, anchorX: number, anchorZ: number) {
  const horizonHeight = sampleHorizonTerrainHeight(x, z);
  const distance = Math.max(Math.abs(x - anchorX), Math.abs(z - anchorZ));
  if (distance >= DETAIL_BLEND_END) return horizonHeight;
  const detailedHeight = Math.max(WATER_LEVEL, sampleTerrainHeight(x, z));
  const amount = THREE.MathUtils.smoothstep(
    distance,
    DETAILED_TERRAIN_HALF_EXTENT,
    DETAIL_BLEND_END,
  );
  return THREE.MathUtils.lerp(detailedHeight, horizonHeight, amount);
}

function pushTerrainColor(
  colors: number[],
  color: THREE.Color,
  x: number,
  z: number,
  height: number,
) {
  terrainSurfaceColor(color, x, z, height);
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
      const height = blendedSurfaceHeight(x, z, anchorX, anchorZ);
      positions.push(x, height - TERRAIN_DEPRESSION - verticalOffset, z);
      pushTerrainColor(colors, surfaceColor, x, z, height);
    }
  }

  const row = segmentsX + 1;
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
      });
    }
  }
  return recipes;
}

export class HorizonRenderer {
  private readonly group = new THREE.Group();
  private readonly terrainMaterial = new THREE.MeshLambertMaterial({
    color: 0xffffff,
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
  private terrainRings = new Map<number, TerrainRingRuntime>();
  private settlementMeshes: THREE.InstancedMesh[] = [];
  private mode: HorizonMode;
  private anchor: { x: number; z: number } | null = null;
  private settlementInstances = 0;
  private rebuilds = 0;

  constructor(private readonly scene: THREE.Scene, mode: HorizonMode) {
    this.mode = mode;
    this.group.name = "horizon-hlod";
    this.group.renderOrder = -1;
    this.scene.add(this.group);
  }

  setMode(mode: HorizonMode) {
    if (mode === this.mode) return false;
    this.mode = mode;
    if (this.anchor) this.rebuildAll();
    return true;
  }

  update(playerX: number, playerZ: number) {
    const coordinate = worldToChunk(playerX, playerZ);
    const center = chunkCenter(coordinate);
    if (this.anchor?.x === center.x && this.anchor.z === center.z) return false;
    this.anchor = center;
    this.reconcileTerrainRings();
    this.rebuildSettlements(HORIZON_PRESETS[this.mode].drawDistanceMeters);
    this.rebuilds += 1;
    return true;
  }

  get diagnostics(): HorizonDiagnostics {
    return {
      mode: this.mode,
      terrainTiles: [...this.terrainRings.values()].reduce(
        (total, ring) => total + ring.meshes.length,
        0,
      ),
      terrainTriangles: [...this.terrainRings.values()].reduce(
        (total, ring) => total + ring.triangles,
        0,
      ),
      settlementInstances: this.settlementInstances,
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
  }

  private clearRuntimeMeshes() {
    for (const ring of this.terrainRings.values()) this.disposeTerrainRing(ring);
    this.terrainRings.clear();
    this.clearSettlementMeshes();
  }

  private clearSettlementMeshes() {
    for (const mesh of this.settlementMeshes) {
      this.group.remove(mesh);
      mesh.dispose();
    }
    this.settlementMeshes = [];
    this.settlementInstances = 0;
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
    this.rebuilds += 1;
  }

  private reconcileTerrainRings() {
    if (!this.anchor) return;
    const preset = HORIZON_PRESETS[this.mode];
    for (const [ringIndex, runtime] of this.terrainRings) {
      if (ringIndex < preset.rings.length) continue;
      this.disposeTerrainRing(runtime);
      this.terrainRings.delete(ringIndex);
    }

    for (const [ringIndex, ring] of preset.rings.entries()) {
      const snap = ringIndex === 0 ? CHUNK_SIZE : Math.max(CHUNK_SIZE, ring.cellSize);
      const anchorX = Math.round(this.anchor.x / snap) * snap;
      const anchorZ = Math.round(this.anchor.z / snap) * snap;
      const existing = this.terrainRings.get(ringIndex);
      if (existing?.anchorX === anchorX && existing.anchorZ === anchorZ) continue;
      if (existing) this.disposeTerrainRing(existing);

      const overlap = ringIndex === 0 ? ring.cellSize : ring.cellSize * 1.08;
      const renderRing: HorizonRingDefinition = {
        ...ring,
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
  }
}
