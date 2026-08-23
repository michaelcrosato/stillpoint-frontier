export const GAME_TITLE = "Stillpoint Frontier";
export const WORLD_SEED = "STILL-0317";

export const CHUNK_SIZE = 96;
export const CHUNK_SEGMENTS = 18;
/** 9x9 visual ring: exactly twice the previous worst-direction terrain horizon. */
export const WORLD_CHUNK_LOAD_RADIUS = 4;
/** Keep colliders, targets, and resource queries inside the original 5x5 budget. */
export const GAMEPLAY_CHUNK_RADIUS = 2;
/** Ambient citizens remain independent from the expanded visual horizon. */
export const CITIZEN_CHUNK_LOAD_RADIUS = 2;
export const WORLD_RESIDENT_CHUNKS = (WORLD_CHUNK_LOAD_RADIUS * 2 + 1) ** 2;
export const CITIZEN_RESIDENT_CHUNKS = (CITIZEN_CHUNK_LOAD_RADIUS * 2 + 1) ** 2;
export const CAMERA_DRAW_DISTANCE = 1_840;
export const WAYPOINT_WORLD_MARKER_DISTANCE = 846;
export const PLAYER_HEIGHT = 1.72;
export const PLAYER_BODY_HEIGHT = 1.82;
export const CROUCH_HEIGHT = 1.08;
export const CROUCH_BODY_HEIGHT = 1.16;
export const PLAYER_RADIUS = 0.42;
export const WALK_SPEED = 6.4;
export const SPRINT_SPEED = 10.5;
export const CROUCH_SPEED = 3.35;
export const JUMP_SPEED = 7.1;
export const GRAVITY = 19.5;
export const STAMINA_DRAIN_RATE = 0.24;
export const STAMINA_REGEN_RATE = 0.18;
export const STAMINA_REGEN_DELAY = 0.65;
export const INTERACTION_DISTANCE = 6.25;

export const MAX_PIXEL_RATIO = 1.75;
export const SHADOW_MAP_SIZE = 2048;

export type QualityLevel = "cinematic" | "performance";

export const BEACONS = [
  {
    id: "amber-relay",
    name: "Amber Relay",
    code: "SR-01",
    x: 38,
    z: -52,
    note: "A weather archive, sealed before the last migration.",
  },
  {
    id: "hollow-array",
    name: "Hollow Array",
    code: "SR-02",
    x: -112,
    z: -118,
    note: "Its alignment points below the horizon, not above it.",
  },
  {
    id: "meridian-vault",
    name: "Meridian Vault",
    code: "SR-03",
    x: 156,
    z: 76,
    note: "The final survey mark repeats a coordinate with no known place.",
  },
] as const;

export type BeaconId = (typeof BEACONS)[number]["id"];
