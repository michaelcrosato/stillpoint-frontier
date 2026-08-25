import {
  CHUNK_SIZE,
  WORLD_SEED,
  qualityUsesHighDetail,
  type QualityLevel,
} from "../config";
import { randomRange, seededRandom } from "../core/random";
import {
  WATER_LEVEL,
  nearestSettlement,
  sampleClimate,
  type BiomeId,
} from "../world/macroWorld";
import { distanceToPathSegment, worldPathSegmentsForChunk } from "../world/roads";
import { chunkCenter, chunkKey, sampleTerrainHeight } from "../world/terrain";

export type AnimalBodyKind = "grazer" | "stocky" | "small" | "reptile" | "bird";

export type AnimalSpeciesId =
  | "marsh_deer"
  | "reed_heron"
  | "sable_elk"
  | "forest_boar"
  | "crown_goat"
  | "ridge_raven"
  | "steppe_pronghorn"
  | "dune_fox"
  | "glass_lizard"
  | "salt_gull"
  | "meadow_hare";

export interface AnimalSpeciesDefinition {
  id: AnimalSpeciesId;
  label: string;
  body: AnimalBodyKind;
  bodyColor: number;
  accentColor: number;
  scale: number;
  minGroup: number;
  maxGroup: number;
  speed: number;
  roamRadius: number;
  flying: boolean;
}

interface WeightedAnimalSpecies {
  id: AnimalSpeciesId;
  weight: number;
}

export interface AnimalRecipe {
  id: string;
  speciesId: AnimalSpeciesId;
  x: number;
  z: number;
  scale: number;
  heading: number;
  speed: number;
  roamRadius: number;
  phase: number;
  flightHeight: number;
}

export interface AnimalPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export const MAX_ANIMALS_PER_CHUNK = 6;
export const MAX_RESIDENT_ANIMALS: Readonly<Record<QualityLevel, number>> = {
  ultra: 72,
  cinematic: 72,
  performance: 36,
};

export const ANIMAL_SPECIES: Readonly<Record<AnimalSpeciesId, AnimalSpeciesDefinition>> = {
  marsh_deer: {
    id: "marsh_deer",
    label: "Greywater deer",
    body: "grazer",
    bodyColor: 0x766550,
    accentColor: 0xc1b391,
    scale: 0.92,
    minGroup: 1,
    maxGroup: 3,
    speed: 0.12,
    roamRadius: 6,
    flying: false,
  },
  reed_heron: {
    id: "reed_heron",
    label: "Reed heron",
    body: "bird",
    bodyColor: 0xa7aaa0,
    accentColor: 0x30383a,
    scale: 0.9,
    minGroup: 1,
    maxGroup: 2,
    speed: 0.1,
    roamRadius: 8,
    flying: true,
  },
  sable_elk: {
    id: "sable_elk",
    label: "Sable elk",
    body: "grazer",
    bodyColor: 0x5c4b3b,
    accentColor: 0xbca77d,
    scale: 1.14,
    minGroup: 2,
    maxGroup: 4,
    speed: 0.1,
    roamRadius: 7,
    flying: false,
  },
  forest_boar: {
    id: "forest_boar",
    label: "Forest boar",
    body: "stocky",
    bodyColor: 0x413d38,
    accentColor: 0x7d715e,
    scale: 0.82,
    minGroup: 1,
    maxGroup: 3,
    speed: 0.14,
    roamRadius: 5,
    flying: false,
  },
  crown_goat: {
    id: "crown_goat",
    label: "Crown mountain goat",
    body: "grazer",
    bodyColor: 0x969185,
    accentColor: 0x3f3d39,
    scale: 0.84,
    minGroup: 1,
    maxGroup: 3,
    speed: 0.11,
    roamRadius: 5,
    flying: false,
  },
  ridge_raven: {
    id: "ridge_raven",
    label: "Ridge raven",
    body: "bird",
    bodyColor: 0x24282a,
    accentColor: 0x4a5458,
    scale: 0.66,
    minGroup: 1,
    maxGroup: 3,
    speed: 0.16,
    roamRadius: 10,
    flying: true,
  },
  steppe_pronghorn: {
    id: "steppe_pronghorn",
    label: "Steppe pronghorn",
    body: "grazer",
    bodyColor: 0xa27d51,
    accentColor: 0xe0c89d,
    scale: 0.88,
    minGroup: 2,
    maxGroup: 4,
    speed: 0.15,
    roamRadius: 8,
    flying: false,
  },
  dune_fox: {
    id: "dune_fox",
    label: "Dune fox",
    body: "small",
    bodyColor: 0xa76942,
    accentColor: 0xe0b98d,
    scale: 0.72,
    minGroup: 1,
    maxGroup: 1,
    speed: 0.18,
    roamRadius: 6,
    flying: false,
  },
  glass_lizard: {
    id: "glass_lizard",
    label: "Glassback lizard",
    body: "reptile",
    bodyColor: 0x7a6850,
    accentColor: 0xb28b59,
    scale: 0.66,
    minGroup: 1,
    maxGroup: 2,
    speed: 0.2,
    roamRadius: 3.5,
    flying: false,
  },
  salt_gull: {
    id: "salt_gull",
    label: "Salt gull",
    body: "bird",
    bodyColor: 0xd3d0bf,
    accentColor: 0x4f5556,
    scale: 0.72,
    minGroup: 2,
    maxGroup: 3,
    speed: 0.18,
    roamRadius: 11,
    flying: true,
  },
  meadow_hare: {
    id: "meadow_hare",
    label: "Meadow hare",
    body: "small",
    bodyColor: 0x88735c,
    accentColor: 0xc5b89c,
    scale: 0.56,
    minGroup: 1,
    maxGroup: 2,
    speed: 0.22,
    roamRadius: 4,
    flying: false,
  },
};

export const ANIMAL_PROFILES: Readonly<Record<BiomeId, readonly WeightedAnimalSpecies[]>> = {
  riverlands: [
    { id: "marsh_deer", weight: 0.58 },
    { id: "reed_heron", weight: 0.42 },
  ],
  pine_forest: [
    { id: "sable_elk", weight: 0.55 },
    { id: "forest_boar", weight: 0.3 },
    { id: "ridge_raven", weight: 0.15 },
  ],
  crown_highlands: [
    { id: "crown_goat", weight: 0.72 },
    { id: "ridge_raven", weight: 0.28 },
  ],
  warden_steppe: [
    { id: "steppe_pronghorn", weight: 0.68 },
    { id: "dune_fox", weight: 0.32 },
  ],
  glass_badlands: [
    { id: "glass_lizard", weight: 0.76 },
    { id: "ridge_raven", weight: 0.24 },
  ],
  salt_coast: [
    { id: "salt_gull", weight: 0.74 },
    { id: "reed_heron", weight: 0.26 },
  ],
  grey_meadow: [
    { id: "meadow_hare", weight: 0.42 },
    { id: "marsh_deer", weight: 0.35 },
    { id: "dune_fox", weight: 0.23 },
  ],
};

function selectSpecies(biomeId: BiomeId, value: number) {
  const profile = ANIMAL_PROFILES[biomeId];
  const target = Math.min(0.999999, Math.max(0, value));
  let accumulated = 0;
  for (const entry of profile) {
    accumulated += entry.weight;
    if (target <= accumulated) return ANIMAL_SPECIES[entry.id];
  }
  return ANIMAL_SPECIES[profile[profile.length - 1].id];
}

export function generateAnimalChunk(chunkX: number, chunkZ: number): AnimalRecipe[] {
  const key = chunkKey(chunkX, chunkZ);
  const center = chunkCenter({ x: chunkX, z: chunkZ });
  const climate = sampleClimate(center.x, center.z);
  const nearest = nearestSettlement(center.x, center.z);
  if (nearest.distance < nearest.settlement.radius + 34) return [];

  const random = seededRandom(`${WORLD_SEED}:animals:v1:${key}`);
  const presenceChance = 0.22 + climate.moisture * 0.08;
  if (random() > presenceChance) return [];
  const species = selectSpecies(climate.biome.id, random());
  const groupSize = Math.min(
    MAX_ANIMALS_PER_CHUNK,
    species.minGroup + Math.floor(random() * (species.maxGroup - species.minGroup + 1)),
  );
  const paths = worldPathSegmentsForChunk(chunkX, chunkZ);
  let anchor: { x: number; z: number } | null = null;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const x = center.x + randomRange(random, -CHUNK_SIZE * 0.37, CHUNK_SIZE * 0.37);
    const z = center.z + randomRange(random, -CHUNK_SIZE * 0.37, CHUNK_SIZE * 0.37);
    const terrainY = sampleTerrainHeight(x, z);
    if (terrainY <= WATER_LEVEL + 0.18) continue;
    const localSettlement = nearestSettlement(x, z);
    if (localSettlement.distance < localSettlement.settlement.radius + 28) continue;
    if (paths.some((path) =>
      distanceToPathSegment({ x, z }, path) < path.width * 0.5 + 9,
    )) continue;
    anchor = { x, z };
    break;
  }
  if (!anchor) return [];

  const recipes: AnimalRecipe[] = [];
  for (let index = 0; index < groupSize; index += 1) {
    const angle = random() * Math.PI * 2;
    const spread = index === 0 ? 0 : randomRange(random, 1.2, 4.2);
    recipes.push({
      id: `animal:${species.id}:v1:${key}:${index}`,
      speciesId: species.id,
      x: anchor.x + Math.cos(angle) * spread,
      z: anchor.z + Math.sin(angle) * spread,
      scale: species.scale * randomRange(random, 0.86, 1.12),
      heading: random() * Math.PI * 2,
      speed: species.speed * randomRange(random, 0.82, 1.18),
      roamRadius: species.roamRadius * randomRange(random, 0.72, 1),
      phase: random() * Math.PI * 2,
      flightHeight: species.flying ? randomRange(random, 2.8, 7.5) : 0,
    });
  }
  return recipes;
}

export function visibleAnimalCount(recipeCount: number, quality: QualityLevel) {
  const safeCount = Math.max(0, Math.floor(recipeCount));
  const qualityCount = qualityUsesHighDetail(quality)
    ? safeCount
    : Math.ceil(safeCount * 0.55);
  return Math.min(qualityCount, MAX_RESIDENT_ANIMALS[quality]);
}

export function sampleAnimalPose(recipe: AnimalRecipe, elapsedSeconds: number): AnimalPose {
  const safeTime = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  const species = ANIMAL_SPECIES[recipe.speciesId];
  const phase = recipe.phase + safeTime * recipe.speed;
  const x = recipe.x + Math.cos(phase) * recipe.roamRadius;
  const z = recipe.z + Math.sin(phase * 0.83) * recipe.roamRadius * 0.72;
  const dx = -Math.sin(phase) * recipe.roamRadius;
  const dz = Math.cos(phase * 0.83) * recipe.roamRadius * 0.72 * 0.83;
  const groundY = sampleTerrainHeight(x, z);
  return {
    x,
    y: groundY + (species.flying ? recipe.flightHeight + Math.sin(phase * 1.7) * 0.35 : 0),
    z,
    yaw: Math.atan2(dx, dz),
  };
}
