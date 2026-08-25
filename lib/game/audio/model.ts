import type { BiomeId } from "../world/macroWorld";
import type { PrecipitationKind } from "../environment/model";

export type FootstepSurface = "grass" | "stone" | "soil" | "sand" | "interior";

export type AudioCue =
  | "collect"
  | "harvest"
  | "door-open"
  | "door-close"
  | "scan"
  | "inspect"
  | "discover"
  | "damage"
  | "recover"
  | "save";

export type AudioWaveform = "sine" | "square" | "sawtooth" | "triangle";

export interface AudioCueRecipe {
  startFrequency: number;
  endFrequency: number;
  duration: number;
  gain: number;
  waveform: AudioWaveform;
}

export const AUDIO_CUE_RECIPES = {
  collect: { startFrequency: 520, endFrequency: 760, duration: 0.17, gain: 0.075, waveform: "sine" },
  harvest: { startFrequency: 135, endFrequency: 92, duration: 0.17, gain: 0.075, waveform: "triangle" },
  "door-open": { startFrequency: 180, endFrequency: 230, duration: 0.17, gain: 0.075, waveform: "sine" },
  "door-close": { startFrequency: 210, endFrequency: 120, duration: 0.17, gain: 0.075, waveform: "sine" },
  scan: { startFrequency: 410, endFrequency: 920, duration: 0.17, gain: 0.075, waveform: "sine" },
  inspect: { startFrequency: 360, endFrequency: 470, duration: 0.17, gain: 0.075, waveform: "sine" },
  discover: { startFrequency: 330, endFrequency: 660, duration: 0.17, gain: 0.075, waveform: "sine" },
  damage: { startFrequency: 95, endFrequency: 58, duration: 0.17, gain: 0.13, waveform: "triangle" },
  recover: { startFrequency: 260, endFrequency: 520, duration: 0.17, gain: 0.075, waveform: "sine" },
  save: { startFrequency: 620, endFrequency: 780, duration: 0.17, gain: 0.075, waveform: "sine" },
} as const satisfies Record<AudioCue, AudioCueRecipe>;

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
