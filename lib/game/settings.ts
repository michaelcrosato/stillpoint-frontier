import { isQualityLevel, type HorizonMode, type QualityLevel } from "./config";

export const GAME_ACTIONS = [
  "moveForward",
  "moveBackward",
  "moveLeft",
  "moveRight",
  "sprint",
  "crouch",
  "jump",
  "interact",
  "harvest",
  "flashlight",
  "map",
  "inventory",
  "scanner",
  "fieldGuide",
  "quality",
  "recover",
] as const;

export type GameAction = (typeof GAME_ACTIONS)[number];
export type KeyBindings = Record<GameAction, string>;

export interface GameSettings {
  fov: number;
  lookSensitivity: number;
  invertY: boolean;
  masterVolume: number;
  ambientVolume: number;
  effectsVolume: number;
  quality: QualityLevel;
  horizonMode: HorizonMode;
  keyBindings: KeyBindings;
}

export const DEFAULT_KEY_BINDINGS: KeyBindings = Object.freeze({
  moveForward: "KeyW",
  moveBackward: "KeyS",
  moveLeft: "KeyA",
  moveRight: "KeyD",
  sprint: "ShiftLeft",
  crouch: "ControlLeft",
  jump: "Space",
  interact: "KeyE",
  harvest: "KeyF",
  flashlight: "KeyL",
  map: "KeyM",
  inventory: "KeyI",
  scanner: "KeyG",
  fieldGuide: "KeyJ",
  quality: "KeyQ",
  recover: "KeyR",
});

export const DEFAULT_GAME_SETTINGS: GameSettings = Object.freeze({
  fov: 67,
  lookSensitivity: 1,
  invertY: false,
  masterVolume: 0.72,
  ambientVolume: 0.66,
  effectsVolume: 0.8,
  quality: "cinematic",
  horizonMode: "standard",
  keyBindings: DEFAULT_KEY_BINDINGS,
});

const ACTION_LABELS: Record<GameAction, string> = {
  moveForward: "Move forward",
  moveBackward: "Move backward",
  moveLeft: "Move left",
  moveRight: "Move right",
  sprint: "Sprint",
  crouch: "Crouch",
  jump: "Jump",
  interact: "Use / inspect",
  harvest: "Harvest",
  flashlight: "Phone light",
  map: "Map",
  inventory: "Inventory",
  scanner: "Field scanner",
  fieldGuide: "Field operations",
  quality: "Quality profile",
  recover: "Recover",
};

const VALID_KEY_CODE = /^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Arrow(?:Up|Down|Left|Right)|Space|Tab|Enter|Shift(?:Left|Right)|Control(?:Left|Right)|Alt(?:Left|Right))$/;

function finiteClamp(value: unknown, fallback: number, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

export function isBindableCode(value: unknown): value is string {
  return typeof value === "string" && VALID_KEY_CODE.test(value);
}

export function normalizeKeyBindings(value: unknown): KeyBindings {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<Record<GameAction, unknown>>
    : {};
  let result = { ...DEFAULT_KEY_BINDINGS };
  for (const action of GAME_ACTIONS) {
    const candidate = source[action];
    if (!isBindableCode(candidate)) continue;
    result = rebindAction(result, action, candidate) ?? result;
  }
  return result;
}

export function normalizeGameSettings(
  value: unknown,
  horizonFallback: HorizonMode = DEFAULT_GAME_SETTINGS.horizonMode,
): GameSettings {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<Record<keyof GameSettings, unknown>>
    : {};
  return {
    fov: finiteClamp(source.fov, DEFAULT_GAME_SETTINGS.fov, 55, 95),
    lookSensitivity: finiteClamp(
      source.lookSensitivity,
      DEFAULT_GAME_SETTINGS.lookSensitivity,
      0.25,
      2.5,
    ),
    invertY: typeof source.invertY === "boolean"
      ? source.invertY
      : DEFAULT_GAME_SETTINGS.invertY,
    masterVolume: finiteClamp(source.masterVolume, DEFAULT_GAME_SETTINGS.masterVolume, 0, 1),
    ambientVolume: finiteClamp(source.ambientVolume, DEFAULT_GAME_SETTINGS.ambientVolume, 0, 1),
    effectsVolume: finiteClamp(source.effectsVolume, DEFAULT_GAME_SETTINGS.effectsVolume, 0, 1),
    quality: isQualityLevel(source.quality) ? source.quality : DEFAULT_GAME_SETTINGS.quality,
    horizonMode:
      source.horizonMode === "standard" ||
      source.horizonMode === "extended" ||
      source.horizonMode === "unlimited"
        ? source.horizonMode
        : horizonFallback,
    keyBindings: normalizeKeyBindings(source.keyBindings),
  };
}

export function rebindAction(
  bindings: Readonly<KeyBindings>,
  action: GameAction,
  code: string,
): KeyBindings | null {
  if (!isBindableCode(code)) return null;
  const next = { ...bindings };
  const previous = next[action];
  const conflicting = GAME_ACTIONS.find(
    (candidate) => candidate !== action && next[candidate] === code,
  );
  next[action] = code;
  if (conflicting) next[conflicting] = previous;
  return next;
}

export function actionLabel(action: GameAction) {
  return ACTION_LABELS[action];
}

export function keyLabel(code: string) {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code
    .replace("Control", "CTRL ")
    .replace("Shift", "SHIFT ")
    .replace("Arrow", "")
    .replace("Left", "L")
    .replace("Right", "R")
    .toUpperCase();
}
