import { describe, expect, it } from "vitest";
import {
  MAX_PLACED_ENTITIES,
  PLACEMENT_FOOTPRINT_RADIUS,
  evaluateDeploymentPlacement,
  placementFootprintRadius,
  placementOffsetDistance,
  placementOverlaps,
  type PlacementCandidate,
} from "../../lib/game/gameplay/deploymentPlacement";
import { MAX_PLACED_SERIAL, type PlacedEntity } from "../../lib/game/world/deployments";
import { MAX_WORLD_HEIGHT, MIN_WORLD_HEIGHT } from "../../lib/game/world/heightBounds";

function candidate(overrides: Partial<PlacementCandidate> = {}): PlacementCandidate {
  return {
    archetypeId: "campfire",
    x: 10,
    z: 20,
    y: 30,
    supportHeights: [30, 30, 30, 30],
    playerY: 30,
    overWater: false,
    standable: true,
    placed: [],
    serial: 1,
    maxSerial: MAX_PLACED_SERIAL,
    ...overrides,
  };
}

function record(overrides: Partial<PlacedEntity> = {}): PlacedEntity {
  return { id: "placed:campfire:99", archetypeId: "campfire", x: 10, y: 30, z: 20, yaw: 0, ...overrides };
}

describe("deployment placement rules", () => {
  it("accepts clear, level, dry ground within reach", () => {
    expect(evaluateDeploymentPlacement(candidate())).toBeNull();
  });

  it("reserves one footprint per archetype for both the candidate and existing records", () => {
    // Two hand-inlined copies of this table previously drifted independently,
    // which desynchronized the reserved footprint from the overlap test.
    for (const archetypeId of Object.keys(PLACEMENT_FOOTPRINT_RADIUS) as Array<
      keyof typeof PLACEMENT_FOOTPRINT_RADIUS
    >) {
      const radius = placementFootprintRadius(archetypeId);
      expect(radius).toBeGreaterThan(0);
      // An existing record of the same archetype must reserve the same radius.
      const touching = placementOverlaps({
        archetypeId,
        x: 0,
        y: 0,
        z: 0,
        placed: [record({ archetypeId, x: radius * 2, y: 0, z: 0 })],
      });
      expect(touching).toBe(true);
    }
  });

  it.each([
    ["weather_shelter", 1.5, 3.1],
    ["bedroll", 0.95, 2.35],
    ["campfire", 0.55, 2.35],
  ] as const)("pins %s footprint and offset", (archetypeId, radius, distance) => {
    expect(placementFootprintRadius(archetypeId)).toBe(radius);
    expect(placementOffsetDistance(archetypeId)).toBe(distance);
  });

  it("refuses a full registry", () => {
    const placed = Array.from({ length: MAX_PLACED_ENTITIES }, (_, index) =>
      record({ id: `placed:campfire:${index + 1}`, x: 5_000 + index }),
    );
    expect(evaluateDeploymentPlacement(candidate({ placed }))).toBe("registry_full");
  });

  it("refuses heights the save normalizer would discard", () => {
    // A finite-only check accepted these in-session and then lost them on
    // reload, with no notice to the player.
    expect(evaluateDeploymentPlacement(candidate({ y: MIN_WORLD_HEIGHT - 1, playerY: MIN_WORLD_HEIGHT - 1 })))
      .toBe("unclear_ground");
    expect(evaluateDeploymentPlacement(candidate({ y: MAX_WORLD_HEIGHT + 1, playerY: MAX_WORLD_HEIGHT + 1 })))
      .toBe("unclear_ground");
    expect(evaluateDeploymentPlacement(candidate({ y: MIN_WORLD_HEIGHT, playerY: MIN_WORLD_HEIGHT }))).toBeNull();
    expect(evaluateDeploymentPlacement(candidate({ y: MAX_WORLD_HEIGHT, playerY: MAX_WORLD_HEIGHT }))).toBeNull();
  });

  it.each([
    ["water", { overWater: true }],
    ["unstandable ground", { standable: false }],
    ["a non-finite support sample", { supportHeights: [30, Number.NaN, 30, 30] }],
    ["a step the player cannot reach", { playerY: 32 }],
    ["ground too uneven to seat the footprint", { supportHeights: [30, 30.9, 30, 30] }],
  ])("refuses %s", (_label, overrides) => {
    expect(evaluateDeploymentPlacement(candidate(overrides))).toBe("unclear_ground");
  });

  it("refuses a footprint overlapping an existing deployment", () => {
    const placed = [record({ x: 10.4, z: 20 })];
    expect(evaluateDeploymentPlacement(candidate({ placed }))).toBe("unclear_ground");
  });

  it("allows a deployment placed clear of an existing footprint", () => {
    const placed = [record({ x: 14, z: 20 })];
    expect(evaluateDeploymentPlacement(candidate({ placed }))).toBeNull();
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["beyond the serial ceiling", MAX_PLACED_SERIAL + 1],
  ])("refuses a %s serial", (_label, serial) => {
    expect(evaluateDeploymentPlacement(candidate({ serial }))).toBe("no_serial");
  });

  it("refuses a serial already used by this archetype", () => {
    const placed = [record({ id: "placed:campfire:7", x: 5_000 })];
    expect(evaluateDeploymentPlacement(candidate({ serial: 7, placed }))).toBe("no_serial");
  });
});
