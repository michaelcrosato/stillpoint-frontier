import {
  ITEM_DEFINITIONS,
  applyInventoryDelta,
  type InventoryState,
  type ItemId,
} from "./items";

export type CraftingStationKind = "field" | "workbench";

export const RECIPE_DEFINITIONS = {
  bedroll: {
    id: "recipe:bedroll:v1",
    label: "Survey bedroll",
    description: "Deploys a reusable wilderness rest site.",
    station: "field",
    ingredients: { fiber: 3 },
    output: { item: "bedroll", quantity: 1 },
  },
  campfire_kit: {
    id: "recipe:campfire-kit:v1",
    label: "Campfire kit",
    description: "Adds warmth to nearby rest sites.",
    station: "field",
    ingredients: { wood: 2, stone: 2 },
    output: { item: "campfire_kit", quantity: 1 },
  },
  survey_marker: {
    id: "recipe:survey-marker:v1",
    label: "Survey marker",
    description: "Creates a persistent navigation stake.",
    station: "field",
    ingredients: { wood: 1, stone: 1 },
    output: { item: "survey_marker", quantity: 1 },
  },
  first_aid_kit: {
    id: "recipe:first-aid-kit:v1",
    label: "First-aid kit",
    description: "Restores 35 health when used.",
    station: "workbench",
    ingredients: { fiber: 2, relic: 1 },
    output: { item: "first_aid_kit", quantity: 1 },
  },
  weather_shelter: {
    id: "recipe:weather-shelter:v1",
    label: "Weather shelter",
    description: "Shelters a nearby bedroll from precipitation.",
    station: "workbench",
    ingredients: { wood: 3, fiber: 4 },
    output: { item: "weather_shelter", quantity: 1 },
  },
  field_torch: {
    id: "recipe:field-torch:v1",
    label: "Field torch",
    description: "Marks a route with a persistent emissive light.",
    station: "workbench",
    ingredients: { wood: 1, fiber: 1, relic: 1 },
    output: { item: "field_torch", quantity: 1 },
  },
} as const;

export type RecipeKey = keyof typeof RECIPE_DEFINITIONS;
export type RecipeId = (typeof RECIPE_DEFINITIONS)[RecipeKey]["id"];

export const ALL_RECIPE_IDS = Object.values(RECIPE_DEFINITIONS).map(
  (recipe) => recipe.id,
) as RecipeId[];

export function recipeById(id: string) {
  return Object.values(RECIPE_DEFINITIONS).find((recipe) => recipe.id === id) ?? null;
}

export function canUseStation(
  required: CraftingStationKind,
  available: CraftingStationKind,
) {
  return required === "field" || available === "workbench";
}

export interface CraftingOutcome {
  result: "crafted" | "unknown_recipe" | "locked" | "wrong_station" | "missing_items";
  inventory: InventoryState;
  item: ItemId | null;
  quantity: number;
}

export function craftRecipe(
  inventory: Readonly<InventoryState>,
  recipeId: string,
  station: CraftingStationKind,
  unlockedRecipeIds: readonly string[],
): CraftingOutcome {
  const recipe = recipeById(recipeId);
  if (!recipe) {
    return { result: "unknown_recipe", inventory: { ...inventory }, item: null, quantity: 0 };
  }
  if (!unlockedRecipeIds.includes(recipe.id)) {
    return { result: "locked", inventory: { ...inventory }, item: null, quantity: 0 };
  }
  if (!canUseStation(recipe.station, station)) {
    return { result: "wrong_station", inventory: { ...inventory }, item: null, quantity: 0 };
  }
  const delta: Partial<Record<ItemId, number>> = {};
  for (const [item, quantity] of Object.entries(recipe.ingredients)) {
    delta[item as ItemId] = -(quantity as number);
  }
  const outputItem = recipe.output.item as ItemId;
  delta[outputItem] = (delta[outputItem] ?? 0) + recipe.output.quantity;
  const next = applyInventoryDelta(inventory, delta);
  if (!next) {
    return { result: "missing_items", inventory: { ...inventory }, item: null, quantity: 0 };
  }
  if (next[outputItem] > ITEM_DEFINITIONS[outputItem].stackLimit) {
    return { result: "missing_items", inventory: { ...inventory }, item: null, quantity: 0 };
  }
  return {
    result: "crafted",
    inventory: next,
    item: outputItem,
    quantity: recipe.output.quantity,
  };
}

export function recipeMissingItems(
  inventory: Readonly<InventoryState>,
  recipeId: string,
) {
  const recipe = recipeById(recipeId);
  if (!recipe) return [];
  return Object.entries(recipe.ingredients)
    .map(([item, quantity]) => ({
      item: item as ItemId,
      required: quantity as number,
      available: inventory[item as ItemId],
    }))
    .filter((entry) => entry.available < entry.required);
}
