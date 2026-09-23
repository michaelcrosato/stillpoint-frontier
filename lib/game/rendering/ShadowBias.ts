import { QUALITY_PRESETS, type QualityLevel } from "../config";

/** Width and height of the sun's orthographic shadow box, in metres. */
export const SUN_SHADOW_EXTENT_METERS = 176;

/**
 * Three's PCF lookup adds `shadow.bias` to the fragment depth under both depth
 * conventions, while its BASIC and VSM paths negate it for a reversed buffer.
 * Moving a fragment toward the light means lowering its depth in a standard
 * buffer and raising it in a reversed one, so the sign has to follow the
 * renderer's convention.
 */
export function shadowDepthBias(magnitude: number, reversedDepth: boolean) {
  return reversedDepth ? magnitude : -magnitude;
}

export interface SunShadowBiases {
  bias: number;
  normalBias: number;
}

export function sunShadowBiases(
  quality: QualityLevel,
  reversedDepth: boolean,
  mapSize = QUALITY_PRESETS[quality].sunShadowMapSize,
): SunShadowBiases {
  const texel = SUN_SHADOW_EXTENT_METERS / Math.max(1, mapSize);
  return {
    bias: shadowDepthBias(quality === "ultra" ? 0.00008 : 0.00015, reversedDepth),
    // Half a texel covers the map's own quantisation on surfaces the light
    // grazes; less leaves acne that the depth bias alone cannot remove.
    normalBias: texel / 2,
  };
}
