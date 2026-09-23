import * as THREE from "three";
import { QUALITY_LEVELS, type QualityLevel } from "../config";
import type { EnvironmentVisualState } from "../environment";

type EnvironmentMapSample = Pick<
  EnvironmentVisualState,
  | "cloudCover"
  | "daylight"
  | "goldenHour"
  | "dust"
  | "sunDirection"
>;

// Non-finite input lands in bucket 0: a NaN signature never equals itself and
// would regenerate the PMREM on every frame.
const quantize = (value: number, steps: number) =>
  Number.isFinite(value) ? Math.round(THREE.MathUtils.clamp(value, 0, 1) * steps) : 0;

/**
 * Broad deterministic buckets keep PMREM generation out of the frame loop.
 * The buckets are packed into one integer, one mixed-radix digit each, so the
 * per-frame comparison allocates nothing. Sun azimuth is not a bucket: the
 * captured sky is symmetric about the vertical apart from the sun, so the
 * runtime turns the captured map with the sun instead of recapturing.
 */
export function environmentMapSignature(
  state: Readonly<EnvironmentMapSample>,
  quality: QualityLevel,
): number {
  const elevation = state.sunDirection.y * 0.5 + 0.5;
  let signature = QUALITY_LEVELS.indexOf(quality);
  signature = signature * 6 + quantize(state.daylight, 5);
  signature = signature * 4 + quantize(state.goldenHour, 3);
  signature = signature * 4 + quantize(state.cloudCover, 3);
  signature = signature * 3 + quantize(state.dust, 2);
  return signature * 8 + quantize(elevation, 7);
}

/** Azimuth of a direction about the vertical, as atan2(z, x). */
export function sunAzimuth(direction: Readonly<THREE.Vector3>) {
  const azimuth = Math.atan2(direction.z, direction.x);
  return Number.isFinite(azimuth) ? azimuth : 0;
}

/** Wraps an angle into (-pi, pi]. */
export function wrapAngle(angle: number) {
  if (!Number.isFinite(angle)) return 0;
  const wrapped = ((((angle + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

export function renderPixelRatio(
  devicePixelRatio: number,
  presetCap: number,
  width: number,
  height: number,
  maxFramebufferSize: number,
) {
  const safeWidth = Math.max(1, Number.isFinite(width) ? width : 1);
  const safeHeight = Math.max(1, Number.isFinite(height) ? height : 1);
  const safeMaximum = Math.max(
    1,
    Number.isFinite(maxFramebufferSize) ? maxFramebufferSize : 1,
  );
  return Math.max(
    1 / Math.max(safeWidth, safeHeight),
    Math.min(
      Math.max(0.5, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1),
      Math.max(0.5, Number.isFinite(presetCap) ? presetCap : 1),
      safeMaximum / safeWidth,
      safeMaximum / safeHeight,
    ),
  );
}

export function composerSampleCount(requested: number, maximum: number) {
  return Math.max(
    0,
    Math.min(
      Math.floor(Number.isFinite(requested) ? requested : 0),
      Math.floor(Number.isFinite(maximum) ? maximum : 0),
    ),
  );
}

export function gtaoIsSupported(requested: boolean, logarithmicDepth: boolean) {
  return requested && !logarithmicDepth;
}
