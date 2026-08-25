import * as THREE from "three";
import { tagWorldMaterial } from "../rendering/WorldMaterialLibrary";
import { qualityUsesShadows, type QualityLevel } from "../config";
import type { PlanarCollider } from "../systems/collision";
import {
  createAuthoredDoor,
} from "./authoredDoor";
import type { AuthoredBuildingRuntime } from "./buildingTypes";
import { sampleTerrainHeight } from "./terrain";

const SITE = {
  x: 12,
  z: -6,
  width: 8,
  depth: 6,
} as const;

const footprintTerrain = [-1, 0, 1].flatMap((xStep) =>
  [-1, 0, 1].map((zStep) =>
    sampleTerrainHeight(
      SITE.x + xStep * SITE.width * 0.5,
      SITE.z + zStep * SITE.depth * 0.5,
    ),
  ),
);
const floorY = Math.max(...footprintTerrain) + 0.04;
const foundationBottomY = Math.min(...footprintTerrain) - 0.08;
const ROOF_STAIR_STEPS = 20;
const ROOF_STAIR_START_Z = 2.25;
const ROOF_STAIR_END_Z = -2.25;
const ROOF_STAIR_RUN = ROOF_STAIR_START_Z - ROOF_STAIR_END_Z;
const ROOF_STAIR_TREAD = ROOF_STAIR_RUN / ROOF_STAIR_STEPS;
const ROOF_STAIR_RAIL_START_Z =
  ROOF_STAIR_START_Z - ROOF_STAIR_TREAD * 4;
const ROOF_STAIR_CENTER_X = 2.55;
const ROOF_STAIR_WIDTH = 1.35;
const WALL_HEIGHT = 3.5;
const ROOF_THICKNESS = 0.24;
const roofY = floorY + WALL_HEIGHT + ROOF_THICKNESS;

/**
 * The only detailed/enterable building in the Version 10 prototype world.
 * Keep this authored recipe small and explicit while the building model is
 * iterated, instead of applying unfinished interior logic to every city.
 */
export const SPAWN_BUILDING = Object.freeze({
  id: "spawn-field-unit-01",
  name: "Field Unit 01",
  chunkKey: "0:0",
  x: SITE.x,
  z: SITE.z,
  width: SITE.width,
  depth: SITE.depth,
  floorY,
  floorCount: 1,
  hasBasement: false,
  roofAccess: true,
  doorId: "spawn-field-unit-01:front",
  wallHeight: WALL_HEIGHT,
  wallThickness: 0.22,
  roofThickness: ROOF_THICKNESS,
  roofY,
  doorWidth: 1.5,
  // A tall industrial doorway keeps the visible header above the complete
  // Version 10 jump arc. The V10 collision model is intentionally planar, so
  // this avoids presenting a low lintel that the player could clip through.
  doorHeight: 3.2,
  windowWidth: 1.5,
  windowHeight: 1.1,
  windowSill: 0.92,
  roofStairCenterX: ROOF_STAIR_CENTER_X,
  roofStairWidth: ROOF_STAIR_WIDTH,
  roofStairStartZ: ROOF_STAIR_START_Z,
  roofStairEndZ: ROOF_STAIR_END_Z,
  roofStairSteps: ROOF_STAIR_STEPS,
  roofStairRise: (roofY - floorY) / ROOF_STAIR_STEPS,
  roofStairTread: ROOF_STAIR_TREAD,
  roofStairRailStartZ: ROOF_STAIR_RAIL_START_Z,
  roofStairwellMinX: 1.78,
  roofStairwellMaxX: 3.32,
  roofStairwellMinZ: ROOF_STAIR_END_Z,
  roofStairwellMaxZ: ROOF_STAIR_START_Z,
  foundationDepth: floorY - foundationBottomY,
  clearanceRadius: Math.hypot(SITE.width, SITE.depth) * 0.5 + 1.25,
});

export type SpawnBuildingRuntime = AuthoredBuildingRuntime;

function wallCollider(
  id: string,
  x: number,
  z: number,
  halfWidth: number,
  halfDepth: number,
): PlanarCollider {
  return {
    shape: "box",
    id: `spawn-building:${SPAWN_BUILDING.id}:wall:${id}`,
    x,
    z,
    halfWidth,
    halfDepth,
    rotation: 0,
    minY: SPAWN_BUILDING.floorY,
    maxY: SPAWN_BUILDING.floorY + SPAWN_BUILDING.wallHeight,
  };
}

function localBoxCollider(
  id: string,
  localX: number,
  localZ: number,
  halfWidth: number,
  halfDepth: number,
  minY: number,
  maxY: number,
): PlanarCollider {
  return {
    shape: "box",
    id: `spawn-building:${SPAWN_BUILDING.id}:${id}`,
    x: SPAWN_BUILDING.x + localX,
    z: SPAWN_BUILDING.z + localZ,
    halfWidth,
    halfDepth,
    rotation: 0,
    minY,
    maxY,
  };
}

export function spawnBuildingSupportCandidates(x: number, z: number): number[] {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return [];
  const localX = x - SPAWN_BUILDING.x;
  const localZ = z - SPAWN_BUILDING.z;
  const innerHalfWidth = SPAWN_BUILDING.width * 0.5 - SPAWN_BUILDING.wallThickness;
  const innerHalfDepth = SPAWN_BUILDING.depth * 0.5 - SPAWN_BUILDING.wallThickness;
  const inside =
    Math.abs(localX) <= innerHalfWidth && Math.abs(localZ) <= innerHalfDepth;
  const onDoorThreshold =
    Math.abs(localX) <= SPAWN_BUILDING.doorWidth * 0.5 &&
    localZ > innerHalfDepth &&
    localZ <= SPAWN_BUILDING.depth * 0.5 + 0.55;
  if (!inside && !onDoorThreshold) return [];
  const supports = [SPAWN_BUILDING.floorY];
  if (!inside) return supports;

  const onRoofStair =
    Math.abs(localX - SPAWN_BUILDING.roofStairCenterX) <=
      SPAWN_BUILDING.roofStairWidth * 0.5 &&
    localZ <= SPAWN_BUILDING.roofStairStartZ &&
    localZ >= SPAWN_BUILDING.roofStairEndZ;
  if (onRoofStair) {
    const progress = THREE.MathUtils.clamp(
      (SPAWN_BUILDING.roofStairStartZ - localZ) / ROOF_STAIR_RUN,
      0,
      0.999999,
    );
    const stepIndex = Math.floor(progress * SPAWN_BUILDING.roofStairSteps);
    supports.push(
      SPAWN_BUILDING.floorY +
        (stepIndex + 1) * SPAWN_BUILDING.roofStairRise,
    );
  }

  const inRoofOpening =
    localX >= SPAWN_BUILDING.roofStairwellMinX &&
    localX <= SPAWN_BUILDING.roofStairwellMaxX &&
    localZ >= SPAWN_BUILDING.roofStairwellMinZ &&
    localZ <= SPAWN_BUILDING.roofStairwellMaxZ;
  if (!inRoofOpening) supports.push(SPAWN_BUILDING.roofY);
  return [...new Set(supports)].sort((left, right) => left - right);
}

export function spawnBuildingSupportHeight(x: number, z: number) {
  return spawnBuildingSupportCandidates(x, z)[0] ?? null;
}

export function createSpawnBuilding(
  quality: QualityLevel,
  initialDoorOpen = false,
): SpawnBuildingRuntime {
  const definition = SPAWN_BUILDING;
  const root = new THREE.Group();
  root.name = `spawn-building:${definition.id}`;
  root.position.set(definition.x, definition.floorY, definition.z);
  root.userData.enterable = true;
  root.userData.floorCount = definition.floorCount;
  root.userData.roofAccess = true;

  const wallTemplate = tagWorldMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x777166,
      roughness: 0.9,
      metalness: 0.04,
    }),
    { role: "building", weatherExposure: 0, environmentScale: 0.78 },
  );
  const floorTemplate = tagWorldMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x4d4b45,
      roughness: 0.86,
      metalness: 0.08,
    }),
    { role: "building", weatherExposure: 0, environmentScale: 0.72 },
  );
  const roofTemplate = tagWorldMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x343735,
      roughness: 0.76,
      metalness: 0.24,
    }),
    {
      role: "roof",
      weatherExposure: 1,
      wetRoughness: 0.3,
      environmentScale: 0.94,
      wetReflectionBoost: 0.5,
    },
  );
  const trimTemplate = tagWorldMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x252826,
      roughness: 0.72,
      metalness: 0.3,
    }),
    { role: "metal", weatherExposure: 0, environmentScale: 0.92 },
  );
  const glassTemplate = new THREE.MeshPhysicalMaterial({
    color: 0x8fbfc8,
    roughness: 0.12,
    metalness: 0.05,
    transmission: 0.72,
    thickness: 0.045,
    ior: 1.46,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const materials = {
    wall: wallTemplate,
    floor: floorTemplate,
    roof: roofTemplate,
    trim: trimTemplate,
    glass: glassTemplate,
  } as const;

  const addBox = (
    name: string,
    size: readonly [number, number, number],
    position: readonly [number, number, number],
    materialKind: keyof typeof materials,
    rotationY = 0,
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size[0], size[1], size[2]),
      materials[materialKind].clone(),
    );
    mesh.name = `spawn-building:${name}`;
    mesh.position.set(position[0], position[1], position[2]);
    mesh.rotation.y = rotationY;
    mesh.castShadow = qualityUsesShadows(quality) && materialKind !== "glass";
    mesh.receiveShadow = materialKind !== "glass";
    mesh.userData.shadow = materialKind !== "glass";
    mesh.userData.glass = materialKind === "glass";
    root.add(mesh);
    return mesh;
  };

  const addBoxBatch = (
    name: string,
    recipes: readonly {
      size: readonly [number, number, number];
      position: readonly [number, number, number];
    }[],
    materialKind: keyof typeof materials,
  ) => {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      materials[materialKind].clone(),
      recipes.length,
    );
    mesh.name = `spawn-building:${name}`;
    mesh.castShadow = qualityUsesShadows(quality) && materialKind !== "glass";
    mesh.receiveShadow = materialKind !== "glass";
    mesh.userData.shadow = materialKind !== "glass";
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    recipes.forEach((recipe, index) => {
      position.set(...recipe.position);
      scale.set(...recipe.size);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    root.add(mesh);
    return mesh;
  };

  addBox(
    "floor",
    [definition.width, definition.foundationDepth, definition.depth],
    [0, -definition.foundationDepth * 0.5, 0],
    "floor",
  );
  const roofHalfWidth = definition.width * 0.5 + 0.18;
  const roofHalfDepth = definition.depth * 0.5 + 0.18;
  const roofCenterY = definition.wallHeight + definition.roofThickness * 0.5;
  const roofRegions: Array<{
    size: readonly [number, number, number];
    position: readonly [number, number, number];
  }> = [];
  const addRoofRegion = (
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
  ) => {
    if (maxX <= minX || maxZ <= minZ) return;
    roofRegions.push({
      size: [maxX - minX, definition.roofThickness, maxZ - minZ],
      position: [(minX + maxX) * 0.5, roofCenterY, (minZ + maxZ) * 0.5],
    });
  };
  addRoofRegion(
    -roofHalfWidth,
    definition.roofStairwellMinX,
    -roofHalfDepth,
    roofHalfDepth,
  );
  addRoofRegion(
    definition.roofStairwellMaxX,
    roofHalfWidth,
    -roofHalfDepth,
    roofHalfDepth,
  );
  addRoofRegion(
    definition.roofStairwellMinX,
    definition.roofStairwellMaxX,
    definition.roofStairwellMaxZ,
    roofHalfDepth,
  );
  addRoofRegion(
    definition.roofStairwellMinX,
    definition.roofStairwellMaxX,
    -roofHalfDepth,
    definition.roofStairwellMinZ,
  );
  addBoxBatch("roof", roofRegions, "roof");

  const frontZ = definition.depth * 0.5;
  const backZ = -frontZ;
  const sideX = definition.width * 0.5;
  const frontSegmentWidth = (definition.width - definition.doorWidth) * 0.5;
  const frontSegmentOffset = definition.doorWidth * 0.5 + frontSegmentWidth * 0.5;
  addBox(
    "wall:front-left",
    [frontSegmentWidth, definition.wallHeight, definition.wallThickness],
    [-frontSegmentOffset, definition.wallHeight * 0.5, frontZ],
    "wall",
  );
  addBox(
    "wall:front-right",
    [frontSegmentWidth, definition.wallHeight, definition.wallThickness],
    [frontSegmentOffset, definition.wallHeight * 0.5, frontZ],
    "wall",
  );
  addBox(
    "wall:front-header",
    [
      definition.doorWidth,
      definition.wallHeight - definition.doorHeight,
      definition.wallThickness,
    ],
    [
      0,
      definition.doorHeight +
        (definition.wallHeight - definition.doorHeight) * 0.5,
      frontZ,
    ],
    "wall",
  );

  const addWindowedWall = (
    side: "back" | "left" | "right",
    runsAlongX: boolean,
    fixedCoordinate: number,
    length: number,
  ) => {
    const columnLength = (length - definition.windowWidth) * 0.5;
    const columnOffset = definition.windowWidth * 0.5 + columnLength * 0.5;
    const lowerHeight = definition.windowSill;
    const windowTop = definition.windowSill + definition.windowHeight;
    const upperHeight = definition.wallHeight - windowTop;
    const columnSize: [number, number, number] = runsAlongX
      ? [columnLength, definition.wallHeight, definition.wallThickness]
      : [definition.wallThickness, definition.wallHeight, columnLength];
    const lowerSize: [number, number, number] = runsAlongX
      ? [definition.windowWidth, lowerHeight, definition.wallThickness]
      : [definition.wallThickness, lowerHeight, definition.windowWidth];
    const upperSize: [number, number, number] = runsAlongX
      ? [definition.windowWidth, upperHeight, definition.wallThickness]
      : [definition.wallThickness, upperHeight, definition.windowWidth];
    const glassSize: [number, number, number] = runsAlongX
      ? [definition.windowWidth - 0.1, definition.windowHeight - 0.1, 0.045]
      : [0.045, definition.windowHeight - 0.1, definition.windowWidth - 0.1];
    const coordinate = (offset: number, y: number): [number, number, number] =>
      runsAlongX
        ? [offset, y, fixedCoordinate]
        : [fixedCoordinate, y, offset];

    addBox(`wall:${side}-a`, columnSize, coordinate(-columnOffset, definition.wallHeight * 0.5), "wall");
    addBox(`wall:${side}-b`, columnSize, coordinate(columnOffset, definition.wallHeight * 0.5), "wall");
    addBox(`wall:${side}-lower`, lowerSize, coordinate(0, lowerHeight * 0.5), "wall");
    addBox(
      `wall:${side}-upper`,
      upperSize,
      coordinate(0, windowTop + upperHeight * 0.5),
      "wall",
    );
    addBox(
      `window:${side}`,
      glassSize,
      coordinate(0, definition.windowSill + definition.windowHeight * 0.5),
      "glass",
    );
  };

  addWindowedWall("back", true, backZ, definition.width);
  addWindowedWall("left", false, -sideX, definition.depth);
  addWindowedWall("right", false, sideX, definition.depth);

  const trimDepth = 0.08;
  addBox(
    "door:trim-left",
    [0.09, definition.doorHeight, trimDepth],
    [-definition.doorWidth * 0.5, definition.doorHeight * 0.5, frontZ + 0.13],
    "trim",
  );

  const stairRecipes: Array<{
    size: readonly [number, number, number];
    position: readonly [number, number, number];
  }> = [];
  for (let step = 0; step < definition.roofStairSteps; step += 1) {
    const stepY = (step + 1) * definition.roofStairRise;
    const stepZ =
      definition.roofStairStartZ - (step + 0.5) * definition.roofStairTread;
    stairRecipes.push({
      size: [
        definition.roofStairWidth,
        definition.roofStairRise,
        definition.roofStairTread + 0.012,
      ],
      position: [
        definition.roofStairCenterX,
        stepY - definition.roofStairRise * 0.5,
        stepZ,
      ],
    });
  }
  addBoxBatch("roof-stair:steps", stairRecipes, "floor");

  const roofTrimRecipes: Array<{
    size: readonly [number, number, number];
    position: readonly [number, number, number];
  }> = [];
  for (const side of [-1, 1] as const) {
    // Leave the first four low steps open so the player can enter the stair
    // laterally without squeezing between the front wall and rail endcaps.
    for (let section = 1; section < 5; section += 1) {
      const startStep = Math.floor((section * definition.roofStairSteps) / 5);
      const endStep = Math.floor(((section + 1) * definition.roofStairSteps) / 5);
      const startZ = definition.roofStairStartZ - startStep * definition.roofStairTread;
      const endZ = definition.roofStairStartZ - endStep * definition.roofStairTread;
      roofTrimRecipes.push({
        size: [0.07, 0.12, startZ - endZ],
        position: [
          definition.roofStairCenterX +
            side * (definition.roofStairWidth * 0.5 + 0.035),
          endStep * definition.roofStairRise + 0.62,
          (startZ + endZ) * 0.5,
        ],
      });
    }
  }
  const roofOffsetY = definition.wallHeight + definition.roofThickness;
  const parapetY = roofOffsetY + 0.525;
  roofTrimRecipes.push(
    {
      size: [definition.width + 0.18, 1.05, 0.09],
      position: [0, parapetY, -definition.depth * 0.5],
    },
    {
      size: [definition.width + 0.18, 1.05, 0.09],
      position: [0, parapetY, definition.depth * 0.5],
    },
    {
      size: [0.09, 1.05, definition.depth],
      position: [-definition.width * 0.5, parapetY, 0],
    },
    {
      size: [0.09, 1.05, definition.depth],
      position: [definition.width * 0.5, parapetY, 0],
    },
    {
      size: [
        definition.roofStairwellMaxX - definition.roofStairwellMinX,
        1.05,
        0.08,
      ],
      position: [
        (definition.roofStairwellMinX + definition.roofStairwellMaxX) * 0.5,
        parapetY,
        definition.roofStairwellMaxZ,
      ],
    },
    {
      size: [0.08, 1.05, ROOF_STAIR_RUN],
      position: [definition.roofStairwellMinX, parapetY, 0],
    },
    {
      size: [0.08, 1.05, ROOF_STAIR_RUN],
      position: [definition.roofStairwellMaxX, parapetY, 0],
    },
  );
  addBoxBatch("roof-stair:rails-and-parapets", roofTrimRecipes, "trim");
  addBox(
    "door:trim-right",
    [0.09, definition.doorHeight, trimDepth],
    [definition.doorWidth * 0.5, definition.doorHeight * 0.5, frontZ + 0.13],
    "trim",
  );
  addBox(
    "door:trim-top",
    [definition.doorWidth + 0.18, 0.09, trimDepth],
    [0, definition.doorHeight, frontZ + 0.13],
    "trim",
  );
  const door = createAuthoredDoor(
    {
      id: definition.doorId,
      name: `${definition.name} door`,
      buildingX: definition.x,
      buildingZ: definition.z,
      floorY: definition.floorY,
      hingeX: -definition.doorWidth * 0.5,
      hingeZ: frontZ,
      width: definition.doorWidth,
      height: definition.doorHeight,
      thickness: 0.07,
    },
    trimTemplate,
    initialDoorOpen,
  );
  door.pivot.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = qualityUsesShadows(quality);
  });
  root.add(door.pivot);

  for (const material of Object.values(materials)) material.dispose();

  const colliders = [
    wallCollider(
      "back",
      definition.x,
      definition.z + backZ,
      definition.width * 0.5,
      definition.wallThickness * 0.5,
    ),
    wallCollider(
      "left",
      definition.x - sideX,
      definition.z,
      definition.wallThickness * 0.5,
      definition.depth * 0.5,
    ),
    wallCollider(
      "right",
      definition.x + sideX,
      definition.z,
      definition.wallThickness * 0.5,
      definition.depth * 0.5,
    ),
    wallCollider(
      "front-left",
      definition.x - frontSegmentOffset,
      definition.z + frontZ,
      frontSegmentWidth * 0.5,
      definition.wallThickness * 0.5,
    ),
    wallCollider(
      "front-right",
      definition.x + frontSegmentOffset,
      definition.z + frontZ,
      frontSegmentWidth * 0.5,
      definition.wallThickness * 0.5,
    ),
    localBoxCollider(
      "wall:front-header",
      0,
      frontZ,
      definition.doorWidth * 0.5,
      definition.wallThickness * 0.5,
      definition.floorY + definition.doorHeight,
      definition.floorY + definition.wallHeight,
    ),
    localBoxCollider(
      "roof-stair:rail:left",
      definition.roofStairCenterX - definition.roofStairWidth * 0.5 - 0.04,
      (definition.roofStairRailStartZ + definition.roofStairEndZ) * 0.5,
      0.04,
      (definition.roofStairRailStartZ - definition.roofStairEndZ) * 0.5,
      definition.floorY,
      definition.roofY + 1.12,
    ),
    localBoxCollider(
      "roof-stair:rail:right",
      definition.roofStairCenterX + definition.roofStairWidth * 0.5 + 0.04,
      (definition.roofStairRailStartZ + definition.roofStairEndZ) * 0.5,
      0.04,
      (definition.roofStairRailStartZ - definition.roofStairEndZ) * 0.5,
      definition.floorY,
      definition.roofY + 1.12,
    ),
    localBoxCollider(
      "roof-stair:inactive-edge",
      (definition.roofStairwellMinX + definition.roofStairwellMaxX) * 0.5,
      definition.roofStairwellMaxZ,
      (definition.roofStairwellMaxX - definition.roofStairwellMinX) * 0.5,
      0.05,
      definition.roofY,
      definition.roofY + 1.05,
    ),
    localBoxCollider(
      "roof:parapet:back",
      0,
      -definition.depth * 0.5,
      definition.width * 0.5,
      0.05,
      definition.roofY,
      definition.roofY + 1.05,
    ),
    localBoxCollider(
      "roof:parapet:front",
      0,
      definition.depth * 0.5,
      definition.width * 0.5,
      0.05,
      definition.roofY,
      definition.roofY + 1.05,
    ),
    localBoxCollider(
      "roof:parapet:left",
      -definition.width * 0.5,
      0,
      0.05,
      definition.depth * 0.5,
      definition.roofY,
      definition.roofY + 1.05,
    ),
    localBoxCollider(
      "roof:parapet:right",
      definition.width * 0.5,
      0,
      0.05,
      definition.depth * 0.5,
      definition.roofY,
      definition.roofY + 1.05,
    ),
    door.collider,
  ];

  return { root, colliders, doors: [door] };
}
