import {
  BIOME_WEATHER_PROFILES,
  GAME_MINUTES_PER_REAL_SECOND,
  MINUTES_PER_WORLD_DAY,
  sanitizeWorldMinutes,
  type WeatherId,
} from "../environment/model";
import type { BiomeId } from "../world/macroWorld";

export interface DeveloperEnvironmentState {
  enabled: boolean;
  clockPaused: boolean;
  worldMinutes: number;
  weatherOverride: WeatherId | null;
}

export interface DeveloperWeatherOption {
  id: WeatherId;
  label: string;
}

export function createDeveloperEnvironmentState(
  canonicalWorldMinutes: number,
): DeveloperEnvironmentState {
  return {
    enabled: false,
    clockPaused: false,
    worldMinutes: sanitizeWorldMinutes(canonicalWorldMinutes),
    weatherOverride: null,
  };
}

export function setDeveloperMode(
  state: Readonly<DeveloperEnvironmentState>,
  enabled: boolean,
  canonicalWorldMinutes: number,
): DeveloperEnvironmentState {
  if (!enabled) return createDeveloperEnvironmentState(canonicalWorldMinutes);
  if (state.enabled) return { ...state };
  return {
    enabled: true,
    clockPaused: true,
    worldMinutes: sanitizeWorldMinutes(canonicalWorldMinutes),
    weatherOverride: null,
  };
}

export function resetDeveloperEnvironment(
  state: Readonly<DeveloperEnvironmentState>,
  canonicalWorldMinutes: number,
): DeveloperEnvironmentState {
  if (!state.enabled) return createDeveloperEnvironmentState(canonicalWorldMinutes);
  return {
    enabled: true,
    clockPaused: true,
    worldMinutes: sanitizeWorldMinutes(canonicalWorldMinutes),
    weatherOverride: null,
  };
}

export function setDeveloperMinuteOfDay(
  state: Readonly<DeveloperEnvironmentState>,
  minuteOfDay: number,
): DeveloperEnvironmentState {
  if (!state.enabled || !Number.isFinite(minuteOfDay)) return { ...state };
  const normalized =
    ((Math.floor(minuteOfDay) % MINUTES_PER_WORLD_DAY) + MINUTES_PER_WORLD_DAY) %
    MINUTES_PER_WORLD_DAY;
  const dayStart =
    Math.floor(state.worldMinutes / MINUTES_PER_WORLD_DAY) * MINUTES_PER_WORLD_DAY;
  return { ...state, worldMinutes: dayStart + normalized };
}

export function advanceDeveloperMinutes(
  state: Readonly<DeveloperEnvironmentState>,
  minutes: number,
): DeveloperEnvironmentState {
  if (!state.enabled || !Number.isFinite(minutes)) return { ...state };
  return {
    ...state,
    worldMinutes: sanitizeWorldMinutes(state.worldMinutes + minutes),
  };
}

export function tickDeveloperEnvironment(
  state: Readonly<DeveloperEnvironmentState>,
  deltaSeconds: number,
  running: boolean,
): DeveloperEnvironmentState {
  if (
    !state.enabled ||
    state.clockPaused ||
    !running ||
    !Number.isFinite(deltaSeconds) ||
    deltaSeconds <= 0
  ) {
    return { ...state };
  }
  return advanceDeveloperMinutes(
    state,
    deltaSeconds * GAME_MINUTES_PER_REAL_SECOND,
  );
}

export function developerWeatherOptions(
  biomeId: BiomeId,
): DeveloperWeatherOption[] {
  return BIOME_WEATHER_PROFILES[biomeId].map(({ id, label }) => ({ id, label }));
}

export function setDeveloperWeather(
  state: Readonly<DeveloperEnvironmentState>,
  weatherId: WeatherId | null,
  biomeId: BiomeId,
): DeveloperEnvironmentState {
  if (!state.enabled) return { ...state };
  if (weatherId === null) return { ...state, weatherOverride: null };
  const supported = BIOME_WEATHER_PROFILES[biomeId].some(
    (candidate) => candidate.id === weatherId,
  );
  return { ...state, weatherOverride: supported ? weatherId : null };
}

export function ensureDeveloperWeatherIsValid(
  state: Readonly<DeveloperEnvironmentState>,
  biomeId: BiomeId,
): DeveloperEnvironmentState {
  if (!state.weatherOverride) return { ...state };
  return setDeveloperWeather(state, state.weatherOverride, biomeId);
}
