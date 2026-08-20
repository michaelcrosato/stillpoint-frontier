export interface CircleCollider {
  id: string;
  x: number;
  z: number;
  radius: number;
}

export interface PlanarPosition {
  x: number;
  z: number;
}

export function resolveCircleMovement(
  current: PlanarPosition,
  desired: PlanarPosition,
  colliders: readonly CircleCollider[],
  playerRadius: number,
): PlanarPosition {
  const result = { ...desired };

  for (const collider of colliders) {
    const minimumDistance = playerRadius + collider.radius;
    let deltaX = result.x - collider.x;
    let deltaZ = result.z - collider.z;
    const distanceSquared = deltaX * deltaX + deltaZ * deltaZ;

    if (distanceSquared >= minimumDistance * minimumDistance) continue;

    let distance = Math.sqrt(distanceSquared);
    if (distance < 0.0001) {
      deltaX = current.x - collider.x || 1;
      deltaZ = current.z - collider.z;
      distance = Math.hypot(deltaX, deltaZ) || 1;
    }

    const correction = minimumDistance / distance;
    result.x = collider.x + deltaX * correction;
    result.z = collider.z + deltaZ * correction;
  }

  return result;
}
