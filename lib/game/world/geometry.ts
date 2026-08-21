export interface Point2 {
  x: number;
  z: number;
}

/** Liang-Barsky clipping for deterministic road recipes. */
export function clipSegmentToRect(
  start: Point2,
  end: Point2,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): { start: Point2; end: Point2 } | null {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  let low = 0;
  let high = 1;
  const constraints = [
    [-dx, start.x - minX],
    [dx, maxX - start.x],
    [-dz, start.z - minZ],
    [dz, maxZ - start.z],
  ] as const;

  for (const [p, q] of constraints) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const ratio = q / p;
    if (p < 0) low = Math.max(low, ratio);
    else high = Math.min(high, ratio);
    if (low > high) return null;
  }

  return {
    start: { x: start.x + dx * low, z: start.z + dz * low },
    end: { x: start.x + dx * high, z: start.z + dz * high },
  };
}
