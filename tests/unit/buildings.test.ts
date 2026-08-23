import { describe, expect, it } from "vitest";
import { PLAYER_BODY_HEIGHT, PLAYER_RADIUS } from "../../lib/game/config";
import {
  colliderOverlapsVerticalSpan,
  resolvePlanarMovement,
} from "../../lib/game/systems/collision";
import {
  BUILDING_BASEMENT_DEPTH,
  BUILDING_DOOR_HEIGHT,
  BUILDING_DOOR_WIDTH,
  BUILDING_PARAPET_HEIGHT,
  BUILDING_SLAB_THICKNESS,
  BUILDING_WALL_THICKNESS,
  BUILDING_WINDOW_HEIGHT,
  BUILDING_WINDOW_SILL,
  buildingBasementSupportY,
  buildingCeilingY,
  buildingContainsPoint,
  buildingGroundSupportY,
  buildingLevelStops,
  buildingLocalToWorld,
  buildingRoofSupportY,
  buildingStructuralColliders,
  createBuildingRecipe,
  resolveBuildingTraversal,
  type CreateBuildingRecipeInput,
} from "../../lib/game/world/buildings";
import type { WorldPathSegment } from "../../lib/game/world/roads";

const road: WorldPathSegment = {
  id: "test-road",
  kind: "street",
  start: { x: -30, z: 18 },
  end: { x: 30, z: 18 },
  width: 6,
};

function recipeInput(
  overrides: Partial<CreateBuildingRecipeInput> = {},
): CreateBuildingRecipeInput {
  return {
    id: "building:test:0:0:7",
    settlementId: "test",
    settlementName: "Metric Test",
    tier: "city",
    chunkKey: "0:0",
    candidateIndex: 7,
    x: 4,
    z: 3,
    fallbackRotation: 0,
    width: 9,
    depth: 8,
    desiredHeight: 13,
    foundationY: 2,
    allowBasement: true,
    basementRoll: 0,
    roofRoll: 0,
    paths: [road],
    ...overrides,
  };
}

describe("procedural building recipes", () => {
  it("is deterministic, metric, and aligned to complete storeys", () => {
    const first = createBuildingRecipe(recipeInput());
    const second = createBuildingRecipe(recipeInput());
    expect(second).toEqual(first);
    expect(first.id).toBe("building:test:0:0:7");
    expect(first.doorWidth).toBe(BUILDING_DOOR_WIDTH);
    expect(first.doorWidth).toBeGreaterThan(PLAYER_RADIUS * 2 + 0.3);
    expect(first.doorHeight).toBe(BUILDING_DOOR_HEIGHT);
    expect(first.floorHeight).toBeGreaterThanOrEqual(3);
    expect(first.height).toBeCloseTo(first.floorCount * first.floorHeight);
    expect(first.floorCount).toBeGreaterThan(1);
    expect(first.hasBasement).toBe(true);
    expect(first.roofAccess).toBe(true);
    expect(first.rotation).toBeCloseTo(Math.atan2(0, 15));
    expect(buildingCeilingY(first, buildingGroundSupportY(first) + 1.2))
      .toBeCloseTo(
        buildingGroundSupportY(first) + first.floorHeight - BUILDING_SLAB_THICKNESS,
      );
  });

  it("keeps every generated dimension and capability internally valid", () => {
    const tiers = ["megacity", "city", "town", "village"] as const;
    for (let index = 0; index < 120; index += 1) {
      const recipe = createBuildingRecipe(recipeInput({
        id: `building:test:${index}`,
        candidateIndex: index,
        tier: tiers[index % tiers.length],
        width: 4.5 + (index % 16) * 0.73,
        depth: 4.2 + (index % 13) * 0.67,
        desiredHeight: 3 + (index % 35) * 2.4,
        allowBasement: index % 3 !== 0,
        basementRoll: (index % 10) / 10,
        roofRoll: (index % 9) / 9,
      }));
      expect(Number.isFinite(recipe.rotation)).toBe(true);
      expect(recipe.width).toBeGreaterThan(recipe.doorWidth + BUILDING_WALL_THICKNESS * 2);
      expect(recipe.height).toBeCloseTo(recipe.floorHeight * recipe.floorCount);
      expect(recipe.floorCount).toBeGreaterThanOrEqual(1);
      expect(recipe.floorCount).toBeLessThanOrEqual(30);
      expect(buildingRoofSupportY(recipe)).toBeGreaterThan(buildingGroundSupportY(recipe));
      expect(buildingLevelStops(recipe).length).toBeGreaterThanOrEqual(recipe.floorCount);
    }
  });

  it("leaves a real ground-floor doorway while closing the upper facade", () => {
    const recipe = createBuildingRecipe(recipeInput({ x: 0, z: 0, paths: [], fallbackRotation: 0 }));
    const colliders = buildingStructuralColliders(recipe);
    const groundY = buildingGroundSupportY(recipe);
    const frontOutside = buildingLocalToWorld(recipe, 0, recipe.depth * 0.5 + 2);
    const interior = buildingLocalToWorld(recipe, 0, 0);
    const groundColliders = colliders.filter((collider) =>
      colliderOverlapsVerticalSpan(collider, groundY, groundY + PLAYER_BODY_HEIGHT),
    );
    const entered = resolvePlanarMovement(
      frontOutside,
      interior,
      groundColliders,
      PLAYER_RADIUS,
    );
    expect(buildingContainsPoint(recipe, entered.x, entered.z)).toBe(true);

    const upperY = groundY + recipe.floorHeight;
    const upperColliders = colliders.filter((collider) =>
      colliderOverlapsVerticalSpan(collider, upperY, upperY + PLAYER_BODY_HEIGHT),
    );
    const blocked = resolvePlanarMovement(
      frontOutside,
      interior,
      upperColliders,
      PLAYER_RADIUS,
    );
    expect(buildingContainsPoint(recipe, blocked.x, blocked.z)).toBe(false);

    const roofColliders = colliders.filter((collider) =>
      collider.id.includes(":roof:"),
    );
    expect(roofColliders).toHaveLength(4);
    for (const collider of roofColliders) {
      expect((collider.maxY ?? 0) - (collider.minY ?? 0))
        .toBeCloseTo(BUILDING_PARAPET_HEIGHT);
    }
  });

  it("seals the center of the front wall below ground without closing the doorway", () => {
    const recipe = createBuildingRecipe(recipeInput({
      x: 0,
      z: 0,
      paths: [],
      fallbackRotation: 0,
    }));
    expect(recipe.hasBasement).toBe(true);
    const colliders = buildingStructuralColliders(recipe);
    const frontOutside = buildingLocalToWorld(recipe, 0, recipe.depth * 0.5 + 2);
    const interior = buildingLocalToWorld(recipe, 0, 0);

    const atGround = colliders.filter((collider) =>
      colliderOverlapsVerticalSpan(
        collider,
        buildingGroundSupportY(recipe),
        buildingGroundSupportY(recipe) + PLAYER_BODY_HEIGHT,
      ),
    );
    const entered = resolvePlanarMovement(
      frontOutside,
      interior,
      atGround,
      PLAYER_RADIUS,
    );
    expect(buildingContainsPoint(recipe, entered.x, entered.z)).toBe(true);

    const basementY = buildingBasementSupportY(recipe);
    const belowGround = colliders.filter((collider) =>
      colliderOverlapsVerticalSpan(
        collider,
        basementY,
        basementY + PLAYER_BODY_HEIGHT,
      ),
    );
    const blocked = resolvePlanarMovement(
      frontOutside,
      interior,
      belowGround,
      PLAYER_RADIUS,
    );
    expect(buildingContainsPoint(recipe, blocked.x, blocked.z)).toBe(false);
  });

  it("keeps declared window and slab measurements within each metric storey", () => {
    const recipe = createBuildingRecipe(recipeInput());
    const groundY = buildingGroundSupportY(recipe);
    const basementY = buildingBasementSupportY(recipe);
    const stops = buildingLevelStops(recipe).filter((stop) => stop.kind === "floor");

    expect(groundY - recipe.foundationY).toBeCloseTo(BUILDING_SLAB_THICKNESS);
    expect(groundY - basementY).toBeCloseTo(BUILDING_BASEMENT_DEPTH);
    expect(BUILDING_WINDOW_SILL).toBeGreaterThan(BUILDING_SLAB_THICKNESS);
    expect(BUILDING_WINDOW_SILL + BUILDING_WINDOW_HEIGHT).toBeLessThan(
      recipe.floorHeight - BUILDING_SLAB_THICKNESS,
    );
    expect(stops).toHaveLength(recipe.floorCount);
    for (let index = 1; index < stops.length; index += 1) {
      expect(stops[index].y - stops[index - 1].y).toBeCloseTo(recipe.floorHeight);
    }
  });

  it("resolves basement, floor, and roof traversal without animation state", () => {
    const recipe = createBuildingRecipe(recipeInput());
    const stops = buildingLevelStops(recipe);
    expect(stops[0].label).toBe("B1");
    expect(stops.at(-1)?.label).toBe("ROOF");
    const ground = stops.find((stop) => stop.label === "F01");
    expect(ground).toBeDefined();
    if (!ground) return;
    const up = resolveBuildingTraversal(
      { direction: 1, stops, destinationX: 1, destinationZ: 2 },
      ground.y,
    );
    const down = resolveBuildingTraversal(
      { direction: -1, stops, destinationX: 3, destinationZ: 4 },
      ground.y,
    );
    expect(up?.origin.label).toBe("F01");
    expect(up?.destination.label).toBe("F02");
    expect(down?.destination.label).toBe("B1");
    expect(resolveBuildingTraversal(
      { direction: 1, stops, destinationX: 0, destinationZ: 0 },
      ground.y + 1.2,
    )).toBeNull();
    expect(BUILDING_SLAB_THICKNESS).toBeLessThan(0.25);
  });
});
