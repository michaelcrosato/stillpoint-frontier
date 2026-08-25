import { BIOMES, SETTLEMENTS, sampleClimate, type BiomeId } from "./macroWorld";
import { SPAWN_BUILDING } from "./spawnBuilding";
import { TEN_STORY_BUILDING } from "./tenStoryBuilding";
import { TWO_STORY_BUILDING } from "./twoStoryBuilding";

export type LocationKind = "biome" | "settlement" | "landmark";

export interface DiscoverableLocation {
  id: string;
  name: string;
  kind: LocationKind;
  region: string;
  note: string;
}

const COMPOUND: DiscoverableLocation & { x: number; z: number; radius: number } = {
  id: "landmark:field-unit-compound",
  name: "Field Unit Compound",
  kind: "landmark",
  region: "Grey Meadow",
  note: "Three restored survey structures mark the expedition's safe operating base.",
  x: (SPAWN_BUILDING.x + TWO_STORY_BUILDING.x + TEN_STORY_BUILDING.x) / 3,
  z: (SPAWN_BUILDING.z + TWO_STORY_BUILDING.z + TEN_STORY_BUILDING.z) / 3,
  radius: 54,
};

const BIOME_LOCATIONS = Object.values(BIOMES).map<DiscoverableLocation>((biome) => ({
  id: `biome:${biome.id}`,
  name: biome.name,
  kind: "biome",
  region: biome.region,
  note: `Survey classification registered for ${biome.name}.`,
}));

const SETTLEMENT_LOCATIONS = SETTLEMENTS.map<DiscoverableLocation>((settlement) => ({
  id: `settlement:${settlement.id}`,
  name: settlement.name,
  kind: "settlement",
  region: settlement.tier.toUpperCase(),
  note: settlement.reason,
}));

export const DISCOVERABLE_LOCATIONS: readonly DiscoverableLocation[] = Object.freeze([
  COMPOUND,
  ...BIOME_LOCATIONS,
  ...SETTLEMENT_LOCATIONS,
]);

const LOCATION_BY_ID = new Map(DISCOVERABLE_LOCATIONS.map((location) => [location.id, location]));

export function isKnownLocationId(value: unknown): value is string {
  return typeof value === "string" && LOCATION_BY_ID.has(value);
}

export function getDiscoverableLocation(id: string) {
  return LOCATION_BY_ID.get(id) ?? null;
}

export function currentDiscoverableLocation(x: number, z: number): DiscoverableLocation {
  const settlement = SETTLEMENTS.find(
    (candidate) => Math.hypot(x - candidate.x, z - candidate.z) <= candidate.radius,
  );
  if (settlement) return LOCATION_BY_ID.get(`settlement:${settlement.id}`)!;
  if (Math.hypot(x - COMPOUND.x, z - COMPOUND.z) <= COMPOUND.radius) return COMPOUND;
  const biomeId: BiomeId = sampleClimate(x, z).biome.id;
  return LOCATION_BY_ID.get(`biome:${biomeId}`)!;
}

export function addLocationDiscovery(
  discovered: readonly string[],
  locationId: string,
) {
  if (!isKnownLocationId(locationId) || discovered.includes(locationId)) return [...discovered];
  return [...discovered, locationId];
}
