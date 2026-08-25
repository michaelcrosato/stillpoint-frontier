import type { QualityLevel } from "../config";
import type {
  AuthoredBuildingFrame,
  AuthoredBuildingRecipe,
  BuildingAnchor,
  ResolvedBuildingAnchor,
} from "./buildingTypes";
import {
  SPAWN_BUILDING,
  createSpawnBuilding,
  spawnBuildingSupportCandidates,
} from "./spawnBuilding";
import {
  TEN_STORY_BUILDING,
  createTenStoryBuilding,
  tenStorySupportCandidates,
} from "./tenStoryBuilding";
import {
  TWO_STORY_BUILDING,
  createTwoStoryBuilding,
  twoStorySupportCandidates,
} from "./twoStoryBuilding";

const fieldUnitFrame: AuthoredBuildingFrame<"field-unit"> = {
  id: "field-unit",
  definitionId: SPAWN_BUILDING.id,
  landmarkId: "landmark:field-unit-compound",
  name: SPAWN_BUILDING.name,
  chunkKey: SPAWN_BUILDING.chunkKey,
  x: SPAWN_BUILDING.x,
  z: SPAWN_BUILDING.z,
  rotation: 0,
  width: SPAWN_BUILDING.width,
  depth: SPAWN_BUILDING.depth,
  wallThickness: SPAWN_BUILDING.wallThickness,
  floorYs: [SPAWN_BUILDING.floorY],
  roofY: SPAWN_BUILDING.roofY,
  clearanceRadius: SPAWN_BUILDING.clearanceRadius,
  reservations: [
    {
      id: "roof-stair",
      minX: SPAWN_BUILDING.roofStairwellMinX,
      maxX: SPAWN_BUILDING.roofStairwellMaxX,
      minZ: SPAWN_BUILDING.roofStairwellMinZ,
      maxZ: SPAWN_BUILDING.roofStairwellMaxZ,
    },
    {
      id: "front-door",
      minX: -SPAWN_BUILDING.doorWidth * 0.5 - 0.45,
      maxX: SPAWN_BUILDING.doorWidth * 0.5 + 0.45,
      minZ: SPAWN_BUILDING.depth * 0.5 - 1.15,
      maxZ: SPAWN_BUILDING.depth * 0.5 + 0.55,
    },
  ],
};

const surveyHouseFrame: AuthoredBuildingFrame<"survey-house"> = {
  id: "survey-house",
  definitionId: TWO_STORY_BUILDING.id,
  landmarkId: "landmark:field-unit-compound",
  name: TWO_STORY_BUILDING.name,
  chunkKey: TWO_STORY_BUILDING.chunkKey,
  x: TWO_STORY_BUILDING.x,
  z: TWO_STORY_BUILDING.z,
  rotation: TWO_STORY_BUILDING.rotation,
  width: TWO_STORY_BUILDING.width,
  depth: TWO_STORY_BUILDING.depth,
  wallThickness: TWO_STORY_BUILDING.wallThickness,
  floorYs: [TWO_STORY_BUILDING.floorY, TWO_STORY_BUILDING.upperFloorY],
  roofY: TWO_STORY_BUILDING.roofY,
  clearanceRadius: TWO_STORY_BUILDING.clearanceRadius,
  reservations: [
    {
      id: "stairs",
      minX: TWO_STORY_BUILDING.stairwellMinX,
      maxX: TWO_STORY_BUILDING.stairwellMaxX,
      minZ: TWO_STORY_BUILDING.stairwellMinZ,
      maxZ: TWO_STORY_BUILDING.stairwellMaxZ,
    },
    {
      id: "front-door",
      minX: -TWO_STORY_BUILDING.doorWidth * 0.5 - 0.45,
      maxX: TWO_STORY_BUILDING.doorWidth * 0.5 + 0.45,
      minZ: TWO_STORY_BUILDING.depth * 0.5 - 1.2,
      maxZ: TWO_STORY_BUILDING.depth * 0.5 + 0.55,
    },
  ],
};

const meridianTowerFrame: AuthoredBuildingFrame<"meridian-tower"> = {
  id: "meridian-tower",
  definitionId: TEN_STORY_BUILDING.id,
  landmarkId: "landmark:field-unit-compound",
  name: TEN_STORY_BUILDING.name,
  chunkKey: TEN_STORY_BUILDING.chunkKey,
  x: TEN_STORY_BUILDING.x,
  z: TEN_STORY_BUILDING.z,
  rotation: TEN_STORY_BUILDING.rotation,
  width: TEN_STORY_BUILDING.width,
  depth: TEN_STORY_BUILDING.depth,
  wallThickness: TEN_STORY_BUILDING.wallThickness,
  floorYs: TEN_STORY_BUILDING.floorYs,
  roofY: TEN_STORY_BUILDING.roofY,
  clearanceRadius: TEN_STORY_BUILDING.clearanceRadius,
  reservations: [
    {
      id: "stairs",
      minX: TEN_STORY_BUILDING.stairwellMinX,
      maxX: TEN_STORY_BUILDING.stairwellMaxX,
      minZ: TEN_STORY_BUILDING.stairwellMinZ,
      maxZ: TEN_STORY_BUILDING.stairwellMaxZ,
    },
    {
      id: "front-door",
      minX: -TEN_STORY_BUILDING.doorWidth * 0.5 - 0.45,
      maxX: TEN_STORY_BUILDING.doorWidth * 0.5 + 0.45,
      minZ: TEN_STORY_BUILDING.depth * 0.5 - 1.2,
      maxZ: TEN_STORY_BUILDING.depth * 0.5 + 0.55,
    },
  ],
};

export const AUTHORED_BUILDINGS = [
  {
    frame: fieldUnitFrame,
    doorIds: [SPAWN_BUILDING.doorId],
    create: (context) =>
      createSpawnBuilding(context.quality, context.isDoorOpen(SPAWN_BUILDING.doorId)),
    supportCandidates: spawnBuildingSupportCandidates,
  },
  {
    frame: surveyHouseFrame,
    doorIds: [TWO_STORY_BUILDING.doorId],
    create: (context) =>
      createTwoStoryBuilding(
        context.quality,
        context.isDoorOpen(TWO_STORY_BUILDING.doorId),
      ),
    supportCandidates: twoStorySupportCandidates,
  },
  {
    frame: meridianTowerFrame,
    doorIds: [TEN_STORY_BUILDING.doorId],
    create: (context) =>
      createTenStoryBuilding(
        context.quality,
        context.isDoorOpen(TEN_STORY_BUILDING.doorId),
      ),
    supportCandidates: tenStorySupportCandidates,
  },
] as const satisfies readonly AuthoredBuildingRecipe[];

export type AuthoredBuildingId = (typeof AUTHORED_BUILDINGS)[number]["frame"]["id"];

export function authoredBuildingById(id: string) {
  return AUTHORED_BUILDINGS.find((recipe) => recipe.frame.id === id) ?? null;
}

export function authoredBuildingsForChunk(chunkKey: string) {
  return AUTHORED_BUILDINGS.filter((recipe) => recipe.frame.chunkKey === chunkKey);
}

export function authoredBuildingsForLandmark(landmarkId: string) {
  return AUTHORED_BUILDINGS.filter(
    (recipe) => recipe.frame.landmarkId === landmarkId,
  );
}

export function createAuthoredBuildingsForChunk(
  chunkKey: string,
  quality: QualityLevel,
  doorStates: Readonly<Record<string, boolean>>,
) {
  return authoredBuildingsForChunk(chunkKey).map((recipe) =>
    recipe.create({
      quality,
      isDoorOpen: (id) => doorStates[id] ?? false,
    }),
  );
}

export function authoredBuildingSupportCandidates(x: number, z: number) {
  return AUTHORED_BUILDINGS.flatMap((recipe) => recipe.supportCandidates(x, z));
}

export function buildingLocalToWorld(
  frame: Pick<AuthoredBuildingFrame, "x" | "z" | "rotation">,
  localX: number,
  localZ: number,
) {
  const cosine = Math.cos(frame.rotation);
  const sine = Math.sin(frame.rotation);
  return {
    x: frame.x + cosine * localX + sine * localZ,
    z: frame.z - sine * localX + cosine * localZ,
  };
}

export function resolveBuildingAnchor(
  anchor: Readonly<BuildingAnchor>,
): ResolvedBuildingAnchor | null {
  const recipe = authoredBuildingById(anchor.buildingId);
  if (!recipe || !Number.isInteger(anchor.floor)) return null;
  const floorY = recipe.frame.floorYs[anchor.floor];
  if (floorY === undefined) return null;
  const point = buildingLocalToWorld(
    recipe.frame,
    anchor.localX,
    anchor.localZ,
  );
  if (![point.x, point.z, anchor.localYOffset ?? 0, anchor.localYaw ?? 0].every(Number.isFinite)) {
    return null;
  }
  return {
    x: point.x,
    y: floorY + (anchor.localYOffset ?? 0),
    z: point.z,
    yaw: recipe.frame.rotation + (anchor.localYaw ?? 0),
  };
}
