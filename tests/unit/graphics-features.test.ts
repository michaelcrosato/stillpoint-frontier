import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRAPHICS_FEATURES,
  GRAPHICS_FEATURE_IDS,
  isGraphicsFeatureId,
  setGraphicsFeatureState,
} from "../../lib/game/rendering/GraphicsFeatures";

describe("graphics feature policy", () => {
  it("defines default-on, independently addressable renderer modules", () => {
    expect(GRAPHICS_FEATURE_IDS).toEqual([
      "shadowStabilization",
      "surfaceDetail",
      "vegetationWind",
      "atmosphericGrade",
      "horizonLights",
      "selectiveBloom",
      "ambientOcclusion",
      "environmentReflections",
    ]);
    expect(Object.values(DEFAULT_GRAPHICS_FEATURES)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(isGraphicsFeatureId("vegetationWind")).toBe(true);
    expect(isGraphicsFeatureId("rayTracing")).toBe(false);
  });

  it("preserves identity for no-op toggles and copies changed state", () => {
    expect(
      setGraphicsFeatureState(
        DEFAULT_GRAPHICS_FEATURES,
        "surfaceDetail",
        true,
      ),
    ).toBe(DEFAULT_GRAPHICS_FEATURES);
    const disabled = setGraphicsFeatureState(
      DEFAULT_GRAPHICS_FEATURES,
      "surfaceDetail",
      false,
    );
    expect(disabled).not.toBe(DEFAULT_GRAPHICS_FEATURES);
    expect(disabled).toEqual({
      ...DEFAULT_GRAPHICS_FEATURES,
      surfaceDetail: false,
    });
  });
});
