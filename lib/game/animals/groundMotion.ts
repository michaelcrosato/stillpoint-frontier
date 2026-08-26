import { hashString } from "../core/random";
import {
  resolvePlanarMovement,
  type PlanarCollider,
  type PlanarPosition,
} from "../systems/collision";
import { WATER_LEVEL } from "../world/macroWorld";
import { sampleTerrainHeight } from "../world/terrain";
import {
  isCanyonRiverAt,
  sampleCanyonDepth,
} from "../world/canyonLandmark";
import type { AnimalPose } from "./animalRecipes";

const MINIMUM_DRY_CLEARANCE = 0.18;
const TERRAIN_TRACE_SPACING = 0.22;
const TERRAIN_EDGE_SEARCH_STEPS = 7;

/**
 * Narrow world-query surface used by ground wildlife. Keeping this adapter
 * independent of ChunkManager lets authored regions, test worlds, and future
 * nav volumes provide the same movement contract without coupling wildlife to
 * a particular streaming implementation.
 */
export interface AnimalGroundNavigation {
  sampleHeight(x: number, z: number): number;
  queryColliders?(
    current: Readonly<PlanarPosition>,
    desired: Readonly<PlanarPosition>,
    radius: number,
    minY: number,
    maxY: number,
  ): readonly PlanarCollider[];
}

export interface GroundAnimalDimensions {
  radius: number;
  height: number;
}

export const DEFAULT_ANIMAL_GROUND_NAVIGATION: AnimalGroundNavigation = {
  sampleHeight: sampleTerrainHeight,
};

function safeHeight(
  navigation: Readonly<AnimalGroundNavigation>,
  x: number,
  z: number,
  fallback: number,
) {
  const sampled = navigation.sampleHeight(x, z);
  return Number.isFinite(sampled) ? sampled : fallback;
}

function footprintIsDry(
  navigation: Readonly<AnimalGroundNavigation>,
  position: Readonly<PlanarPosition>,
  radius: number,
) {
  const edge = Math.max(0, radius) * 0.82;
  const diagonal = edge * Math.SQRT1_2;
  const samples: readonly [number, number][] = [
    [0, 0],
    [edge, 0],
    [-edge, 0],
    [0, edge],
    [0, -edge],
    [diagonal, diagonal],
    [diagonal, -diagonal],
    [-diagonal, diagonal],
    [-diagonal, -diagonal],
  ];
  return samples.every(([offsetX, offsetZ]) => {
    const x = position.x + offsetX;
    const z = position.z + offsetZ;
    const height = navigation.sampleHeight(x, z);
    if (!Number.isFinite(height)) return false;
    if (sampleCanyonDepth(x, z) > 0) return !isCanyonRiverAt(x, z);
    return height > WATER_LEVEL + MINIMUM_DRY_CLEARANCE;
  });
}

function positionAt(
  current: Readonly<PlanarPosition>,
  desired: Readonly<PlanarPosition>,
  amount: number,
): PlanarPosition {
  return {
    x: current.x + (desired.x - current.x) * amount,
    z: current.z + (desired.z - current.z) * amount,
  };
}

/**
 * Clips a movement segment at the last footprint-safe dry point. Endpoint-only
 * checks are insufficient because a short flee step can cross a narrow stream
 * and finish on apparently valid terrain on the far bank.
 */
function clipToDryTerrain(
  navigation: Readonly<AnimalGroundNavigation>,
  current: Readonly<PlanarPosition>,
  desired: Readonly<PlanarPosition>,
  radius: number,
) {
  const distance = Math.hypot(desired.x - current.x, desired.z - current.z);
  if (distance <= 1e-8) return { ...current };

  const currentIsDry = footprintIsDry(navigation, current, radius);
  if (!currentIsDry) {
    // A corrupt/legacy transient pose may already be wet. Permit only a direct
    // recovery onto dry terrain instead of trapping the animal permanently.
    return footprintIsDry(navigation, desired, radius) ? { ...desired } : { ...current };
  }

  const sampleCount = Math.max(1, Math.ceil(distance / TERRAIN_TRACE_SPACING));
  let safeAmount = 0;
  for (let index = 1; index <= sampleCount; index += 1) {
    const amount = index / sampleCount;
    const candidate = positionAt(current, desired, amount);
    if (footprintIsDry(navigation, candidate, radius)) {
      safeAmount = amount;
      continue;
    }

    let lower = safeAmount;
    let upper = amount;
    for (let step = 0; step < TERRAIN_EDGE_SEARCH_STEPS; step += 1) {
      const middle = (lower + upper) * 0.5;
      if (footprintIsDry(navigation, positionAt(current, desired, middle), radius)) {
        lower = middle;
      } else {
        upper = middle;
      }
    }
    return positionAt(current, desired, lower);
  }
  return { ...desired };
}

function rotateMovement(x: number, z: number, angle: number) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: x * cosine - z * sine,
    z: x * sine + z * cosine,
  };
}

function finitePosition(position: Readonly<PlanarPosition>) {
  return Number.isFinite(position.x) && Number.isFinite(position.z);
}

/**
 * Resolves one deterministic ground-animal step against streamed colliders and
 * water. When the direct flee vector is blocked, stable angled alternatives
 * let an animal move along a bank or obstacle rather than jittering in place.
 */
export function resolveGroundAnimalMovement(
  animalId: string,
  currentInput: Readonly<PlanarPosition>,
  desiredInput: Readonly<PlanarPosition>,
  dimensionsInput: Readonly<GroundAnimalDimensions>,
  navigation: Readonly<AnimalGroundNavigation> = DEFAULT_ANIMAL_GROUND_NAVIGATION,
): PlanarPosition {
  const current = finitePosition(currentInput) ? currentInput : { x: 0, z: 0 };
  const desired = finitePosition(desiredInput) ? desiredInput : current;
  const radius = Number.isFinite(dimensionsInput.radius)
    ? Math.max(0.08, dimensionsInput.radius)
    : 0.24;
  const height = Number.isFinite(dimensionsInput.height)
    ? Math.max(0.2, dimensionsInput.height)
    : 0.8;
  const movementX = desired.x - current.x;
  const movementZ = desired.z - current.z;
  const intendedDistance = Math.hypot(movementX, movementZ);
  if (intendedDistance <= 1e-8) return { ...current };

  const turnBias = hashString(animalId) % 2 === 0 ? 1 : -1;
  const candidateAngles = [
    0,
    turnBias * Math.PI * 0.25,
    -turnBias * Math.PI * 0.25,
    turnBias * Math.PI * 0.5,
    -turnBias * Math.PI * 0.5,
  ];
  const currentY = safeHeight(navigation, current.x, current.z, WATER_LEVEL + 1);
  let best = { ...current };
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const angle of candidateAngles) {
    const movement = rotateMovement(movementX, movementZ, angle);
    const candidate = { x: current.x + movement.x, z: current.z + movement.z };
    const candidateY = safeHeight(navigation, candidate.x, candidate.z, currentY);
    const colliders = navigation.queryColliders?.(
      current,
      candidate,
      radius,
      Math.min(currentY, candidateY),
      Math.max(currentY, candidateY) + height,
    ) ?? [];
    const collisionResolved = resolvePlanarMovement(current, candidate, colliders, radius);
    const terrainResolved = clipToDryTerrain(
      navigation,
      current,
      collisionResolved,
      radius,
    );
    const actualX = terrainResolved.x - current.x;
    const actualZ = terrainResolved.z - current.z;
    const actualDistance = Math.hypot(actualX, actualZ);
    const forwardProgress =
      (actualX * movementX + actualZ * movementZ) / Math.max(intendedDistance, 1e-8);
    const score = actualDistance + Math.max(-intendedDistance, forwardProgress) * 0.28;
    if (score > bestScore + 1e-8) {
      best = terrainResolved;
      bestScore = score;
    }
    if (angle === 0 && actualDistance >= intendedDistance * 0.995) break;
  }

  return best;
}

/** Reattaches a rigid ground-animal pose to terrain after reaction offsets. */
export function resampleGroundAnimalPose(
  pose: Readonly<AnimalPose>,
  navigation: Readonly<AnimalGroundNavigation> = DEFAULT_ANIMAL_GROUND_NAVIGATION,
): AnimalPose {
  return {
    ...pose,
    y: safeHeight(navigation, pose.x, pose.z, pose.y),
  };
}
