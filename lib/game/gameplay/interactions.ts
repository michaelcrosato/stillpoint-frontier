import type { ItemId, InventoryState } from "./items";
import { addItem } from "./items";

export interface EntityDiff {
  hits: number;
  removed: boolean;
}

export interface InteractionState {
  inventory: InventoryState;
  worldDiffs: Record<string, EntityDiff>;
}

export interface GatherTarget {
  id: string;
  action: "collect" | "harvest";
  item: ItemId;
  yieldAmount: number;
  hitsRequired: number;
}

export interface GatherOutcome {
  state: InteractionState;
  result: "hit" | "collected" | "depleted" | "unchanged";
  remainingHits: number;
  loot: { item: ItemId; quantity: number } | null;
}

/** Pure, idempotent gameplay reducer. Loot is granted only when an entity is removed. */
export function applyGather(
  state: Readonly<InteractionState>,
  target: Readonly<GatherTarget>,
): GatherOutcome {
  const current = state.worldDiffs[target.id] ?? { hits: 0, removed: false };
  if (current.removed) {
    return { state: { ...state }, result: "unchanged", remainingHits: 0, loot: null };
  }

  const required = Math.max(1, Math.floor(target.hitsRequired));
  const nextHits = target.action === "collect" ? required : Math.min(required, current.hits + 1);
  const removed = nextHits >= required;
  const nextDiff = { hits: nextHits, removed };
  const nextWorldDiffs = { ...state.worldDiffs, [target.id]: nextDiff };
  if (!removed) {
    return {
      state: { inventory: { ...state.inventory }, worldDiffs: nextWorldDiffs },
      result: "hit",
      remainingHits: required - nextHits,
      loot: null,
    };
  }

  const quantity = Math.max(0, Math.floor(target.yieldAmount));
  return {
    state: {
      inventory: addItem(state.inventory, target.item, quantity),
      worldDiffs: nextWorldDiffs,
    },
    result: target.action === "collect" ? "collected" : "depleted",
    remainingHits: 0,
    loot: { item: target.item, quantity },
  };
}
