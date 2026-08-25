import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  applyAnimalReactionPose,
  createAnimalReactionState,
  reactionProfile,
  stepAnimalReaction,
  type AnimalReactionState,
} from "../../lib/game/animals/reactions";
import type { AnimalPose, AnimalRecipe } from "../../lib/game/animals/animalRecipes";
import {
  authoredNpcScheduleAnchor,
  createAuthoredNpcTarget,
  AUTHORED_NPCS,
  updateAuthoredNpcTarget,
} from "../../lib/game/npcs/authoredNpc";
import {
  applyPlacedRuntimeLighting,
  createPlacedRuntime,
  FIELD_TORCH_LIGHT_CAP,
  nearbyCampModifiers,
  normalizePlacedEntities,
  type PlacedEntity,
} from "../../lib/game/world/deployments";
import {
  INTERIOR_PLACEMENTS,
  interiorPlacementIssues,
} from "../../lib/game/world/spawnFeatures";
import { SPAWN_BUILDING } from "../../lib/game/world/spawnBuilding";
import { TEN_STORY_BUILDING } from "../../lib/game/world/tenStoryBuilding";
import { TWO_STORY_BUILDING } from "../../lib/game/world/twoStoryBuilding";
import { ChunkManager } from "../../lib/game/world/ChunkManager";

describe("opening interior layouts", () => {
  it("keeps every prop on a valid floor, inside its building, and out of traversal reservations", () => {
    expect(interiorPlacementIssues()).toEqual([]);
    expect(new Set(INTERIOR_PLACEMENTS.map(({ buildingId, id }) => `${buildingId}:${id}`)).size)
      .toBe(INTERIOR_PLACEMENTS.length);

    const serviceCache = INTERIOR_PLACEMENTS.find(({ id }) => id === "tower-service-cache");
    expect(serviceCache).toBeDefined();
    if (!serviceCache) return;
    expect(serviceCache.localX + serviceCache.width * 0.5)
      .toBeLessThan(TEN_STORY_BUILDING.stairwellMinX);
  });

  it("reports malformed future placements without requiring a renderer", () => {
    const exemplar = INTERIOR_PLACEMENTS[0];
    expect(interiorPlacementIssues([
      exemplar,
      { ...exemplar },
      { ...exemplar, id: "bad-floor", floor: 99 },
      {
        ...exemplar,
        id: "stair-blocker",
        localX: SPAWN_BUILDING.roofStairCenterX,
        localZ: 0,
      },
    ])).toEqual(expect.arrayContaining([
      "field-unit:operations-desk:duplicate-id",
      "field-unit:bad-floor:invalid-floor",
      "field-unit:stair-blocker:blocks-roof-stair",
    ]));
  });

  it("reports pairwise prop overlap only within the same building floor", () => {
    const exemplar = INTERIOR_PLACEMENTS[0];
    const overlapping = { ...exemplar, id: "overlapping-desk", localX: exemplar.localX + 0.1 };
    const otherFloor = { ...overlapping, id: "other-floor", buildingId: "survey-house" as const };
    expect(interiorPlacementIssues([exemplar, overlapping, otherFloor])).toEqual(
      expect.arrayContaining([
        "field-unit:operations-desk:overlaps-overlapping-desk",
      ]),
    );
    expect(interiorPlacementIssues([exemplar, otherFloor])).not.toEqual(
      expect.arrayContaining([expect.stringContaining("overlaps-")]),
    );
  });
});

describe("authored NPC schedule", () => {
  it("uses deterministic authored interior anchors at exact schedule boundaries", () => {
    const beforeDesk = authoredNpcScheduleAnchor(5 * 60 + 59);
    const desk = authoredNpcScheduleAnchor(6 * 60);
    const beforeQuarters = authoredNpcScheduleAnchor(22 * 60 - 1);
    const quarters = authoredNpcScheduleAnchor(22 * 60);

    expect(beforeDesk.id).toBe("survey-quarters");
    expect(desk.id).toBe("field-desk");
    expect(beforeQuarters.id).toBe("field-desk");
    expect(quarters.id).toBe("survey-quarters");
    expect(desk.y).toBe(SPAWN_BUILDING.floorY);
    expect(quarters.y).toBe(TWO_STORY_BUILDING.upperFloorY);
    expect(Math.abs(desk.x - SPAWN_BUILDING.x)).toBeLessThan(SPAWN_BUILDING.width / 2);
    expect(Math.abs(desk.z - SPAWN_BUILDING.z)).toBeLessThan(SPAWN_BUILDING.depth / 2);
    expect(authoredNpcScheduleAnchor(6 * 60 + 1_440)).toEqual(desk);
  });

  it("updates both the rigid figure and its interaction point atomically", () => {
    const target = createAuthoredNpcTarget(AUTHORED_NPCS[0], "performance", 12 * 60);
    expect(target.root.userData.scheduleAnchor).toBe("field-desk");
    updateAuthoredNpcTarget(target, 23 * 60);
    expect(target.root.userData.scheduleAnchor).toBe("survey-quarters");
    expect(target.position.x).toBe(target.root.position.x);
    expect(target.position.z).toBe(target.root.position.z);
    expect(target.position.y).toBeCloseTo(target.root.position.y + 1.35);
  });
});

describe("rigid wildlife reactions", () => {
  const recipe: AnimalRecipe = {
    id: "animal:meadow_hare:test",
    speciesId: "meadow_hare",
    x: 0,
    z: 0,
    scale: 1,
    heading: 0.7,
    speed: 0.1,
    roamRadius: 3,
    phase: 0,
    flightHeight: 0,
  };
  const basePose: AnimalPose = { x: 0, y: 2, z: 0, yaw: 0.7 };
  const profile = reactionProfile("small", false);

  it("alerts toward the player, flees away, then returns cleanly to its analytic route", () => {
    const calm = createAnimalReactionState(recipe);
    const alert = stepAnimalReaction(calm, basePose, { x: 0, z: 12 }, profile, 0.1);
    expect(alert.mode).toBe("alert");
    expect(alert.yaw).toBeCloseTo(0);

    const fleeing = stepAnimalReaction(alert, basePose, { x: 0, z: 2 }, profile, 0.1);
    expect(fleeing.mode).toBe("flee");
    expect(fleeing.offsetZ).toBeLessThan(0);
    expect(fleeing.yaw).toBeCloseTo(Math.PI);

    let returning = stepAnimalReaction(
      fleeing,
      basePose,
      { x: 0, z: 100 },
      profile,
      0.1,
    );
    for (let index = 0; index < 12; index += 1) {
      returning = stepAnimalReaction(
        returning,
        basePose,
        { x: 0, z: 100 },
        profile,
        0.1,
      );
    }
    expect(returning).toMatchObject({ mode: "calm", offsetX: 0, offsetZ: 0 });
    expect(applyAnimalReactionPose(basePose, returning)).toEqual(basePose);
  });

  it("contains corrupt transient values instead of emitting non-finite instance matrices", () => {
    const corrupt: AnimalReactionState = {
      mode: "return",
      offsetX: Number.NaN,
      offsetZ: Number.POSITIVE_INFINITY,
      yaw: Number.NaN,
      modeSeconds: Number.NaN,
    };
    const repaired = stepAnimalReaction(
      corrupt,
      basePose,
      { x: Number.NaN, z: Number.NaN },
      profile,
      Number.NaN,
    );
    expect(Object.values(applyAnimalReactionPose(basePose, repaired)).every(Number.isFinite))
      .toBe(true);
  });
});

describe("player deployments", () => {
  it("normalizes bounded persistent records and derives local shelter/warmth", () => {
    const valid: PlacedEntity = {
      id: "placed:campfire:1",
      archetypeId: "campfire",
      x: 4,
      y: 2,
      z: -3,
      yaw: Math.PI * 5,
    };
    const records = normalizePlacedEntities([
      valid,
      valid,
      { ...valid, id: "placed:weather_shelter:2", archetypeId: "weather_shelter" },
      { ...valid, id: "invalid", archetypeId: "campfire" },
      { ...valid, id: "placed:campfire:000001", archetypeId: "campfire" },
    ]);
    expect(records).toHaveLength(2);
    expect(records[0].yaw).toBeCloseTo(-Math.PI);
    expect(nearbyCampModifiers(records, 4, -3)).toEqual({ sheltered: true, warmth: 1 });
    expect(nearbyCampModifiers(records, 4, -3, 2)).toEqual({ sheltered: true, warmth: 1 });
    expect(nearbyCampModifiers(records, 4, -3, 5.25)).toEqual({
      sheltered: false,
      warmth: 0,
    });
    expect(nearbyCampModifiers(records, 100, 100)).toEqual({ sheltered: false, warmth: 0 });
  });

  it("creates one owned scene subtree with bounded targets and colliders", () => {
    const records: PlacedEntity[] = [
      { id: "placed:bedroll:1", archetypeId: "bedroll", x: 0, y: 1, z: 0, yaw: 0 },
      { id: "placed:campfire:2", archetypeId: "campfire", x: 3, y: 1, z: 0, yaw: 0 },
      { id: "placed:weather_shelter:3", archetypeId: "weather_shelter", x: 6, y: 1, z: 0, yaw: 0 },
    ];
    const runtime = createPlacedRuntime(records, "performance");
    expect(runtime.root).toBeInstanceOf(THREE.Group);
    expect(runtime.root.children).toHaveLength(records.length);
    expect(runtime.targets).toHaveLength(3);
    expect(runtime.colliders).toHaveLength(2);
    expect(runtime.lights).toHaveLength(0);
    expect(new Set(runtime.targets.map(({ id }) => id)).size).toBe(runtime.targets.length);
  });

  it("keeps placed torch lights night-driven and quality-bounded", () => {
    const torches: PlacedEntity[] = Array.from(
      { length: FIELD_TORCH_LIGHT_CAP.cinematic + 3 },
      (_, index) => ({
        id: `placed:field_torch:${index + 1}`,
        archetypeId: "field_torch",
        x: index * 4,
        y: 1,
        z: 0,
        yaw: 0,
      }),
    );
    const runtime = createPlacedRuntime(torches, "performance");
    expect(applyPlacedRuntimeLighting(runtime, "performance", 0, 0, 0)).toBe(0);
    expect(runtime.lights.every(({ light }) => !light.visible && light.intensity === 0)).toBe(true);

    expect(applyPlacedRuntimeLighting(runtime, "performance", 1, 0, 0))
      .toBe(FIELD_TORCH_LIGHT_CAP.performance);
    const performanceLights = runtime.lights.filter(({ light }) => light.visible);
    expect(performanceLights).toHaveLength(FIELD_TORCH_LIGHT_CAP.performance);
    expect(performanceLights.every(({ light }) => light.distance === 11 && !light.castShadow))
      .toBe(true);
    expect(runtime.lights.at(-1)?.light.visible).toBe(false);

    expect(applyPlacedRuntimeLighting(runtime, "cinematic", 0.5, torches.at(-1)?.x, 0))
      .toBe(FIELD_TORCH_LIGHT_CAP.cinematic);
    expect(runtime.lights.at(-1)?.light.visible).toBe(true);
    expect(runtime.lights.filter(({ light }) => light.visible)).toHaveLength(
      FIELD_TORCH_LIGHT_CAP.cinematic,
    );
  });
});

describe("world-content lifecycle", () => {
  it("clears placed targets, colliders, scene ownership, and sight queries on disposal", () => {
    const scene = new THREE.Scene();
    const world = new ChunkManager(scene, "performance");
    world.setPlacedEntities([{
      id: "placed:campfire:1",
      archetypeId: "campfire",
      x: 0,
      y: 1,
      z: -3,
      yaw: 0,
    }]);
    expect(world.targets).toHaveLength(1);
    expect(world.colliders).toHaveLength(1);
    expect(scene.children).toHaveLength(1);

    world.dispose();

    expect(world.targets).toEqual([]);
    expect(world.colliders).toEqual([]);
    expect(world.placedEntities).toEqual([]);
    expect(scene.children).toEqual([]);
    expect(world.hasLineOfSight(
      { x: 0, y: 1.6, z: 0 },
      { x: 0, y: 1.6, z: -2 },
    )).toBe(false);
    expect(() => world.dispose()).not.toThrow();
  });
});
