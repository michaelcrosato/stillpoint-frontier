import * as THREE from "three";
import type { QualityLevel } from "../config";
import type { PlanarCollider } from "../systems/collision";
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
  roofAccess: false,
  wallHeight: 3.5,
  wallThickness: 0.22,
  roofThickness: 0.24,
  doorWidth: 1.5,
  // A tall industrial doorway keeps the visible header above the complete
  // Version 10 jump arc. The V10 collision model is intentionally planar, so
  // this avoids presenting a low lintel that the player could clip through.
  doorHeight: 3.2,
  windowWidth: 1.5,
  windowHeight: 1.1,
  windowSill: 0.92,
  foundationDepth: floorY - foundationBottomY,
  clearanceRadius: Math.hypot(SITE.width, SITE.depth) * 0.5 + 1.25,
});

export interface SpawnBuildingRuntime {
  root: THREE.Group;
  colliders: PlanarCollider[];
}

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
  };
}

export function spawnBuildingSupportHeight(x: number, z: number) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
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
  return inside || onDoorThreshold ? SPAWN_BUILDING.floorY : null;
}

export function createSpawnBuilding(
  quality: QualityLevel,
): SpawnBuildingRuntime {
  const definition = SPAWN_BUILDING;
  const root = new THREE.Group();
  root.name = `spawn-building:${definition.id}`;
  root.position.set(definition.x, definition.floorY, definition.z);
  root.userData.enterable = true;
  root.userData.floorCount = definition.floorCount;

  const wallTemplate = new THREE.MeshStandardMaterial({
    color: 0x777166,
    roughness: 0.9,
    metalness: 0.04,
  });
  const floorTemplate = new THREE.MeshStandardMaterial({
    color: 0x4d4b45,
    roughness: 0.86,
    metalness: 0.08,
  });
  const roofTemplate = new THREE.MeshStandardMaterial({
    color: 0x343735,
    roughness: 0.76,
    metalness: 0.24,
  });
  const trimTemplate = new THREE.MeshStandardMaterial({
    color: 0x252826,
    roughness: 0.72,
    metalness: 0.3,
  });
  const glassTemplate = new THREE.MeshPhysicalMaterial({
    color: 0x9ab8b7,
    roughness: 0.18,
    metalness: 0.05,
    transmission: 0.28,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
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
    mesh.castShadow = quality === "cinematic" && materialKind !== "glass";
    mesh.receiveShadow = materialKind !== "glass";
    mesh.userData.shadow = materialKind !== "glass";
    root.add(mesh);
    return mesh;
  };

  addBox(
    "floor",
    [definition.width, definition.foundationDepth, definition.depth],
    [0, -definition.foundationDepth * 0.5, 0],
    "floor",
  );
  addBox(
    "roof",
    [definition.width + 0.36, definition.roofThickness, definition.depth + 0.36],
    [0, definition.wallHeight + definition.roofThickness * 0.5, 0],
    "roof",
  );

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
  addBox(
    "door:open-leaf",
    [definition.doorWidth, definition.doorHeight, 0.07],
    [
      -definition.doorWidth * 0.5,
      definition.doorHeight * 0.5,
      frontZ - definition.doorWidth * 0.5,
    ],
    "trim",
    Math.PI * 0.5,
  );

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
  ];

  return { root, colliders };
}
