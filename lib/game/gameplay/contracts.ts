import type { GameplayEvent } from "./events";
import { fieldGuideEntry } from "./fieldGuide";
import type { ItemId } from "./items";
import { MAX_WORLD_MINUTES } from "../environment/model";

export type ContractObjectiveMatcher =
  | { type: "inspect"; targetId: string }
  | { type: "collect"; item: ItemId }
  | { type: "scan"; entryId?: string; category?: "fauna" | "flora" | "resource" | "landmark" }
  | { type: "craft"; recipeId: string }
  | { type: "place"; archetypeId: string }
  | { type: "rest" }
  | { type: "loot"; containerId: string }
  | { type: "return"; npcId: string };

export interface ContractObjectiveDefinition {
  id: string;
  label: string;
  amount: number;
  matcher: ContractObjectiveMatcher;
  target?: { x: number; z: number };
}

export interface ContractDefinition {
  id: string;
  code: string;
  title: string;
  summary: string;
  issuerNpcId: string;
  objectives: readonly ContractObjectiveDefinition[];
  rewards: Readonly<Partial<Record<ItemId, number>>>;
}

export const CONTRACT_DEFINITIONS = [
  {
    id: "contract:field-calibration:v1",
    code: "FC-01",
    title: "Field calibration",
    summary: "Validate the compound workflow before taking remote assignments.",
    issuerNpcId: "npc:mara-venn:v1",
    objectives: [
      {
        id: "inspect-orders",
        label: "Read the Field Unit standing orders",
        amount: 1,
        matcher: { type: "inspect", targetId: "inspectable:field-unit-noticeboard" },
        target: { x: 3, z: 4.5 },
      },
      {
        id: "collect-fiber",
        label: "Collect 2 plant fiber",
        amount: 2,
        matcher: { type: "collect", item: "fiber" },
        target: { x: 2.3, z: 5.4 },
      },
      {
        id: "scan-mast",
        label: "Hold the scanner on the weather mast",
        amount: 1,
        matcher: { type: "scan", entryId: "guide:landmark:field-unit-weather-mast:v1" },
        target: { x: -1.8, z: 3.4 },
      },
      {
        id: "return-mara",
        label: "Return to Coordinator Mara Venn",
        amount: 1,
        matcher: { type: "return", npcId: "npc:mara-venn:v1" },
        target: { x: 5.5, z: 5.5 },
      },
    ],
    rewards: { first_aid_kit: 1 },
  },
  {
    id: "contract:shelter-protocol:v1",
    code: "SP-02",
    title: "Shelter protocol",
    summary: "Fabricate and prove a minimal field camp before extended travel.",
    issuerNpcId: "npc:mara-venn:v1",
    objectives: [
      {
        id: "craft-bedroll",
        label: "Craft a survey bedroll",
        amount: 1,
        matcher: { type: "craft", recipeId: "recipe:bedroll:v1" },
        target: { x: 12, z: -6 },
      },
      {
        id: "place-bedroll",
        label: "Deploy the bedroll on clear ground",
        amount: 1,
        matcher: { type: "place", archetypeId: "bedroll" },
      },
      {
        id: "rest-field",
        label: "Complete at least one hour of field rest",
        amount: 60,
        matcher: { type: "rest" },
      },
      {
        id: "return-mara",
        label: "Report the camp result to Mara",
        amount: 1,
        matcher: { type: "return", npcId: "npc:mara-venn:v1" },
        target: { x: 5.5, z: 5.5 },
      },
    ],
    rewards: { weather_shelter: 1 },
  },
  {
    id: "contract:meridian-stores:v1",
    code: "MS-03",
    title: "Meridian stores",
    summary: "Audit the tower service cache and add a live fauna record.",
    issuerNpcId: "npc:mara-venn:v1",
    objectives: [
      {
        id: "inspect-directory",
        label: "Read the Meridian Tower directory",
        amount: 1,
        matcher: { type: "inspect", targetId: "inspectable:meridian-tower-directory" },
        target: { x: 4, z: 27.6 },
      },
      {
        id: "loot-service-cache",
        label: "Recover the tower service cache",
        amount: 1,
        matcher: { type: "loot", containerId: "container:meridian-tower:service-a" },
        target: { x: 3.05, z: 31.5 },
      },
      {
        id: "scan-fauna",
        label: "Catalog any regional animal",
        amount: 1,
        matcher: { type: "scan", category: "fauna" },
      },
      {
        id: "return-mara",
        label: "Return the audit to Mara",
        amount: 1,
        matcher: { type: "return", npcId: "npc:mara-venn:v1" },
        target: { x: 5.5, z: 5.5 },
      },
    ],
    rewards: { relic: 2, field_torch: 1 },
  },
] as const satisfies readonly ContractDefinition[];

export type ContractId = (typeof CONTRACT_DEFINITIONS)[number]["id"];
export type ContractStatus = "active" | "ready" | "completed";

export interface ContractProgress {
  status: ContractStatus;
  acceptedAt: number;
  completedAt: number | null;
  objectiveProgress: Record<string, number>;
}

export type ContractJournal = Partial<Record<ContractId, ContractProgress>>;

export interface ContractJournalState {
  contracts: ContractJournal;
  activeContractId: ContractId | null;
}

export function contractById(id: string) {
  return CONTRACT_DEFINITIONS.find((contract) => contract.id === id) ?? null;
}

export function createContractJournal(): ContractJournalState {
  return { contracts: {}, activeContractId: null };
}

export function acceptContract(
  state: Readonly<ContractJournalState>,
  contractId: string,
  worldMinutes: number,
): ContractJournalState {
  const definition = contractById(contractId);
  if (!definition || state.contracts[definition.id]) {
    return { contracts: { ...state.contracts }, activeContractId: state.activeContractId };
  }
  return {
    contracts: {
      ...state.contracts,
      [definition.id]: {
        status: "active",
        acceptedAt: normalizeContractTimestamp(worldMinutes),
        completedAt: null,
        objectiveProgress: {},
      },
    },
    activeContractId: definition.id,
  };
}

function normalizeContractTimestamp(value: number, fallback = 0) {
  return Number.isFinite(value)
    ? Math.min(MAX_WORLD_MINUTES, Math.max(0, value))
    : fallback;
}

export function currentContractObjective(
  definition: Readonly<ContractDefinition>,
  progress: Readonly<ContractProgress>,
) {
  return definition.objectives.find(
    (objective) => (progress.objectiveProgress[objective.id] ?? 0) < objective.amount,
  ) ?? null;
}

function eventAmount(matcher: ContractObjectiveMatcher, event: GameplayEvent) {
  if (matcher.type === "inspect" && event.type === "object.inspected") {
    return event.targetId === matcher.targetId ? 1 : 0;
  }
  if (matcher.type === "collect" && event.type === "item.collected") {
    return event.item === matcher.item ? Math.max(0, event.quantity) : 0;
  }
  if (matcher.type === "scan" && event.type === "subject.scanned") {
    if (matcher.entryId) return event.entryId === matcher.entryId ? 1 : 0;
    const entry = fieldGuideEntry(event.entryId);
    return entry && entry.category === matcher.category ? 1 : 0;
  }
  if (matcher.type === "craft" && event.type === "item.crafted") {
    return event.recipeId === matcher.recipeId ? Math.max(0, event.quantity) : 0;
  }
  if (matcher.type === "place" && event.type === "structure.placed") {
    return event.archetypeId === matcher.archetypeId ? 1 : 0;
  }
  if (matcher.type === "rest" && event.type === "rest.completed") {
    return Math.max(0, event.minutes);
  }
  if (matcher.type === "loot" && event.type === "container.looted") {
    return event.containerId === matcher.containerId && event.quantity > 0 ? 1 : 0;
  }
  if (matcher.type === "return" && event.type === "npc.talked") {
    return event.npcId === matcher.npcId ? 1 : 0;
  }
  return 0;
}

export function progressContracts(
  state: Readonly<ContractJournalState>,
  event: GameplayEvent,
): ContractJournalState {
  let changed = false;
  const contracts: ContractJournal = { ...state.contracts };
  for (const definition of CONTRACT_DEFINITIONS) {
    const progress = contracts[definition.id];
    if (!progress || progress.status !== "active") continue;
    const objective = currentContractObjective(definition, progress);
    if (!objective) continue;
    const amount = eventAmount(objective.matcher, event);
    if (amount <= 0) continue;
    const objectiveProgress = {
      ...progress.objectiveProgress,
      [objective.id]: Math.min(
        objective.amount,
        (progress.objectiveProgress[objective.id] ?? 0) + amount,
      ),
    };
    const nextProgress: ContractProgress = { ...progress, objectiveProgress };
    if (!currentContractObjective(definition, nextProgress)) nextProgress.status = "ready";
    contracts[definition.id] = nextProgress;
    changed = true;
  }
  return changed
    ? { contracts, activeContractId: state.activeContractId }
    : { contracts: { ...state.contracts }, activeContractId: state.activeContractId };
}

export function turnInContract(
  state: Readonly<ContractJournalState>,
  contractId: string,
  worldMinutes: number,
) {
  const definition = contractById(contractId);
  const progress = definition ? state.contracts[definition.id] : null;
  if (!definition || !progress || progress.status !== "ready") {
    return { state: { contracts: { ...state.contracts }, activeContractId: state.activeContractId }, rewards: null };
  }
  const contracts = {
    ...state.contracts,
    [definition.id]: {
      ...progress,
      status: "completed" as const,
      completedAt: normalizeContractTimestamp(worldMinutes, progress.acceptedAt),
    },
  };
  const nextActive = state.activeContractId === definition.id
    ? CONTRACT_DEFINITIONS.find((candidate) => {
        const status = contracts[candidate.id]?.status;
        return status === "active" || status === "ready";
      })?.id ?? null
    : state.activeContractId;
  return {
    state: { contracts, activeContractId: nextActive },
    rewards: { ...definition.rewards },
  };
}

export function normalizeContractJournal(value: unknown): ContractJournalState {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as { contracts?: unknown; activeContractId?: unknown }
    : {};
  const rawContracts = source.contracts && typeof source.contracts === "object"
    ? source.contracts as Record<string, unknown>
    : {};
  const contracts: ContractJournal = {};
  for (const definition of CONTRACT_DEFINITIONS) {
    const raw = rawContracts[definition.id];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const candidate = raw as Partial<ContractProgress>;
    const objectiveProgress: Record<string, number> = {};
    const rawProgress = candidate.objectiveProgress && typeof candidate.objectiveProgress === "object"
      ? candidate.objectiveProgress
      : {};
    for (const objective of definition.objectives) {
      const count = (rawProgress as Record<string, unknown>)[objective.id];
      if (typeof count === "number" && Number.isFinite(count) && count > 0) {
        objectiveProgress[objective.id] = Math.min(objective.amount, Math.floor(count));
      }
    }
    const complete = definition.objectives.every(
      (objective) => (objectiveProgress[objective.id] ?? 0) >= objective.amount,
    );
    const requestedStatus = candidate.status;
    const status: ContractStatus = requestedStatus === "completed" && complete
      ? "completed"
      : complete
        ? "ready"
        : "active";
    const acceptedAt = normalizeContractTimestamp(
      typeof candidate.acceptedAt === "number" ? candidate.acceptedAt : Number.NaN,
    );
    contracts[definition.id] = {
      status,
      acceptedAt,
      completedAt:
        status === "completed" && typeof candidate.completedAt === "number" && Number.isFinite(candidate.completedAt)
          ? Math.max(acceptedAt, normalizeContractTimestamp(candidate.completedAt, acceptedAt))
          : null,
      objectiveProgress,
    };
  }
  const requestedActive = source.activeContractId;
  const requestedProgress = typeof requestedActive === "string"
    ? contracts[requestedActive as ContractId]
    : null;
  const activeContractId = requestedProgress && requestedProgress.status !== "completed"
    ? requestedActive as ContractId
    : CONTRACT_DEFINITIONS.find((definition) => {
        const status = contracts[definition.id]?.status;
        return status === "active" || status === "ready";
      })?.id ?? null;
  return { contracts, activeContractId };
}
