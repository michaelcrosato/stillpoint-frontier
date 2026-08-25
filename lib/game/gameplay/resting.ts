import {
  MAX_HEALTH,
  type PlayerConditionState,
} from "./playerCondition";

export interface RestSiteDefinition {
  id: string;
  label: string;
  safe: boolean;
  sheltered: boolean;
  warmth: number;
}

export type RestOptionId = "wait_1h" | "rest_4h" | "sleep_until_7";

export const REST_OPTIONS = [
  { id: "wait_1h", label: "Wait one hour", description: "Advance the clock with light recovery." },
  { id: "rest_4h", label: "Rest four hours", description: "Recover health and reduce exposure." },
  { id: "sleep_until_7", label: "Sleep until 07:00", description: "Advance to the next morning watch." },
] as const;

function minutesForOption(optionId: RestOptionId, totalMinutes: number) {
  if (optionId === "wait_1h") return 60;
  if (optionId === "rest_4h") return 240;
  const minuteOfDay = ((totalMinutes % 1_440) + 1_440) % 1_440;
  const target = 7 * 60;
  const until = target - minuteOfDay;
  return until > 0 ? until : until + 1_440;
}

export interface RestOutcome {
  accepted: boolean;
  minutes: number;
  condition: PlayerConditionState;
}

export function resolveRest(
  condition: Readonly<PlayerConditionState>,
  site: Readonly<RestSiteDefinition>,
  optionId: RestOptionId,
  totalMinutes: number,
): RestOutcome {
  if (condition.health <= 0 || !REST_OPTIONS.some((option) => option.id === optionId)) {
    return { accepted: false, minutes: 0, condition: { ...condition } };
  }
  const minutes = minutesForOption(optionId, Number.isFinite(totalMinutes) ? totalMinutes : 0);
  const hours = minutes / 60;
  const safety = site.safe ? 1 : 0.62;
  const shelter = site.sheltered ? 1 : 0.46;
  const warmth = Math.min(1, Math.max(0, site.warmth));
  const healthGain = hours * 5.5 * safety * (0.72 + warmth * 0.28);
  const wetnessLoss = hours * (0.11 + shelter * 0.16 + warmth * 0.22);
  const coldLoss = hours * (0.09 + shelter * 0.12 + warmth * 0.3);
  return {
    accepted: true,
    minutes,
    condition: {
      ...condition,
      health: Math.min(MAX_HEALTH, condition.health + healthGain),
      wetness: Math.max(0, condition.wetness - wetnessLoss),
      coldStress: Math.max(0, condition.coldStress - coldLoss),
      damageRecoveryDelay: 0,
    },
  };
}
