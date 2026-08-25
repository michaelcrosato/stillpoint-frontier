import type { BiomeId } from "../world/macroWorld";
import type { PrecipitationKind } from "../environment/model";

export type FootstepSurface = "grass" | "stone" | "soil" | "sand" | "interior";

export interface AmbientMixInput {
  windKph: number;
  precipitation: PrecipitationKind;
  precipitationRate: number;
  night: number;
  biomeId: BiomeId;
  settlementInfluence: number;
  animalActivity: number;
  paused: boolean;
}

export interface AmbientMix {
  wind: number;
  weather: number;
  wildlife: number;
  settlement: number;
  lowpassHz: number;
}

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function deriveAmbientMix(input: Readonly<AmbientMixInput>): AmbientMix {
  if (input.paused) {
    return { wind: 0, weather: 0, wildlife: 0, settlement: 0, lowpassHz: 1_000 };
  }
  const wind = clamp01(input.windKph / 72);
  const precipitation = input.precipitation === "none"
    ? 0
    : clamp01(input.precipitationRate);
  const forest = input.biomeId === "pine_forest" || input.biomeId === "riverlands";
  return {
    wind: 0.12 + wind * 0.62,
    weather: precipitation * 0.78,
    wildlife: clamp01(input.animalActivity) * (forest ? 0.72 : 0.42) * (1 - precipitation * 0.75),
    settlement: clamp01(input.settlementInfluence) * (0.35 + (1 - clamp01(input.night)) * 0.65),
    lowpassHz: 900 + (1 - precipitation) * 2_400 + wind * 1_000,
  };
}

export function footstepSurfaceForBiome(
  biomeId: BiomeId,
  sheltered: boolean,
): FootstepSurface {
  if (sheltered) return "interior";
  if (biomeId === "crown_highlands" || biomeId === "glass_badlands") return "stone";
  if (biomeId === "salt_coast") return "sand";
  if (biomeId === "riverlands") return "soil";
  return "grass";
}

export function footstepSpacing(sprinting: boolean, crouching: boolean) {
  if (crouching) return 1.45;
  return sprinting ? 0.82 : 1.12;
}
