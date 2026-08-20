export const GAME_TITLE = "Stillpoint Frontier";
export const WORLD_SEED = "STILL-0317";

export const CHUNK_SIZE = 96;
export const CHUNK_SEGMENTS = 18;
export const CHUNK_LOAD_RADIUS = 2;
export const PLAYER_HEIGHT = 1.72;
export const PLAYER_RADIUS = 0.42;
export const WALK_SPEED = 6.4;
export const SPRINT_SPEED = 10.5;
export const INTERACTION_DISTANCE = 5.25;

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
