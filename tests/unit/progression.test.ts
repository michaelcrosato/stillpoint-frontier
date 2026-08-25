import { describe, expect, it } from "vitest";
import { ALL_RECIPE_IDS } from "../../lib/game/gameplay/crafting";
import {
  createFeatureProgress,
  normalizeFeatureProgress,
} from "../../lib/game/gameplay/progression";
import { ITEM_DEFINITIONS } from "../../lib/game/gameplay/items";

describe("feature progression persistence slice", () => {
  it("returns independent complete defaults", () => {
    const first = createFeatureProgress();
    const second = createFeatureProgress();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.contractJournal).not.toBe(second.contractJournal);
    expect(first.unlockedRecipeIds).not.toBe(second.unlockedRecipeIds);
    expect(new Set(first.unlockedRecipeIds)).toEqual(new Set(ALL_RECIPE_IDS));
    expect(first.nextPlacedSerial).toBe(1);
  });

  it("normalizes each subsystem independently and derives the next placement serial", () => {
    const normalized = normalizeFeatureProgress({
      fieldGuideEntries: [
        "guide:resource:fiber:v1",
        "guide:resource:fiber:v1",
        "guide:invented",
      ],
      containerStates: {
        "container:field-unit:a": {
          opened: true,
          looted: true,
          remaining: { first_aid_kit: 999, invented: 4 },
        },
      },
      placedEntities: [
        {
          id: "placed:bedroll:7",
          archetypeId: "bedroll",
          x: 4,
          y: 2,
          z: -3,
          yaw: Math.PI * 5,
        },
        {
          id: "placed:bedroll:7",
          archetypeId: "bedroll",
          x: 8,
          y: 2,
          z: -3,
          yaw: 0,
        },
        {
          id: "placed:invented:8",
          archetypeId: "invented",
          x: 0,
          y: 0,
          z: 0,
          yaw: 0,
        },
      ],
      nextPlacedSerial: -8,
      unlockedRecipeIds: ["recipe:bedroll:v1", "recipe:invented", "recipe:bedroll:v1"],
      npcFlags: ["npc:mara-venn:v1:introduced", "bad flag", "npc:mara-venn:v1:introduced"],
      lastRestAt: 99_000_000,
    });
    expect(normalized.fieldGuideEntries).toEqual(["guide:resource:fiber:v1"]);
    expect(normalized.containerStates).toEqual({
      "container:field-unit:a": {
        opened: true,
        looted: true,
        remaining: { first_aid_kit: ITEM_DEFINITIONS.first_aid_kit.stackLimit },
      },
    });
    expect(normalized.placedEntities).toHaveLength(1);
    expect(normalized.placedEntities[0]).toMatchObject({
      id: "placed:bedroll:7",
      archetypeId: "bedroll",
      x: 4,
      y: 2,
      z: -3,
    });
    expect(normalized.placedEntities[0].yaw).toBeCloseTo(-Math.PI);
    expect(normalized.nextPlacedSerial).toBe(8);
    expect(normalized.unlockedRecipeIds).toEqual(["recipe:bedroll:v1"]);
    expect(normalized.npcFlags).toEqual(["npc:mara-venn:v1:introduced"]);
    expect(normalized.lastRestAt).toBe(10_000_000);
  });

  it("recovers defaults from malformed slices and preserves an intentional empty unlock list", () => {
    expect(normalizeFeatureProgress("corrupt")).toEqual(createFeatureProgress());
    expect(normalizeFeatureProgress({
      unlockedRecipeIds: [],
      nextPlacedSerial: Number.NaN,
      lastRestAt: -1,
    })).toMatchObject({
      unlockedRecipeIds: [],
      nextPlacedSerial: 1,
      lastRestAt: null,
    });
  });

  it("wraps placement identifiers without colliding at the namespace boundary", () => {
    const normalized = normalizeFeatureProgress({
      placedEntities: [{
        id: "placed:survey_marker:999999",
        archetypeId: "survey_marker",
        x: 0,
        y: 1,
        z: 0,
        yaw: 0,
      }],
      nextPlacedSerial: 999_999,
    });
    expect(normalized.nextPlacedSerial).toBe(1);
  });
});
