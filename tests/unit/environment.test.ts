import { describe, expect, it } from "vitest";
import {
  BIOME_WEATHER_PROFILES,
  MINUTES_PER_WORLD_DAY,
  WEATHER_EPOCH_MINUTES,
  WORLD_START_MINUTES,
  sampleBiomeWeather,
  sampleDaylight,
  sampleEnvironment,
  sanitizeWorldMinutes,
} from "../../lib/game/environment/model";
import {
  BIOMES,
  WORLD_HALF_EXTENT,
  sampleClimate,
  type BiomeId,
  type ClimateSample,
} from "../../lib/game/world/macroWorld";

function climateForBiome(id: BiomeId): ClimateSample {
  for (let z = -WORLD_HALF_EXTENT; z <= WORLD_HALF_EXTENT; z += 1_500) {
    for (let x = -WORLD_HALF_EXTENT; x <= WORLD_HALF_EXTENT; x += 1_500) {
      const climate = sampleClimate(x, z);
      if (climate.biome.id === id) return climate;
    }
  }
  throw new Error(`No climate sample found for ${id}`);
}

describe("deterministic world atmosphere", () => {
  it("classifies a complete day and rolls the calendar forward", () => {
    expect(sampleDaylight(4 * 60 + 59).phase).toBe("night");
    expect(sampleDaylight(5 * 60).phase).toBe("dawn");
    expect(sampleDaylight(7 * 60).phase).toBe("day");
    expect(sampleDaylight(17 * 60).phase).toBe("dusk");
    expect(sampleDaylight(19 * 60).phase).toBe("night");
    expect(sampleDaylight(MINUTES_PER_WORLD_DAY + 75)).toMatchObject({
      day: 2,
      hour: 1,
      minute: 15,
    });
  });

  it("makes noon visibly brighter than midnight without invalid values", () => {
    const climate = climateForBiome("grey_meadow");
    const noon = sampleEnvironment(12 * 60, climate);
    const midnight = sampleEnvironment(0, climate);
    expect(noon.daylight).toBeGreaterThan(0.95);
    expect(midnight.night).toBeGreaterThan(0.95);
    expect(noon.lightScale).toBeGreaterThan(midnight.lightScale);
    expect(noon.exposure).toBeGreaterThan(midnight.exposure);
    expect(Object.values(noon).filter((value) => typeof value === "number").every(Number.isFinite)).toBe(true);
  });

  it("is random-access deterministic for the same seed, biome, and time", () => {
    const climate = climateForBiome("salt_coast");
    const first = sampleEnvironment(18_432.75, climate, "test-seed");
    expect(sampleEnvironment(18_432.75, climate, "test-seed")).toEqual(first);
    expect(sampleEnvironment(18_432.75, climate, "different-seed")).not.toEqual(first);
  });

  it("only selects weather declared for each biome", () => {
    for (const biomeId of Object.keys(BIOMES) as BiomeId[]) {
      const climate = climateForBiome(biomeId);
      const allowed = new Set(BIOME_WEATHER_PROFILES[biomeId].map((entry) => entry.id));
      const observed = new Set<string>();
      for (let epoch = 0; epoch < 72; epoch += 1) {
        const sample = sampleBiomeWeather(
          biomeId,
          climate,
          epoch * WEATHER_EPOCH_MINUTES + 20,
        );
        expect(allowed.has(sample.weatherId)).toBe(true);
        expect(sample.windDirection).toBeGreaterThanOrEqual(0);
        expect(sample.windDirection).toBeLessThan(360);
        expect(sample.visibilityMeters).toBeGreaterThanOrEqual(120);
        expect(sample.visibilityMeters).toBeLessThanOrEqual(12_000);
        observed.add(sample.weatherId);
      }
      expect(observed.size).toBeGreaterThan(1);
    }
  });

  it("keeps impossible biome combinations out of the weather menus", () => {
    const badland = BIOME_WEATHER_PROFILES.glass_badlands;
    expect(badland.every((entry) => entry.precipitation === "none")).toBe(true);
    expect(badland.some((entry) => entry.id === "dust")).toBe(true);
    expect(BIOME_WEATHER_PROFILES.crown_highlands.some(
      (entry) => entry.precipitation === "snow" || entry.precipitation === "sleet",
    )).toBe(true);
    expect(BIOME_WEATHER_PROFILES.salt_coast.some((entry) => entry.label.includes("squall"))).toBe(true);
  });

  it("blends continuously across deterministic weather epochs", () => {
    const climate = climateForBiome("riverlands");
    const boundary = WEATHER_EPOCH_MINUTES * 9;
    const before = sampleBiomeWeather("riverlands", climate, boundary - 0.001, "blend-seed");
    const after = sampleBiomeWeather("riverlands", climate, boundary + 0.001, "blend-seed");
    expect(Math.abs(before.fogDensity - after.fogDensity)).toBeLessThan(0.00001);
    expect(Math.abs(before.cloudCover - after.cloudCover)).toBeLessThan(0.001);
    expect(before.transition).toBeGreaterThan(0.999);
    expect(after.transition).toBeLessThan(0.001);
  });

  it("uses climate temperature while preserving deterministic weather", () => {
    const cold = { temperature: 0.1 };
    const hot = { temperature: 0.9 };
    const coldWeather = sampleBiomeWeather("grey_meadow", cold, 640, "thermal-seed");
    const hotWeather = sampleBiomeWeather("grey_meadow", hot, 640, "thermal-seed");
    expect(hotWeather.weatherId).toBe(coldWeather.weatherId);
    expect(hotWeather.temperatureC - coldWeather.temperatureC).toBeCloseTo(28.8);
  });

  it("sanitizes corrupt clock values to a stable opening time", () => {
    expect(sanitizeWorldMinutes(Number.NaN)).toBe(WORLD_START_MINUTES);
    expect(sanitizeWorldMinutes(Number.POSITIVE_INFINITY)).toBe(WORLD_START_MINUTES);
    expect(sanitizeWorldMinutes(-50)).toBe(0);
    expect(sampleDaylight(Number.NaN).totalMinutes).toBe(WORLD_START_MINUTES);
  });
});
