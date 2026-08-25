import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORLD_DETAIL_LEVEL,
  WORLD_DETAIL_LEVELS,
  WORLD_DETAIL_PRESETS,
  normalizeWorldDetailLevel,
} from "../../lib/game/world/WorldLodPolicy";

describe("world LOD policy", () => {
  it("normalizes arbitrary input to one of five saved slider stops", () => {
    expect(normalizeWorldDetailLevel(undefined)).toBe(DEFAULT_WORLD_DETAIL_LEVEL);
    expect(normalizeWorldDetailLevel(Number.NaN)).toBe(DEFAULT_WORLD_DETAIL_LEVEL);
    expect(normalizeWorldDetailLevel(-10)).toBe(0);
    expect(normalizeWorldDetailLevel(1.6)).toBe(2);
    expect(normalizeWorldDetailLevel(99)).toBe(4);
  });

  it("trades bounded geometry and scenery budgets for monotonic detail", () => {
    let previousDistance = 0;
    let previousCellSize = Number.POSITIVE_INFINITY;
    let previousScenery = 0;
    for (const level of WORLD_DETAIL_LEVELS) {
      const preset = WORLD_DETAIL_PRESETS[level];
      expect(preset.detailBlendEnd).toBeGreaterThan(previousDistance);
      expect(preset.nearCellSize).toBeLessThan(previousCellSize);
      expect(preset.maxSceneryInstances).toBeGreaterThanOrEqual(previousScenery);
      expect(preset.maxTerrainTriangles).toBeLessThanOrEqual(300_000);
      previousDistance = preset.detailBlendEnd;
      previousCellSize = preset.nearCellSize;
      previousScenery = preset.maxSceneryInstances;
    }
  });
});
