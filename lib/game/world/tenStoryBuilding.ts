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
  x: 4,
  z: 34,
  width: 14,
  depth: 12,
  rotation: Math.PI,
} as const;

const FLOOR_COUNT = 10;
const STORY_HEIGHT = 3.5;
const STAIR_STEPS = 20;
const STAIR_RISE = STORY_HEIGHT / STAIR_STEPS;
const STAIR_FRONT_Z = 3.2;
const STAIR_BACK_Z = -2.6;
const STAIR_RUN = STAIR_FRONT_Z - STAIR_BACK_Z;
const STAIR_TREAD = STAIR_RUN / STAIR_STEPS;
const STAIR_LANE_CENTERS = [3.25, 4.95] as const;

function localToWorld(localX: number, localZ: number) {
  const cosine = Math.cos(SITE.rotation);
  const sine = Math.sin(SITE.rotation);
  return {
    x: SITE.x + cosine * localX + sine * localZ,
    z: SITE.z - sine * localX + cosine * localZ,
  };
}

function worldToLocal(x: number, z: number) {
  const cosine = Math.cos(SITE.rotation);
  const sine = Math.sin(SITE.rotation);
  const deltaX = x - SITE.x;
  const deltaZ = z - SITE.z;
  return {
    x: cosine * deltaX - sine * deltaZ,
    z: sine * deltaX + cosine * deltaZ,
  };
}

const footprintTerrain = [-1, 0, 1].flatMap((xStep) =>
  [-1, 0, 1].map((zStep) => {
    const point = localToWorld(
      xStep * SITE.width * 0.5,
      zStep * SITE.depth * 0.5,
    );
    return sampleTerrainHeight(point.x, point.z);
  }),
);
const floorY = Math.max(...footprintTerrain) + 0.04;
const foundationBottomY = Math.min(...footprintTerrain) - 0.08;
const floorYs = Object.freeze(
  Array.from({ length: FLOOR_COUNT }, (_, floor) => floorY + floor * STORY_HEIGHT),
);
const roofY = floorY + FLOOR_COUNT * STORY_HEIGHT;
const stairFlights = Object.freeze(
  Array.from({ length: FLOOR_COUNT }, (_, index) => {
    const ascendsTowardBack = index % 2 === 0;
    return Object.freeze({
      index,
      fromFloor: index,
      toFloor: index + 1,
      lane: index % 2,
      centerX: STAIR_LANE_CENTERS[index % 2],
      startZ: ascendsTowardBack ? STAIR_FRONT_Z : STAIR_BACK_Z,
      endZ: ascendsTowardBack ? STAIR_BACK_Z : STAIR_FRONT_Z,
      startY: floorYs[index],
      endY: floorYs[index + 1] ?? roofY,
      steps: STAIR_STEPS,
      rise: STAIR_RISE,
      tread: STAIR_TREAD,
    });
  }),
);

/**
 * A deliberately authored spawn landmark. Static instanced boxes keep the
 * ten traversable floors plus the roof inexpensive, while two separate stair
 * lanes prevent vertically stacked support samples from selecting the wrong
 * flight.
 */
export const TEN_STORY_BUILDING = Object.freeze({
  id: "spawn-meridian-tower-03",
  name: "Meridian Tower 03",
  chunkKey: "0:0",
  x: SITE.x,
  z: SITE.z,
  rotation: SITE.rotation,
  width: SITE.width,
  depth: SITE.depth,
  floorY,
  floorYs,
  roofY,
  floorCount: FLOOR_COUNT,
  storyHeight: STORY_HEIGHT,
  wallHeight: FLOOR_COUNT * STORY_HEIGHT,
  wallThickness: 0.24,
  slabThickness: 0.18,
  roofThickness: 0.28,
  parapetHeight: 1.05,
  hasBasement: false,
  roofAccess: true,
  doorId: "spawn-meridian-tower-03:front",
  doorWidth: 1.6,
  doorHeight: 3.2,
  windowWidth: 2.4,
  windowHeight: 1.3,
  windowSill: 1.0,
  stairWidth: 1.4,
  stairSteps: STAIR_STEPS,
  stairRise: STAIR_RISE,
  stairTread: STAIR_TREAD,
  stairwellMinX: 2.48,
  stairwellMaxX: 5.72,
  stairwellMinZ: STAIR_BACK_Z,
  stairwellMaxZ: STAIR_FRONT_Z,
  stairFlights,
  foundationDepth: floorY - foundationBottomY,
  clearanceRadius: Math.hypot(SITE.width, SITE.depth) * 0.5 + 1.25,
});

export type TenStoryBuildingRuntime = AuthoredBuildingRuntime;

interface BoxRecipe {
  size: readonly [number, number, number];
  position: readonly [number, number, number];
}

function boxCollider(
  id: string,
  localX: number,
  localZ: number,
  halfWidth: number,
  halfDepth: number,
  minY = TEN_STORY_BUILDING.floorY,
  maxY = TEN_STORY_BUILDING.floorY + TEN_STORY_BUILDING.wallHeight,
): PlanarCollider {
  const point = localToWorld(localX, localZ);
  return {
    shape: "box",
    id: `ten-story-building:${TEN_STORY_BUILDING.id}:${id}`,
    x: point.x,
    z: point.z,
    halfWidth,
    halfDepth,
    rotation: TEN_STORY_BUILDING.rotation,
    minY,
    maxY,
  };
}

/** Returns every walkable tower surface at this horizontal position. */
export function tenStorySupportCandidates(x: number, z: number): number[] {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return [];
  const definition = TEN_STORY_BUILDING;
  const local = worldToLocal(x, z);
  const innerHalfWidth = definition.width * 0.5 - definition.wallThickness;
  const innerHalfDepth = definition.depth * 0.5 - definition.wallThickness;
  const inside =
    Math.abs(local.x) <= innerHalfWidth && Math.abs(local.z) <= innerHalfDepth;
  const onDoorThreshold =
    Math.abs(local.x) <= definition.doorWidth * 0.5 &&
    local.z > innerHalfDepth &&
    local.z <= definition.depth * 0.5 + 0.55;
  if (!inside && !onDoorThreshold) return [];

  const supports = [definition.floorY];
  if (!inside) return supports;

  const inStairwell =
    local.x >= definition.stairwellMinX &&
    local.x <= definition.stairwellMaxX &&
    local.z >= definition.stairwellMinZ &&
    local.z <= definition.stairwellMaxZ;
  if (!inStairwell) {
    supports.push(...definition.floorYs.slice(1));
    supports.push(definition.roofY);
    return supports;
  }

  for (const flight of definition.stairFlights) {
    const onLane =
      Math.abs(local.x - flight.centerX) <= definition.stairWidth * 0.5;
    if (!onLane) continue;
    const distanceAlong = flight.startZ > flight.endZ
      ? flight.startZ - local.z
      : local.z - flight.startZ;
    const progress = THREE.MathUtils.clamp(distanceAlong / STAIR_RUN, 0, 0.999999);
    const stepIndex = Math.floor(progress * flight.steps);
    supports.push(flight.startY + (stepIndex + 1) * flight.rise);
  }

  return [...new Set(supports)].sort((left, right) => left - right);
}

function createInstanceBatch(
  root: THREE.Group,
  name: string,
  recipes: readonly BoxRecipe[],
  material: THREE.Material,
  options: {
    castShadow?: boolean;
    receiveShadow?: boolean;
    glass?: boolean;
  } = {},
) {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    material,
    recipes.length,
  );
  mesh.name = `ten-story-building:${name}`;
  mesh.castShadow = options.castShadow ?? false;
  mesh.receiveShadow = options.receiveShadow ?? false;
  mesh.userData.shadow = options.castShadow ?? false;
  mesh.userData.glass = options.glass ?? false;
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
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
}

export function createTenStoryBuilding(
  quality: QualityLevel,
  initialDoorOpen = false,
): TenStoryBuildingRuntime {
  const definition = TEN_STORY_BUILDING;
  const root = new THREE.Group();
  root.name = `ten-story-building:${definition.id}`;
  root.position.set(definition.x, definition.floorY, definition.z);
  root.rotation.y = definition.rotation;
  root.userData.enterable = true;
  root.userData.floorCount = definition.floorCount;
  root.userData.roofAccess = definition.roofAccess;
  root.userData.roofY = definition.roofY;

  const materials = {
    wall: tagWorldMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x5d625f,
        roughness: 0.82,
        metalness: 0.12,
      }),
      { role: "building", weatherExposure: 0, environmentScale: 0.84 },
    ),
    floor: tagWorldMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x3e4542,
        roughness: 0.86,
        metalness: 0.14,
      }),
      { role: "building", weatherExposure: 0, environmentScale: 0.76 },
    ),
    roof: tagWorldMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x282f2d,
        roughness: 0.66,
        metalness: 0.38,
      }),
      {
        role: "roof",
        weatherExposure: 1,
        wetRoughness: 0.28,
        environmentScale: 1.04,
        wetReflectionBoost: 0.52,
      },
    ),
    trim: tagWorldMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x202725,
        roughness: 0.62,
        metalness: 0.44,
      }),
      { role: "metal", weatherExposure: 0, environmentScale: 0.98 },
    ),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x81b2bf,
      roughness: 0.1,
      metalness: 0.04,
      transmission: 0.76,
      thickness: 0.055,
      ior: 1.46,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  } as const;

  const wallBoxes: BoxRecipe[] = [];
  const floorBoxes: BoxRecipe[] = [];
  const roofBoxes: BoxRecipe[] = [];
  const trimBoxes: BoxRecipe[] = [];
  const glassBoxes: Record<"front" | "back" | "left" | "right", BoxRecipe[]> = {
    front: [],
    back: [],
    left: [],
    right: [],
  };
  const addRecipe = (
    target: BoxRecipe[],
    size: BoxRecipe["size"],
    position: BoxRecipe["position"],
  ) => target.push({ size, position });

  addRecipe(
    floorBoxes,
    [definition.width, definition.foundationDepth, definition.depth],
    [0, -definition.foundationDepth * 0.5, 0],
  );
  const innerHalfWidth = definition.width * 0.5 - definition.wallThickness;
  const innerHalfDepth = definition.depth * 0.5 - definition.wallThickness;
  for (let floor = 1; floor < definition.floorCount; floor += 1) {
    const slabY = floor * definition.storyHeight - definition.slabThickness * 0.5;
    const slabRegion = (minX: number, maxX: number, minZ: number, maxZ: number) => {
      if (maxX <= minX || maxZ <= minZ) return;
      addRecipe(
        floorBoxes,
        [maxX - minX, definition.slabThickness, maxZ - minZ],
        [(minX + maxX) * 0.5, slabY, (minZ + maxZ) * 0.5],
      );
    };
    slabRegion(
      -innerHalfWidth,
      definition.stairwellMinX,
      -innerHalfDepth,
      innerHalfDepth,
    );
    slabRegion(
      definition.stairwellMaxX,
      innerHalfWidth,
      -innerHalfDepth,
      innerHalfDepth,
    );
    slabRegion(
      definition.stairwellMinX,
      definition.stairwellMaxX,
      definition.stairwellMaxZ,
      innerHalfDepth,
    );
    slabRegion(
      definition.stairwellMinX,
      definition.stairwellMaxX,
      -innerHalfDepth,
      definition.stairwellMinZ,
    );
  }

  const roofSurfaceY = definition.wallHeight;
  const roofCenterY = roofSurfaceY - definition.roofThickness * 0.5;
  const addRoofRegion = (
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
  ) => {
    if (maxX <= minX || maxZ <= minZ) return;
    addRecipe(
      roofBoxes,
      [maxX - minX, definition.roofThickness, maxZ - minZ],
      [(minX + maxX) * 0.5, roofCenterY, (minZ + maxZ) * 0.5],
    );
  };
  addRoofRegion(
    -innerHalfWidth,
    definition.stairwellMinX,
    -innerHalfDepth,
    innerHalfDepth,
  );
  addRoofRegion(
    definition.stairwellMaxX,
    innerHalfWidth,
    -innerHalfDepth,
    innerHalfDepth,
  );
  addRoofRegion(
    definition.stairwellMinX,
    definition.stairwellMaxX,
    definition.stairwellMaxZ,
    innerHalfDepth,
  );
  addRoofRegion(
    definition.stairwellMinX,
    definition.stairwellMaxX,
    -innerHalfDepth,
    definition.stairwellMinZ,
  );

  const addWindowedStory = (
    side: "front" | "back" | "left" | "right",
    story: number,
  ) => {
    const runsAlongX = side === "front" || side === "back";
    const length = runsAlongX ? definition.width : definition.depth;
    const fixed = side === "front"
      ? definition.depth * 0.5
      : side === "back"
        ? -definition.depth * 0.5
        : side === "left"
          ? -definition.width * 0.5
          : definition.width * 0.5;
    const baseY = story * definition.storyHeight;
    const sideLength = (length - definition.windowWidth) * 0.5;
    const sideOffset = definition.windowWidth * 0.5 + sideLength * 0.5;
    const windowTop = definition.windowSill + definition.windowHeight;
    const upperHeight = definition.storyHeight - windowTop;
    const coordinate = (offset: number, y: number): [number, number, number] =>
      runsAlongX ? [offset, baseY + y, fixed] : [fixed, baseY + y, offset];
    const size = (
      run: number,
      height: number,
      thickness: number = definition.wallThickness,
    ): [number, number, number] =>
      runsAlongX ? [run, height, thickness] : [thickness, height, run];

    addRecipe(
      wallBoxes,
      size(sideLength, definition.storyHeight),
      coordinate(-sideOffset, definition.storyHeight * 0.5),
    );
    addRecipe(
      wallBoxes,
      size(sideLength, definition.storyHeight),
      coordinate(sideOffset, definition.storyHeight * 0.5),
    );
    addRecipe(
      wallBoxes,
      size(definition.windowWidth, definition.windowSill),
      coordinate(0, definition.windowSill * 0.5),
    );
    addRecipe(
      wallBoxes,
      size(definition.windowWidth, upperHeight),
      coordinate(0, windowTop + upperHeight * 0.5),
    );
    addRecipe(
      glassBoxes[side],
      size(definition.windowWidth - 0.12, definition.windowHeight - 0.12, 0.045),
      coordinate(0, definition.windowSill + definition.windowHeight * 0.5),
    );
  };

  for (const side of ["back", "left", "right"] as const) {
    for (let story = 0; story < definition.floorCount; story += 1) {
      addWindowedStory(side, story);
    }
  }
  for (let story = 1; story < definition.floorCount; story += 1) {
    addWindowedStory("front", story);
  }

  const frontZ = definition.depth * 0.5;
  const frontSegmentWidth = (definition.width - definition.doorWidth) * 0.5;
  const frontSegmentOffset = definition.doorWidth * 0.5 + frontSegmentWidth * 0.5;
  addRecipe(
    wallBoxes,
    [frontSegmentWidth, definition.storyHeight, definition.wallThickness],
    [-frontSegmentOffset, definition.storyHeight * 0.5, frontZ],
  );
  addRecipe(
    wallBoxes,
    [frontSegmentWidth, definition.storyHeight, definition.wallThickness],
    [frontSegmentOffset, definition.storyHeight * 0.5, frontZ],
  );
  addRecipe(
    wallBoxes,
    [
      definition.doorWidth,
      definition.storyHeight - definition.doorHeight,
      definition.wallThickness,
    ],
    [
      0,
      definition.doorHeight +
        (definition.storyHeight - definition.doorHeight) * 0.5,
      frontZ,
    ],
  );

  const trimDepth = 0.08;
  addRecipe(
    trimBoxes,
    [0.09, definition.doorHeight, trimDepth],
    [-definition.doorWidth * 0.5, definition.doorHeight * 0.5, frontZ + 0.13],
  );
  addRecipe(
    trimBoxes,
    [0.09, definition.doorHeight, trimDepth],
    [definition.doorWidth * 0.5, definition.doorHeight * 0.5, frontZ + 0.13],
  );
  addRecipe(
    trimBoxes,
    [definition.doorWidth + 0.18, 0.09, trimDepth],
    [0, definition.doorHeight, frontZ + 0.13],
  );

  for (const flight of definition.stairFlights) {
    const direction = Math.sign(flight.endZ - flight.startZ);
    const baseY = flight.index * definition.storyHeight;
    for (let step = 0; step < flight.steps; step += 1) {
      const stepY = baseY + (step + 1) * flight.rise;
      const stepZ = flight.startZ + direction * (step + 0.5) * flight.tread;
      addRecipe(
        floorBoxes,
        [definition.stairWidth, flight.rise, flight.tread + 0.012],
        [flight.centerX, stepY - flight.rise * 0.5, stepZ],
      );
    }
    for (const side of [-1, 1] as const) {
      for (let section = 0; section < 5; section += 1) {
        const sectionStart = Math.floor((section * flight.steps) / 5);
        const sectionEnd = Math.floor(((section + 1) * flight.steps) / 5);
        const railStartZ = flight.startZ + direction * sectionStart * flight.tread;
        const railEndZ = flight.startZ + direction * sectionEnd * flight.tread;
        addRecipe(
          trimBoxes,
          [0.07, 0.12, Math.abs(railEndZ - railStartZ)],
          [
            flight.centerX + side * (definition.stairWidth * 0.5 + 0.035),
            baseY + sectionEnd * flight.rise + 0.62,
            (railStartZ + railEndZ) * 0.5,
          ],
        );
      }
    }
  }

  for (let floor = 1; floor < definition.floorCount; floor += 1) {
    const connectedAtBack = floor % 2 === 1;
    const guardZ = connectedAtBack
      ? definition.stairwellMaxZ
      : definition.stairwellMinZ;
    addRecipe(
      trimBoxes,
      [
        definition.stairwellMaxX - definition.stairwellMinX,
        1.05,
        0.08,
      ],
      [
        (definition.stairwellMinX + definition.stairwellMaxX) * 0.5,
        floor * definition.storyHeight + 0.525,
        guardZ,
      ],
    );
  }
  const roofOffset = definition.wallHeight;
  const roofFlight = definition.stairFlights.at(-1);
  const activeRoofLane = roofFlight?.lane ?? 1;
  const unusedRoofLane = STAIR_LANE_CENTERS[activeRoofLane === 0 ? 1 : 0];
  const roofConnectedZ = roofFlight?.endZ ?? definition.stairwellMaxZ;
  const roofOppositeZ = roofFlight?.startZ ?? definition.stairwellMinZ;
  const unusedLaneOuterSide = unusedRoofLane < (roofFlight?.centerX ?? 0) ? -1 : 1;
  addRecipe(
    trimBoxes,
    [
      definition.stairwellMaxX - definition.stairwellMinX,
      definition.parapetHeight,
      0.08,
    ],
    [
      (definition.stairwellMinX + definition.stairwellMaxX) * 0.5,
      roofOffset + definition.parapetHeight * 0.5,
      roofOppositeZ,
    ],
  );
  addRecipe(
    trimBoxes,
    [definition.stairWidth + 0.12, 1.05, 0.08],
    [unusedRoofLane, roofOffset + 0.525, roofConnectedZ],
  );
  addRecipe(
    trimBoxes,
    [0.08, 1.05, STAIR_RUN],
    [
      unusedRoofLane + unusedLaneOuterSide * (definition.stairWidth * 0.5 + 0.04),
      roofOffset + 0.525,
      (definition.stairwellMinZ + definition.stairwellMaxZ) * 0.5,
    ],
  );

  const roofHalfWidth = definition.width * 0.5;
  const roofHalfDepth = definition.depth * 0.5;
  const parapetCenterY = roofOffset + definition.parapetHeight * 0.5;
  for (const z of [-roofHalfDepth, roofHalfDepth]) {
    addRecipe(
      trimBoxes,
      [definition.width, definition.parapetHeight, 0.12],
      [0, parapetCenterY, z],
    );
  }
  for (const x of [-roofHalfWidth, roofHalfWidth]) {
    addRecipe(
      trimBoxes,
      [0.12, definition.parapetHeight, definition.depth - 0.24],
      [x, parapetCenterY, 0],
    );
  }

  createInstanceBatch(
    root,
    "walls",
    wallBoxes,
    materials.wall,
    { castShadow: qualityUsesShadows(quality), receiveShadow: true },
  );
  createInstanceBatch(
    root,
    "floors-and-stairs",
    floorBoxes,
    materials.floor,
    { receiveShadow: true },
  );
  createInstanceBatch(
    root,
    "roof",
    roofBoxes,
    materials.roof,
    { castShadow: qualityUsesShadows(quality), receiveShadow: true },
  );
  createInstanceBatch(
    root,
    "trim-and-rails",
    trimBoxes,
    materials.trim,
  );
  for (const side of ["front", "back", "left", "right"] as const) {
    createInstanceBatch(
      root,
      `glass:${side}`,
      glassBoxes[side],
      materials.glass,
      { glass: true },
    );
  }

  const door = createAuthoredDoor(
    {
      id: definition.doorId,
      name: `${definition.name} door`,
      buildingX: definition.x,
      buildingZ: definition.z,
      buildingRotation: definition.rotation,
      floorY: definition.floorY,
      hingeX: -definition.doorWidth * 0.5,
      hingeZ: frontZ,
      width: definition.doorWidth,
      height: definition.doorHeight,
      thickness: 0.07,
    },
    materials.trim,
    initialDoorOpen,
  );
  door.pivot.traverse((object) => {
    if (object instanceof THREE.Mesh) object.castShadow = qualityUsesShadows(quality);
  });
  root.add(door.pivot);

  root.userData.staticInstanceCount =
    wallBoxes.length +
    floorBoxes.length +
    roofBoxes.length +
    trimBoxes.length +
    Object.values(glassBoxes).reduce((sum, boxes) => sum + boxes.length, 0);

  const halfWidth = definition.width * 0.5;
  const halfDepth = definition.depth * 0.5;
  const colliders: PlanarCollider[] = [
    boxCollider("wall:back", 0, -halfDepth, halfWidth, definition.wallThickness * 0.5),
    boxCollider("wall:left", -halfWidth, 0, definition.wallThickness * 0.5, halfDepth),
    boxCollider("wall:right", halfWidth, 0, definition.wallThickness * 0.5, halfDepth),
    boxCollider(
      "wall:front-left",
      -frontSegmentOffset,
      frontZ,
      frontSegmentWidth * 0.5,
      definition.wallThickness * 0.5,
    ),
    boxCollider(
      "wall:front-right",
      frontSegmentOffset,
      frontZ,
      frontSegmentWidth * 0.5,
      definition.wallThickness * 0.5,
    ),
    boxCollider(
      "wall:front-header",
      0,
      frontZ,
      definition.doorWidth * 0.5,
      definition.wallThickness * 0.5,
      definition.floorY + definition.doorHeight,
      definition.floorY + definition.wallHeight,
    ),
  ];

  for (const flight of definition.stairFlights) {
    for (const side of [-1, 1] as const) {
      colliders.push(boxCollider(
        `stair:${flight.index}:rail:${side}`,
        flight.centerX + side * (definition.stairWidth * 0.5 + 0.04),
        (flight.startZ + flight.endZ) * 0.5,
        0.04,
        STAIR_RUN * 0.5,
        flight.startY,
        flight.endY + 1.12,
      ));
    }
  }
  for (let floor = 1; floor < definition.floorCount; floor += 1) {
    const connectedAtBack = floor % 2 === 1;
    colliders.push(boxCollider(
      `stair:${floor}:opposite-guard`,
      (definition.stairwellMinX + definition.stairwellMaxX) * 0.5,
      connectedAtBack ? definition.stairwellMaxZ : definition.stairwellMinZ,
      (definition.stairwellMaxX - definition.stairwellMinX) * 0.5,
      0.05,
      definition.floorYs[floor],
      definition.floorYs[floor] + 1.05,
    ));
  }
  colliders.push(
    boxCollider(
      "stair:roof:opposite-guard",
      (definition.stairwellMinX + definition.stairwellMaxX) * 0.5,
      roofOppositeZ,
      (definition.stairwellMaxX - definition.stairwellMinX) * 0.5,
      0.05,
      definition.roofY,
      definition.roofY + definition.parapetHeight,
    ),
    boxCollider(
      "stair:roof:unused-lane-entry",
      unusedRoofLane,
      roofConnectedZ,
      definition.stairWidth * 0.5 + 0.06,
      0.05,
      definition.roofY,
      definition.roofY + definition.parapetHeight,
    ),
    boxCollider(
      "stair:roof:unused-lane-side",
      unusedRoofLane + unusedLaneOuterSide * (definition.stairWidth * 0.5 + 0.04),
      (definition.stairwellMinZ + definition.stairwellMaxZ) * 0.5,
      0.04,
      STAIR_RUN * 0.5,
      definition.roofY,
      definition.roofY + definition.parapetHeight,
    ),
  );
  colliders.push(
    boxCollider(
      "roof:parapet:back",
      0,
      -roofHalfDepth,
      roofHalfWidth,
      0.06,
      definition.roofY,
      definition.roofY + definition.parapetHeight,
    ),
    boxCollider(
      "roof:parapet:front",
      0,
      roofHalfDepth,
      roofHalfWidth,
      0.06,
      definition.roofY,
      definition.roofY + definition.parapetHeight,
    ),
    boxCollider(
      "roof:parapet:left",
      -roofHalfWidth,
      0,
      0.06,
      roofHalfDepth - 0.12,
      definition.roofY,
      definition.roofY + definition.parapetHeight,
    ),
    boxCollider(
      "roof:parapet:right",
      roofHalfWidth,
      0,
      0.06,
      roofHalfDepth - 0.12,
      definition.roofY,
      definition.roofY + definition.parapetHeight,
    ),
  );
  colliders.push(door.collider);

  return { root, colliders, doors: [door] };
}
