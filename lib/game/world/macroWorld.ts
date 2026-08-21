import { hashString } from "../core/random";

/**
 * The authored atlas is 96 km square. Only a 5x5 ring of 96 m chunks is ever
 * resident, so the scale changes geography and travel time, not GPU load.
 */
export const WORLD_MODEL_SCALE = 7.5;
export const WORLD_HALF_EXTENT = 6_400 * WORLD_MODEL_SCALE;
export const WORLD_SIZE_METERS = WORLD_HALF_EXTENT * 2;
export const WORLD_AREA_KM2 = (WORLD_SIZE_METERS * WORLD_SIZE_METERS) / 1_000_000;
export const WATER_LEVEL = -2.4;

export type BiomeId =
  | "riverlands"
  | "pine_forest"
  | "crown_highlands"
  | "warden_steppe"
  | "glass_badlands"
  | "salt_coast"
  | "grey_meadow";

export interface BiomeDefinition {
  id: BiomeId;
  name: string;
  region: string;
  color: number;
  treeDensity: number;
  rockDensity: number;
  primaryResource: "fiber" | "wood" | "stone" | "ore" | "relic";
}

export const BIOMES: Record<BiomeId, BiomeDefinition> = {
  riverlands: {
    id: "riverlands",
    name: "Greywater Riverlands",
    region: "Greywater Basin",
    color: 0x65705b,
    treeDensity: 0.45,
    rockDensity: 0.25,
    primaryResource: "fiber",
  },
  pine_forest: {
    id: "pine_forest",
    name: "Sable Pine Forest",
    region: "Sablewood",
    color: 0x3f5144,
    treeDensity: 1,
    rockDensity: 0.45,
    primaryResource: "wood",
  },
  crown_highlands: {
    id: "crown_highlands",
    name: "Crown Highlands",
    region: "Crown Highlands",
    color: 0x62635f,
    treeDensity: 0.22,
    rockDensity: 1,
    primaryResource: "ore",
  },
  warden_steppe: {
    id: "warden_steppe",
    name: "Warden Steppe",
    region: "Warden Steppe",
    color: 0x8a7958,
    treeDensity: 0.08,
    rockDensity: 0.38,
    primaryResource: "fiber",
  },
  glass_badlands: {
    id: "glass_badlands",
    name: "Glass Barrens",
    region: "Glass Barrens",
    color: 0x8b6048,
    treeDensity: 0,
    rockDensity: 0.9,
    primaryResource: "stone",
  },
  salt_coast: {
    id: "salt_coast",
    name: "Salt Coast",
    region: "The Salt Reach",
    color: 0x8b8776,
    treeDensity: 0.04,
    rockDensity: 0.32,
    primaryResource: "relic",
  },
  grey_meadow: {
    id: "grey_meadow",
    name: "Grey Meadow",
    region: "Red Basin Marches",
    color: 0x7a7358,
    treeDensity: 0.24,
    rockDensity: 0.42,
    primaryResource: "fiber",
  },
};

export function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function smoothstep(edge0: number, edge1: number, value: number) {
  const amount = clamp01((value - edge0) / (edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

function baseRiverCenterX(z: number) {
  return 650 + Math.sin(z * 0.00055) * 520 + Math.sin(z * 0.0013 + 0.7) * 180;
}

export function riverCenterX(z: number) {
  return baseRiverCenterX(z / WORLD_MODEL_SCALE) * WORLD_MODEL_SCALE;
}

export function riverWidth(z: number) {
  const modelZ = z / WORLD_MODEL_SCALE;
  return (
    34 +
    smoothstep(1_800, 5_300, modelZ) * 32 +
    (Math.sin(modelZ * 0.0017) + 1) * 4
  ) * WORLD_MODEL_SCALE;
}

export function distanceToRiver(x: number, z: number) {
  return Math.abs(x - riverCenterX(z));
}

export function sampleMacroElevation(x: number, z: number) {
  const modelX = x / WORLD_MODEL_SCALE;
  const modelZ = z / WORLD_MODEL_SCALE;
  const rolling =
    Math.sin(modelX * 0.00105 + 0.4) * 8 + Math.cos(modelZ * 0.00086 - 0.7) * 6;
  const northernRise = smoothstep(-1_900, -5_800, modelZ) * 34;
  const westernRidge = smoothstep(1_700, 4_800, Math.abs(modelX)) * 15;
  const badlandShelf = smoothstep(2_100, 5_200, modelX) * 10;
  return rolling + northernRise + westernRidge + badlandShelf;
}

export interface ClimateSample {
  biome: BiomeDefinition;
  moisture: number;
  temperature: number;
  riverDistance: number;
  macroElevation: number;
}

export function sampleClimate(x: number, z: number): ClimateSample {
  const modelX = x / WORLD_MODEL_SCALE;
  const modelZ = z / WORLD_MODEL_SCALE;
  const macroElevation = sampleMacroElevation(x, z);
  const riverDistance = distanceToRiver(x, z);
  const riverMoisture = Math.exp(-riverDistance / (620 * WORLD_MODEL_SCALE));
  const weatherNoise =
    (Math.sin(modelX * 0.00072 + modelZ * 0.00031) +
      Math.cos(modelZ * 0.00057 - modelX * 0.00018) +
      2) /
    4;
  const westernRain = clamp01(0.66 - modelX / (6_400 * 1.7));
  const moisture = clamp01(riverMoisture * 0.62 + weatherNoise * 0.2 + westernRain * 0.27);
  const temperature = clamp01(0.61 + modelZ / (6_400 * 3.2) - macroElevation * 0.007);

  let biomeId: BiomeId;
  if (modelZ > 4_750) biomeId = "salt_coast";
  else if (riverDistance < riverWidth(z) + 72 * WORLD_MODEL_SCALE) biomeId = "riverlands";
  else if (modelZ < -3_250 || macroElevation > 32) biomeId = "crown_highlands";
  else if (modelX > 2_350 && moisture < 0.5) biomeId = "glass_badlands";
  else if (moisture > 0.58 && temperature < 0.68) biomeId = "pine_forest";
  else if (modelX < -1_350 && moisture < 0.54) biomeId = "warden_steppe";
  else biomeId = "grey_meadow";

  return { biome: BIOMES[biomeId], moisture, temperature, riverDistance, macroElevation };
}

export type SettlementTier = "megacity" | "city" | "town" | "village";

export interface Settlement {
  id: string;
  name: string;
  tier: SettlementTier;
  x: number;
  z: number;
  population: number;
  economy: string;
  reason: string;
  radius: number;
}

const atRiver = (z: number, offset = 0) => Math.round(baseRiverCenterX(z) + offset);

const BASE_SETTLEMENTS: readonly Settlement[] = [
  {
    id: "vesper-crown",
    name: "Vesper Crown",
    tier: "megacity",
    x: atRiver(1_050, 120),
    z: 1_050,
    population: 11_800_000,
    economy: "finance · precision industry · river trade · administration",
    reason: "Founded where the Greywater narrows at the continent's main east–west caravan crossing.",
    radius: 560,
  },
  {
    id: "ironvale",
    name: "Ironvale",
    tier: "city",
    x: -3_180,
    z: -3_050,
    population: 162_000,
    economy: "iron · machine works · rail stock · stone",
    reason: "A spring-fed highland shelf beside the region's richest iron and hard-stone seams.",
    radius: 320,
  },
  {
    id: "reedwater",
    name: "Reedwater",
    tier: "city",
    x: atRiver(-1_020, -170),
    z: -1_020,
    population: 118_000,
    economy: "grain · milling · river barges · food markets",
    reason: "Built on a broad, flood-renewed terrace where barges can load the northern grain belt.",
    radius: 300,
  },
  {
    id: "kilnreach",
    name: "Kilnreach",
    tier: "city",
    x: 3_320,
    z: 620,
    population: 96_000,
    economy: "glass · ceramics · solar works · salt chemicals",
    reason: "Deep artesian wells support a factory city beside silica flats, clay beds, and unbroken sun.",
    radius: 290,
  },
  {
    id: "lumenport",
    name: "Lumenport",
    tier: "city",
    x: atRiver(4_850, 80),
    z: 4_850,
    population: 204_000,
    economy: "shipping · fisheries · warehousing · ship repair",
    reason: "The Greywater's navigable estuary gives inland producers their only all-season sea port.",
    radius: 340,
  },
  {
    id: "timberfall",
    name: "Timberfall",
    tier: "town",
    x: -1_720,
    z: -2_420,
    population: 24_000,
    economy: "timber · resin · paper · carpentry",
    reason: "A managed-forest town where two logging valleys meet the highland road.",
    radius: 175,
  },
  {
    id: "crosswind",
    name: "Crosswind",
    tier: "town",
    x: -820,
    z: 460,
    population: 31_000,
    economy: "grain exchange · livestock · wagon works",
    reason: "A dry, level crossroads between western farms, Vesper Crown, and the northern mills.",
    radius: 180,
  },
  {
    id: "red-quay",
    name: "Red Quay",
    tier: "town",
    x: atRiver(2_650, -40),
    z: 2_650,
    population: 28_000,
    economy: "river freight · orchards · cooperage",
    reason: "A natural landing above the tidal reach, surrounded by warm orchard terraces.",
    radius: 170,
  },
  {
    id: "bright-mine",
    name: "Bright Mine",
    tier: "town",
    x: 2_620,
    z: -2_520,
    population: 19_000,
    economy: "copper · rare earths · explosives",
    reason: "A mining settlement on an exposed mineral fault with a direct haul road to Kilnreach.",
    radius: 160,
  },
  {
    id: "saltmere",
    name: "Saltmere",
    tier: "town",
    x: 2_850,
    z: 5_030,
    population: 21_000,
    economy: "salt pans · fish curing · coastal trade",
    reason: "Shallow evaporation flats and a protected coastal inlet sustain salt and fishing fleets.",
    radius: 165,
  },
  {
    id: "barrow-gate",
    name: "Barrow Gate",
    tier: "town",
    x: -3_720,
    z: 1_620,
    population: 17_000,
    economy: "wool · horses · leather · caravan services",
    reason: "The western steppe road funnels through this dependable well and sheltered escarpment gap.",
    radius: 150,
  },
  {
    id: "greybridge",
    name: "Greybridge",
    tier: "town",
    x: atRiver(-3_050, 20),
    z: -3_050,
    population: 14_000,
    economy: "hydropower · quarrying · bridge tolls",
    reason: "The last safe river crossing before the steep Crown Highlands controls northbound trade.",
    radius: 145,
  },
  {
    id: "dustmere",
    name: "Dustmere",
    tier: "village",
    x: -210,
    z: -240,
    population: 1_420,
    economy: "goats · dry farming · relay salvage",
    reason: "A sheltered basin spring and old relay road support the frontier's nearest permanent village.",
    radius: 82,
  },
  {
    id: "willow-bank",
    name: "Willow Bank",
    tier: "village",
    x: atRiver(-210, -90),
    z: -210,
    population: 2_160,
    economy: "vegetables · reeds · ferries",
    reason: "Shallow riverbanks and rich silt favor market gardens and a local ferry crossing.",
    radius: 88,
  },
  {
    id: "pine-rest",
    name: "Pine Rest",
    tier: "village",
    x: -1_350,
    z: -1_640,
    population: 1_080,
    economy: "charcoal · mushrooms · forestry",
    reason: "A forest clearing on the Timberfall road where charcoal burners share a perennial creek.",
    radius: 76,
  },
  {
    id: "long-acre",
    name: "Long Acre",
    tier: "village",
    x: -2_180,
    z: 120,
    population: 1_760,
    economy: "wheat · seed stock · sheep",
    reason: "Deep steppe loam, low slope, and easy access to Crosswind's grain market favor broad farms.",
    radius: 84,
  },
  {
    id: "cold-spring",
    name: "Cold Spring",
    tier: "village",
    x: -2_480,
    z: -3_820,
    population: 740,
    economy: "goats · slate · spring water",
    reason: "A mineral spring makes a rare habitable shelf beneath the northern quarry faces.",
    radius: 68,
  },
  {
    id: "copper-leaf",
    name: "Copperleaf",
    tier: "village",
    x: 2_040,
    z: -1_780,
    population: 980,
    economy: "prospecting · pack animals · herbs",
    reason: "A wooded fault valley provides water, browse, and a staging point for the eastern mines.",
    radius: 72,
  },
  {
    id: "white-clay",
    name: "White Clay",
    tier: "village",
    x: 3_740,
    z: 1_420,
    population: 1_340,
    economy: "clay · kiln fuel · ceramics",
    reason: "A clay lens beside an artesian seep supplies Kilnreach's ceramic yards.",
    radius: 76,
  },
  {
    id: "orchard-bend",
    name: "Orchard Bend",
    tier: "village",
    x: atRiver(3_360, -260),
    z: 3_360,
    population: 2_420,
    economy: "fruit · cider · river pilots",
    reason: "A warm, south-facing river bend protects orchards from coastal wind.",
    radius: 90,
  },
  {
    id: "nettle-ford",
    name: "Nettle Ford",
    tier: "village",
    x: atRiver(1_920, 150),
    z: 1_920,
    population: 1_880,
    economy: "hemp fiber · ferries · poultry",
    reason: "A firm gravel ford and wet fields make this a natural fiber-growing and ferry village.",
    radius: 86,
  },
  {
    id: "sunbreak",
    name: "Sunbreak",
    tier: "village",
    x: 4_360,
    z: 120,
    population: 860,
    economy: "solar maintenance · silica gathering",
    reason: "Unbroken sunlight and a shallow service well support workers on the eastern solar fields.",
    radius: 70,
  },
  {
    id: "west-well",
    name: "West Well",
    tier: "village",
    x: -4_620,
    z: 580,
    population: 620,
    economy: "water stop · horses · caravan repair",
    reason: "The only reliable deep well across a long stretch of the western caravan route.",
    radius: 62,
  },
  {
    id: "low-tide",
    name: "Low Tide",
    tier: "village",
    x: -640,
    z: 5_180,
    population: 1_520,
    economy: "shellfish · rope · coastal pilots",
    reason: "Mudflats rich in shellfish sit beside the safest small-craft channel west of Lumenport.",
    radius: 78,
  },
] as const;

export const SETTLEMENTS: readonly Settlement[] = BASE_SETTLEMENTS.map((settlement) => ({
  ...settlement,
  x: Math.round(settlement.x * WORLD_MODEL_SCALE),
  z: Math.round(settlement.z * WORLD_MODEL_SCALE),
  radius:
    settlement.tier === "megacity"
      ? 8_000
      : Math.round(settlement.radius * Math.min(WORLD_MODEL_SCALE, 4)),
}));

export interface RoadLink {
  from: string;
  to: string;
  class: "trunk" | "regional" | "local";
}

export interface RoadCorridor {
  id: string;
  class: RoadLink["class"];
  kind: "trade" | "service";
  from: { x: number; z: number };
  to: { x: number; z: number };
  endpointPopulations: readonly [number, number];
}

export const ROAD_LINKS: readonly RoadLink[] = [
  { from: "ironvale", to: "greybridge", class: "regional" },
  { from: "greybridge", to: "reedwater", class: "trunk" },
  { from: "reedwater", to: "vesper-crown", class: "trunk" },
  { from: "vesper-crown", to: "red-quay", class: "trunk" },
  { from: "red-quay", to: "lumenport", class: "trunk" },
  { from: "vesper-crown", to: "crosswind", class: "trunk" },
  { from: "crosswind", to: "barrow-gate", class: "regional" },
  { from: "barrow-gate", to: "west-well", class: "local" },
  { from: "vesper-crown", to: "kilnreach", class: "trunk" },
  { from: "kilnreach", to: "bright-mine", class: "regional" },
  { from: "kilnreach", to: "sunbreak", class: "local" },
  { from: "kilnreach", to: "white-clay", class: "local" },
  { from: "lumenport", to: "saltmere", class: "regional" },
  { from: "crosswind", to: "long-acre", class: "local" },
  { from: "reedwater", to: "timberfall", class: "regional" },
  { from: "timberfall", to: "pine-rest", class: "local" },
  { from: "ironvale", to: "cold-spring", class: "local" },
  { from: "bright-mine", to: "copper-leaf", class: "local" },
  { from: "red-quay", to: "orchard-bend", class: "local" },
  { from: "vesper-crown", to: "nettle-ford", class: "local" },
  { from: "lumenport", to: "low-tide", class: "regional" },
  { from: "crosswind", to: "dustmere", class: "local" },
  { from: "dustmere", to: "willow-bank", class: "local" },
] as const;

const settlementById = new Map(SETTLEMENTS.map((settlement) => [settlement.id, settlement]));

export function getSettlement(id: string) {
  return settlementById.get(id) ?? null;
}

export function nearestSettlement(x: number, z: number) {
  let nearest = SETTLEMENTS[0];
  let distance = Number.POSITIVE_INFINITY;
  for (const settlement of SETTLEMENTS) {
    const nextDistance = Math.hypot(x - settlement.x, z - settlement.z);
    if (nextDistance < distance) {
      nearest = settlement;
      distance = nextDistance;
    }
  }
  return { settlement: nearest, distance };
}

export function settlementInfluence(settlement: Settlement, x: number, z: number) {
  return clamp01(1 - Math.hypot(x - settlement.x, z - settlement.z) / settlement.radius);
}

export function settlementsNear(x: number, z: number, padding: number) {
  return SETTLEMENTS.filter(
    (settlement) => Math.hypot(x - settlement.x, z - settlement.z) <= settlement.radius + padding,
  );
}

export function siteSuitability(x: number, z: number) {
  const climate = sampleClimate(x, z);
  const water = clamp01(
    Math.exp(-climate.riverDistance / (700 * WORLD_MODEL_SCALE)) +
      smoothstep(4_300, 5_500, z / WORLD_MODEL_SCALE) * 0.55,
  );
  const fertility = clamp01(climate.moisture * (1 - Math.abs(climate.macroElevation) / 40));
  const oreNoise = (hashString(`${Math.round(x / 200)}:${Math.round(z / 200)}`) % 1000) / 1000;
  const ore = clamp01(Math.abs(climate.macroElevation) / 24 + oreNoise * 0.45);
  const timber = climate.biome.id === "pine_forest" ? 1 : climate.biome.treeDensity * 0.6;
  const trade = clamp01(
    0.8 - Math.hypot(x, z - 800 * WORLD_MODEL_SCALE) / (9_000 * WORLD_MODEL_SCALE) + water * 0.35,
  );
  return { water, fertility, ore, timber, trade };
}

export function roadEndpoints(link: RoadLink) {
  const from = getSettlement(link.from);
  const to = getSettlement(link.to);
  return from && to ? { from, to } : null;
}

/**
 * Renderable road geometry, including the old service spur that connects the
 * opening relay survey to Dustmere. ROAD_LINKS remains the settlement trade
 * graph; service corridors are deliberately not counted as towns or cities.
 */
export const ROAD_CORRIDORS: readonly RoadCorridor[] = [
  ...ROAD_LINKS.flatMap((link) => {
    const endpoints = roadEndpoints(link);
    if (!endpoints) return [];
    return [
      {
        id: `${link.from}:${link.to}`,
        class: link.class,
        kind: "trade" as const,
        from: { x: endpoints.from.x, z: endpoints.from.z },
        to: { x: endpoints.to.x, z: endpoints.to.z },
        endpointPopulations: [endpoints.from.population, endpoints.to.population] as const,
      },
    ];
  }),
  {
    id: "old-relay-spur:west",
    class: "local",
    kind: "service",
    from: {
      x: getSettlement("dustmere")?.x ?? -1_575,
      z: getSettlement("dustmere")?.z ?? -1_800,
    },
    to: { x: -112, z: -118 },
    endpointPopulations: [getSettlement("dustmere")?.population ?? 1_420, 48],
  },
  {
    id: "old-relay-spur:east",
    class: "local",
    kind: "service",
    from: { x: -112, z: -118 },
    to: { x: 38, z: -52 },
    endpointPopulations: [48, 34],
  },
];
