import * as THREE from "three";
import type { QualityLevel } from "../config";
import type { EnvironmentVisualState } from "../environment";

type EnvironmentMapSample = Pick<
  EnvironmentVisualState,
  | "cloudCover"
  | "daylight"
  | "goldenHour"
  | "dust"
  | "sunDirection"
>;

const quantize = (value: number, steps: number) =>
  Math.round(THREE.MathUtils.clamp(value, 0, 1) * steps);

/** Broad deterministic buckets keep PMREM generation out of the frame loop. */
export function environmentMapSignature(
  state: Readonly<EnvironmentMapSample>,
  quality: QualityLevel,
) {
  const azimuth = Math.atan2(state.sunDirection.z, state.sunDirection.x);
  const normalizedAzimuth = (azimuth + Math.PI) / (Math.PI * 2);
  const elevation = state.sunDirection.y * 0.5 + 0.5;
  return [
    quality,
    quantize(state.daylight, 5),
    quantize(state.goldenHour, 3),
    quantize(state.cloudCover, 3),
    quantize(state.dust, 2),
    quantize(elevation, 7),
    Math.round(normalizedAzimuth * 12) % 12,
  ].join(":");
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
