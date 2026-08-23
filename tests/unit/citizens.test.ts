import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  CHUNK_SIZE,
  CITIZEN_CHUNK_LOAD_RADIUS,
  CITIZEN_RESIDENT_CHUNKS,
} from "../../lib/game/config";
import {
  MAX_CITIZENS_PER_CHUNK,
  MAX_RESIDENT_CITIZENS,
  crowdDensityForCount,
  expectedSettlementCitizens,
  generateCitizenChunk,
  sampleCitizenPose,
  visibleCitizenCount,
} from "../../lib/game/citizens/citizenRecipes";
import {
  ROAD_CORRIDORS,
  SETTLEMENTS,
  WATER_LEVEL,
  getSettlement,
  riverCenterX,
  settlementInfluence,
} from "../../lib/game/world/macroWorld";
import {
  ROAD_WIDTHS,
  distanceToPathSegment,
  roadSegmentsForChunk,
  settlementStreetSegmentsForChunk,
} from "../../lib/game/world/roads";
import { chunkCenter, chunksAround, worldToChunk } from "../../lib/game/world/terrain";

function residentRecipes(x: number, z: number) {
  const center = worldToChunk(x, z);
  return chunksAround(center, CITIZEN_CHUNK_LOAD_RADIUS).flatMap((chunk) =>
    generateCitizenChunk(chunk.x, chunk.z),
  );
}

function settlement(id: string) {
  const result = getSettlement(id);
  if (!result) throw new Error(`Missing test settlement: ${id}`);
  return result;
}

describe("ambient citizen recipes", () => {
  it("is deterministic, load-order independent, and globally ID-stable", () => {
    const center = worldToChunk(settlement("vesper-crown").x, settlement("vesper-crown").z);
    const coordinates = chunksAround(center, CITIZEN_CHUNK_LOAD_RADIUS);
    const forward = coordinates.flatMap((chunk) => generateCitizenChunk(chunk.x, chunk.z));
    const reverse = [...coordinates]
      .reverse()
      .flatMap((chunk) => generateCitizenChunk(chunk.x, chunk.z));
    expect(generateCitizenChunk(center.x, center.z)).toEqual(generateCitizenChunk(center.x, center.z));
    expect(new Set(forward.map((recipe) => recipe.id)).size).toBe(forward.length);
    expect(reverse.map((recipe) => recipe.id).sort()).toEqual(
      forward.map((recipe) => recipe.id).sort(),
    );
  });

  it("scales population sharply by settlement hierarchy", () => {
    const mega = residentRecipes(settlement("vesper-crown").x, settlement("vesper-crown").z);
    const city = residentRecipes(settlement("reedwater").x, settlement("reedwater").z);
    const town = residentRecipes(settlement("crosswind").x, settlement("crosswind").z);
    const village = residentRecipes(settlement("dustmere").x, settlement("dustmere").z);
    expect(mega.length).toBeGreaterThan(city.length);
    expect(city.length).toBeGreaterThan(town.length);
    expect(town.length).toBeGreaterThan(village.length);
    expect(village.length).toBeGreaterThan(0);
    expect(mega.length).toBeGreaterThan(3_500);
    expect(village.length).toBeLessThan(100);
  });

  it("uses tier, population, and radial influence rather than literal population", () => {
    for (const candidate of SETTLEMENTS) {
      const core = expectedSettlementCitizens(candidate, 1);
      const edge = expectedSettlementCitizens(candidate, 0.02);
      expect(core).toBeGreaterThan(edge);
      expect(core).toBeLessThanOrEqual(MAX_CITIZENS_PER_CHUNK);
    }
    expect(expectedSettlementCitizens(settlement("vesper-crown"), 1)).toBeGreaterThan(
      expectedSettlementCitizens(settlement("reedwater"), 1),
    );
    expect(settlementInfluence(settlement("dustmere"), 45_000, -45_000)).toBe(0);
  });

  it("puts a sparse, credible relay crew on the opening service road", () => {
    const opening = residentRecipes(0, 8);
    expect(opening.length).toBeGreaterThanOrEqual(4);
    expect(opening.length).toBeLessThanOrEqual(24);
    expect(opening.every((recipe) => recipe.source === "road")).toBe(true);
    expect(opening.some((recipe) => recipe.sourceId.startsWith("old-relay-spur"))).toBe(true);
  });

  it("leaves genuine off-road wilderness empty", () => {
    expect(residentRecipes(44_000, -44_000)).toHaveLength(0);
    expect(crowdDensityForCount(0)).toBe("WILDERNESS");
  });

  it("keeps every generated route inside its chunk and declared provenance", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -500, max: 500 }),
        fc.integer({ min: -500, max: 500 }),
        (chunkX, chunkZ) => {
          const center = chunkCenter({ x: chunkX, z: chunkZ });
          const recipes = generateCitizenChunk(chunkX, chunkZ);
          expect(recipes.length).toBeLessThanOrEqual(MAX_CITIZENS_PER_CHUNK);
          for (const recipe of recipes) {
            for (const point of [recipe.start, recipe.end]) {
              expect(Math.abs(point.x - center.x)).toBeLessThanOrEqual(CHUNK_SIZE / 2 + 0.001);
              expect(Math.abs(point.z - center.z)).toBeLessThanOrEqual(CHUNK_SIZE / 2 + 0.001);
            }
            if (recipe.source === "settlement") {
              const source = getSettlement(recipe.sourceId);
              expect(source).not.toBeNull();
              if (source) {
                expect(Math.hypot(recipe.start.x - source.x, recipe.start.z - source.z)).toBeLessThanOrEqual(
                  source.radius + 0.001,
                );
                expect(Math.hypot(recipe.end.x - source.x, recipe.end.z - source.z)).toBeLessThanOrEqual(
                  source.radius + 0.001,
                );
              }
            } else {
              const corridor = ROAD_CORRIDORS.find((candidate) => candidate.id === recipe.sourceId);
              expect(corridor).toBeDefined();
              if (corridor && recipe.roadClass) {
                const distance = distanceToPathSegment(recipe.start, {
                  start: corridor.from,
                  end: corridor.to,
                });
                expect(distance).toBeLessThanOrEqual(ROAD_WIDTHS[recipe.roadClass] / 2 + 1.31);
              }
            }
          }
        },
      ),
      { numRuns: 120 },
    );
  });

  it("samples repeatable, finite poses that remain on the assigned lane", () => {
    const recipe = residentRecipes(0, 8)[0];
    expect(recipe).toBeDefined();
    if (!recipe) return;
    const fixed = sampleCitizenPose(recipe, 42.5);
    expect(sampleCitizenPose(recipe, 42.5)).toEqual(fixed);
    for (const time of [-900, 0, 1.25, 10_000, Number.NaN, Number.POSITIVE_INFINITY]) {
      const pose = sampleCitizenPose(recipe, time);
      expect(Object.values(pose).every(Number.isFinite)).toBe(true);
      expect(distanceToPathSegment(pose, recipe)).toBeLessThan(0.001);
    }

    const cityRecipe = residentRecipes(
      settlement("vesper-crown").x,
      settlement("vesper-crown").z,
    )[0];
    expect(cityRecipe?.source).toBe("settlement");
    if (cityRecipe) expect(Object.values(sampleCitizenPose(cityRecipe, 2)).every(Number.isFinite)).toBe(true);

    const bridgeX = riverCenterX(0);
    const bridgeRecipe = {
      ...recipe,
      source: "road" as const,
      roadClass: "trunk" as const,
      start: { x: bridgeX, z: 0 },
      end: { x: bridgeX + 20, z: 0 },
      phase: 0,
    };
    expect(sampleCitizenPose(bridgeRecipe, 0).y).toBeCloseTo(WATER_LEVEL + 0.39);
  });

  it("covers every road class and both village street orientations", () => {
    for (const roadClass of ["trunk", "regional", "local"] as const) {
      const corridor = ROAD_CORRIDORS.find((candidate) => candidate.class === roadClass);
      expect(corridor).toBeDefined();
      if (!corridor) continue;
      const midpoint = worldToChunk(
        (corridor.from.x + corridor.to.x) / 2,
        (corridor.from.z + corridor.to.z) / 2,
      );
      expect(roadSegmentsForChunk(midpoint.x, midpoint.z).some(
        (segment) => segment.corridorId === corridor.id,
      )).toBe(true);
      generateCitizenChunk(midpoint.x, midpoint.z);
    }

    for (const village of SETTLEMENTS.filter((candidate) => candidate.tier === "village")) {
      const chunk = worldToChunk(village.x, village.z);
      expect(settlementStreetSegmentsForChunk(chunk.x, chunk.z).some(
        (street) => street.settlementId === village.id,
      )).toBe(true);
    }

    expect(distanceToPathSegment(
      { x: 3, z: 4 },
      { start: { x: 0, z: 0 }, end: { x: 0, z: 0 } },
    )).toBe(5);
  });

  it("enforces quality caps and density bands", () => {
    expect(visibleCitizenCount(MAX_CITIZENS_PER_CHUNK, "cinematic") * CITIZEN_RESIDENT_CHUNKS).toBeLessThanOrEqual(
      MAX_RESIDENT_CITIZENS.cinematic,
    );
    expect(visibleCitizenCount(MAX_CITIZENS_PER_CHUNK, "performance") * CITIZEN_RESIDENT_CHUNKS).toBeLessThanOrEqual(
      MAX_RESIDENT_CITIZENS.performance,
    );
    expect(visibleCitizenCount(1, "performance")).toBe(1);
    expect(visibleCitizenCount(0, "cinematic")).toBe(0);
    expect(crowdDensityForCount(8)).toBe("QUIET");
    expect(crowdDensityForCount(80)).toBe("LOCAL");
    expect(crowdDensityForCount(500)).toBe("ACTIVE");
    expect(crowdDensityForCount(1_500)).toBe("BUSY");
    expect(crowdDensityForCount(4_000)).toBe("SURGE");
  });

  it("never exposes interaction, inventory, dialogue, or collision fields", () => {
    const citizen = residentRecipes(settlement("vesper-crown").x, settlement("vesper-crown").z)[0];
    expect(citizen).toBeDefined();
    if (!citizen) return;
    for (const forbidden of ["action", "item", "beaconId", "hits", "dialogue", "collider"]) {
      expect(forbidden in citizen).toBe(false);
    }
  });
});
