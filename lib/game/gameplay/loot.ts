import { WORLD_SEED } from "../config";
import { randomRange, seededRandom } from "../core/random";
import {
  ITEM_DEFINITIONS,
  addItem,
  type InventoryState,
  type ItemId,
} from "./items";

export type LootTableId = "field_supplies" | "tower_service";

interface LootRollDefinition {
  item: ItemId;
  chance: number;
  minimum: number;
  maximum: number;
}

export const LOOT_TABLES: Readonly<Record<LootTableId, readonly LootRollDefinition[]>> = {
  field_supplies: [
    { item: "fiber", chance: 1, minimum: 1, maximum: 3 },
    { item: "wood", chance: 0.8, minimum: 1, maximum: 2 },
    { item: "stone", chance: 0.55, minimum: 1, maximum: 2 },
    { item: "first_aid_kit", chance: 0.28, minimum: 1, maximum: 1 },
  ],
  tower_service: [
    { item: "relic", chance: 1, minimum: 1, maximum: 2 },
    { item: "ore", chance: 0.82, minimum: 1, maximum: 3 },
    { item: "fiber", chance: 0.5, minimum: 1, maximum: 2 },
    { item: "field_torch", chance: 0.45, minimum: 1, maximum: 1 },
  ],
};

export interface ContainerState {
  opened: boolean;
  /** Durable evidence that at least one item has ever been recovered. */
  looted: boolean;
  remaining: Partial<Record<ItemId, number>>;
}

export type ContainerStates = Record<string, ContainerState>;

const CONTAINER_ID = /^container:[a-z0-9][a-z0-9:._-]{0,103}$/i;

export function createContainerContents(containerId: string, tableId: LootTableId) {
  const random = seededRandom(`${WORLD_SEED}:loot:v1:${tableId}:${containerId}`);
  const contents: Partial<Record<ItemId, number>> = {};
  for (const roll of LOOT_TABLES[tableId]) {
    if (random() > roll.chance) continue;
    const quantity = Math.floor(randomRange(random, roll.minimum, roll.maximum + 0.999999));
    if (quantity > 0) contents[roll.item] = quantity;
  }
  return contents;
}

export function ensureContainerState(
  states: Readonly<ContainerStates>,
  containerId: string,
  tableId: LootTableId,
) {
  const existing = states[containerId];
  if (existing) {
    return {
      states: { ...states },
      state: {
        opened: true,
        looted: existing.looted,
        remaining: { ...existing.remaining },
      },
    };
  }
  const state: ContainerState = {
    opened: true,
    looted: false,
    remaining: createContainerContents(containerId, tableId),
  };
  return { states: { ...states, [containerId]: state }, state };
}

export function containerItemCount(state: Readonly<ContainerState> | null | undefined) {
  if (!state) return 0;
  return Object.values(state.remaining).reduce((total, quantity) => total + (quantity ?? 0), 0);
}

export function takeContainerItem(
  inventory: Readonly<InventoryState>,
  states: Readonly<ContainerStates>,
  containerId: string,
  item: ItemId,
  requestedQuantity: number,
) {
  const state = states[containerId];
  const available = state?.remaining[item] ?? 0;
  const capacity = ITEM_DEFINITIONS[item].stackLimit - inventory[item];
  const quantity = Math.min(
    available,
    capacity,
    Number.isFinite(requestedQuantity) ? Math.max(0, Math.floor(requestedQuantity)) : 0,
  );
  if (!state || quantity <= 0) {
    return { inventory: { ...inventory }, states: { ...states }, quantity: 0 };
  }
  const remaining = { ...state.remaining, [item]: available - quantity };
  if (remaining[item] === 0) delete remaining[item];
  return {
    inventory: addItem(inventory, item, quantity),
    states: {
      ...states,
      [containerId]: { opened: true, looted: true, remaining },
    },
    quantity,
  };
}

export function takeAllContainerItems(
  inventory: Readonly<InventoryState>,
  states: Readonly<ContainerStates>,
  containerId: string,
) {
  let nextInventory = { ...inventory };
  let nextStates = { ...states };
  let quantity = 0;
  for (const item of Object.keys(ITEM_DEFINITIONS) as ItemId[]) {
    const outcome = takeContainerItem(
      nextInventory,
      nextStates,
      containerId,
      item,
      nextStates[containerId]?.remaining[item] ?? 0,
    );
    nextInventory = outcome.inventory;
    nextStates = outcome.states;
    quantity += outcome.quantity;
  }
  return { inventory: nextInventory, states: nextStates, quantity };
}

export function normalizeContainerStates(value: unknown): ContainerStates {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const states: ContainerStates = {};
  let accepted = 0;
  for (const [containerId, raw] of Object.entries(value)) {
    if (accepted >= 512 || !CONTAINER_ID.test(containerId) || !raw || typeof raw !== "object") continue;
    const source = raw as { opened?: unknown; looted?: unknown; remaining?: unknown };
    if (source.opened !== true || !source.remaining || typeof source.remaining !== "object") continue;
    const remaining: Partial<Record<ItemId, number>> = {};
    for (const [item, amount] of Object.entries(source.remaining)) {
      if (!(item in ITEM_DEFINITIONS) || !Number.isSafeInteger(amount) || (amount as number) <= 0) continue;
      remaining[item as ItemId] = Math.min(
        ITEM_DEFINITIONS[item as ItemId].stackLimit,
        amount as number,
      );
    }
    states[containerId] = {
      opened: true,
      looted: source.looted === true,
      remaining,
    };
    accepted += 1;
  }
  return states;
}
