import { describe, expect, it } from "vitest";
import {
  QUALITY_LEVELS,
  QUALITY_PRESETS,
  isQualityLevel,
  qualityUsesHighDetail,
  qualityUsesShadows,
} from "../../lib/game/config";

describe("quality profiles", () => {
  it("defines a stable low-to-high profile order with complete budgets", () => {
    expect(QUALITY_LEVELS).toEqual(["performance", "cinematic", "ultra"]);
    expect(new Set(QUALITY_LEVELS).size).toBe(QUALITY_LEVELS.length);
    for (const level of QUALITY_LEVELS) {
      const preset = QUALITY_PRESETS[level];
      expect(preset.pixelRatioCap).toBeGreaterThanOrEqual(1);
      expect(preset.pixelRatioCap).toBeLessThanOrEqual(2);
      expect(Math.log2(preset.sunShadowMapSize) % 1).toBe(0);
      expect(Math.log2(preset.flashlightShadowMapSize) % 1).toBe(0);
      expect([32, 64, 128]).toContain(preset.environmentMap.size);
      expect(preset.environmentMap.intensity).toBeGreaterThan(0);
      expect(preset.worldEffects.surfaceDetailStrength).toBeGreaterThanOrEqual(0);
      expect(preset.worldEffects.surfaceDetailStrength).toBeLessThanOrEqual(1);
      expect(preset.worldEffects.vegetationWindStrength).toBeGreaterThanOrEqual(0);
      expect(preset.worldEffects.vegetationWindStrength).toBeLessThanOrEqual(1);
      expect(preset.postProcessing.msaaSamples).toBeGreaterThanOrEqual(0);
      expect(preset.postProcessing.gtaoResolutionScale).toBeGreaterThan(0);
      expect(preset.postProcessing.gtaoResolutionScale).toBeLessThanOrEqual(1);
      expect(isQualityLevel(level)).toBe(true);
    }
  });

  it("keeps Ultra on the high-detail path while increasing image budgets", () => {
    expect(qualityUsesShadows("performance")).toBe(false);
    expect(qualityUsesHighDetail("performance")).toBe(false);
    expect(qualityUsesShadows("cinematic")).toBe(true);
    expect(qualityUsesHighDetail("ultra")).toBe(true);
    expect(QUALITY_PRESETS.ultra.sunShadowMapSize).toBe(4096);
    expect(QUALITY_PRESETS.ultra.flashlightShadowMapSize).toBe(2048);
    expect(QUALITY_PRESETS.ultra.pixelRatioCap).toBe(2);
    expect(QUALITY_PRESETS.ultra.postProcessing.gtao).toBe(true);
    expect(QUALITY_PRESETS.cinematic.postProcessing.enabled).toBe(true);
    expect(QUALITY_PRESETS.performance.postProcessing.enabled).toBe(false);
    expect(QUALITY_PRESETS.ultra.environmentMap.size)
      .toBeGreaterThan(QUALITY_PRESETS.cinematic.environmentMap.size);
    expect(isQualityLevel("extreme")).toBe(false);
    expect(isQualityLevel(null)).toBe(false);
  });
});
