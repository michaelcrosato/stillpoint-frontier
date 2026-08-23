import { BEACONS, PLAYER_RADIUS } from "../config";
import { hashString } from "../core/random";
import type { CircleCollider } from "../systems/collision";
import {
  SETTLEMENTS,
  WORLD_HALF_EXTENT,
  WORLD_MODEL_SCALE,
  distanceToRiver,
  riverWidth,
  type SettlementTier,
} from "./macroWorld";
import { sampleTerrainHeight } from "./terrain";

export const FAST_TRAVEL_PLAYTEST_UNLOCKED = true;

export type FastTravelLocationKind = SettlementTier | "relay";

export interface FastTravelLocation {
  id: string;
  sourceId: string;
  name: string;
  kind: FastTravelLocationKind;
  x: number;
  z: number;
  detail: string;
}

export interface FastTravelArrival {
  x: number;
  y: number;
  z: number;
}

const SETTLEMENT_LOCATIONS: readonly FastTravelLocation[] = SETTLEMENTS.map(
  (settlement) => ({
    id: `settlement:${settlement.id}`,
    sourceId: settlement.id,
    name: settlement.name,
    kind: settlement.tier,
    x: settlement.x,
    z: settlement.z,
    detail: settlement.economy,
  }),
);

const RELAY_LOCATIONS: readonly FastTravelLocation[] = BEACONS.map((beacon) => ({
  id: `relay:${beacon.id}`,
  sourceId: beacon.id,
  name: beacon.name,
  kind: "relay",
  x: beacon.x,
  z: beacon.z,
  detail: beacon.code,
}));

/**
 * This deliberately contains every authored key location. A later progression
 * feature can filter this immutable catalog without changing travel mechanics.
 */
export const FAST_TRAVEL_LOCATIONS: readonly FastTravelLocation[] = [
  ...SETTLEMENT_LOCATIONS,
  ...RELAY_LOCATIONS,
];

const locationById = new Map(
  FAST_TRAVEL_LOCATIONS.map((location) => [location.id, location]),
);

export function getFastTravelLocation(id: string) {
  return locationById.get(id) ?? null;
}

function preferredArrivalDistance(kind: FastTravelLocationKind) {
  switch (kind) {
    case "megacity":
      return 72;
    case "city":
      return 52;
    case "town":
      return 34;
    case "village":
      return 22;
    case "relay":
      return 13;
  }
}

function terrainIsWalkable(x: number, z: number, y: number) {
  const inRiver = distanceToRiver(x, z) <= riverWidth(z);
  const inCoastalWater = z > 4_900 * WORLD_MODEL_SCALE;
  if (inRiver || inCoastalWater) return false;
  const sampleRadius = 1.35;
  const neighbors = [
    sampleTerrainHeight(x + sampleRadius, z),
    sampleTerrainHeight(x - sampleRadius, z),
    sampleTerrainHeight(x, z + sampleRadius),
    sampleTerrainHeight(x, z - sampleRadius),
  ];
  return neighbors.every((height) => Math.abs(height - y) <= 1.15);
}

function clearsColliders(
  x: number,
  z: number,
  colliders: readonly CircleCollider[],
) {
  return colliders.every(
    (collider) =>
      Math.hypot(x - collider.x, z - collider.z) >=
      collider.radius + PLAYER_RADIUS + 0.85,
  );
}

/**
 * Produces a stable, walkable offset rather than dropping the player on top of
 * a landmark or procedural building. The same location and collider set always
 * resolve to the same arrival, which keeps automated playtests repeatable.
 */
export function resolveFastTravelArrival(
  location: FastTravelLocation,
  colliders: readonly CircleCollider[] = [],
): FastTravelArrival {
  const baseDistance = preferredArrivalDistance(location.kind);
  const baseAngle =
    (hashString(`fast-travel:${location.id}:arrival:v1`) / 0x1_0000_0000) *
    Math.PI *
    2;
  const worldLimit = WORLD_HALF_EXTENT - 2;
  let fallback: FastTravelArrival | null = null;
  const searchDistances = [
    baseDistance,
    baseDistance + 13,
    baseDistance + 26,
    baseDistance + 39,
    baseDistance + 52,
    128,
    256,
    512,
    1_024,
    2_048,
    4_096,
  ];

  for (const distance of searchDistances) {
    for (let spoke = 0; spoke < 16; spoke += 1) {
      const angle = baseAngle + (spoke / 16) * Math.PI * 2;
      const x = Math.min(worldLimit, Math.max(-worldLimit, location.x + Math.cos(angle) * distance));
      const z = Math.min(worldLimit, Math.max(-worldLimit, location.z + Math.sin(angle) * distance));
      const y = sampleTerrainHeight(x, z);
      fallback ??= { x, y, z };
      if (!terrainIsWalkable(x, z, y)) continue;
      if (!clearsColliders(x, z, colliders)) continue;
      return { x, y, z };
    }
  }

  if (fallback) return fallback;
  const x = Math.min(worldLimit, Math.max(-worldLimit, location.x));
  const z = Math.min(worldLimit, Math.max(-worldLimit, location.z));
  return { x, y: sampleTerrainHeight(x, z), z };
}
