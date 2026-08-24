import * as THREE from "three";
import { MAX_STEP_HEIGHT, type QualityLevel } from "../config";
import type { PlanarCollider } from "../systems/collision";
import {
  createAuthoredDoor,
  type AuthoredDoorRuntime,
} from "./authoredDoor";
import { sampleTerrainHeight } from "./terrain";

const SITE = {
  x: 18,
  z: 13,
  width: 10,
  depth: 9,
  rotation: Math.PI,
} as const;

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

export const TWO_STORY_BUILDING = Object.freeze({
  id: "spawn-survey-house-02",
  name: "Survey House 02",
  chunkKey: "0:0",
  x: SITE.x,
  z: SITE.z,
  rotation: SITE.rotation,
  width: SITE.width,
  depth: SITE.depth,
  floorY,
  floorCount: 2,
  storyHeight: 3.5,
  upperFloorY: floorY + 3.5,
  wallHeight: 7,
  wallThickness: 0.24,
  slabThickness: 0.18,
  roofThickness: 0.24,
  hasBasement: false,
  roofAccess: false,
  doorId: "spawn-survey-house-02:front",
  doorWidth: 1.5,
  doorHeight: 3.2,
  windowWidth: 1.8,
  windowHeight: 1.2,
  windowSill: 1.05,
  stairCenterX: 3.3,
  stairWidth: 1.45,
  stairStartZ: 2.9,
  stairEndZ: -2.7,
  stairTopLandingEndZ: -3.05,
  stairSteps: 20,
  stairRise: 3.5 / 20,
  stairTread: (2.9 - -2.7) / 20,
  stairwellMinX: 2.45,
  stairwellMaxX: 4.15,
  stairwellMinZ: -3.05,
  stairwellMaxZ: 3.2,
  foundationDepth: floorY - foundationBottomY,
  clearanceRadius: Math.hypot(SITE.width, SITE.depth) * 0.5 + 1.25,
});

export interface TwoStoryBuildingRuntime {
  root: THREE.Group;
  colliders: PlanarCollider[];
  doors: AuthoredDoorRuntime[];
}

function boxCollider(
  id: string,
  localX: number,
  localZ: number,
  halfWidth: number,
  halfDepth: number,
  minY = TWO_STORY_BUILDING.floorY,
  maxY = TWO_STORY_BUILDING.floorY + TWO_STORY_BUILDING.wallHeight,
): PlanarCollider {
  const point = localToWorld(localX, localZ);
  return {
    shape: "box",
    id: `two-story-building:${TWO_STORY_BUILDING.id}:${id}`,
    x: point.x,
    z: point.z,
    halfWidth,
    halfDepth,
    rotation: TWO_STORY_BUILDING.rotation,
    minY,
    maxY,
  };
}

/** Returns every walkable authored surface at this horizontal position. */
export function twoStorySupportCandidates(x: number, z: number): number[] {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return [];
  const definition = TWO_STORY_BUILDING;
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

  const onStair =
    Math.abs(local.x - definition.stairCenterX) <= definition.stairWidth * 0.5 &&
    local.z <= definition.stairStartZ &&
    local.z >= definition.stairTopLandingEndZ;
  if (onStair) {
    if (local.z <= definition.stairEndZ) {
      supports.push(definition.upperFloorY);
    } else {
      const progress = THREE.MathUtils.clamp(
        (definition.stairStartZ - local.z) /
          (definition.stairStartZ - definition.stairEndZ),
        0,
        0.999999,
      );
      const stepIndex = Math.floor(progress * definition.stairSteps);
      supports.push(
        definition.floorY + (stepIndex + 1) * definition.stairRise,
      );
    }
  }

  const inStairwell =
    local.x >= definition.stairwellMinX &&
    local.x <= definition.stairwellMaxX &&
    local.z >= definition.stairwellMinZ &&
    local.z <= definition.stairwellMaxZ;
  if (!inStairwell) supports.push(definition.upperFloorY);
  return [...new Set(supports)].sort((left, right) => left - right);
}

export function selectWalkableSupport(
  supports: readonly number[],
  referenceY?: number,
) {
  if (supports.length === 0) return null;
  const ordered = [...supports].sort((left, right) => left - right);
  if (referenceY === undefined || !Number.isFinite(referenceY)) return ordered[0];
  const reachable = ordered.filter((height) => height <= referenceY + MAX_STEP_HEIGHT);
  return reachable.at(-1) ?? ordered[0];
}

export function createTwoStoryBuilding(
  quality: QualityLevel,
  initialDoorOpen = false,
): TwoStoryBuildingRuntime {
  const definition = TWO_STORY_BUILDING;
  const root = new THREE.Group();
  root.name = `two-story-building:${definition.id}`;
  root.position.set(definition.x, definition.floorY, definition.z);
  root.rotation.y = definition.rotation;
  root.userData.enterable = true;
  root.userData.floorCount = definition.floorCount;

  const templates = {
    wall: new THREE.MeshStandardMaterial({
      color: 0x706c64,
      roughness: 0.88,
      metalness: 0.05,
    }),
    floor: new THREE.MeshStandardMaterial({
      color: 0x454944,
      roughness: 0.83,
      metalness: 0.12,
    }),
    roof: new THREE.MeshStandardMaterial({
      color: 0x303633,
      roughness: 0.7,
      metalness: 0.3,
    }),
    trim: new THREE.MeshStandardMaterial({
      color: 0x242927,
      roughness: 0.68,
      metalness: 0.34,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x8ab9c4,
      roughness: 0.1,
      metalness: 0.04,
      transmission: 0.76,
      thickness: 0.05,
      ior: 1.46,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  } as const;

  const addBox = (
    name: string,
    size: readonly [number, number, number],
    position: readonly [number, number, number],
    materialKind: keyof typeof templates,
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size[0], size[1], size[2]),
      templates[materialKind].clone(),
    );
    mesh.name = `two-story-building:${name}`;
    mesh.position.set(position[0], position[1], position[2]);
    mesh.castShadow = quality === "cinematic" && materialKind !== "glass";
    mesh.receiveShadow = materialKind !== "glass";
    mesh.userData.shadow = materialKind !== "glass";
    mesh.userData.glass = materialKind === "glass";
    root.add(mesh);
    return mesh;
  };

  addBox(
    "foundation",
    [definition.width, definition.foundationDepth, definition.depth],
    [0, -definition.foundationDepth * 0.5, 0],
    "floor",
  );
  addBox(
    "roof",
    [definition.width + 0.38, definition.roofThickness, definition.depth + 0.38],
    [0, definition.wallHeight + definition.roofThickness * 0.5, 0],
    "roof",
  );

  const innerHalfWidth = definition.width * 0.5 - definition.wallThickness;
  const innerHalfDepth = definition.depth * 0.5 - definition.wallThickness;
  const slabY = definition.storyHeight - definition.slabThickness * 0.5;
  const addSlabRegion = (
    name: string,
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
  ) => {
    if (maxX <= minX || maxZ <= minZ) return;
    addBox(
      `upper-floor:${name}`,
      [maxX - minX, definition.slabThickness, maxZ - minZ],
      [(minX + maxX) * 0.5, slabY, (minZ + maxZ) * 0.5],
      "floor",
    );
  };
  addSlabRegion(
    "left",
    -innerHalfWidth,
    definition.stairwellMinX,
    -innerHalfDepth,
    innerHalfDepth,
  );
  addSlabRegion(
    "right",
    definition.stairwellMaxX,
    innerHalfWidth,
    -innerHalfDepth,
    innerHalfDepth,
  );
  addSlabRegion(
    "front-landing",
    definition.stairwellMinX,
    definition.stairwellMaxX,
    definition.stairwellMaxZ,
    innerHalfDepth,
  );
  addSlabRegion(
    "back-landing",
    definition.stairwellMinX,
    definition.stairwellMaxX,
    -innerHalfDepth,
    definition.stairwellMinZ,
  );

  const addWindowedStory = (
    side: "back" | "left" | "right",
    story: 0 | 1,
  ) => {
    const runsAlongX = side === "back";
    const length = runsAlongX ? definition.width : definition.depth;
    const fixed = side === "back"
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
    const along = (
      run: number,
      height: number,
      thickness: number = definition.wallThickness,
    ): [number, number, number] =>
      runsAlongX ? [run, height, thickness] : [thickness, height, run];

    addBox(
      `wall:${side}:${story}:a`,
      along(sideLength, definition.storyHeight),
      coordinate(-sideOffset, definition.storyHeight * 0.5),
      "wall",
    );
    addBox(
      `wall:${side}:${story}:b`,
      along(sideLength, definition.storyHeight),
      coordinate(sideOffset, definition.storyHeight * 0.5),
      "wall",
    );
    addBox(
      `wall:${side}:${story}:lower`,
      along(definition.windowWidth, definition.windowSill),
      coordinate(0, definition.windowSill * 0.5),
      "wall",
    );
    addBox(
      `wall:${side}:${story}:upper`,
      along(definition.windowWidth, upperHeight),
      coordinate(0, windowTop + upperHeight * 0.5),
      "wall",
    );
    addBox(
      `window:${side}:${story}`,
      along(definition.windowWidth - 0.1, definition.windowHeight - 0.1, 0.045),
      coordinate(0, definition.windowSill + definition.windowHeight * 0.5),
      "glass",
    );
  };

  for (const side of ["back", "left", "right"] as const) {
    addWindowedStory(side, 0);
    addWindowedStory(side, 1);
  }

  const frontZ = definition.depth * 0.5;
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
    [definition.doorWidth, definition.wallHeight - definition.doorHeight, definition.wallThickness],
    [0, definition.doorHeight + (definition.wallHeight - definition.doorHeight) * 0.5, frontZ],
    "wall",
  );

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

  for (let index = 0; index < definition.stairSteps; index += 1) {
    const stepHeight = (index + 1) * definition.stairRise;
    const stepZ = definition.stairStartZ - (index + 0.5) * definition.stairTread;
    addBox(
      `stair:${index + 1}`,
      [definition.stairWidth, stepHeight, definition.stairTread + 0.012],
      [definition.stairCenterX, stepHeight * 0.5, stepZ],
      "floor",
    );
  }
  addBox(
    "stair:top-landing",
    [definition.stairWidth, definition.storyHeight, definition.stairEndZ - definition.stairTopLandingEndZ],
    [
      definition.stairCenterX,
      definition.storyHeight * 0.5,
      (definition.stairEndZ + definition.stairTopLandingEndZ) * 0.5,
    ],
    "floor",
  );
  for (const side of [-1, 1] as const) {
    for (let section = 0; section < 5; section += 1) {
      const sectionStart = Math.floor((section * definition.stairSteps) / 5);
      const sectionEnd = Math.floor(((section + 1) * definition.stairSteps) / 5);
      const railZStart = definition.stairStartZ - sectionStart * definition.stairTread;
      const railZEnd = definition.stairStartZ - sectionEnd * definition.stairTread;
      const railHeight = sectionEnd * definition.stairRise + 0.62;
      addBox(
        `stair:rail:${side}:${section}`,
        [0.07, 0.12, railZStart - railZEnd],
        [
          definition.stairCenterX + side * (definition.stairWidth * 0.5 + 0.035),
          railHeight,
          (railZStart + railZEnd) * 0.5,
        ],
        "trim",
      );
    }
  }
  addBox(
    "stair:upper-front-guard",
    [
      definition.stairwellMaxX - definition.stairwellMinX,
      1.05,
      0.08,
    ],
    [
      (definition.stairwellMinX + definition.stairwellMaxX) * 0.5,
      definition.storyHeight + 0.525,
      definition.stairwellMaxZ,
    ],
    "trim",
  );

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
    templates.trim,
    initialDoorOpen,
  );
  door.pivot.traverse((object) => {
    if (object instanceof THREE.Mesh) object.castShadow = quality === "cinematic";
  });
  root.add(door.pivot);

  for (const material of Object.values(templates)) material.dispose();

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
    boxCollider(
      "stair:rail:left",
      definition.stairCenterX - definition.stairWidth * 0.5 - 0.05,
      (definition.stairStartZ + definition.stairEndZ) * 0.5,
      0.05,
      (definition.stairStartZ - definition.stairEndZ) * 0.5,
    ),
    boxCollider(
      "stair:rail:right",
      definition.stairCenterX + definition.stairWidth * 0.5 + 0.05,
      (definition.stairStartZ + definition.stairEndZ) * 0.5,
      0.05,
      (definition.stairStartZ - definition.stairEndZ) * 0.5,
    ),
    boxCollider(
      "stair:upper-front-guard",
      (definition.stairwellMinX + definition.stairwellMaxX) * 0.5,
      definition.stairwellMaxZ,
      (definition.stairwellMaxX - definition.stairwellMinX) * 0.5,
      0.05,
      definition.upperFloorY,
      definition.upperFloorY + 1.05,
    ),
    door.collider,
  ];

  return { root, colliders, doors: [door] };
}
