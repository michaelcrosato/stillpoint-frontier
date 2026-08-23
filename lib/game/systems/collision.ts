export interface PlanarPosition {
  x: number;
  z: number;
}

interface ColliderBase extends PlanarPosition {
  id: string;
  /** Optional vertical bounds for stacked interiors. Unbounded when omitted. */
  minY?: number;
  maxY?: number;
  /** Placement-only volumes remain indexed but are ignored by character movement. */
  blocksPlayer?: boolean;
}

export interface CircleCollider extends ColliderBase {
  shape: "circle";
  radius: number;
}

export interface BoxCollider extends ColliderBase {
  shape: "box";
  halfWidth: number;
  halfDepth: number;
  /** Rotation around world-up, in radians. */
  rotation: number;
}

export type PlanarCollider = CircleCollider | BoxCollider;

interface CollisionNormal {
  x: number;
  z: number;
}

interface Penetration extends CollisionNormal {
  depth: number;
}

interface SweepHit extends CollisionNormal {
  time: number;
}

interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const EPSILON = 1e-9;
const TIME_EPSILON = 1e-7;
const CONTACT_SKIN = 1e-4;
const MAX_DEPENETRATION_ITERATIONS = 16;
const MAX_SWEEP_ITERATIONS = 8;

function isFinitePosition(position: PlanarPosition) {
  return Number.isFinite(position.x) && Number.isFinite(position.z);
}

function isValidCollider(collider: PlanarCollider) {
  if (!collider.id || !isFinitePosition(collider)) return false;
  if (
    (collider.minY !== undefined && !Number.isFinite(collider.minY)) ||
    (collider.maxY !== undefined && !Number.isFinite(collider.maxY)) ||
    (collider.minY !== undefined &&
      collider.maxY !== undefined &&
      collider.minY > collider.maxY)
  ) {
    return false;
  }
  if (collider.shape === "circle") {
    return Number.isFinite(collider.radius) && collider.radius >= 0;
  }
  return (
    Number.isFinite(collider.halfWidth) &&
    collider.halfWidth >= 0 &&
    Number.isFinite(collider.halfDepth) &&
    collider.halfDepth >= 0 &&
    Number.isFinite(collider.rotation)
  );
}

export function colliderOverlapsVerticalSpan(
  collider: PlanarCollider,
  minY: number,
  maxY: number,
) {
  if (collider.blocksPlayer === false) return false;
  const firstY = Number.isFinite(minY) ? minY : Number.NEGATIVE_INFINITY;
  const secondY = Number.isFinite(maxY) ? maxY : Number.POSITIVE_INFINITY;
  const safeMinY = Math.min(firstY, secondY);
  const safeMaxY = Math.max(firstY, secondY);
  const colliderMinY = collider.minY ?? Number.NEGATIVE_INFINITY;
  const colliderMaxY = collider.maxY ?? Number.POSITIVE_INFINITY;
  return safeMaxY >= colliderMinY && safeMinY <= colliderMaxY;
}

function toLocal(point: PlanarPosition, collider: BoxCollider): PlanarPosition {
  const cosine = Math.cos(collider.rotation);
  const sine = Math.sin(collider.rotation);
  const deltaX = point.x - collider.x;
  const deltaZ = point.z - collider.z;
  return {
    x: cosine * deltaX - sine * deltaZ,
    z: sine * deltaX + cosine * deltaZ,
  };
}

function vectorToLocal(vector: PlanarPosition, rotation: number): PlanarPosition {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return {
    x: cosine * vector.x - sine * vector.z,
    z: sine * vector.x + cosine * vector.z,
  };
}

function vectorToWorld(vector: PlanarPosition, rotation: number): PlanarPosition {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return {
    x: cosine * vector.x + sine * vector.z,
    z: -sine * vector.x + cosine * vector.z,
  };
}

function colliderBounds(collider: PlanarCollider): Bounds {
  if (collider.shape === "circle") {
    return {
      minX: collider.x - collider.radius,
      maxX: collider.x + collider.radius,
      minZ: collider.z - collider.radius,
      maxZ: collider.z + collider.radius,
    };
  }
  const cosine = Math.abs(Math.cos(collider.rotation));
  const sine = Math.abs(Math.sin(collider.rotation));
  const extentX = cosine * collider.halfWidth + sine * collider.halfDepth;
  const extentZ = sine * collider.halfWidth + cosine * collider.halfDepth;
  return {
    minX: collider.x - extentX,
    maxX: collider.x + extentX,
    minZ: collider.z - extentZ,
    maxZ: collider.z + extentZ,
  };
}

/**
 * Rebuilt only when streamed chunks change. Movement queries then touch the
 * small set of cells crossed by the player instead of every city collider.
 */
export class PlanarCollisionIndex {
  private readonly cells = new Map<string, PlanarCollider[]>();
  private maximumColliderReach = 0;

  constructor(private readonly cellSize = 16) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new Error("Collision-index cell size must be positive and finite.");
    }
  }

  rebuild(colliders: readonly PlanarCollider[]) {
    this.cells.clear();
    this.maximumColliderReach = 0;
    for (const collider of colliders) {
      if (!isValidCollider(collider)) continue;
      const bounds = colliderBounds(collider);
      this.maximumColliderReach = Math.max(
        this.maximumColliderReach,
        (bounds.maxX - bounds.minX) * 0.5,
        (bounds.maxZ - bounds.minZ) * 0.5,
      );
      const minCellX = Math.floor(bounds.minX / this.cellSize);
      const maxCellX = Math.floor(bounds.maxX / this.cellSize);
      const minCellZ = Math.floor(bounds.minZ / this.cellSize);
      const maxCellZ = Math.floor(bounds.maxZ / this.cellSize);
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
          const key = `${cellX}:${cellZ}`;
          const cell = this.cells.get(key);
          if (cell) cell.push(collider);
          else this.cells.set(key, [collider]);
        }
      }
    }
  }

  querySweep(
    current: PlanarPosition,
    desired: PlanarPosition,
    radius: number,
  ): PlanarCollider[] {
    if (!isFinitePosition(current) || !isFinitePosition(desired)) return [];
    const safeRadius = Number.isFinite(radius) && radius >= 0 ? radius : 0;
    // Sliding and start-overlap recovery can deflect the center beyond the raw
    // segment AABB by an obstacle diameter. Include that halo so the
    // index never drops a second contact near a corner or invalid spawn.
    const padding = safeRadius + this.maximumColliderReach * 2 + CONTACT_SKIN;
    const bounds = {
      minX: Math.min(current.x, desired.x) - padding,
      maxX: Math.max(current.x, desired.x) + padding,
      minZ: Math.min(current.z, desired.z) - padding,
      maxZ: Math.max(current.z, desired.z) + padding,
    };
    const found = new Set<PlanarCollider>();
    const minCellX = Math.floor(bounds.minX / this.cellSize);
    const maxCellX = Math.floor(bounds.maxX / this.cellSize);
    const minCellZ = Math.floor(bounds.minZ / this.cellSize);
    const maxCellZ = Math.floor(bounds.maxZ / this.cellSize);
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
        for (const collider of this.cells.get(`${cellX}:${cellZ}`) ?? []) {
          const colliderArea = colliderBounds(collider);
          if (
            bounds.maxX < colliderArea.minX ||
            bounds.minX > colliderArea.maxX ||
            bounds.maxZ < colliderArea.minZ ||
            bounds.minZ > colliderArea.maxZ
          ) {
            continue;
          }
          found.add(collider);
        }
      }
    }
    return [...found];
  }
}

function sweepBoundsIntersect(
  start: PlanarPosition,
  movement: PlanarPosition,
  collider: PlanarCollider,
  radius: number,
) {
  const bounds = colliderBounds(collider);
  const endX = start.x + movement.x;
  const endZ = start.z + movement.z;
  return !(
    Math.max(start.x, endX) + radius < bounds.minX ||
    Math.min(start.x, endX) - radius > bounds.maxX ||
    Math.max(start.z, endZ) + radius < bounds.minZ ||
    Math.min(start.z, endZ) - radius > bounds.maxZ
  );
}

function penetrationAgainstCircle(
  position: PlanarPosition,
  collider: CircleCollider,
  radius: number,
): Penetration | null {
  const combinedRadius = radius + collider.radius;
  const deltaX = position.x - collider.x;
  const deltaZ = position.z - collider.z;
  const distanceSquared = deltaX * deltaX + deltaZ * deltaZ;
  if (distanceSquared >= combinedRadius * combinedRadius - EPSILON) return null;
  const distance = Math.sqrt(Math.max(0, distanceSquared));
  if (distance <= EPSILON) return { x: 1, z: 0, depth: combinedRadius };
  return {
    x: deltaX / distance,
    z: deltaZ / distance,
    depth: combinedRadius - distance,
  };
}

function penetrationAgainstBox(
  position: PlanarPosition,
  collider: BoxCollider,
  radius: number,
): Penetration | null {
  const local = toLocal(position, collider);
  const closestX = Math.max(-collider.halfWidth, Math.min(collider.halfWidth, local.x));
  const closestZ = Math.max(-collider.halfDepth, Math.min(collider.halfDepth, local.z));
  const deltaX = local.x - closestX;
  const deltaZ = local.z - closestZ;
  const distanceSquared = deltaX * deltaX + deltaZ * deltaZ;

  let localNormal: CollisionNormal;
  let depth: number;
  if (distanceSquared > EPSILON) {
    if (distanceSquared >= radius * radius - EPSILON) return null;
    const distance = Math.sqrt(distanceSquared);
    localNormal = { x: deltaX / distance, z: deltaZ / distance };
    depth = radius - distance;
  } else {
    const exitX = collider.halfWidth - Math.abs(local.x);
    const exitZ = collider.halfDepth - Math.abs(local.z);
    if (exitX <= exitZ) {
      localNormal = { x: local.x < 0 ? -1 : 1, z: 0 };
      depth = exitX + radius;
    } else {
      localNormal = { x: 0, z: local.z < 0 ? -1 : 1 };
      depth = exitZ + radius;
    }
  }
  const worldNormal = vectorToWorld(localNormal, collider.rotation);
  return { ...worldNormal, depth };
}

function penetrationAgainstCollider(
  position: PlanarPosition,
  collider: PlanarCollider,
  radius: number,
) {
  if (!isValidCollider(collider)) return null;
  return collider.shape === "circle"
    ? penetrationAgainstCircle(position, collider, radius)
    : penetrationAgainstBox(position, collider, radius);
}

function depenetrate(
  initial: PlanarPosition,
  colliders: readonly PlanarCollider[],
  radius: number,
) {
  const result = { ...initial };
  for (let iteration = 0; iteration < MAX_DEPENETRATION_ITERATIONS; iteration += 1) {
    let best: (Penetration & { id: string }) | null = null;
    for (const collider of colliders) {
      const overlap = penetrationAgainstCollider(result, collider, radius);
      if (!overlap) continue;
      if (
        !best ||
        overlap.depth > best.depth + EPSILON ||
        (Math.abs(overlap.depth - best.depth) <= EPSILON && collider.id < best.id)
      ) {
        best = { ...overlap, id: collider.id };
      }
    }
    if (!best) break;
    result.x += best.x * (best.depth + CONTACT_SKIN);
    result.z += best.z * (best.depth + CONTACT_SKIN);
  }
  return result;
}

function sweepCircle(
  start: PlanarPosition,
  movement: PlanarPosition,
  collider: CircleCollider,
  radius: number,
): SweepHit | null {
  const combinedRadius = radius + collider.radius;
  const offsetX = start.x - collider.x;
  const offsetZ = start.z - collider.z;
  const movementSquared = movement.x * movement.x + movement.z * movement.z;
  if (movementSquared <= EPSILON) return null;
  const offsetSquared = offsetX * offsetX + offsetZ * offsetZ;
  const projection = offsetX * movement.x + offsetZ * movement.z;

  if (offsetSquared <= combinedRadius * combinedRadius + EPSILON) {
    const distance = Math.sqrt(Math.max(0, offsetSquared));
    const normal = distance > EPSILON
      ? { x: offsetX / distance, z: offsetZ / distance }
      : { x: 1, z: 0 };
    if (movement.x * normal.x + movement.z * normal.z < -EPSILON) {
      return { ...normal, time: 0 };
    }
    return null;
  }

  const constant = offsetSquared - combinedRadius * combinedRadius;
  const discriminant = projection * projection - movementSquared * constant;
  if (discriminant < 0) return null;
  const time = (-projection - Math.sqrt(Math.max(0, discriminant))) / movementSquared;
  if (time < -TIME_EPSILON || time > 1 + TIME_EPSILON) return null;
  const clampedTime = Math.max(0, Math.min(1, time));
  const hitX = start.x + movement.x * clampedTime;
  const hitZ = start.z + movement.z * clampedTime;
  const normalLength = Math.hypot(hitX - collider.x, hitZ - collider.z);
  if (normalLength <= EPSILON) return null;
  const normal = {
    x: (hitX - collider.x) / normalLength,
    z: (hitZ - collider.z) / normalLength,
  };
  if (movement.x * normal.x + movement.z * normal.z >= -EPSILON) return null;
  return { ...normal, time: clampedTime };
}

function sweepBox(
  start: PlanarPosition,
  movement: PlanarPosition,
  collider: BoxCollider,
  radius: number,
): SweepHit | null {
  const localStart = toLocal(start, collider);
  const localMovement = vectorToLocal(movement, collider.rotation);
  let earliest: (SweepHit & { rank: number }) | null = null;

  const consider = (time: number, normal: CollisionNormal, rank: number) => {
    if (time < -TIME_EPSILON || time > 1 + TIME_EPSILON) return;
    if (localMovement.x * normal.x + localMovement.z * normal.z >= -EPSILON) return;
    const clampedTime = Math.max(0, Math.min(1, time));
    if (
      !earliest ||
      clampedTime < earliest.time - TIME_EPSILON ||
      (Math.abs(clampedTime - earliest.time) <= TIME_EPSILON && rank < earliest.rank)
    ) {
      earliest = { ...normal, time: clampedTime, rank };
    }
  };

  if (Math.abs(localMovement.x) > EPSILON) {
    for (const sign of [-1, 1] as const) {
      const boundary = sign * (collider.halfWidth + radius);
      const time = (boundary - localStart.x) / localMovement.x;
      const hitZ = localStart.z + localMovement.z * time;
      if (hitZ >= -collider.halfDepth - EPSILON && hitZ <= collider.halfDepth + EPSILON) {
        consider(time, { x: sign, z: 0 }, sign < 0 ? 0 : 1);
      }
    }
  }

  if (Math.abs(localMovement.z) > EPSILON) {
    for (const sign of [-1, 1] as const) {
      const boundary = sign * (collider.halfDepth + radius);
      const time = (boundary - localStart.z) / localMovement.z;
      const hitX = localStart.x + localMovement.x * time;
      if (hitX >= -collider.halfWidth - EPSILON && hitX <= collider.halfWidth + EPSILON) {
        consider(time, { x: 0, z: sign }, sign < 0 ? 2 : 3);
      }
    }
  }

  const movementSquared =
    localMovement.x * localMovement.x + localMovement.z * localMovement.z;
  for (const signX of [-1, 1] as const) {
    for (const signZ of [-1, 1] as const) {
      const cornerX = signX * collider.halfWidth;
      const cornerZ = signZ * collider.halfDepth;
      const offsetX = localStart.x - cornerX;
      const offsetZ = localStart.z - cornerZ;
      const projection = offsetX * localMovement.x + offsetZ * localMovement.z;
      const constant = offsetX * offsetX + offsetZ * offsetZ - radius * radius;
      const discriminant = projection * projection - movementSquared * constant;
      if (discriminant < 0) continue;
      const time = (-projection - Math.sqrt(Math.max(0, discriminant))) / movementSquared;
      if (time < -TIME_EPSILON || time > 1 + TIME_EPSILON) continue;
      const hitX = localStart.x + localMovement.x * time;
      const hitZ = localStart.z + localMovement.z * time;
      if (
        hitX * signX < collider.halfWidth - EPSILON ||
        hitZ * signZ < collider.halfDepth - EPSILON
      ) {
        continue;
      }
      const normalLength = Math.hypot(hitX - cornerX, hitZ - cornerZ);
      if (normalLength <= EPSILON) continue;
      consider(
        time,
        { x: (hitX - cornerX) / normalLength, z: (hitZ - cornerZ) / normalLength },
        4 + (signX > 0 ? 2 : 0) + (signZ > 0 ? 1 : 0),
      );
    }
  }

  const localHit = earliest as (SweepHit & { rank: number }) | null;
  if (!localHit) return null;
  const worldNormal = vectorToWorld(localHit, collider.rotation);
  return { ...worldNormal, time: localHit.time };
}

function findEarliestHit(
  start: PlanarPosition,
  movement: PlanarPosition,
  colliders: readonly PlanarCollider[],
  radius: number,
) {
  let best: (SweepHit & { id: string }) | null = null;
  for (const collider of colliders) {
    if (!isValidCollider(collider)) continue;
    if (!sweepBoundsIntersect(start, movement, collider, radius + CONTACT_SKIN)) continue;
    const hit = collider.shape === "circle"
      ? sweepCircle(start, movement, collider, radius)
      : sweepBox(start, movement, collider, radius);
    if (!hit) continue;
    if (
      !best ||
      hit.time < best.time - TIME_EPSILON ||
      (Math.abs(hit.time - best.time) <= TIME_EPSILON && collider.id < best.id)
    ) {
      best = { ...hit, id: collider.id };
    }
  }
  return best;
}

/**
 * Continuous circular-character collision against circles and oriented boxes.
 * It sweeps the complete movement segment, slides along contact planes, and
 * deterministically recovers from streamed/spawned overlap.
 */
export function resolvePlanarMovement(
  current: PlanarPosition,
  desired: PlanarPosition,
  colliders: readonly PlanarCollider[],
  playerRadius: number,
): PlanarPosition {
  const safeCurrent = isFinitePosition(current) ? current : { x: 0, z: 0 };
  const safeDesired = isFinitePosition(desired) ? desired : safeCurrent;
  const safeRadius = Number.isFinite(playerRadius) && playerRadius >= 0 ? playerRadius : 0;
  const intendedMovement = {
    x: safeDesired.x - safeCurrent.x,
    z: safeDesired.z - safeCurrent.z,
  };
  const result = depenetrate(safeCurrent, colliders, safeRadius);
  const remaining = { ...intendedMovement };

  for (let iteration = 0; iteration < MAX_SWEEP_ITERATIONS; iteration += 1) {
    if (remaining.x * remaining.x + remaining.z * remaining.z <= EPSILON) break;
    const hit = findEarliestHit(result, remaining, colliders, safeRadius);
    if (!hit) {
      result.x += remaining.x;
      result.z += remaining.z;
      remaining.x = 0;
      remaining.z = 0;
      break;
    }

    result.x += remaining.x * hit.time + hit.x * CONTACT_SKIN;
    result.z += remaining.z * hit.time + hit.z * CONTACT_SKIN;
    const remainingScale = Math.max(0, 1 - hit.time);
    remaining.x *= remainingScale;
    remaining.z *= remainingScale;
    const inward = remaining.x * hit.x + remaining.z * hit.z;
    if (inward < 0) {
      remaining.x -= hit.x * inward;
      remaining.z -= hit.z * inward;
    }
  }

  return depenetrate(result, colliders, safeRadius);
}

/** True when a circular footprint has no overlap with any valid collider. */
export function isPlanarPositionClear(
  position: PlanarPosition,
  colliders: readonly PlanarCollider[],
  radius: number,
) {
  if (!isFinitePosition(position) || !Number.isFinite(radius) || radius < 0) return false;
  return colliders.every(
    (collider) => penetrationAgainstCollider(position, collider, radius) === null,
  );
}

/** @deprecated Use resolvePlanarMovement; retained for feature-module compatibility. */
export const resolveCircleMovement = resolvePlanarMovement;
