import { CHUNK_SIZE, WORLD_SEED, type QualityLevel } from "../config";
import { randomRange, seededRandom } from "../core/random";
import {
  ROAD_CORRIDORS,
  WATER_LEVEL,
  riverCenterX,
  riverWidth,
  settlementInfluence,
  settlementsNear,
  smoothstep,
  type RoadCorridor,
  type Settlement,
  type SettlementTier,
} from "../world/macroWorld";
import {
  ROAD_WIDTHS,
  pedestrianLanesForChunk,
  type PedestrianLane,
} from "../world/roads";
import { chunkCenter, chunkKey, sampleTerrainHeight } from "../world/terrain";

export const CITIZEN_RECIPE_VERSION = 1;
export const MAX_CITIZENS_PER_CHUNK = 215;
export const MAX_RESIDENT_CITIZENS = { cinematic: 5_000, performance: 2_200 } as const;

export type CitizenRole = "commuter" | "worker" | "trader" | "porter" | "traveler";
export type CrowdDensity = "WILDERNESS" | "QUIET" | "LOCAL" | "ACTIVE" | "BUSY" | "SURGE";
export type CitizenActivityClass = SettlementTier | "road";

export interface CitizenRecipe {
  id: string;
  laneId: string;
  source: "road" | "settlement";
  sourceId: string;
  start: { x: number; z: number };
  end: { x: number; z: number };
  roadClass?: RoadCorridor["class"];
  role: CitizenRole;
  speed: number;
  phase: number;
  height: number;
  width: number;
  depth: number;
  palette: number;
}

export interface CitizenPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const SETTLEMENT_DENSITY: Record<
  SettlementTier,
  { edge: number; core: number; medianPopulation: number }
> = {
  megacity: { edge: 32, core: 210, medianPopulation: 11_800_000 },
  city: { edge: 10, core: 86, medianPopulation: 140_000 },
  town: { edge: 1.5, core: 24, medianPopulation: 22_000 },
  village: { edge: 0.15, core: 4.2, medianPopulation: 1_400 },
};

const ROLE_SPEED: Record<CitizenRole, readonly [number, number]> = {
  commuter: [1.15, 1.68],
  worker: [0.78, 1.18],
  trader: [0.54, 0.92],
  porter: [0.68, 1.02],
  traveler: [0.95, 1.42],
};

const PALETTES = [
  0x8f5d42,
  0x52645f,
  0x6f704f,
  0x4e5d70,
  0x7b564e,
  0x8a7653,
  0x4f4c48,
  0x6f535e,
  0x476967,
  0x796b62,
  0x5b6844,
  0x62506f,
] as const;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function deterministicCount(expected: number, random: () => number) {
  const safeExpected = Math.max(0, expected);
  const whole = Math.floor(safeExpected);
  return whole + (random() < safeExpected - whole ? 1 : 0);
}

export function expectedSettlementCitizens(settlement: Settlement, influence: number) {
  const spec = SETTLEMENT_DENSITY[settlement.tier];
  const coreWeight = smoothstep(0.08, 0.95, clamp(influence, 0, 1)) ** 1.6;
  const populationFactor = clamp(
    (settlement.population / spec.medianPopulation) ** 0.25,
    0.75,
    1.3,
  );
  return (spec.edge + (spec.core - spec.edge) * coreWeight) * populationFactor;
}

function roleWeights(settlement: Settlement | null): ReadonlyArray<readonly [CitizenRole, number]> {
  if (!settlement) return [["traveler", 1]];
  const economy = settlement.economy.toLowerCase();
  const industry = /(mine|iron|machine|glass|ceramic|quarry|timber|solar)/.test(economy);
  const trade = /(trade|market|freight|shipping|caravan|warehouse|ferr)/.test(economy);
  const agriculture = /(grain|farm|wheat|orchard|goat|sheep|fish|vegetable)/.test(economy);
  return [
    ["commuter", settlement.tier === "megacity" || settlement.tier === "city" ? 4.2 : 1.4],
    ["worker", 2.2 + (industry || agriculture ? 2.8 : 0)],
    ["trader", 1.2 + (trade ? 2.6 : 0)],
    ["porter", 1 + (trade || industry ? 2.1 : 0)],
    ["traveler", settlement.tier === "village" ? 1.8 : 0.8],
  ];
}

function chooseRole(random: () => number, settlement: Settlement | null) {
  const weights = roleWeights(settlement);
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = random() * total;
  for (const [role, weight] of weights) {
    cursor -= weight;
    if (cursor <= 0) return role;
  }
  return weights.at(-1)?.[0] ?? "traveler";
}

function roadExpectedCount(corridor: RoadCorridor, centerX: number, centerZ: number) {
  const endpointDistance = Math.min(
    Math.hypot(centerX - corridor.from.x, centerZ - corridor.from.z),
    Math.hypot(centerX - corridor.to.x, centerZ - corridor.to.z),
  );
  const throughBase = corridor.class === "trunk" ? 0.12 : corridor.class === "regional" ? 0.05 : 0;
  const approach = Math.max(throughBase, Math.exp(-endpointDistance / 1_800));
  const base = corridor.class === "trunk" ? 8.5 : corridor.class === "regional" ? 4.2 : 2.15;
  const largestEndpoint = Math.max(...corridor.endpointPopulations);
  const populationFactor = clamp(Math.log10(largestEndpoint + 10) / 4.8, 0.55, 1.45);
  return base * approach * populationFactor;
}

function createRecipe(
  chunkId: string,
  sourceOrdinal: number,
  lane: PedestrianLane,
  random: () => number,
  settlement: Settlement | null,
): CitizenRecipe {
  const role = chooseRole(random, settlement);
  const speedRange = ROLE_SPEED[role];
  const roleDepth = role === "porter" ? 1.16 : role === "worker" ? 1.08 : 1;
  return {
    id: `citizen:v${CITIZEN_RECIPE_VERSION}:${chunkId}:${lane.sourceId}:${sourceOrdinal}`,
    laneId: lane.id,
    source: lane.source,
    sourceId: lane.sourceId,
    start: { ...lane.start },
    end: { ...lane.end },
    roadClass: lane.roadClass,
    role,
    speed: randomRange(random, speedRange[0], speedRange[1]),
    phase: random(),
    height: randomRange(random, 1.52, 1.96),
    width: randomRange(random, 0.82, 1.16),
    depth: randomRange(random, 0.86, 1.12) * roleDepth,
    palette: PALETTES[Math.floor(random() * PALETTES.length)] ?? PALETTES[0],
  };
}

function recipesForLanes(
  chunkId: string,
  lanes: readonly PedestrianLane[],
  count: number,
  namespace: string,
  settlement: Settlement | null,
) {
  if (lanes.length === 0 || count <= 0) return [];
  const random = seededRandom(`${WORLD_SEED}:citizens:v${CITIZEN_RECIPE_VERSION}:${chunkId}:${namespace}`);
  const offset = Math.floor(random() * lanes.length);
  const recipes: CitizenRecipe[] = [];
  for (let index = 0; index < count; index += 1) {
    const lane = lanes[(offset + index) % lanes.length];
    recipes.push(createRecipe(chunkId, index, lane, random, settlement));
  }
  return recipes;
}

export function generateCitizenChunk(chunkX: number, chunkZ: number): CitizenRecipe[] {
  const id = chunkKey(chunkX, chunkZ);
  const center = chunkCenter({ x: chunkX, z: chunkZ });
  const lanes = pedestrianLanesForChunk(chunkX, chunkZ);
  const settlementLanes = lanes.filter((lane) => lane.source === "settlement");
  if (settlementLanes.length > 0) {
    const nearby = settlementsNear(center.x, center.z, CHUNK_SIZE).filter((settlement) =>
      settlementLanes.some((lane) => lane.settlementId === settlement.id),
    );
    const settlement = nearby.reduce<Settlement | null>((best, candidate) => {
      if (!best) return candidate;
      return settlementInfluence(candidate, center.x, center.z) >
        settlementInfluence(best, center.x, center.z)
        ? candidate
        : best;
    }, null);
    if (settlement) {
      const random = seededRandom(`${WORLD_SEED}:citizens:v${CITIZEN_RECIPE_VERSION}:${id}:budget`);
      const count = Math.min(
        MAX_CITIZENS_PER_CHUNK,
        deterministicCount(
          expectedSettlementCitizens(
            settlement,
            settlementInfluence(settlement, center.x, center.z),
          ),
          random,
        ),
      );
      const eligible = settlementLanes.filter((lane) => lane.settlementId === settlement.id);
      return recipesForLanes(id, eligible, count, `settlement:${settlement.id}`, settlement);
    }
  }

  const corridorById = new Map(ROAD_CORRIDORS.map((corridor) => [corridor.id, corridor]));
  const roadLanesByCorridor = new Map<string, PedestrianLane[]>();
  for (const lane of lanes) {
    if (lane.source !== "road" || !lane.corridorId) continue;
    const existing = roadLanesByCorridor.get(lane.corridorId) ?? [];
    existing.push(lane);
    roadLanesByCorridor.set(lane.corridorId, existing);
  }

  const recipes: CitizenRecipe[] = [];
  for (const [corridorId, corridorLanes] of [...roadLanesByCorridor].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const corridor = corridorById.get(corridorId);
    if (!corridor) continue;
    const random = seededRandom(
      `${WORLD_SEED}:citizens:v${CITIZEN_RECIPE_VERSION}:${id}:road-budget:${corridorId}`,
    );
    const count = deterministicCount(roadExpectedCount(corridor, center.x, center.z), random);
    recipes.push(...recipesForLanes(id, corridorLanes, count, `road:${corridorId}`, null));
  }
  return recipes.slice(0, MAX_CITIZENS_PER_CHUNK);
}

export function visibleCitizenCount(count: number, quality: QualityLevel) {
  if (count <= 0) return 0;
  const multiplier = quality === "cinematic" ? 0.92 : 0.4;
  return Math.min(count, Math.max(1, Math.round(count * multiplier)));
}

const NIGHT_ACTIVITY_FLOOR: Record<CitizenActivityClass, number> = {
  megacity: 0.18,
  city: 0.12,
  town: 0.07,
  village: 0.03,
  road: 0.05,
};

const DAILY_ACTIVITY_ANCHORS = [
  { minute: 0, demand: 0.08 },
  { minute: 180, demand: 0 },
  { minute: 360, demand: 0.12 },
  { minute: 480, demand: 0.58 },
  { minute: 720, demand: 1 },
  { minute: 1_020, demand: 0.9 },
  { minute: 1_200, demand: 0.62 },
  { minute: 1_380, demand: 0.18 },
  { minute: 1_440, demand: 0.08 },
] as const;

export function citizenActivityMultiplier(
  totalWorldMinutes: number,
  activityClass: CitizenActivityClass,
) {
  const safeMinutes = Number.isFinite(totalWorldMinutes) ? totalWorldMinutes : 720;
  const minuteOfDay = ((safeMinutes % 1_440) + 1_440) % 1_440;
  let left: { minute: number; demand: number } = DAILY_ACTIVITY_ANCHORS[0];
  let right: { minute: number; demand: number } = DAILY_ACTIVITY_ANCHORS[1];
  for (let index = 1; index < DAILY_ACTIVITY_ANCHORS.length; index += 1) {
    right = DAILY_ACTIVITY_ANCHORS[index];
    if (minuteOfDay <= right.minute) break;
    left = right;
  }
  const progress =
    right.minute === left.minute
      ? 0
      : (minuteOfDay - left.minute) / (right.minute - left.minute);
  const eased = smoothstep(0, 1, progress);
  const demand = left.demand + (right.demand - left.demand) * eased;
  const floor = NIGHT_ACTIVITY_FLOOR[activityClass];
  return floor + (1 - floor) * demand;
}

export function scheduledVisibleCitizenCount(
  count: number,
  quality: QualityLevel,
  totalWorldMinutes: number,
  activityClass: CitizenActivityClass,
) {
  const daytimeVisible = visibleCitizenCount(count, quality);
  if (daytimeVisible <= 0) return 0;
  return Math.min(
    count,
    Math.max(
      0,
      Math.round(
        daytimeVisible * citizenActivityMultiplier(totalWorldMinutes, activityClass),
      ),
    ),
  );
}

export function crowdDensityForCount(count: number): CrowdDensity {
  if (count <= 0) return "WILDERNESS";
  if (count <= 14) return "QUIET";
  if (count <= 120) return "LOCAL";
  if (count <= 700) return "ACTIVE";
  if (count <= 2_400) return "BUSY";
  return "SURGE";
}

export function sampleCitizenPose(recipe: CitizenRecipe, elapsedSeconds: number): CitizenPose {
  const safeTime = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
  const dx = recipe.end.x - recipe.start.x;
  const dz = recipe.end.z - recipe.start.z;
  const length = Math.max(0.001, Math.hypot(dx, dz));
  const rawCycle = recipe.phase + (safeTime * recipe.speed) / (length * 2);
  const cycle = ((rawCycle % 1) + 1) % 1;
  const forward = cycle < 0.5;
  const amount = forward ? cycle * 2 : (1 - cycle) * 2;
  const x = recipe.start.x + dx * amount;
  const z = recipe.start.z + dz * amount;
  const roadWidth = recipe.roadClass ? ROAD_WIDTHS[recipe.roadClass] : 0;
  const onBridge =
    recipe.source === "road" &&
    Math.abs(x - riverCenterX(z)) < riverWidth(z) + roadWidth;
  const y = onBridge ? WATER_LEVEL + 0.39 : sampleTerrainHeight(x, z) + 0.03;
  const baseYaw = Math.atan2(dx, dz);
  return { x, y, z, yaw: forward ? baseYaw : baseYaw + Math.PI };
}
