import type { WeatherId } from "../environment/model";
import type {
  DeveloperPlayerSandboxState,
  DeveloperSpeedMode,
} from "../developer/PlayerSandbox";

export const SESSION_MODES = ["survey", "developer"] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export type SessionPersistence = "persistent" | "ephemeral";

export interface PlayerStartPose {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface DeveloperQuickStartPreset {
  mode: "developer";
  persistence: "ephemeral";
  worldMinutes: number;
  weatherId: WeatherId;
  player: Readonly<DeveloperPlayerSandboxState> & {
    speedMode: DeveloperSpeedMode;
  };
}

export const PLAYER_START_POSE: Readonly<PlayerStartPose> = Object.freeze({
  x: 0,
  z: 8,
  yaw: -0.565,
  pitch: -0.035,
});

/**
 * A deterministic, non-persistent launch profile for rapid world inspection.
 * Keeping this as data makes future playtest profiles possible without adding
 * another set of one-off UI mutations.
 */
export const DEVELOPER_QUICK_START: Readonly<DeveloperQuickStartPreset> =
  Object.freeze({
    mode: "developer",
    persistence: "ephemeral",
    worldMinutes: 12 * 60,
    weatherId: "fair",
    player: Object.freeze({
      invincible: true,
      speedMode: "veryFast",
      fly: true,
    }),
  });

export const SESSION_PROFILES: Readonly<
  Record<SessionMode, Readonly<{ mode: SessionMode; persistence: SessionPersistence }>>
> = Object.freeze({
  survey: Object.freeze({ mode: "survey", persistence: "persistent" }),
  developer: DEVELOPER_QUICK_START,
});

export function sessionPersists(mode: SessionMode): boolean {
  return SESSION_PROFILES[mode].persistence === "persistent";
}
