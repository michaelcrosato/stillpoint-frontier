import {
  ALL_RECIPE_IDS,
  type RecipeId,
} from "./crafting";
import {
  createContractJournal,
  normalizeContractJournal,
  type ContractJournalState,
} from "./contracts";
import { normalizeFieldGuideEntries } from "./fieldGuide";
import { normalizeContainerStates, type ContainerStates } from "./loot";
import {
  MAX_PLACED_SERIAL,
  normalizePlacedEntities,
  type PlacedEntity,
} from "../world/deployments";

export interface FeatureProgressState {
  contractJournal: ContractJournalState;
  fieldGuideEntries: string[];
  containerStates: ContainerStates;
  placedEntities: PlacedEntity[];
  nextPlacedSerial: number;
  unlockedRecipeIds: RecipeId[];
  npcFlags: string[];
  lastRestAt: number | null;
}

const NPC_FLAG = /^npc:[a-z0-9][a-z0-9:._-]{0,103}$/i;

export function createFeatureProgress(): FeatureProgressState {
  return {
    contractJournal: createContractJournal(),
    fieldGuideEntries: [],
    containerStates: {},
    placedEntities: [],
    nextPlacedSerial: 1,
    unlockedRecipeIds: [...ALL_RECIPE_IDS],
    npcFlags: [],
    lastRestAt: null,
  };
}

export function normalizeFeatureProgress(value: unknown): FeatureProgressState {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<Record<keyof FeatureProgressState, unknown>>
    : {};
  const placedEntities = normalizePlacedEntities(source.placedEntities);
  const highestSerial = placedEntities.reduce((highest, record) => {
    const serial = Number(record.id.split(":").at(-1));
    return Number.isSafeInteger(serial) ? Math.max(highest, serial) : highest;
  }, 0);
  const requestedSerial = typeof source.nextPlacedSerial === "number" && Number.isSafeInteger(source.nextPlacedSerial)
    ? source.nextPlacedSerial
    : 1;
  const usedSerials = new Set(
    placedEntities
      .map((record) => Number(record.id.split(":").at(-1)))
      .filter(Number.isSafeInteger),
  );
  const requestedStart = Math.max(highestSerial + 1, requestedSerial, 1);
  const firstCandidate = ((requestedStart - 1) % MAX_PLACED_SERIAL) + 1;
  let nextPlacedSerial = MAX_PLACED_SERIAL + 1;
  // At most 64 records survive normalization, so a free ID must be found in
  // no more than 65 probes unless the supported ID namespace is exhausted.
  for (let offset = 0; offset <= placedEntities.length; offset += 1) {
    const candidate = ((firstCandidate - 1 + offset) % MAX_PLACED_SERIAL) + 1;
    if (!usedSerials.has(candidate)) {
      nextPlacedSerial = candidate;
      break;
    }
  }
  const rawRecipeIds = Array.isArray(source.unlockedRecipeIds)
    ? source.unlockedRecipeIds
    : null;
  const unlockedRecipeIds = rawRecipeIds
    ? [...new Set(rawRecipeIds)]
        .filter((id): id is RecipeId => typeof id === "string" && ALL_RECIPE_IDS.includes(id as RecipeId))
        .sort()
    : [...ALL_RECIPE_IDS];
  const npcFlags = Array.isArray(source.npcFlags)
    ? [...new Set(source.npcFlags)]
        .filter((flag): flag is string => typeof flag === "string" && NPC_FLAG.test(flag))
        .slice(0, 128)
        .sort()
    : [];
  return {
    contractJournal: normalizeContractJournal(source.contractJournal),
    fieldGuideEntries: normalizeFieldGuideEntries(source.fieldGuideEntries),
    containerStates: normalizeContainerStates(source.containerStates),
    placedEntities,
    nextPlacedSerial,
    unlockedRecipeIds:
      rawRecipeIds?.length === 0
        ? []
        : unlockedRecipeIds.length > 0
          ? unlockedRecipeIds
          : [...ALL_RECIPE_IDS],
    npcFlags,
    lastRestAt:
      typeof source.lastRestAt === "number" && Number.isFinite(source.lastRestAt) && source.lastRestAt >= 0
        ? Math.min(10_000_000, source.lastRestAt)
        : null,
  };
}
