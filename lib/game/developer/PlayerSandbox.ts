export const DEVELOPER_SPEED_MODES = ["normal", "fast", "veryFast"] as const;

export type DeveloperSpeedMode = (typeof DEVELOPER_SPEED_MODES)[number];

export interface DeveloperPlayerSandboxState {
  invincible: boolean;
  speedMode: DeveloperSpeedMode;
  fly: boolean;
}

export const DEFAULT_DEVELOPER_PLAYER_SANDBOX: Readonly<DeveloperPlayerSandboxState> =
  Object.freeze({
    invincible: false,
    speedMode: "normal",
    fly: false,
  });

export const DEVELOPER_SPEED_PROFILES: Readonly<
  Record<DeveloperSpeedMode, { label: string; multiplier: number }>
> = Object.freeze({
  normal: { label: "NORMAL", multiplier: 1 },
  fast: { label: "FAST", multiplier: 3 },
  veryFast: { label: "VERY FAST", multiplier: 8 },
});

export const MAX_DEVELOPER_FLIGHT_ALTITUDE = 1_500;

export function isDeveloperSpeedMode(value: unknown): value is DeveloperSpeedMode {
  return DEVELOPER_SPEED_MODES.includes(value as DeveloperSpeedMode);
}

export function developerSpeedMultiplier(mode: DeveloperSpeedMode) {
  return DEVELOPER_SPEED_PROFILES[mode].multiplier;
}

export function resetDeveloperPlayerSandbox(
  target: DeveloperPlayerSandboxState,
) {
  Object.assign(target, DEFAULT_DEVELOPER_PLAYER_SANDBOX);
  return target;
}

export interface DeveloperFlightInput {
  inputX: number;
  inputZ: number;
  ascend: boolean;
  descend: boolean;
  yaw: number;
  pitch: number;
}

/**
 * Produces one normalized no-clip direction. Forward/back follows camera pitch,
 * strafing stays level, and explicit vertical controls remain world-aligned.
 */
export function developerFlightDirection(
  input: Readonly<DeveloperFlightInput>,
) {
  const inputX = Number.isFinite(input.inputX) ? input.inputX : 0;
  const inputZ = Number.isFinite(input.inputZ) ? input.inputZ : 0;
  const yaw = Number.isFinite(input.yaw) ? input.yaw : 0;
  const pitch = Number.isFinite(input.pitch) ? input.pitch : 0;
  const forwardAmount = -inputZ;
  const cosPitch = Math.cos(pitch);
  let x = Math.cos(yaw) * inputX - Math.sin(yaw) * cosPitch * forwardAmount;
  let y = Math.sin(pitch) * forwardAmount;
  let z = -Math.sin(yaw) * inputX - Math.cos(yaw) * cosPitch * forwardAmount;
  y += (input.ascend ? 1 : 0) - (input.descend ? 1 : 0);
  const length = Math.hypot(x, y, z);
  if (length > 1) {
    x /= length;
    y /= length;
    z /= length;
  }
  return { x, y, z };
}
