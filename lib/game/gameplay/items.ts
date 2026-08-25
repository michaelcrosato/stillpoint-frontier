export const ITEM_DEFINITIONS = {
  stone: {
    name: "Stone",
    shortName: "STONE",
    category: "MINERAL",
    unitWeight: 2.4,
    description: "Structural fragments suitable for masonry and aggregate.",
  },
  wood: {
    name: "Timber",
    shortName: "WOOD",
    category: "ORGANIC",
    unitWeight: 1.8,
    description: "Worked lengths cut from harvestable trees.",
  },
  fiber: {
    name: "Plant fiber",
    shortName: "FIBER",
    category: "ORGANIC",
    unitWeight: 0.35,
    description: "Dry stems and resilient strands for cordage and textiles.",
  },
  ore: {
    name: "Raw ore",
    shortName: "ORE",
    category: "MINERAL",
    unitWeight: 3.1,
    description: "Unrefined mineral-bearing rock reserved for future smelting.",
  },
  relic: {
    name: "Old-world salvage",
    shortName: "RELIC",
    category: "SALVAGE",
    unitWeight: 0.9,
    description: "Recoverable mechanisms and fragments from before the migration.",
  },
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

export function inventoryWeight(inventory: Readonly<InventoryState>) {
  return (Object.keys(ITEM_DEFINITIONS) as ItemId[]).reduce(
    (total, item) => total + inventory[item] * ITEM_DEFINITIONS[item].unitWeight,
    0,
  );
}

export function inventoryItemCount(inventory: Readonly<InventoryState>) {
  return (Object.keys(ITEM_DEFINITIONS) as ItemId[]).reduce(
    (total, item) => total + inventory[item],
    0,
  );
}
