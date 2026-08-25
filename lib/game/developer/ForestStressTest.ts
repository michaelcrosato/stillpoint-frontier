import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  qualityUsesShadows,
  type QualityLevel,
} from "../config";
import {
  tagWorldMaterial,
  type WorldMaterialLibrary,
} from "../rendering/WorldMaterialLibrary";
import { prepareVegetationGeometry } from "../rendering/VegetationWind";
import {
  CANOPY_BENCHMARK_LEVELS,
  CANOPY_BENCHMARK_ZONE,
  canopyBenchmarkDistance,
  canopyBenchmarkTileKey,
  generateCanopyBenchmarkPoints,
  generateCanopyBenchmarkReeds,
  normalizeCanopyBenchmarkLevel,
  type CanopyBenchmarkLevel,
  type CanopyBenchmarkLevelDefinition,
  type CanopyBenchmarkPoint,
} from "../world/benchmarkZone";
import { sampleTerrainHeight } from "../world/terrain";
import {
  VEGETATION_PROFILES,
  WOODY_SPECIES,
  createGroundcoverGeometry,
  createWoodyGeometry,
  type WoodySpeciesDefinition,
} from "../world/vegetation";

interface TreePoint extends CanopyBenchmarkPoint {
  species: "sable_pine" | "frost_spruce";
  terrainY: number;
}

type ElevatedBenchmarkPoint = CanopyBenchmarkPoint & { terrainY?: number };

interface TileRecipe {
  key: string;
  centerX: number;
  centerZ: number;
  trees: TreePoint[];
  groundcover: CanopyBenchmarkPoint[];
  rocks: CanopyBenchmarkPoint[];
}

interface TileRuntime {
  lod: THREE.LOD;
  centerX: number;
  centerZ: number;
  sablePines: number;
  frostSpruces: number;
  groundcover: number;
  rocks: number;
}

export interface ForestStressDiagnostics {
  id: string;
  label: string;
  active: boolean;
  level: CanopyBenchmarkLevel;
  levelLabel: string;
  distanceMeters: number;
  trees: number;
  groundcover: number;
  rocks: number;
  reeds: number;
  authoredInstances: number;
  allocatedInstances: number;
  activeLodInstances: number;
  estimatedActiveLodTriangles: number;
  estimatedActiveLodDrawCalls: number;
  tiles: number;
  nearTiles: number;
  midTiles: number;
  farTiles: number;
  rebuilds: number;
  buildMilliseconds: number;
  renderOnly: true;
}

function colorGeometry(source: THREE.BufferGeometry, color: number) {
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

function mergeColored(parts: THREE.BufferGeometry[]) {
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error("Canopy benchmark geometry could not be merged");
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createMidTreeGeometry(species: WoodySpeciesDefinition) {
  const trunk = colorGeometry(
    new THREE.CylinderGeometry(0.3, 0.48, 3.5, 5),
    species.trunkColor,
  );
  trunk.translate(0, 1.75, 0);
  const crown = colorGeometry(
    new THREE.ConeGeometry(1.7, 5, 5),
    species.foliageColor,
  );
  crown.translate(0, 5.1, 0);
  const geometry = mergeColored([trunk, crown]);
  geometry.scale(
    species.relativeWidth,
    species.relativeHeight,
    species.relativeWidth,
  );
  return prepareVegetationGeometry(geometry, 0.42);
}

function createFarTreeGeometry(species: WoodySpeciesDefinition) {
  const width = 1.72 * species.relativeWidth;
  const height = 7.7 * species.relativeHeight;
  const positions = new Float32Array([
    -width, 0, 0, width, 0, 0, 0, height, 0,
    0, 0, -width, 0, 0, width, 0, height, 0,
  ]);
  const color = new THREE.Color(species.foliageColor);
  const colors = new Float32Array(positions.length);
  for (let index = 0; index < colors.length; index += 3) {
    colors[index] = color.r;
    colors[index + 1] = color.g;
    colors[index + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return prepareVegetationGeometry(geometry, 0.42);
}

function createReedGeometry() {
  const positions = new Float32Array([
    -0.08, 0, 0, 0.08, 0, 0, 0.025, 1.15, 0,
    -0.08, 0, 0, 0.025, 1.15, 0, -0.025, 1.15, 0,
    0, 0, -0.08, 0, 0, 0.08, 0, 1.15, 0.025,
    0, 0, -0.08, 0, 1.15, 0.025, 0, 1.15, -0.025,
  ]);
  const colors = new Float32Array(positions.length);
  const color = new THREE.Color(0x60754e);
  for (let index = 0; index < colors.length; index += 3) {
    colors[index] = color.r;
    colors[index + 1] = color.g;
    colors[index + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return prepareVegetationGeometry(geometry, 0.12);
}

function geometryTriangles(geometry: THREE.BufferGeometry) {
  return geometry.index
    ? geometry.index.count / 3
    : geometry.getAttribute("position").count / 3;
}

function makeVegetationMaterial(
  layer: "woody" | "groundcover",
  side: THREE.Side = THREE.FrontSide,
) {
  return tagWorldMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      flatShading: true,
      vertexColors: true,
      side,
    }),
    {
      role: "vegetation",
      weatherExposure: 0.82,
      wetRoughness: 0.62,
      environmentScale: 0.5,
      wetReflectionBoost: 0.18,
      detail: false,
      windAmplitude: layer === "woody" ? 0.42 : 0.12,
    },
  );
}

/**
 * A self-contained, render-only proving ground. It intentionally owns no
 * targets, colliders, AI, inventory resources, discovery, or save records.
 */
export class ForestStressTest {
  private readonly nearGeometry = {
    sable_pine: createWoodyGeometry(WOODY_SPECIES.sable_pine),
    frost_spruce: createWoodyGeometry(WOODY_SPECIES.frost_spruce),
  };
  private readonly midGeometry = {
    sable_pine: createMidTreeGeometry(WOODY_SPECIES.sable_pine),
    frost_spruce: createMidTreeGeometry(WOODY_SPECIES.frost_spruce),
  };
  private readonly farGeometry = {
    sable_pine: createFarTreeGeometry(WOODY_SPECIES.sable_pine),
    frost_spruce: createFarTreeGeometry(WOODY_SPECIES.frost_spruce),
  };
  private readonly groundcoverGeometry = createGroundcoverGeometry(
    VEGETATION_PROFILES.pine_forest,
  );
  private readonly rockGeometry = new THREE.DodecahedronGeometry(1, 0);
  private readonly reedGeometry = createReedGeometry();
  private readonly treeMaterial = makeVegetationMaterial("woody");
  private readonly farTreeMaterial = makeVegetationMaterial(
    "woody",
    THREE.DoubleSide,
  );
  private readonly groundcoverMaterial = makeVegetationMaterial("groundcover");
  private readonly reedMaterial = makeVegetationMaterial(
    "groundcover",
    THREE.DoubleSide,
  );
  private readonly rockMaterial = tagWorldMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x4d5149,
      roughness: 1,
      flatShading: true,
    }),
    {
      role: "rock",
      weatherExposure: 1,
      wetRoughness: 0.36,
      environmentScale: 0.68,
      wetReflectionBoost: 0.52,
    },
  );
  private root: THREE.Group | null = null;
  private tiles: TileRuntime[] = [];
  private level: CanopyBenchmarkLevel = 2;
  private quality: QualityLevel;
  private disposed = false;
  private lastPlayerX = Number.POSITIVE_INFINITY;
  private lastPlayerZ = Number.POSITIVE_INFINITY;
  private rebuilds = 0;
  private buildMilliseconds = 0;
  private activeLodInstances = 0;
  private estimatedActiveLodTriangles = 0;
  private estimatedActiveLodDrawCalls = 0;
  private activeLodSampleX = Number.POSITIVE_INFINITY;
  private activeLodSampleZ = Number.POSITIVE_INFINITY;
  private nearTiles = 0;
  private midTiles = 0;
  private farTiles = 0;

  constructor(
    private readonly scene: THREE.Scene,
    quality: QualityLevel,
    private readonly materialLibrary: WorldMaterialLibrary,
  ) {
    this.quality = quality;
  }

  update(playerX: number, playerZ: number, enabled = true) {
    if (this.disposed) return false;
    this.lastPlayerX = playerX;
    this.lastPlayerZ = playerZ;
    if (!enabled) {
      this.clear();
      return false;
    }
    const distance = canopyBenchmarkDistance(playerX, playerZ);
    if (!this.root && distance <= CANOPY_BENCHMARK_ZONE.activationRadius) {
      this.build();
    } else if (this.root && distance > CANOPY_BENCHMARK_ZONE.unloadRadius) {
      this.clear();
    }
    if (this.root) this.updateActiveLodBudget(playerX, playerZ);
    return this.root !== null;
  }

  setLevel(level: number) {
    const normalized = normalizeCanopyBenchmarkLevel(level);
    if (normalized === this.level) return false;
    this.level = normalized;
    if (this.root) {
      this.clear();
      this.build();
      this.updateActiveLodBudget(this.lastPlayerX, this.lastPlayerZ);
    }
    return true;
  }

  setQuality(quality: QualityLevel) {
    if (this.quality === quality) return false;
    this.quality = quality;
    if (this.root) this.applyShadowPolicy();
    return true;
  }

  get diagnostics(): ForestStressDiagnostics {
    const definition = CANOPY_BENCHMARK_LEVELS[this.level];
    return {
      id: CANOPY_BENCHMARK_ZONE.id,
      label: CANOPY_BENCHMARK_ZONE.label,
      active: this.root !== null,
      level: this.level,
      levelLabel: definition.label,
      distanceMeters: Number.isFinite(this.lastPlayerX)
        ? canopyBenchmarkDistance(this.lastPlayerX, this.lastPlayerZ)
        : Number.POSITIVE_INFINITY,
      trees: this.root ? definition.trees : 0,
      groundcover: this.root ? definition.groundcover : 0,
      rocks: this.root ? definition.rocks : 0,
      reeds: this.root ? definition.reeds : 0,
      authoredInstances: this.root
        ? definition.trees +
          definition.groundcover +
          definition.rocks +
          definition.reeds
        : 0,
      allocatedInstances: this.root
        ? definition.trees * 3 +
          definition.groundcover +
          definition.rocks +
          definition.reeds
        : 0,
      activeLodInstances: this.activeLodInstances,
      estimatedActiveLodTriangles: this.estimatedActiveLodTriangles,
      estimatedActiveLodDrawCalls: this.estimatedActiveLodDrawCalls,
      tiles: this.tiles.length,
      nearTiles: this.nearTiles,
      midTiles: this.midTiles,
      farTiles: this.farTiles,
      rebuilds: this.rebuilds,
      buildMilliseconds: this.buildMilliseconds,
      renderOnly: true,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    for (const geometry of Object.values(this.nearGeometry)) geometry.dispose();
    for (const geometry of Object.values(this.midGeometry)) geometry.dispose();
    for (const geometry of Object.values(this.farGeometry)) geometry.dispose();
    this.groundcoverGeometry.dispose();
    this.rockGeometry.dispose();
    this.reedGeometry.dispose();
    this.treeMaterial.dispose();
    this.farTreeMaterial.dispose();
    this.groundcoverMaterial.dispose();
    this.reedMaterial.dispose();
    this.rockMaterial.dispose();
  }

  private build() {
    if (this.disposed || this.root) return;
    const startedAt = performance.now();
    const definition = CANOPY_BENCHMARK_LEVELS[this.level];
    const root = new THREE.Group();
    root.name = `benchmark:${CANOPY_BENCHMARK_ZONE.id}`;
    root.userData.benchmarkFixture = true;
    root.userData.renderOnly = true;
    const recipes = this.createTileRecipes(definition);
    this.tiles = [...recipes.values()].map((recipe) =>
      this.createTile(recipe, root),
    );
    this.addReeds(root, generateCanopyBenchmarkReeds(definition.reeds));
    this.materialLibrary.track(root);
    this.scene.add(root);
    this.root = root;
    this.rebuilds += 1;
    this.buildMilliseconds = performance.now() - startedAt;
    this.applyShadowPolicy();
  }

  private createTileRecipes(definition: CanopyBenchmarkLevelDefinition) {
    const recipes = new Map<string, TileRecipe>();
    const ensure = (point: CanopyBenchmarkPoint) => {
      const key = canopyBenchmarkTileKey(point.x, point.z);
      let recipe = recipes.get(key);
      if (!recipe) {
        const [tileX, tileZ] = key.split(":").map(Number);
        const half = CANOPY_BENCHMARK_ZONE.forestRadius;
        recipe = {
          key,
          centerX:
            CANOPY_BENCHMARK_ZONE.center.x - half +
            (tileX + 0.5) * CANOPY_BENCHMARK_ZONE.tileSize,
          centerZ:
            CANOPY_BENCHMARK_ZONE.center.z - half +
            (tileZ + 0.5) * CANOPY_BENCHMARK_ZONE.tileSize,
          trees: [],
          groundcover: [],
          rocks: [],
        };
        recipes.set(key, recipe);
      }
      return recipe;
    };
    generateCanopyBenchmarkPoints("trees", definition.trees).forEach(
      (point, index) => {
        ensure(point).trees.push({
          ...point,
          species: index % 5 === 0 ? "frost_spruce" : "sable_pine",
          terrainY: sampleTerrainHeight(point.x, point.z),
        });
      },
    );
    for (const point of generateCanopyBenchmarkPoints(
      "groundcover",
      definition.groundcover,
    )) {
      ensure(point).groundcover.push(point);
    }
    for (const point of generateCanopyBenchmarkPoints("rocks", definition.rocks)) {
      ensure(point).rocks.push(point);
    }
    return recipes;
  }

  private createTile(recipe: TileRecipe, root: THREE.Group): TileRuntime {
    const baseY = sampleTerrainHeight(recipe.centerX, recipe.centerZ);
    const lod = new THREE.LOD();
    lod.name = `benchmark-tile:${recipe.key}`;
    lod.position.set(recipe.centerX, baseY, recipe.centerZ);
    lod.userData.benchmarkFixture = true;
    const near = new THREE.Group();
    const mid = new THREE.Group();
    const far = new THREE.Group();
    const sable = recipe.trees.filter((tree) => tree.species === "sable_pine");
    const spruce = recipe.trees.filter((tree) => tree.species === "frost_spruce");
    this.addTreeMeshes(near, mid, far, sable, "sable_pine", recipe, baseY);
    this.addTreeMeshes(near, mid, far, spruce, "frost_spruce", recipe, baseY);
    this.addInstancedPoints(
      near,
      recipe.groundcover,
      this.groundcoverGeometry,
      this.groundcoverMaterial,
      recipe,
      baseY,
      "groundcover",
      false,
    );
    this.addInstancedPoints(
      near,
      recipe.rocks,
      this.rockGeometry,
      this.rockMaterial,
      recipe,
      baseY,
      "rocks",
      false,
      0.42,
    );
    lod.addLevel(near, 0);
    lod.addLevel(mid, CANOPY_BENCHMARK_ZONE.nearLodDistance);
    lod.addLevel(far, CANOPY_BENCHMARK_ZONE.midLodDistance);
    root.add(lod);
    return {
      lod,
      centerX: recipe.centerX,
      centerZ: recipe.centerZ,
      sablePines: sable.length,
      frostSpruces: spruce.length,
      groundcover: recipe.groundcover.length,
      rocks: recipe.rocks.length,
    };
  }

  private addTreeMeshes(
    near: THREE.Group,
    mid: THREE.Group,
    far: THREE.Group,
    points: readonly TreePoint[],
    species: TreePoint["species"],
    recipe: TileRecipe,
    baseY: number,
  ) {
    if (points.length === 0) return;
    this.addInstancedPoints(
      near,
      points,
      this.nearGeometry[species],
      this.treeMaterial,
      recipe,
      baseY,
      `${species}:near`,
      true,
    );
    this.addInstancedPoints(
      mid,
      points,
      this.midGeometry[species],
      this.treeMaterial,
      recipe,
      baseY,
      `${species}:mid`,
      false,
    );
    this.addInstancedPoints(
      far,
      points,
      this.farGeometry[species],
      this.farTreeMaterial,
      recipe,
      baseY,
      `${species}:far`,
      false,
    );
  }

  private addInstancedPoints(
    group: THREE.Group,
    points: readonly ElevatedBenchmarkPoint[],
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    recipe: TileRecipe,
    baseY: number,
    name: string,
    castsShadow: boolean,
    verticalOffsetScale = 0,
  ) {
    if (points.length === 0) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, points.length);
    mesh.name = `benchmark:${recipe.key}:${name}`;
    mesh.userData.benchmarkFixture = true;
    mesh.userData.shadowCandidate = castsShadow;
    mesh.castShadow = castsShadow && qualityUsesShadows(this.quality);
    mesh.receiveShadow = name !== "groundcover";
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();
    points.forEach((point, index) => {
      const y = point.terrainY ?? sampleTerrainHeight(point.x, point.z);
      position.set(
        point.x - recipe.centerX,
        y - baseY + point.scale * verticalOffsetScale,
        point.z - recipe.centerZ,
      );
      quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, point.yaw);
      scale.set(point.scale, point.scale, point.scale);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      color.setRGB(point.tint, point.tint, point.tint);
      mesh.setColorAt(index, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    group.add(mesh);
    return mesh;
  }

  private addReeds(root: THREE.Group, points: readonly CanopyBenchmarkPoint[]) {
    if (points.length === 0) return;
    const mesh = new THREE.InstancedMesh(
      this.reedGeometry,
      this.reedMaterial,
      points.length,
    );
    mesh.name = "benchmark:lake-reeds";
    mesh.userData.benchmarkFixture = true;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();
    points.forEach((point, index) => {
      position.set(
        point.x,
        sampleTerrainHeight(point.x, point.z),
        point.z,
      );
      quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, point.yaw);
      scale.set(point.scale, point.scale, point.scale);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      color.setRGB(point.tint, point.tint, point.tint);
      mesh.setColorAt(index, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    root.add(mesh);
  }

  private updateActiveLodBudget(playerX: number, playerZ: number) {
    const movedX = playerX - this.activeLodSampleX;
    const movedZ = playerZ - this.activeLodSampleZ;
    if (movedX * movedX + movedZ * movedZ < 1) return;
    this.activeLodSampleX = playerX;
    this.activeLodSampleZ = playerZ;
    const definition = CANOPY_BENCHMARK_LEVELS[this.level];
    let activeLodInstances = definition.reeds;
    let triangles = definition.reeds * geometryTriangles(this.reedGeometry);
    let draws = definition.reeds > 0 ? 1 : 0;
    let nearTiles = 0;
    let midTiles = 0;
    let farTiles = 0;
    for (const tile of this.tiles) {
      const distance = Math.hypot(playerX - tile.centerX, playerZ - tile.centerZ);
      const speciesDraws = Number(tile.sablePines > 0) + Number(tile.frostSpruces > 0);
      if (distance < CANOPY_BENCHMARK_ZONE.nearLodDistance) {
        nearTiles += 1;
        activeLodInstances +=
          tile.sablePines +
          tile.frostSpruces +
          tile.groundcover +
          tile.rocks;
        triangles +=
          tile.sablePines * geometryTriangles(this.nearGeometry.sable_pine) +
          tile.frostSpruces * geometryTriangles(this.nearGeometry.frost_spruce) +
          tile.groundcover * geometryTriangles(this.groundcoverGeometry) +
          tile.rocks * geometryTriangles(this.rockGeometry);
        draws += speciesDraws + Number(tile.groundcover > 0) + Number(tile.rocks > 0);
      } else if (distance < CANOPY_BENCHMARK_ZONE.midLodDistance) {
        midTiles += 1;
        activeLodInstances += tile.sablePines + tile.frostSpruces;
        triangles +=
          tile.sablePines * geometryTriangles(this.midGeometry.sable_pine) +
          tile.frostSpruces * geometryTriangles(this.midGeometry.frost_spruce);
        draws += speciesDraws;
      } else {
        farTiles += 1;
        activeLodInstances += tile.sablePines + tile.frostSpruces;
        triangles +=
          tile.sablePines * geometryTriangles(this.farGeometry.sable_pine) +
          tile.frostSpruces * geometryTriangles(this.farGeometry.frost_spruce);
        draws += speciesDraws;
      }
    }
    this.activeLodInstances = activeLodInstances;
    this.estimatedActiveLodTriangles = Math.round(triangles);
    this.estimatedActiveLodDrawCalls = draws;
    this.nearTiles = nearTiles;
    this.midTiles = midTiles;
    this.farTiles = farTiles;
  }

  private applyShadowPolicy() {
    this.root?.traverse((object) => {
      if (!(object instanceof THREE.InstancedMesh)) return;
      object.castShadow =
        object.userData.shadowCandidate === true &&
        qualityUsesShadows(this.quality);
    });
  }

  private clear() {
    if (!this.root) return;
    const root = this.root;
    this.root = null;
    this.materialLibrary.untrack(root);
    this.scene.remove(root);
    root.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
    root.clear();
    this.tiles = [];
    this.activeLodInstances = 0;
    this.estimatedActiveLodTriangles = 0;
    this.estimatedActiveLodDrawCalls = 0;
    this.activeLodSampleX = Number.POSITIVE_INFINITY;
    this.activeLodSampleZ = Number.POSITIVE_INFINITY;
    this.nearTiles = 0;
    this.midTiles = 0;
    this.farTiles = 0;
  }
}
