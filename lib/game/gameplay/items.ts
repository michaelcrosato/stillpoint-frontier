export type ItemUseKind =
  | "heal"
  | "deploy_bedroll"
  | "deploy_campfire"
  | "deploy_marker"
  | "deploy_shelter"
  | "deploy_torch";

export const ITEM_DEFINITIONS = {
  stone: {
    name: "Stone",
    shortName: "STONE",
    category: "MINERAL",
    unitWeight: 2.4,
    stackLimit: 999,
    description: "Structural fragments suitable for masonry and aggregate.",
  },
  wood: {
    name: "Timber",
    shortName: "WOOD",
    category: "ORGANIC",
    unitWeight: 1.8,
    stackLimit: 999,
    description: "Worked lengths cut from harvestable trees.",
  },
  fiber: {
    name: "Plant fiber",
    shortName: "FIBER",
    category: "ORGANIC",
    unitWeight: 0.35,
    stackLimit: 999,
    description: "Dry stems and resilient strands for cordage and textiles.",
  },
  ore: {
    name: "Raw ore",
    shortName: "ORE",
    category: "MINERAL",
    unitWeight: 3.1,
    stackLimit: 999,
    description: "Unrefined mineral-bearing rock reserved for future smelting.",
  },
  relic: {
    name: "Old-world salvage",
    shortName: "RELIC",
    category: "SALVAGE",
    unitWeight: 0.9,
    stackLimit: 999,
    description: "Recoverable mechanisms and fragments from before the migration.",
  },
  first_aid_kit: {
    name: "First-aid kit",
    shortName: "MEDKIT",
    category: "FIELD GEAR",
    unitWeight: 0.8,
    stackLimit: 12,
    useKind: "heal" as ItemUseKind,
    description: "A sealed field dressing that restores 35 health when injured.",
  },
  bedroll: {
    name: "Survey bedroll",
    shortName: "BEDROLL",
    category: "CAMP",
    unitWeight: 2.2,
    stackLimit: 8,
    useKind: "deploy_bedroll" as ItemUseKind,
    description: "A compact rest site that can be deployed on clear ground.",
  },
  campfire_kit: {
    name: "Campfire kit",
    shortName: "FIRE",
    category: "CAMP",
    unitWeight: 2.8,
    stackLimit: 8,
    useKind: "deploy_campfire" as ItemUseKind,
    description: "A contained heat source that improves nearby wilderness rest.",
  },
  survey_marker: {
    name: "Survey marker",
    shortName: "MARKER",
    category: "FIELD GEAR",
    unitWeight: 1.1,
    stackLimit: 16,
    useKind: "deploy_marker" as ItemUseKind,
    description: "A persistent field stake that registers as a navigation target.",
  },
  weather_shelter: {
    name: "Weather shelter",
    shortName: "SHELTER",
    category: "CAMP",
    unitWeight: 5.4,
    stackLimit: 4,
    useKind: "deploy_shelter" as ItemUseKind,
    description: "A low-profile rain fly that shelters nearby bedrolls.",
  },
  field_torch: {
    name: "Field torch",
    shortName: "TORCH",
    category: "FIELD GEAR",
    unitWeight: 0.7,
    stackLimit: 12,
    useKind: "deploy_torch" as ItemUseKind,
    description: "A persistent low-energy path light for camps and survey routes.",
  },
} as const;

export type ItemId = keyof typeof ITEM_DEFINITIONS;
export type InventoryState = Record<ItemId, number>;

export const BASE_MATERIAL_ITEMS = ["stone", "wood", "fiber", "ore", "relic"] as const;

export function createEmptyInventory(): InventoryState {
  return Object.fromEntries(
    (Object.keys(ITEM_DEFINITIONS) as ItemId[]).map((item) => [item, 0]),
  ) as InventoryState;
}

export const EMPTY_INVENTORY: InventoryState = createEmptyInventory();

function safeQuantity(quantity: number) {
  return Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 0;
}

export function addItem(
  inventory: Readonly<InventoryState>,
  item: ItemId,
  quantity: number,
): InventoryState {
  const definition = ITEM_DEFINITIONS[item];
  return {
    ...inventory,
    [item]: Math.min(definition.stackLimit, inventory[item] + safeQuantity(quantity)),
  };
}

export function removeItem(
  inventory: Readonly<InventoryState>,
  item: ItemId,
  quantity: number,
): InventoryState | null {
  const amount = safeQuantity(quantity);
  if (amount <= 0 || inventory[item] < amount) return null;
  return { ...inventory, [item]: inventory[item] - amount };
}

export function applyInventoryDelta(
  inventory: Readonly<InventoryState>,
  delta: Readonly<Partial<Record<ItemId, number>>>,
): InventoryState | null {
  const next = { ...inventory };
  for (const item of Object.keys(ITEM_DEFINITIONS) as ItemId[]) {
    const change = delta[item] ?? 0;
    if (!Number.isFinite(change) || !Number.isInteger(change)) return null;
    const quantity = next[item] + change;
    if (quantity < 0 || quantity > ITEM_DEFINITIONS[item].stackLimit) return null;
    next[item] = quantity;
  }
  return next;
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

export function itemUseKind(item: ItemId): ItemUseKind | null {
  const definition = ITEM_DEFINITIONS[item] as (typeof ITEM_DEFINITIONS)[ItemId] & {
    useKind?: ItemUseKind;
  };
  return definition.useKind ?? null;
}
