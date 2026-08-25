import { describe, expect, it } from "vitest";
import { INITIAL_PLAYER_CONDITION } from "../../lib/game/gameplay/playerCondition";
import {
  REST_OPTIONS,
  resolveRest,
  type RestOptionId,
  type RestSiteDefinition,
} from "../../lib/game/gameplay/resting";

const safeSite: RestSiteDefinition = {
  id: "rest:field-unit:bunk",
  label: "Field Unit bunk",
  safe: true,
  sheltered: true,
  warmth: 1,
};

const hurt = {
  ...INITIAL_PLAYER_CONDITION,
  health: 50,
  wetness: 0.9,
  coldStress: 0.8,
  damageRecoveryDelay: 7,
  lastDamage: { kind: "exposure" as const, amount: 4 },
};

describe("resting and camping recovery", () => {
  it("publishes unique rest choices and advances their exact durations", () => {
    expect(new Set(REST_OPTIONS.map((option) => option.id)).size).toBe(REST_OPTIONS.length);
    expect(resolveRest(hurt, safeSite, "wait_1h", 300).minutes).toBe(60);
    expect(resolveRest(hurt, safeSite, "rest_4h", 300).minutes).toBe(240);
    expect(resolveRest(hurt, safeSite, "sleep_until_7", 6 * 60).minutes).toBe(60);
    expect(resolveRest(hurt, safeSite, "sleep_until_7", 8 * 60).minutes).toBe(23 * 60);
    expect(resolveRest(hurt, safeSite, "sleep_until_7", 7 * 60).minutes).toBe(24 * 60);
  });

  it("recovers bounded condition state and clears the damage delay", () => {
    const outcome = resolveRest(hurt, safeSite, "rest_4h", 900);
    expect(outcome.accepted).toBe(true);
    expect(outcome.condition.health).toBeGreaterThan(hurt.health);
    expect(outcome.condition.health).toBeLessThanOrEqual(100);
    expect(outcome.condition.wetness).toBeGreaterThanOrEqual(0);
    expect(outcome.condition.wetness).toBeLessThan(hurt.wetness);
    expect(outcome.condition.coldStress).toBeGreaterThanOrEqual(0);
    expect(outcome.condition.coldStress).toBeLessThan(hurt.coldStress);
    expect(outcome.condition.damageRecoveryDelay).toBe(0);
    expect(outcome.condition.lastDamage).toEqual(hurt.lastDamage);
  });

  it("makes safe sheltered warmth more effective than exposed field rest", () => {
    const exposed: RestSiteDefinition = {
      id: "rest:field",
      label: "Exposed bedroll",
      safe: false,
      sheltered: false,
      warmth: 0,
    };
    const safe = resolveRest(hurt, safeSite, "rest_4h", 900).condition;
    const field = resolveRest(hurt, exposed, "rest_4h", 900).condition;
    expect(safe.health).toBeGreaterThan(field.health);
    expect(safe.wetness).toBeLessThan(field.wetness);
    expect(safe.coldStress).toBeLessThan(field.coldStress);
  });

  it("rejects incapacitated players and unknown options without mutation", () => {
    const dead = { ...hurt, health: 0 };
    expect(resolveRest(dead, safeSite, "wait_1h", 100)).toEqual({
      accepted: false,
      minutes: 0,
      condition: dead,
    });
    const invalid = resolveRest(
      hurt,
      safeSite,
      "invented" as RestOptionId,
      100,
    );
    expect(invalid.accepted).toBe(false);
    expect(invalid.condition).toEqual(hurt);
    expect(invalid.condition).not.toBe(hurt);
  });
});
