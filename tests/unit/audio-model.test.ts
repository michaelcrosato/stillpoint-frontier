import { describe, expect, it } from "vitest";
import {
  AUDIO_CUE_RECIPES,
  deriveAmbientMix,
  footstepSpacing,
  footstepSurfaceForBiome,
} from "../../lib/game/audio/model";

const base = {
  windKph: 12,
  precipitation: "none" as const,
  precipitationRate: 0,
  night: 0,
  biomeId: "grey_meadow" as const,
  settlementInfluence: 0,
  animalActivity: 0.5,
  paused: false,
};

describe("procedural environmental audio model", () => {
  it("silences dynamic beds while paused", () => {
    expect(deriveAmbientMix({ ...base, paused: true })).toMatchObject({
      wind: 0,
      weather: 0,
      wildlife: 0,
      settlement: 0,
    });
  });

  it("raises wind and rain beds with weather severity", () => {
    const calm = deriveAmbientMix(base);
    const storm = deriveAmbientMix({
      ...base,
      windKph: 72,
      precipitation: "rain",
      precipitationRate: 1,
    });
    expect(storm.wind).toBeGreaterThan(calm.wind);
    expect(storm.weather).toBeGreaterThan(calm.weather);
    expect(storm.wildlife).toBeLessThan(calm.wildlife);
  });

  it("adds proportional settlement ambience", () => {
    expect(deriveAmbientMix({ ...base, settlementInfluence: 1 }).settlement).toBeGreaterThan(0.9);
    expect(deriveAmbientMix({ ...base, settlementInfluence: 0 }).settlement).toBe(0);
  });

  it("maps biomes and shelter to distinct footstep surfaces", () => {
    expect(footstepSurfaceForBiome("grey_meadow", true)).toBe("interior");
    expect(footstepSurfaceForBiome("crown_highlands", false)).toBe("stone");
    expect(footstepSurfaceForBiome("salt_coast", false)).toBe("sand");
    expect(footstepSurfaceForBiome("riverlands", false)).toBe("soil");
    expect(footstepSurfaceForBiome("pine_forest", false)).toBe("grass");
  });

  it("uses distance cadence for walk, sprint, and crouch", () => {
    expect(footstepSpacing(true, false)).toBeLessThan(footstepSpacing(false, false));
    expect(footstepSpacing(false, true)).toBeGreaterThan(footstepSpacing(false, false));
  });

  it("defines a bounded oscillator recipe for every cue", () => {
    expect(Object.keys(AUDIO_CUE_RECIPES)).toHaveLength(10);
    for (const recipe of Object.values(AUDIO_CUE_RECIPES)) {
      expect(recipe.startFrequency).toBeGreaterThan(20);
      expect(recipe.endFrequency).toBeGreaterThan(20);
      expect(recipe.duration).toBeGreaterThan(0);
      expect(recipe.duration).toBeLessThanOrEqual(0.25);
      expect(recipe.gain).toBeGreaterThan(0);
      expect(recipe.gain).toBeLessThanOrEqual(0.2);
    }
  });
});
