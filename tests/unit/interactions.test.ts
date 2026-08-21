import { describe, expect, it } from "vitest";
import { applyGather } from "../../lib/game/gameplay/interactions";
import { EMPTY_INVENTORY } from "../../lib/game/gameplay/items";

const initial = () => ({ inventory: { ...EMPTY_INVENTORY }, worldDiffs: {} });

describe("gathering reducer", () => {
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
