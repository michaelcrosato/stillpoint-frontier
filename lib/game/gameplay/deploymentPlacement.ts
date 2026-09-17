import type { PlacedEntity, PlacementArchetype } from "../world/deployments";
import { MAX_PLACED_ENTITIES } from "../world/deployments";
import { isSupportedWorldHeight } from "../world/heightBounds";
import { WORLD_HALF_EXTENT } from "../world/macroWorld";

/**
 * Pure placement rules for persistent field deployments. These decide whether a
 * spot is legal; sampling the ground, spending the item and registering the
 * record stay with the Engine.
 */

/** Footprint reserved by each deployment, in metres. */
export const PLACEMENT_FOOTPRINT_RADIUS: Readonly<Record<PlacementArchetype, number>> =
  Object.freeze({
    bedroll: 0.95,
    campfire: 0.55,
    survey_marker: 0.55,
    weather_shelter: 1.5,
    field_torch: 0.55,
  });

/** Distance ahead of the player at which each deployment is dropped, in metres. */
export const PLACEMENT_OFFSET_DISTANCE: Readonly<Record<PlacementArchetype, number>> =
  Object.freeze({
    bedroll: 2.35,
    campfire: 2.35,
    survey_marker: 2.35,
    weather_shelter: 3.1,
    field_torch: 2.35,
  });

export { MAX_PLACED_ENTITIES };

const MAX_SUPPORT_SPREAD = 0.65;
const MAX_STEP_FROM_PLAYER = 1.1;
const OVERLAP_MARGIN = 0.25;
const OVERLAP_VERTICAL_SPAN = 1.5;

export type PlacementRejection = "registry_full" | "unclear_ground" | "no_serial";

export interface PlacementCandidate {
  archetypeId: PlacementArchetype;
  x: number;
  z: number;
  y: number;
  /** Ground heights sampled at +x, -x, +z and -z of the footprint. */
  supportHeights: readonly number[];
  playerY: number;
  overWater: boolean;
  standable: boolean;
  placed: readonly PlacedEntity[];
  serial: number;
  maxSerial: number;
}

export function placementFootprintRadius(archetypeId: PlacementArchetype): number {
  return PLACEMENT_FOOTPRINT_RADIUS[archetypeId];
}

export function placementOffsetDistance(archetypeId: PlacementArchetype): number {
  return PLACEMENT_OFFSET_DISTANCE[archetypeId];
}

/** True when the candidate footprint would intersect an existing deployment. */
export function placementOverlaps(
  candidate: Pick<PlacementCandidate, "archetypeId" | "x" | "y" | "z" | "placed">,
): boolean {
  const radius = placementFootprintRadius(candidate.archetypeId);
  return candidate.placed.some((record) => {
    const existingRadius = placementFootprintRadius(record.archetypeId);
    return (
      Math.abs(record.y - candidate.y) < OVERLAP_VERTICAL_SPAN &&
      Math.hypot(record.x - candidate.x, record.z - candidate.z) <
        existingRadius + radius + OVERLAP_MARGIN
    );
  });
}

function serialIsUsable(candidate: PlacementCandidate): boolean {
  const { serial, maxSerial, archetypeId, placed } = candidate;
  if (!Number.isSafeInteger(serial) || serial < 1 || serial > maxSerial) return false;
  return !placed.some((record) => record.id === `placed:${archetypeId}:${serial}`);
}

/** Returns the reason a placement is refused, or null when it is legal. */
export function evaluateDeploymentPlacement(
  candidate: PlacementCandidate,
): PlacementRejection | null {
  if (candidate.placed.length >= MAX_PLACED_ENTITIES) return "registry_full";

  const supports = candidate.supportHeights;
  const groundIsClear =
    // The save normalizer rejects heights outside the supported range, so a
    // finite-only check here accepted placements that were dropped on reload.
    isSupportedWorldHeight(candidate.y) &&
    supports.every(Number.isFinite) &&
    !candidate.overWater &&
    Math.abs(candidate.y - candidate.playerY) <= MAX_STEP_FROM_PLAYER &&
    Math.max(...supports) - Math.min(...supports) <= MAX_SUPPORT_SPREAD &&
    Math.abs(candidate.x) <= WORLD_HALF_EXTENT &&
    Math.abs(candidate.z) <= WORLD_HALF_EXTENT &&
    !placementOverlaps(candidate) &&
    candidate.standable;
  if (!groundIsClear) return "unclear_ground";

  if (!serialIsUsable(candidate)) return "no_serial";
  return null;
}
