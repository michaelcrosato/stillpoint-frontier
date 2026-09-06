import { describe, expect, it } from "vitest";
import { applyGather } from "../../lib/game/gameplay/interactions";
import { EMPTY_INVENTORY, ITEM_DEFINITIONS } from "../../lib/game/gameplay/items";

const initial = () => ({ inventory: { ...EMPTY_INVENTORY }, worldDiffs: {} });

describe("gathering reducer", () => {
  it.each([999, 998])("preserves a final-hit resource when %i units leave insufficient room", (stone) => {
    const target = { id: "resource:test", action: "harvest" as const, item: "stone" as const, yieldAmount: 3, hitsRequired: 3 };
    const state = { inventory: { ...EMPTY_INVENTORY, stone }, worldDiffs: { [target.id]: { hits: 2, removed: false } } };
    const blocked = applyGather(state, target);
    expect(blocked.result).toBe("full");
    expect(blocked.loot).toBeNull();
    expect(blocked.state).toEqual(state);
    const resumed = applyGather({ ...blocked.state, inventory: { ...blocked.state.inventory, stone: ITEM_DEFINITIONS.stone.stackLimit - 3 } }, target);
    expect(resumed.loot?.quantity).toBe(3);
    expect(resumed.state.inventory.stone).toBe(999);
    expect(resumed.state.worldDiffs[target.id].removed).toBe(true);
    expect(applyGather(resumed.state, target).loot).toBeNull();
  });

  it("leaves a full-stack pickup available without recording removal", () => {
    const state = { ...initial(), inventory: { ...EMPTY_INVENTORY, fiber: 999 } };
    const blocked = applyGather(state, { id: "pickup:test", action: "collect", item: "fiber", yieldAmount: 1, hitsRequired: 1 });
    expect(blocked.result).toBe("full");
    expect(blocked.state).toEqual(state);
  });

  it("contains non-finite hit counts and loot event quantities", () => {
    const outcome = applyGather(initial(), { id: "pickup:test", action: "harvest", item: "fiber", yieldAmount: Infinity, hitsRequired: NaN });
    expect(outcome.result).toBe("depleted");
    expect(outcome.loot?.quantity).toBe(0);
    expect(outcome.remainingHits).toBe(0);
  });
  it("grants rock loot only on the final hit", () => {
    const target = {
      id: "resource:rock:v1:0:0:0",
      action: "harvest" as const,
      item: "stone" as const,
      yieldAmount: 3,
      hitsRequired: 3,
    };
    const first = applyGather(initial(), target);
    const second = applyGather(first.state, target);
    const third = applyGather(second.state, target);
    expect(first.result).toBe("hit");
    expect(second.state.inventory.stone).toBe(0);
    expect(third.result).toBe("depleted");
    expect(third.state.inventory.stone).toBe(3);
    expect(third.state.worldDiffs[target.id]).toEqual({ hits: 3, removed: true });
  });

  it("collects a pickup once and remains idempotent", () => {
    const target = {
      id: "pickup:fiber:v1:0:0:0",
      action: "collect" as const,
      item: "fiber" as const,
      yieldAmount: 1,
      hitsRequired: 1,
    };
    const collected = applyGather(initial(), target);
    const duplicate = applyGather(collected.state, target);
    expect(collected.result).toBe("collected");
    expect(duplicate.result).toBe("unchanged");
    expect(duplicate.state.inventory.fiber).toBe(1);
  });

  it("sanitizes non-finite and negative yields", () => {
    const result = applyGather(initial(), {
      id: "pickup:ore:v1:0:0:0",
      action: "collect",
      item: "ore",
      yieldAmount: Number.NaN,
      hitsRequired: 0,
    });
    expect(result.state.inventory.ore).toBe(0);
    expect(result.state.worldDiffs["pickup:ore:v1:0:0:0"].removed).toBe(true);
  });
});
