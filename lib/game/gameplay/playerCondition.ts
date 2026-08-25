import type { PrecipitationKind } from "../environment/model";

export const MAX_HEALTH = 100;
export const FALL_DAMAGE_THRESHOLD = 11;
export const ENCUMBERED_WEIGHT = 72;

export type DamageKind = "fall" | "exposure";
export type PlayerConditionTag =
  | "sheltered"
  | "wet"
  | "cold"
  | "exhausted"
  | "injured"
  | "critical"
  | "encumbered";

export interface DamageNotice {
  kind: DamageKind;
  amount: number;
}

export interface PlayerConditionState {
  health: number;
  wetness: number;
  coldStress: number;
  damageRecoveryDelay: number;
  lastDamage: DamageNotice | null;
}

export interface ConditionStepInput {
  sheltered: boolean;
  precipitation: PrecipitationKind;
  precipitationRate: number;
  temperatureC: number;
  windKph: number;
  stamina: number;
  inventoryWeight: number;
}

export const INITIAL_PLAYER_CONDITION: PlayerConditionState = Object.freeze({
  health: MAX_HEALTH,
  wetness: 0,
  coldStress: 0,
  damageRecoveryDelay: 0,
  lastDamage: null,
});

function finiteClamp(value: number, fallback: number, minimum: number, maximum: number) {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

export function fallDamageForImpact(speed: number) {
  const safeSpeed = finiteClamp(speed, 0, 0, 200);
  return finiteClamp((safeSpeed - FALL_DAMAGE_THRESHOLD) * 4.8, 0, 0, MAX_HEALTH);
}

export function applyPlayerDamage(
  state: Readonly<PlayerConditionState>,
  amount: number,
  kind: DamageKind,
): PlayerConditionState {
  const safeAmount = finiteClamp(amount, 0, 0, MAX_HEALTH);
  if (safeAmount <= 0 || state.health <= 0) return { ...state };
  return {
    ...state,
    health: Math.max(0, state.health - safeAmount),
    damageRecoveryDelay: 8,
    lastDamage: { kind, amount: safeAmount },
  };
}

export function recoverPlayerCondition(): PlayerConditionState {
  return { ...INITIAL_PLAYER_CONDITION };
}

export function apparentTemperature(
  temperatureC: number,
  windKph: number,
  wetness: number,
) {
  const safeTemperature = finiteClamp(temperatureC, 12, -80, 70);
  const safeWind = finiteClamp(windKph, 0, 0, 180);
  const safeWetness = finiteClamp(wetness, 0, 0, 1);
  return safeTemperature - safeWind * 0.035 - safeWetness * 7.5;
}

export function stepPlayerCondition(
  state: Readonly<PlayerConditionState>,
  input: Readonly<ConditionStepInput>,
  deltaSeconds: number,
): PlayerConditionState {
  const delta = finiteClamp(deltaSeconds, 0, 0, 0.25);
  if (delta === 0) return { ...state };
  const precipitationRate = finiteClamp(input.precipitationRate, 0, 0, 1);
  const activelyWet = input.precipitation !== "none" && !input.sheltered;
  const wetnessRate = activelyWet
    ? 0.055 + precipitationRate * 0.12
    : input.sheltered
      ? -0.052
      : -0.018;
  const wetness = finiteClamp(state.wetness + wetnessRate * delta, 0, 0, 1);
  const feelsLike = apparentTemperature(input.temperatureC, input.windKph, wetness);
  const coldTarget = feelsLike < 4
    ? finiteClamp((4 - feelsLike) / 18 + wetness * 0.36, 0, 0, 1)
    : 0;
  const coldRate = coldTarget > state.coldStress ? 0.035 : 0.045;
  const coldStress = finiteClamp(
    state.coldStress + Math.sign(coldTarget - state.coldStress) * Math.min(
      Math.abs(coldTarget - state.coldStress),
      coldRate * delta,
    ),
    0,
    0,
    1,
  );
  const damageRecoveryDelay = Math.max(0, state.damageRecoveryDelay - delta);
  const canRecover =
    state.health > 0 && damageRecoveryDelay === 0 && coldStress < 0.72;
  const health = canRecover
    ? Math.min(MAX_HEALTH, state.health + 0.7 * delta)
    : finiteClamp(state.health, MAX_HEALTH, 0, MAX_HEALTH);
  return {
    health,
    wetness,
    coldStress,
    damageRecoveryDelay,
    lastDamage: state.lastDamage,
  };
}

export function deriveConditionTags(
  state: Readonly<PlayerConditionState>,
  input: Pick<ConditionStepInput, "sheltered" | "stamina" | "inventoryWeight">,
): PlayerConditionTag[] {
  const tags: PlayerConditionTag[] = [];
  if (input.sheltered) tags.push("sheltered");
  if (state.wetness >= 0.25) tags.push("wet");
  if (state.coldStress >= 0.4) tags.push("cold");
  if (input.stamina < 0.15) tags.push("exhausted");
  if (state.health < 25 && state.health > 0) tags.push("critical");
  else if (state.health < 60 && state.health > 0) tags.push("injured");
  if (input.inventoryWeight >= ENCUMBERED_WEIGHT) tags.push("encumbered");
  return tags;
}
