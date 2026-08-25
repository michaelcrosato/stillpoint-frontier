import { describe, expect, it } from "vitest";
import {
  containerItemCount,
  createContainerContents,
  ensureContainerState,
  normalizeContainerStates,
  takeAllContainerItems,
  takeContainerItem,
  type ContainerStates,
} from "../../lib/game/gameplay/loot";
import {
  EMPTY_INVENTORY,
  ITEM_DEFINITIONS,
} from "../../lib/game/gameplay/items";

const CONTAINER_ID = "container:test:field-supplies-a";

describe("deterministic loot containers", () => {
  it("rolls stable legal contents from table and container IDs", () => {
    const first = createContainerContents(CONTAINER_ID, "field_supplies");
    const second = createContainerContents(CONTAINER_ID, "field_supplies");
    expect(second).toEqual(first);
    expect(Object.values(first).reduce((sum, quantity) => sum + (quantity ?? 0), 0))
      .toBeGreaterThan(0);
    for (const [item, quantity] of Object.entries(first)) {
      expect(item in ITEM_DEFINITIONS).toBe(true);
      expect(Number.isSafeInteger(quantity)).toBe(true);
      expect(quantity).toBeGreaterThan(0);
    }
  });

  it("opens an authored container idempotently", () => {
    const opened = ensureContainerState({}, CONTAINER_ID, "field_supplies");
    expect(opened.state.opened).toBe(true);
    expect(containerItemCount(opened.state)).toBeGreaterThan(0);
    const reopened = ensureContainerState(opened.states, CONTAINER_ID, "tower_service");
    expect(reopened.state).toEqual(opened.state);
    expect(reopened.states).toEqual(opened.states);
    expect(reopened.states).not.toBe(opened.states);
    expect(containerItemCount(null)).toBe(0);
  });

  it("takes only available stack capacity and never duplicates removed loot", () => {
    const states: ContainerStates = {
      [CONTAINER_ID]: {
        opened: true,
        looted: false,
        remaining: { fiber: 3, first_aid_kit: 2 },
      },
    };
    const inventory = {
      ...EMPTY_INVENTORY,
      fiber: ITEM_DEFINITIONS.fiber.stackLimit - 1,
    };
    const fiber = takeContainerItem(inventory, states, CONTAINER_ID, "fiber", 99);
    expect(fiber.quantity).toBe(1);
    expect(fiber.inventory.fiber).toBe(ITEM_DEFINITIONS.fiber.stackLimit);
    expect(fiber.states[CONTAINER_ID]?.looted).toBe(true);
    expect(fiber.states[CONTAINER_ID]?.remaining.fiber).toBe(2);

    const all = takeAllContainerItems(fiber.inventory, fiber.states, CONTAINER_ID);
    expect(all.quantity).toBe(2);
    expect(all.inventory.first_aid_kit).toBe(2);
    expect(all.states[CONTAINER_ID]?.remaining).toEqual({ fiber: 2 });
    const repeated = takeAllContainerItems(all.inventory, all.states, CONTAINER_ID);
    expect(repeated.quantity).toBe(0);
    expect(repeated.inventory).toEqual(all.inventory);
  });

  it("contains invalid requests and normalizes sparse persisted states", () => {
    const states: ContainerStates = {
      [CONTAINER_ID]: { opened: true, looted: false, remaining: { stone: 2 } },
    };
    const invalid = takeContainerItem(
      { ...EMPTY_INVENTORY },
      states,
      CONTAINER_ID,
      "stone",
      Number.NaN,
    );
    expect(invalid.quantity).toBe(0);
    expect(invalid.states).toEqual(states);

    expect(normalizeContainerStates({
      [CONTAINER_ID]: {
        opened: true,
        looted: true,
        remaining: {
          stone: 99_999,
          fiber: -1,
          invented: 4,
          wood: 1.5,
        },
      },
      "bad id": { opened: true, looted: false, remaining: { stone: 2 } },
      "container:test:closed": { opened: false, looted: false, remaining: { stone: 2 } },
    })).toEqual({
      [CONTAINER_ID]: {
        opened: true,
        looted: true,
        remaining: { stone: ITEM_DEFINITIONS.stone.stackLimit },
      },
    });
    expect(normalizeContainerStates([])).toEqual({});
  });
});
