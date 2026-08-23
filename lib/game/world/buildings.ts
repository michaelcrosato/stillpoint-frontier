import type { PlanarCollider } from "../systems/collision";
import type { SettlementTier } from "./macroWorld";
import type { WorldPathSegment } from "./roads";

export const BUILDING_WALL_THICKNESS = 0.22;
export const BUILDING_SLAB_THICKNESS = 0.2;
export const BUILDING_DOOR_WIDTH = 1.3;
export const BUILDING_DOOR_HEIGHT = 2.2;
export const BUILDING_WINDOW_SILL = 0.86;
export const BUILDING_WINDOW_HEIGHT = 1.28;
export const BUILDING_PARAPET_HEIGHT = 1.1;
export const BUILDING_BASEMENT_DEPTH = 2.9;
export const BUILDING_STEP_HEIGHT = 0.34;

export type BuildingLevelKind = "basement" | "floor" | "roof";

export interface BuildingLevelStop {
  kind: BuildingLevelKind;
  index: number;
  label: string;
  y: number;
}

export interface BuildingRecipe {
  id: string;
  displayName: string;
  settlementId: string;
  settlementName: string;
  tier: SettlementTier;
  chunkKey: string;
  candidateIndex: number;
  x: number;
  z: number;
  rotation: number;
  width: number;
  depth: number;
  foundationY: number;
  floorHeight: number;
  floorCount: number;
  height: number;
  doorWidth: number;
  doorHeight: number;
  hasBasement: boolean;
  roofAccess: boolean;
  archetype: "house" | "rowhouse" | "block" | "tower";
}

export interface CreateBuildingRecipeInput {
  id: string;
  settlementId: string;
  settlementName: string;
  tier: SettlementTier;
  chunkKey: string;
  candidateIndex: number;
  x: number;
  z: number;
  fallbackRotation: number;
  width: number;
  depth: number;
  desiredHeight: number;
  foundationY: number;
  allowBasement: boolean;
  basementRoll: number;
  roofRoll: number;
  paths: readonly WorldPathSegment[];
}

export interface BuildingTraversal {
  direction: -1 | 1;
  stops: readonly BuildingLevelStop[];
  destinationX: number;
  destinationZ: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function closestPointOnSegment(
  x: number,
  z: number,
  path: Pick<WorldPathSegment, "start" | "end">,
) {
  const deltaX = path.end.x - path.start.x;
  const deltaZ = path.end.z - path.start.z;
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
  const progress = lengthSquared > 0
    ? clamp(
        ((x - path.start.x) * deltaX + (z - path.start.z) * deltaZ) /
          lengthSquared,
        0,
        1,
      )
    : 0;
  return {
    x: path.start.x + deltaX * progress,
    z: path.start.z + deltaZ * progress,
  };
}

/** Rotation that points the building's local +Z entrance toward the nearest road. */
export function entranceFacingRotation(
  x: number,
  z: number,
  paths: readonly WorldPathSegment[],
  fallbackRotation: number,
) {
  let bestDistance = Number.POSITIVE_INFINITY;
  let best: { x: number; z: number } | null = null;
  for (const path of paths) {
    const point = closestPointOnSegment(x, z, path);
    const distance = Math.hypot(point.x - x, point.z - z);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = point;
  }
  if (!best || bestDistance < 0.001) return fallbackRotation;
  return Math.atan2(best.x - x, best.z - z);
}

function floorHeightForTier(tier: SettlementTier) {
  if (tier === "megacity") return 3.3;
  if (tier === "city") return 3.2;
  if (tier === "town") return 3.1;
  return 3;
}

function basementChance(tier: SettlementTier) {
  if (tier === "megacity") return 0.25;
  if (tier === "city") return 0.22;
  if (tier === "town") return 0.18;
  return 0.1;
}

function roofChance(tier: SettlementTier) {
  if (tier === "megacity") return 0.58;
  if (tier === "city") return 0.46;
  if (tier === "town") return 0.3;
  return 0.12;
}

export function createBuildingRecipe(input: CreateBuildingRecipeInput): BuildingRecipe {
  const width = Math.max(4.5, input.width);
  const depth = Math.max(4.2, input.depth);
  const floorHeight = floorHeightForTier(input.tier);
  const footprintFloorLimit = Math.max(
    1,
    Math.floor(Math.min(width, depth) * (input.tier === "megacity" ? 1.55 : 1.35)),
  );
  const tierFloorLimit =
    input.tier === "megacity"
      ? 30
      : input.tier === "city"
        ? 16
        : input.tier === "town"
          ? 7
          : 3;
  const desiredFloors = Math.max(1, Math.round(input.desiredHeight / floorHeight));
  const floorCount = clamp(desiredFloors, 1, Math.min(footprintFloorLimit, tierFloorLimit));
  const archetype =
    floorCount >= 10
      ? "tower"
      : floorCount >= 4
        ? "block"
        : floorCount >= 2
          ? "rowhouse"
          : "house";
  const title = archetype === "tower"
    ? "Tower"
    : archetype === "block"
      ? "Block"
      : archetype === "rowhouse"
        ? "House"
        : "Cottage";
  const hasBasement = input.allowBasement && input.basementRoll < basementChance(input.tier);
  const roofAccess = floorCount >= 2 && input.roofRoll < roofChance(input.tier);

  return {
    id: input.id,
    displayName: `${input.settlementName} ${title} ${String(input.candidateIndex + 1).padStart(2, "0")}`,
    settlementId: input.settlementId,
    settlementName: input.settlementName,
    tier: input.tier,
    chunkKey: input.chunkKey,
    candidateIndex: input.candidateIndex,
    x: input.x,
    z: input.z,
    rotation: entranceFacingRotation(
      input.x,
      input.z,
      input.paths,
      input.fallbackRotation,
    ),
    width,
    depth,
    foundationY: input.foundationY,
    floorHeight,
    floorCount,
    height: floorCount * floorHeight,
    doorWidth: Math.min(BUILDING_DOOR_WIDTH, width - BUILDING_WALL_THICKNESS * 4),
    doorHeight: BUILDING_DOOR_HEIGHT,
    hasBasement,
    roofAccess,
    archetype,
  };
}

export function buildingGroundSupportY(recipe: BuildingRecipe) {
  return recipe.foundationY + BUILDING_SLAB_THICKNESS;
}

export function buildingRoofSupportY(recipe: BuildingRecipe) {
  return buildingGroundSupportY(recipe) + recipe.floorCount * recipe.floorHeight;
}

export function buildingBasementSupportY(recipe: BuildingRecipe) {
  return buildingGroundSupportY(recipe) - BUILDING_BASEMENT_DEPTH;
}

export function buildingLevelStops(recipe: BuildingRecipe): BuildingLevelStop[] {
  const stops: BuildingLevelStop[] = [];
  if (recipe.hasBasement) {
    stops.push({
      kind: "basement",
      index: -1,
      label: "B1",
      y: buildingBasementSupportY(recipe),
    });
  }
  const groundY = buildingGroundSupportY(recipe);
  for (let index = 0; index < recipe.floorCount; index += 1) {
    stops.push({
      kind: "floor",
      index,
      label: `F${String(index + 1).padStart(2, "0")}`,
      y: groundY + index * recipe.floorHeight,
    });
  }
  if (recipe.roofAccess) {
    stops.push({
      kind: "roof",
      index: recipe.floorCount,
      label: "ROOF",
      y: buildingRoofSupportY(recipe),
    });
  }
  return stops;
}

export function buildingLocalToWorld(
  recipe: Pick<BuildingRecipe, "x" | "z" | "rotation">,
  localX: number,
  localZ: number,
) {
  const cosine = Math.cos(recipe.rotation);
  const sine = Math.sin(recipe.rotation);
  return {
    x: recipe.x + localX * cosine + localZ * sine,
    z: recipe.z + localZ * cosine - localX * sine,
  };
}

export function buildingWorldToLocal(
  recipe: Pick<BuildingRecipe, "x" | "z" | "rotation">,
  x: number,
  z: number,
) {
  const cosine = Math.cos(recipe.rotation);
  const sine = Math.sin(recipe.rotation);
  const deltaX = x - recipe.x;
  const deltaZ = z - recipe.z;
  return {
    x: deltaX * cosine - deltaZ * sine,
    z: deltaZ * cosine + deltaX * sine,
  };
}

export function buildingContainsPoint(
  recipe: BuildingRecipe,
  x: number,
  z: number,
  inset = BUILDING_WALL_THICKNESS * 0.6,
) {
  const local = buildingWorldToLocal(recipe, x, z);
  return (
    Math.abs(local.x) <= recipe.width * 0.5 - inset &&
    Math.abs(local.z) <= recipe.depth * 0.5 - inset
  );
}

function wallBox(
  recipe: BuildingRecipe,
  suffix: string,
  localX: number,
  localZ: number,
  width: number,
  depth: number,
  minY: number,
  maxY: number,
): PlanarCollider {
  const position = buildingLocalToWorld(recipe, localX, localZ);
  return {
    shape: "box",
    id: `${recipe.id}:${suffix}`,
    x: position.x,
    z: position.z,
    halfWidth: width * 0.5,
    halfDepth: depth * 0.5,
    rotation: recipe.rotation,
    minY,
    maxY,
  };
}

export function buildingStructuralColliders(recipe: BuildingRecipe): PlanarCollider[] {
  const wall = BUILDING_WALL_THICKNESS;
  const bottomY = recipe.hasBasement
    ? buildingBasementSupportY(recipe)
    : buildingGroundSupportY(recipe);
  const topY = buildingRoofSupportY(recipe);
  const frontZ = recipe.depth * 0.5 - wall * 0.5;
  const backZ = -frontZ;
  const sideX = recipe.width * 0.5 - wall * 0.5;
  const frontSegmentWidth = Math.max(
    wall,
    (recipe.width - recipe.doorWidth) * 0.5,
  );
  const frontSegmentOffset = recipe.doorWidth * 0.5 + frontSegmentWidth * 0.5;
  const colliders: PlanarCollider[] = [
    wallBox(recipe, "wall:left", -sideX, 0, wall, recipe.depth, bottomY, topY),
    wallBox(recipe, "wall:right", sideX, 0, wall, recipe.depth, bottomY, topY),
    wallBox(recipe, "wall:back", 0, backZ, recipe.width, wall, bottomY, topY),
    wallBox(
      recipe,
      "wall:front-left",
      -frontSegmentOffset,
      frontZ,
      frontSegmentWidth,
      wall,
      bottomY,
      topY,
    ),
    wallBox(
      recipe,
      "wall:front-right",
      frontSegmentOffset,
      frontZ,
      frontSegmentWidth,
      wall,
      bottomY,
      topY,
    ),
    wallBox(
      recipe,
      "wall:front-header",
      0,
      frontZ,
      recipe.doorWidth,
      wall,
      buildingGroundSupportY(recipe) + recipe.doorHeight,
      topY,
    ),
  ];

  // The ground-floor door must not become a vertical shaft into a basement.
  // Close the same opening below the threshold while retaining the 2.2 m
  // doorway at street level.
  if (recipe.hasBasement) {
    colliders.push(
      wallBox(
        recipe,
        "wall:front-basement",
        0,
        frontZ,
        recipe.doorWidth,
        wall,
        bottomY,
        buildingGroundSupportY(recipe) - 0.01,
      ),
    );
  }

  if (recipe.roofAccess) {
    const parapetTop = topY + BUILDING_PARAPET_HEIGHT;
    colliders.push(
      wallBox(recipe, "roof:left", -sideX, 0, wall, recipe.depth, topY, parapetTop),
      wallBox(recipe, "roof:right", sideX, 0, wall, recipe.depth, topY, parapetTop),
      wallBox(recipe, "roof:front", 0, frontZ, recipe.width, wall, topY, parapetTop),
      wallBox(recipe, "roof:back", 0, backZ, recipe.width, wall, topY, parapetTop),
    );
  }
  return colliders;
}

export function buildingPlacementCollider(recipe: BuildingRecipe): PlanarCollider {
  return {
    shape: "box",
    id: `${recipe.id}:footprint`,
    x: recipe.x,
    z: recipe.z,
    halfWidth: recipe.width * 0.5,
    halfDepth: recipe.depth * 0.5,
    rotation: recipe.rotation,
    blocksPlayer: false,
  };
}

export function buildingEntranceApronCollider(recipe: BuildingRecipe): PlanarCollider {
  const position = buildingLocalToWorld(
    recipe,
    0,
    recipe.depth * 0.5 + 1.25,
  );
  return {
    shape: "box",
    id: `${recipe.id}:entrance-apron`,
    x: position.x,
    z: position.z,
    halfWidth: recipe.doorWidth * 0.72,
    halfDepth: 1.25,
    rotation: recipe.rotation,
    blocksPlayer: false,
  };
}

export function nearestBuildingStop(
  stops: readonly BuildingLevelStop[],
  playerY: number,
  direction: -1 | 0 | 1 = 0,
) {
  const minimum = direction < 0 ? 1 : 0;
  const maximum = direction > 0 ? stops.length - 2 : stops.length - 1;
  if (maximum < minimum) return null;
  let bestIndex = minimum;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = minimum; index <= maximum; index += 1) {
    const distance = Math.abs(stops[index].y - playerY);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    bestIndex = index;
  }
  return { index: bestIndex, stop: stops[bestIndex], distance: bestDistance };
}

export function resolveBuildingTraversal(
  traversal: BuildingTraversal,
  playerY: number,
) {
  const origin = nearestBuildingStop(
    traversal.stops,
    playerY,
    traversal.direction,
  );
  if (!origin || origin.distance > 0.75) return null;
  const destination = traversal.stops[origin.index + traversal.direction];
  if (!destination) return null;
  return {
    origin: origin.stop,
    destination,
    x: traversal.destinationX,
    z: traversal.destinationZ,
  };
}

export function buildingCeilingY(recipe: BuildingRecipe, playerY: number) {
  const groundY = buildingGroundSupportY(recipe);
  const roofY = buildingRoofSupportY(recipe);
  if (recipe.hasBasement && playerY < groundY) {
    return playerY >= buildingBasementSupportY(recipe) - 0.1
      ? groundY - BUILDING_SLAB_THICKNESS
      : Number.POSITIVE_INFINITY;
  }
  if (playerY < groundY - 0.1 || playerY >= roofY) {
    return Number.POSITIVE_INFINITY;
  }
  const floorIndex = Math.max(
    0,
    Math.min(
      recipe.floorCount - 1,
      Math.floor((playerY - groundY + 0.001) / recipe.floorHeight),
    ),
  );
  return groundY + (floorIndex + 1) * recipe.floorHeight - BUILDING_SLAB_THICKNESS;
}
