import { describe, expect, it } from "vitest";
import {
  INITIAL_PLAYER_CONDITION,
  MAX_HEALTH,
  apparentTemperature,
  applyPlayerDamage,
  deriveConditionTags,
  fallDamageForImpact,
  recoverPlayerCondition,
  stepPlayerCondition,
  type ConditionStepInput,
} from "../../lib/game/gameplay/playerCondition";

const fairInput = {
  sheltered: false,
  precipitation: "none" as const,
  precipitationRate: 0,
  temperatureC: 16,
  windKph: 8,
  stamina: 1,
  inventoryWeight: 0,
};

function advance(seconds: number, input: Readonly<ConditionStepInput> = fairInput) {
  let state = { ...INITIAL_PLAYER_CONDITION };
  for (let index = 0; index < seconds * 60; index += 1) {
    state = stepPlayerCondition(state, input, 1 / 60);
  }
  return state;
}

describe("player condition model", () => {
  it("keeps ordinary jumps safe and makes tall falls consequential", () => {
    expect(fallDamageForImpact(7.1)).toBe(0);
    expect(fallDamageForImpact(11)).toBe(0);
    expect(fallDamageForImpact(16)).toBe(24);
    expect(fallDamageForImpact(40)).toBe(MAX_HEALTH);
  });

  it("is monotonic and contains invalid impact speeds", () => {
    const samples = [0, 7, 11, 15, 20, 40].map(fallDamageForImpact);
    expect(samples).toEqual([...samples].sort((a, b) => a - b));
    expect(fallDamageForImpact(Number.NaN)).toBe(0);
    expect(fallDamageForImpact(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("applies damage once and never underflows health", () => {
    const hurt = applyPlayerDamage(INITIAL_PLAYER_CONDITION, 34, "fall");
    expect(hurt.health).toBe(66);
    expect(hurt.lastDamage).toEqual({ kind: "fall", amount: 34 });
    expect(applyPlayerDamage(hurt, 500, "fall").health).toBe(0);
    expect(applyPlayerDamage({ ...hurt, health: 0 }, 20, "fall").health).toBe(0);
  });

  it("gets wet in rain and dries faster under shelter", () => {
    const rain = advance(10, {
      ...fairInput,
      precipitation: "rain",
      precipitationRate: 1,
      temperatureC: 8,
      windKph: 30,
    });
    expect(rain.wetness).toBeGreaterThan(0.9);
    const drying = stepPlayerCondition(rain, { ...fairInput, sheltered: true }, 0.25);
    expect(drying.wetness).toBeLessThan(rain.wetness);
  });

  it("combines wind and wetness into apparent cold", () => {
    expect(apparentTemperature(8, 50, 1)).toBeLessThan(apparentTemperature(8, 0, 0));
    const cold = advance(20, {
      ...fairInput,
      temperatureC: -8,
      windKph: 60,
      precipitation: "snow",
      precipitationRate: 0.8,
    });
    expect(cold.coldStress).toBeGreaterThan(0.5);
  });

  it("derives stable, non-duplicated condition tags", () => {
    const tags = deriveConditionTags(
      { ...INITIAL_PLAYER_CONDITION, health: 20, wetness: 0.5, coldStress: 0.7 },
      { sheltered: true, stamina: 0.1, inventoryWeight: 100 },
    );
    expect(tags).toEqual(["sheltered", "wet", "cold", "exhausted", "critical", "encumbered"]);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("delays slow recovery after damage and fully resets on recovery", () => {
    const hurt = applyPlayerDamage(INITIAL_PLAYER_CONDITION, 20, "fall");
    const soon = stepPlayerCondition(hurt, fairInput, 0.25);
    expect(soon.health).toBe(80);
    let later = hurt;
    for (let index = 0; index < 40; index += 1) later = stepPlayerCondition(later, fairInput, 0.25);
    expect(later.health).toBeGreaterThan(80);
    expect(recoverPlayerCondition()).toEqual(INITIAL_PLAYER_CONDITION);
  });
});
