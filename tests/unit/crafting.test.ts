import { describe, expect, it } from "vitest";
import {
  ALL_RECIPE_IDS,
  RECIPE_DEFINITIONS,
  canUseStation,
  craftRecipe,
  recipeById,
  recipeMissingItems,
} from "../../lib/game/gameplay/crafting";
import {
  EMPTY_INVENTORY,
  ITEM_DEFINITIONS,
  addItem,
  applyInventoryDelta,
  createEmptyInventory,
  inventoryItemCount,
  inventoryWeight,
  itemUseKind,
  removeItem,
  type ItemId,
} from "../../lib/game/gameplay/items";

function inventory(overrides: Partial<Record<ItemId, number>> = {}) {
  return { ...EMPTY_INVENTORY, ...overrides };
}

describe("crafting and expanded inventory", () => {
  it("keeps recipes, outputs, and item metadata internally valid", () => {
    expect(new Set(ALL_RECIPE_IDS).size).toBe(ALL_RECIPE_IDS.length);
    expect(Object.keys(createEmptyInventory()).sort())
      .toEqual(Object.keys(ITEM_DEFINITIONS).sort());
    for (const recipe of Object.values(RECIPE_DEFINITIONS)) {
      expect(recipeById(recipe.id)).toBe(recipe);
      expect(recipe.output.quantity).toBeGreaterThan(0);
      expect(ITEM_DEFINITIONS[recipe.output.item]).toBeDefined();
      for (const [item, quantity] of Object.entries(recipe.ingredients)) {
        expect(ITEM_DEFINITIONS[item as ItemId]).toBeDefined();
        expect(quantity).toBeGreaterThan(0);
      }
    }
    for (const definition of Object.values(ITEM_DEFINITIONS)) {
      expect(definition.unitWeight).toBeGreaterThanOrEqual(0);
      expect(definition.stackLimit).toBeGreaterThan(0);
      expect(Number.isSafeInteger(definition.stackLimit)).toBe(true);
    }
  });

  it("crafts atomically without mutating the source inventory", () => {
    const source = inventory({ fiber: 3 });
    const outcome = craftRecipe(
      source,
      "recipe:bedroll:v1",
      "field",
      ALL_RECIPE_IDS,
    );
    expect(outcome).toMatchObject({
      result: "crafted",
      item: "bedroll",
      quantity: 1,
    });
    expect(outcome.inventory.fiber).toBe(0);
    expect(outcome.inventory.bedroll).toBe(1);
    expect(source).toEqual(inventory({ fiber: 3 }));
  });

  it("contains unknown, locked, station, material, and stack-limit failures", () => {
    const supplies = inventory({ fiber: 3 });
    expect(craftRecipe(supplies, "recipe:invented", "field", ALL_RECIPE_IDS).result)
      .toBe("unknown_recipe");
    expect(craftRecipe(supplies, "recipe:bedroll:v1", "field", []).result)
      .toBe("locked");
    expect(craftRecipe(
      inventory({ fiber: 2, relic: 1 }),
      "recipe:first-aid-kit:v1",
      "field",
      ALL_RECIPE_IDS,
    ).result).toBe("wrong_station");
    expect(craftRecipe(inventory(), "recipe:bedroll:v1", "field", ALL_RECIPE_IDS).result)
      .toBe("missing_items");
    expect(craftRecipe(
      inventory({ fiber: 3, bedroll: ITEM_DEFINITIONS.bedroll.stackLimit }),
      "recipe:bedroll:v1",
      "field",
      ALL_RECIPE_IDS,
    ).result).toBe("missing_items");
    expect(canUseStation("field", "workbench")).toBe(true);
    expect(canUseStation("workbench", "field")).toBe(false);
  });

  it("reports exact missing ingredients", () => {
    expect(recipeMissingItems(
      inventory({ wood: 1, stone: 0 }),
      "recipe:campfire-kit:v1",
    )).toEqual([
      { item: "wood", required: 2, available: 1 },
      { item: "stone", required: 2, available: 0 },
    ]);
    expect(recipeMissingItems(inventory(), "recipe:invented")).toEqual([]);
  });

  it("bounds item arithmetic and rejects partial invalid transactions", () => {
    const capped = addItem(inventory(), "first_aid_kit", 999);
    expect(capped.first_aid_kit).toBe(ITEM_DEFINITIONS.first_aid_kit.stackLimit);
    expect(addItem(capped, "first_aid_kit", Number.NaN)).toEqual(capped);
    expect(removeItem(capped, "first_aid_kit", 3)?.first_aid_kit)
      .toBe(ITEM_DEFINITIONS.first_aid_kit.stackLimit - 3);
    expect(removeItem(capped, "first_aid_kit", 999)).toBeNull();

    const source = inventory({ stone: 3, wood: 2 });
    expect(applyInventoryDelta(source, { stone: -2, wood: 4 })).toMatchObject({
      stone: 1,
      wood: 6,
    });
    expect(applyInventoryDelta(source, { stone: -4, wood: 4 })).toBeNull();
    expect(applyInventoryDelta(source, { stone: 0.5 })).toBeNull();
    expect(source).toEqual(inventory({ stone: 3, wood: 2 }));
    expect(inventoryItemCount(source)).toBe(5);
    expect(inventoryWeight(source)).toBeCloseTo(3 * 2.4 + 2 * 1.8);
    expect(itemUseKind("first_aid_kit")).toBe("heal");
    expect(itemUseKind("stone")).toBeNull();
  });
});
