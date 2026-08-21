export const ITEM_DEFINITIONS = {
  stone: { name: "Stone", shortName: "STONE" },
  wood: { name: "Timber", shortName: "WOOD" },
  fiber: { name: "Plant fiber", shortName: "FIBER" },
  ore: { name: "Raw ore", shortName: "ORE" },
  relic: { name: "Old-world salvage", shortName: "RELIC" },
} as const;

export type ItemId = keyof typeof ITEM_DEFINITIONS;
export type InventoryState = Record<ItemId, number>;

export const EMPTY_INVENTORY: InventoryState = {
  stone: 0,
  wood: 0,
  fiber: 0,
  ore: 0,
  relic: 0,
};

export function addItem(
  inventory: Readonly<InventoryState>,
  item: ItemId,
  quantity: number,
): InventoryState {
  const safeQuantity = Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 0;
  return { ...inventory, [item]: inventory[item] + safeQuantity };
}
