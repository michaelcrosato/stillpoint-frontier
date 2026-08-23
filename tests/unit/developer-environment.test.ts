import { describe, expect, it } from "vitest";
import {
  advanceDeveloperMinutes,
  createDeveloperEnvironmentState,
  developerWeatherOptions,
  ensureDeveloperWeatherIsValid,
  resetDeveloperEnvironment,
  setDeveloperMinuteOfDay,
  setDeveloperMode,
  setDeveloperWeather,
  tickDeveloperEnvironment,
} from "../../lib/game/developer/environmentState";

describe("developer environment sandbox", () => {
  it("clones canonical time on enable and restores it on disable", () => {
    const canonicalMinutes = 815;
    const initial = createDeveloperEnvironmentState(canonicalMinutes);
    const enabled = setDeveloperMode(initial, true, canonicalMinutes);
    const changed = advanceDeveloperMinutes(
      setDeveloperMinuteOfDay(enabled, 0),
      120,
    );

    expect(enabled).toMatchObject({
      enabled: true,
      clockPaused: true,
      worldMinutes: canonicalMinutes,
      weatherOverride: null,
    });
    expect(changed.worldMinutes).toBe(120);
    expect(canonicalMinutes).toBe(815);
    expect(setDeveloperMode(changed, false, canonicalMinutes)).toEqual(initial);
  });

  it("preserves the current day when selecting a time and wraps inputs safely", () => {
    const enabled = setDeveloperMode(
      createDeveloperEnvironmentState(2 * 1_440 + 700),
      true,
      2 * 1_440 + 700,
    );
    expect(setDeveloperMinuteOfDay(enabled, 18 * 60).worldMinutes).toBe(
      2 * 1_440 + 18 * 60,
    );
    expect(setDeveloperMinuteOfDay(enabled, 1_440).worldMinutes).toBe(2 * 1_440);
    expect(setDeveloperMinuteOfDay(enabled, -60).worldMinutes).toBe(
      2 * 1_440 + 23 * 60,
    );
    expect(setDeveloperMinuteOfDay(enabled, Number.NaN)).toEqual(enabled);
  });

  it("advances only while enabled, running, and unfrozen", () => {
    const disabled = createDeveloperEnvironmentState(450);
    const frozen = setDeveloperMode(disabled, true, 450);
    expect(tickDeveloperEnvironment(disabled, 5, true)).toEqual(disabled);
    expect(tickDeveloperEnvironment(frozen, 5, true)).toEqual(frozen);

    const running = { ...frozen, clockPaused: false };
    expect(tickDeveloperEnvironment(running, 2.5, true).worldMinutes).toBe(452.5);
    expect(tickDeveloperEnvironment(running, 2.5, false)).toEqual(running);
    expect(tickDeveloperEnvironment(running, -1, true)).toEqual(running);
    expect(tickDeveloperEnvironment(running, Number.NaN, true)).toEqual(running);
  });

  it("only accepts weather declared for the current biome", () => {
    const enabled = setDeveloperMode(
      createDeveloperEnvironmentState(450),
      true,
      450,
    );
    const coastalOptions = developerWeatherOptions("salt_coast");
    expect(coastalOptions.some((option) => option.id === "storm")).toBe(true);
    expect(coastalOptions.some((option) => option.id === "dust")).toBe(false);

    const storm = setDeveloperWeather(enabled, "storm", "salt_coast");
    expect(storm.weatherOverride).toBe("storm");
    expect(setDeveloperWeather(storm, "dust", "salt_coast").weatherOverride).toBeNull();
    expect(setDeveloperWeather(storm, null, "salt_coast").weatherOverride).toBeNull();
    expect(setDeveloperWeather(createDeveloperEnvironmentState(450), "storm", "salt_coast"))
      .toEqual(createDeveloperEnvironmentState(450));
  });

  it("returns invalid cross-biome overrides to Auto and resets all overrides", () => {
    const enabled = setDeveloperMode(
      createDeveloperEnvironmentState(450),
      true,
      450,
    );
    const dust = setDeveloperWeather(enabled, "dust", "glass_badlands");
    expect(ensureDeveloperWeatherIsValid(dust, "grey_meadow").weatherOverride).toBeNull();
    expect(ensureDeveloperWeatherIsValid(enabled, "grey_meadow")).toEqual(enabled);

    const changed = {
      ...advanceDeveloperMinutes(dust, 300),
      clockPaused: false,
    };
    expect(resetDeveloperEnvironment(changed, 900)).toEqual({
      enabled: true,
      clockPaused: true,
      worldMinutes: 900,
      weatherOverride: null,
    });
    expect(resetDeveloperEnvironment(createDeveloperEnvironmentState(450), 900))
      .toEqual(createDeveloperEnvironmentState(900));
    expect(advanceDeveloperMinutes(enabled, Number.NaN)).toEqual(enabled);
  });
});
