import { BIOMES, SETTLEMENTS, sampleClimate, type BiomeId } from "./macroWorld";
import { authoredBuildingsForLandmark } from "./authoredBuildings";
import { MOUNTAIN_LANDMARK, mountainDistance } from "./mountainLandmark";
import {
  CANYON_LANDMARK,
  isInsideCanyonDiscovery,
} from "./canyonLandmark";

export type LocationKind = "biome" | "settlement" | "landmark";

export interface DiscoverableLocation {
  id: string;
  name: string;
  kind: LocationKind;
  region: string;
  note: string;
}

const COMPOUND_ID = "landmark:field-unit-compound";
const compoundBuildings = authoredBuildingsForLandmark(COMPOUND_ID);
const compoundCenter = compoundBuildings.length > 0
  ? {
      x:
        compoundBuildings.reduce((sum, recipe) => sum + recipe.frame.x, 0) /
        compoundBuildings.length,
      z:
        compoundBuildings.reduce((sum, recipe) => sum + recipe.frame.z, 0) /
        compoundBuildings.length,
    }
  : { x: 0, z: 8 };

const COMPOUND: DiscoverableLocation & { x: number; z: number; radius: number } = {
  id: COMPOUND_ID,
  name: "Field Unit Compound",
  kind: "landmark",
  region: "Grey Meadow",
  note: "Three restored survey structures mark the expedition's safe operating base.",
  x: compoundCenter.x,
  z: compoundCenter.z,
  radius: 54,
};

const CROWNSPIRE: DiscoverableLocation = {
  id: MOUNTAIN_LANDMARK.id,
  name: MOUNTAIN_LANDMARK.name,
  kind: "landmark",
  region: MOUNTAIN_LANDMARK.region,
  note: MOUNTAIN_LANDMARK.note,
};

const SUNSCAR_CANYON: DiscoverableLocation = {
  id: CANYON_LANDMARK.id,
  name: CANYON_LANDMARK.name,
  kind: "landmark",
  region: CANYON_LANDMARK.region,
  note: CANYON_LANDMARK.note,
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
  CROWNSPIRE,
  SUNSCAR_CANYON,
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
  if (mountainDistance(x, z) <= MOUNTAIN_LANDMARK.discoveryRadius) {
    return CROWNSPIRE;
  }
  if (isInsideCanyonDiscovery(x, z)) return SUNSCAR_CANYON;
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
