const FULL_TURN = 360;
const HALF_TURN = 180;

export interface FlatPosition {
  x: number;
  z: number;
}

export interface MapRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CompassMark {
  absoluteHeading: number;
  heading: number;
  offset: number;
  label: string | null;
  kind: "minor" | "degree" | "cardinal";
}

const CARDINAL_LABELS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeDegrees(value: number) {
  if (!Number.isFinite(value)) return 0;
  return ((value % FULL_TURN) + FULL_TURN) % FULL_TURN;
}

/** Three.js cameras face north (-Z) at yaw 0 and turn east with negative yaw. */
export function unwrappedHeadingFromYaw(yawRadians: number) {
  return Number.isFinite(yawRadians) ? (-yawRadians * HALF_TURN) / Math.PI : 0;
}

export function headingFromYaw(yawRadians: number) {
  return normalizeDegrees(unwrappedHeadingFromYaw(yawRadians));
}

export function bearingDegrees(from: FlatPosition, to: FlatPosition) {
  const deltaX = to.x - from.x;
  const deltaZ = to.z - from.z;
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaZ)) return 0;
  if (deltaX === 0 && deltaZ === 0) return 0;
  return normalizeDegrees((Math.atan2(deltaX, -deltaZ) * HALF_TURN) / Math.PI);
}

/** Signed shortest turn from `fromHeading` to `targetHeading`, in [-180, 180). */
export function signedHeadingDelta(targetHeading: number, fromHeading: number) {
  return normalizeDegrees(targetHeading - fromHeading + HALF_TURN) - HALF_TURN;
}

export function planarDistance(from: FlatPosition, to: FlatPosition) {
  return Math.hypot(to.x - from.x, to.z - from.z);
}

export function worldToMapPercent(value: number, worldHalfExtent: number) {
  if (!Number.isFinite(value) || !Number.isFinite(worldHalfExtent) || worldHalfExtent <= 0) {
    return 50;
  }
  return 50 + (value / (worldHalfExtent * 2)) * 100;
}

export function mapPercentToWorld(percent: number, worldHalfExtent: number) {
  if (!Number.isFinite(percent) || !Number.isFinite(worldHalfExtent) || worldHalfExtent <= 0) {
    return 0;
  }
  return ((clamp(percent, 0, 100) - 50) / 100) * worldHalfExtent * 2;
}

export function mapPointToWorld(
  clientX: number,
  clientY: number,
  rect: MapRect,
  worldHalfExtent: number,
): FlatPosition | null {
  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY) ||
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.top) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    !Number.isFinite(worldHalfExtent) ||
    worldHalfExtent <= 0
  ) {
    return null;
  }
  const horizontal = clamp((clientX - rect.left) / rect.width, 0, 1);
  const vertical = clamp((clientY - rect.top) / rect.height, 0, 1);
  return {
    x: (horizontal * 2 - 1) * worldHalfExtent,
    z: (vertical * 2 - 1) * worldHalfExtent,
  };
}

export function cardinalForHeading(heading: number) {
  return CARDINAL_LABELS[Math.round(normalizeDegrees(heading) / 45) % CARDINAL_LABELS.length];
}

export function formatHeading(heading: number) {
  const rounded = Math.round(normalizeDegrees(heading)) % FULL_TURN;
  return `${String(rounded).padStart(3, "0")}°`;
}

export function formatNavigationDistance(meters: number) {
  if (!Number.isFinite(meters) || meters < 0) return "--";
  if (meters >= 10_000) return `${Math.round(meters / 1_000)} KM`;
  if (meters >= 1_000) return `${(meters / 1_000).toFixed(1)} KM`;
  return `${Math.round(meters)} M`;
}

/**
 * Produces a local, unwrapped compass window. Absolute headings keep the tape
 * continuous while crossing north instead of jumping from 359 back to 0.
 */
export function buildCompassMarks(
  unwrappedHeading: number,
  span = 60,
  step = 5,
): CompassMark[] {
  const safeHeading = Number.isFinite(unwrappedHeading) ? unwrappedHeading : 0;
  const safeSpan = Number.isFinite(span) && span > 0 ? span : 60;
  const safeStep = Number.isFinite(step) && step > 0 ? step : 5;
  const first = Math.floor((safeHeading - safeSpan) / safeStep) * safeStep;
  const last = Math.ceil((safeHeading + safeSpan) / safeStep) * safeStep;
  const marks: CompassMark[] = [];

  for (let absoluteHeading = first; absoluteHeading <= last; absoluteHeading += safeStep) {
    const heading = normalizeDegrees(absoluteHeading);
    const cardinalIndex = Math.round(heading / 45) % CARDINAL_LABELS.length;
    const isCardinal = Math.abs(heading / 45 - Math.round(heading / 45)) < 0.000_001;
    const isDegree = Math.abs(heading / 15 - Math.round(heading / 15)) < 0.000_001;
    marks.push({
      absoluteHeading,
      heading,
      offset: absoluteHeading - safeHeading,
      label: isCardinal
        ? CARDINAL_LABELS[cardinalIndex]
        : isDegree
          ? String(Math.round(heading)).padStart(3, "0")
          : null,
      kind: isCardinal ? "cardinal" : isDegree ? "degree" : "minor",
    });
  }
  return marks;
}
