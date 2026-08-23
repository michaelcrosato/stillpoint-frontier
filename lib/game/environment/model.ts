import { WORLD_SEED } from "../config";
import { seededRandom } from "../core/random";
import {
  smoothstep,
  type BiomeId,
  type ClimateSample,
} from "../world/macroWorld";

export const MINUTES_PER_WORLD_DAY = 1_440;
export const WORLD_START_MINUTES = 7 * 60 + 30;
export const GAME_MINUTES_PER_REAL_SECOND = 1;
export const WEATHER_EPOCH_MINUTES = 180;
export const WEATHER_TRANSITION_MINUTES = 36;

export type DayPhase = "dawn" | "day" | "dusk" | "night";
export type WeatherId =
  | "fair"
  | "overcast"
  | "fog"
  | "rain"
  | "storm"
  | "snow"
  | "dry_wind"
  | "dust";
export type PrecipitationKind = "none" | "rain" | "snow" | "sleet";

export interface WeatherDefinition {
  id: WeatherId;
  label: string;
  weight: number;
  cloudCover: number;
  fogDensity: number;
  precipitation: PrecipitationKind;
  precipitationRate: number;
  windKph: number;
  temperatureOffset: number;
  dust: number;
}

export interface DaylightSample {
  totalMinutes: number;
  minuteOfDay: number;
  day: number;
  hour: number;
  minute: number;
  phase: DayPhase;
  sunElevation: number;
  sunAzimuth: number;
  daylight: number;
  goldenHour: number;
  night: number;
}

export interface WeatherSample {
  weatherId: WeatherId;
  weatherLabel: string;
  cloudCover: number;
  fogDensity: number;
  precipitation: PrecipitationKind;
  precipitationRate: number;
  windKph: number;
  windDirection: number;
  temperatureC: number;
  dust: number;
  visibilityMeters: number;
  transition: number;
  epoch: number;
}

export interface EnvironmentSample extends DaylightSample, WeatherSample {
  biomeId: BiomeId;
  lightScale: number;
  exposure: number;
}

function weather(
  definition: WeatherDefinition,
): WeatherDefinition {
  return definition;
}

export const BIOME_WEATHER_PROFILES: Record<
  BiomeId,
  readonly WeatherDefinition[]
> = {
  riverlands: [
    weather({ id: "fair", label: "Riverbreak fair", weight: 28, cloudCover: 0.14, fogDensity: 0.0032, precipitation: "none", precipitationRate: 0, windKph: 10, temperatureOffset: 1, dust: 0 }),
    weather({ id: "overcast", label: "Low river cloud", weight: 22, cloudCover: 0.72, fogDensity: 0.0041, precipitation: "none", precipitationRate: 0, windKph: 14, temperatureOffset: -1, dust: 0 }),
    weather({ id: "fog", label: "Greywater mist", weight: 16, cloudCover: 0.62, fogDensity: 0.0095, precipitation: "none", precipitationRate: 0, windKph: 4, temperatureOffset: -2, dust: 0 }),
    weather({ id: "rain", label: "Basin rain", weight: 22, cloudCover: 0.88, fogDensity: 0.0062, precipitation: "rain", precipitationRate: 0.68, windKph: 24, temperatureOffset: -3, dust: 0 }),
    weather({ id: "storm", label: "Greywater thunderhead", weight: 12, cloudCover: 1, fogDensity: 0.0084, precipitation: "rain", precipitationRate: 1, windKph: 48, temperatureOffset: -4, dust: 0 }),
  ],
  pine_forest: [
    weather({ id: "fair", label: "Canopy clear", weight: 24, cloudCover: 0.2, fogDensity: 0.0038, precipitation: "none", precipitationRate: 0, windKph: 8, temperatureOffset: 0, dust: 0 }),
    weather({ id: "overcast", label: "Sable overcast", weight: 24, cloudCover: 0.76, fogDensity: 0.0048, precipitation: "none", precipitationRate: 0, windKph: 12, temperatureOffset: -2, dust: 0 }),
    weather({ id: "fog", label: "Pine-floor fog", weight: 19, cloudCover: 0.68, fogDensity: 0.0105, precipitation: "none", precipitationRate: 0, windKph: 3, temperatureOffset: -3, dust: 0 }),
    weather({ id: "rain", label: "Canopy drizzle", weight: 26, cloudCover: 0.9, fogDensity: 0.0068, precipitation: "rain", precipitationRate: 0.56, windKph: 18, temperatureOffset: -3, dust: 0 }),
    weather({ id: "storm", label: "Timber rain", weight: 7, cloudCover: 1, fogDensity: 0.0082, precipitation: "rain", precipitationRate: 0.88, windKph: 38, temperatureOffset: -5, dust: 0 }),
  ],
  crown_highlands: [
    weather({ id: "fair", label: "Cold highland clear", weight: 20, cloudCover: 0.12, fogDensity: 0.003, precipitation: "none", precipitationRate: 0, windKph: 22, temperatureOffset: -6, dust: 0 }),
    weather({ id: "overcast", label: "Stone-grey ceiling", weight: 20, cloudCover: 0.82, fogDensity: 0.0046, precipitation: "none", precipitationRate: 0, windKph: 28, temperatureOffset: -8, dust: 0 }),
    weather({ id: "snow", label: "Crown snow", weight: 26, cloudCover: 0.9, fogDensity: 0.0074, precipitation: "snow", precipitationRate: 0.72, windKph: 25, temperatureOffset: -12, dust: 0 }),
    weather({ id: "storm", label: "Highland sleet", weight: 16, cloudCover: 1, fogDensity: 0.0088, precipitation: "sleet", precipitationRate: 0.9, windKph: 52, temperatureOffset: -10, dust: 0 }),
    weather({ id: "dry_wind", label: "Crown gale", weight: 18, cloudCover: 0.34, fogDensity: 0.0038, precipitation: "none", precipitationRate: 0, windKph: 64, temperatureOffset: -7, dust: 0 }),
  ],
  warden_steppe: [
    weather({ id: "fair", label: "Open steppe", weight: 40, cloudCover: 0.1, fogDensity: 0.0029, precipitation: "none", precipitationRate: 0, windKph: 18, temperatureOffset: 3, dust: 0 }),
    weather({ id: "overcast", label: "Prairie overcast", weight: 16, cloudCover: 0.7, fogDensity: 0.0037, precipitation: "none", precipitationRate: 0, windKph: 22, temperatureOffset: -1, dust: 0 }),
    weather({ id: "dry_wind", label: "Warden crosswind", weight: 25, cloudCover: 0.2, fogDensity: 0.0034, precipitation: "none", precipitationRate: 0, windKph: 48, temperatureOffset: 2, dust: 0.16 }),
    weather({ id: "dust", label: "Loam blow", weight: 15, cloudCover: 0.45, fogDensity: 0.0068, precipitation: "none", precipitationRate: 0, windKph: 58, temperatureOffset: 4, dust: 0.72 }),
    weather({ id: "rain", label: "Rare steppe rain", weight: 4, cloudCover: 0.82, fogDensity: 0.0052, precipitation: "rain", precipitationRate: 0.42, windKph: 28, temperatureOffset: -2, dust: 0 }),
  ],
  glass_badlands: [
    weather({ id: "fair", label: "Glass-clear heat", weight: 42, cloudCover: 0.05, fogDensity: 0.0028, precipitation: "none", precipitationRate: 0, windKph: 12, temperatureOffset: 8, dust: 0.06 }),
    weather({ id: "dry_wind", label: "Kiln wind", weight: 28, cloudCover: 0.13, fogDensity: 0.0032, precipitation: "none", precipitationRate: 0, windKph: 46, temperatureOffset: 7, dust: 0.24 }),
    weather({ id: "dust", label: "Glass dust storm", weight: 26, cloudCover: 0.62, fogDensity: 0.0086, precipitation: "none", precipitationRate: 0, windKph: 66, temperatureOffset: 5, dust: 1 }),
    weather({ id: "overcast", label: "Ash-white ceiling", weight: 4, cloudCover: 0.65, fogDensity: 0.004, precipitation: "none", precipitationRate: 0, windKph: 20, temperatureOffset: 2, dust: 0.08 }),
  ],
  salt_coast: [
    weather({ id: "fair", label: "Salt-bright fair", weight: 24, cloudCover: 0.18, fogDensity: 0.0034, precipitation: "none", precipitationRate: 0, windKph: 18, temperatureOffset: 1, dust: 0 }),
    weather({ id: "overcast", label: "Marine layer", weight: 20, cloudCover: 0.82, fogDensity: 0.0052, precipitation: "none", precipitationRate: 0, windKph: 17, temperatureOffset: -2, dust: 0 }),
    weather({ id: "fog", label: "Coastal fog", weight: 22, cloudCover: 0.76, fogDensity: 0.011, precipitation: "none", precipitationRate: 0, windKph: 7, temperatureOffset: -3, dust: 0 }),
    weather({ id: "rain", label: "Salt rain", weight: 22, cloudCover: 0.92, fogDensity: 0.0069, precipitation: "rain", precipitationRate: 0.64, windKph: 30, temperatureOffset: -3, dust: 0 }),
    weather({ id: "storm", label: "Coastal squall", weight: 12, cloudCover: 1, fogDensity: 0.0092, precipitation: "rain", precipitationRate: 1, windKph: 70, temperatureOffset: -5, dust: 0 }),
  ],
  grey_meadow: [
    weather({ id: "fair", label: "Meadow fair", weight: 30, cloudCover: 0.14, fogDensity: 0.0031, precipitation: "none", precipitationRate: 0, windKph: 12, temperatureOffset: 1, dust: 0 }),
    weather({ id: "overcast", label: "March overcast", weight: 23, cloudCover: 0.74, fogDensity: 0.0042, precipitation: "none", precipitationRate: 0, windKph: 17, temperatureOffset: -2, dust: 0 }),
    weather({ id: "fog", label: "Low meadow mist", weight: 14, cloudCover: 0.66, fogDensity: 0.009, precipitation: "none", precipitationRate: 0, windKph: 5, temperatureOffset: -2, dust: 0 }),
    weather({ id: "rain", label: "March rain", weight: 23, cloudCover: 0.9, fogDensity: 0.0061, precipitation: "rain", precipitationRate: 0.62, windKph: 24, temperatureOffset: -3, dust: 0 }),
    weather({ id: "storm", label: "Basin thunderhead", weight: 10, cloudCover: 1, fogDensity: 0.008, precipitation: "rain", precipitationRate: 0.96, windKph: 50, temperatureOffset: -5, dust: 0 }),
  ],
};

export function sanitizeWorldMinutes(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : WORLD_START_MINUTES;
}

function phaseForMinute(minuteOfDay: number): DayPhase {
  if (minuteOfDay >= 300 && minuteOfDay < 420) return "dawn";
  if (minuteOfDay >= 420 && minuteOfDay < 1_020) return "day";
  if (minuteOfDay >= 1_020 && minuteOfDay < 1_140) return "dusk";
  return "night";
}

export function sampleDaylight(totalWorldMinutes: number): DaylightSample {
  const totalMinutes = sanitizeWorldMinutes(totalWorldMinutes);
  const wholeMinutes = Math.floor(totalMinutes);
  const minuteOfDay = wholeMinutes % MINUTES_PER_WORLD_DAY;
  const dayProgress = minuteOfDay / MINUTES_PER_WORLD_DAY;
  const sunElevation = Math.sin((dayProgress - 0.25) * Math.PI * 2);
  const daylight = smoothstep(-0.12, 0.25, sunElevation);
  const horizonProximity = 1 - Math.min(1, Math.abs(sunElevation - 0.08) / 0.34);

  return {
    totalMinutes,
    minuteOfDay,
    day: Math.floor(totalMinutes / MINUTES_PER_WORLD_DAY) + 1,
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
    phase: phaseForMinute(minuteOfDay),
    sunElevation,
    sunAzimuth: (totalMinutes / MINUTES_PER_WORLD_DAY) * Math.PI * 2 + 0.38,
    daylight,
    goldenHour: horizonProximity * smoothstep(-0.1, 0.12, sunElevation),
    night: 1 - daylight,
  };
}

function selectWeather(seed: string, biomeId: BiomeId, epoch: number) {
  const profile = BIOME_WEATHER_PROFILES[biomeId];
  const random = seededRandom(`${seed}:weather:${biomeId}:${epoch}`);
  const totalWeight = profile.reduce((sum, candidate) => sum + candidate.weight, 0);
  const roll = random() * totalWeight;
  let cumulative = 0;
  let selected = profile[profile.length - 1] as WeatherDefinition;
  for (const candidate of profile) {
    cumulative += candidate.weight;
    if (roll <= cumulative) {
      selected = candidate;
      break;
    }
  }
  return { definition: selected, direction: random() * 360 };
}

function mix(left: number, right: number, amount: number) {
  return left + (right - left) * amount;
}

function mixDirection(left: number, right: number, amount: number) {
  const delta = ((right - left + 540) % 360) - 180;
  return (left + delta * amount + 360) % 360;
}

export function sampleBiomeWeather(
  biomeId: BiomeId,
  climate: Pick<ClimateSample, "temperature">,
  totalWorldMinutes: number,
  seed = WORLD_SEED,
): WeatherSample {
  const totalMinutes = sanitizeWorldMinutes(totalWorldMinutes);
  const epoch = Math.floor(totalMinutes / WEATHER_EPOCH_MINUTES);
  const epochProgress =
    (totalMinutes - epoch * WEATHER_EPOCH_MINUTES) / WEATHER_EPOCH_MINUTES;
  const transitionStart =
    1 - WEATHER_TRANSITION_MINUTES / WEATHER_EPOCH_MINUTES;
  const transition = smoothstep(transitionStart, 1, epochProgress);
  const current = selectWeather(seed, biomeId, epoch);
  const next = selectWeather(seed, biomeId, epoch + 1);
  const displayed = transition < 0.5 ? current.definition : next.definition;
  const precipitation =
    transition < 0.5
      ? current.definition.precipitation
      : next.definition.precipitation;
  const fogDensity = mix(
    current.definition.fogDensity,
    next.definition.fogDensity,
    transition,
  );
  const temperatureBase = -8 + climate.temperature * 36;

  return {
    weatherId: displayed.id,
    weatherLabel: displayed.label,
    cloudCover: mix(current.definition.cloudCover, next.definition.cloudCover, transition),
    fogDensity,
    precipitation,
    precipitationRate: mix(
      current.definition.precipitationRate,
      next.definition.precipitationRate,
      transition,
    ),
    windKph: mix(current.definition.windKph, next.definition.windKph, transition),
    windDirection: mixDirection(current.direction, next.direction, transition),
    temperatureC:
      temperatureBase +
      mix(current.definition.temperatureOffset, next.definition.temperatureOffset, transition),
    dust: mix(current.definition.dust, next.definition.dust, transition),
    visibilityMeters: Math.round(Math.min(12_000, Math.max(120, 1.978 / fogDensity))),
    transition,
    epoch,
  };
}

export function sampleForcedBiomeWeather(
  biomeId: BiomeId,
  climate: Pick<ClimateSample, "temperature">,
  totalWorldMinutes: number,
  weatherId: WeatherId,
  seed = WORLD_SEED,
): WeatherSample | null {
  const definition = BIOME_WEATHER_PROFILES[biomeId].find(
    (candidate) => candidate.id === weatherId,
  );
  if (!definition) return null;
  const totalMinutes = sanitizeWorldMinutes(totalWorldMinutes);
  const epoch = Math.floor(totalMinutes / WEATHER_EPOCH_MINUTES);
  const random = seededRandom(`${seed}:developer-weather:${biomeId}:${weatherId}`);
  const fogDensity = definition.fogDensity;
  return {
    weatherId: definition.id,
    weatherLabel: definition.label,
    cloudCover: definition.cloudCover,
    fogDensity,
    precipitation: definition.precipitation,
    precipitationRate: definition.precipitationRate,
    windKph: definition.windKph,
    windDirection: random() * 360,
    temperatureC:
      -8 + climate.temperature * 36 + definition.temperatureOffset,
    dust: definition.dust,
    visibilityMeters: Math.round(
      Math.min(12_000, Math.max(120, 1.978 / fogDensity)),
    ),
    transition: 1,
    epoch,
  };
}

export function sampleEnvironment(
  totalWorldMinutes: number,
  climate: ClimateSample,
  seed = WORLD_SEED,
  weatherOverride: WeatherId | null = null,
): EnvironmentSample {
  const daylight = sampleDaylight(totalWorldMinutes);
  const weatherSample =
    (weatherOverride
      ? sampleForcedBiomeWeather(
          climate.biome.id,
          climate,
          daylight.totalMinutes,
          weatherOverride,
          seed,
        )
      : null) ??
    sampleBiomeWeather(
      climate.biome.id,
      climate,
      daylight.totalMinutes,
      seed,
    );
  return {
    ...daylight,
    ...weatherSample,
    biomeId: climate.biome.id,
    lightScale:
      (0.16 + daylight.daylight * 0.84) *
      (1 - weatherSample.cloudCover * 0.52),
    exposure:
      0.61 + daylight.daylight * 0.54 - weatherSample.cloudCover * 0.08,
  };
}
