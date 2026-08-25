import { describe, expect, it } from "vitest";
import { ANIMAL_RESIDENT_CHUNKS } from "../../lib/game/config";
import {
  ANIMAL_PROFILES,
  MAX_ANIMALS_PER_CHUNK,
  MAX_RESIDENT_ANIMALS,
  generateAnimalChunk,
  sampleAnimalPose,
  visibleAnimalCount,
} from "../../lib/game/animals/animalRecipes";
import { sampleClimate } from "../../lib/game/world/macroWorld";
import { chunkCenter } from "../../lib/game/world/terrain";

describe("ambient animal recipes", () => {
  it("is deterministic, sparse, and independent of generation order", () => {
    const coordinates = [
      { x: 0, z: 0 },
      { x: 80, z: -120 },
      { x: -220, z: 160 },
      { x: 320, z: 260 },
    ];
    const forward = coordinates.flatMap(({ x, z }) => generateAnimalChunk(x, z));
    const reverse = [...coordinates]
      .reverse()
      .flatMap(({ x, z }) => generateAnimalChunk(x, z))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(forward.sort((a, b) => a.id.localeCompare(b.id))).toEqual(reverse);
    for (const coordinate of coordinates) {
      const first = generateAnimalChunk(coordinate.x, coordinate.z);
      const second = generateAnimalChunk(coordinate.x, coordinate.z);
      expect(first).toEqual(second);
      expect(first.length).toBeLessThanOrEqual(MAX_ANIMALS_PER_CHUNK);
      expect(new Set(first.map((recipe) => recipe.id)).size).toBe(first.length);
    }
  });

  it("populates the atlas with habitat-correct species while leaving many chunks empty", () => {
    const observedSpecies = new Set<string>();
    let emptyChunks = 0;
    let populatedChunks = 0;
    for (let chunkZ = -480; chunkZ <= 480; chunkZ += 60) {
      for (let chunkX = -480; chunkX <= 480; chunkX += 60) {
        const recipes = generateAnimalChunk(chunkX, chunkZ);
        if (recipes.length === 0) emptyChunks += 1;
        else populatedChunks += 1;
        const center = chunkCenter({ x: chunkX, z: chunkZ });
        const biomeId = sampleClimate(center.x, center.z).biome.id;
        const allowed = new Set(ANIMAL_PROFILES[biomeId].map((entry) => entry.id));
        for (const recipe of recipes) {
          expect(allowed.has(recipe.speciesId)).toBe(true);
          expect(Number.isFinite(recipe.x)).toBe(true);
          expect(Number.isFinite(recipe.z)).toBe(true);
          expect(Math.abs(recipe.x - center.x)).toBeLessThan(48);
          expect(Math.abs(recipe.z - center.z)).toBeLessThan(48);
          observedSpecies.add(recipe.speciesId);
        }
      }
    }
    expect(emptyChunks).toBeGreaterThan(populatedChunks);
    expect(populatedChunks).toBeGreaterThan(10);
    expect(observedSpecies.size).toBeGreaterThanOrEqual(7);
  });

  it("returns finite rigid poses and enforces resident quality caps", () => {
    const recipe = (() => {
      for (let z = -40; z <= 40; z += 1) {
        for (let x = -40; x <= 40; x += 1) {
          const candidate = generateAnimalChunk(x, z)[0];
          if (candidate) return candidate;
        }
      }
      return null;
    })();
    expect(recipe).not.toBeNull();
    if (!recipe) return;
    for (const time of [-100, 0, 1 / 120, 10_000, Number.NaN, Number.POSITIVE_INFINITY]) {
      const pose = sampleAnimalPose(recipe, time);
      expect(Object.values(pose).every(Number.isFinite)).toBe(true);
    }
    const maximumGenerated = ANIMAL_RESIDENT_CHUNKS * MAX_ANIMALS_PER_CHUNK;
    expect(visibleAnimalCount(maximumGenerated, "cinematic")).toBe(
      MAX_RESIDENT_ANIMALS.cinematic,
    );
    expect(visibleAnimalCount(maximumGenerated, "performance")).toBe(
      MAX_RESIDENT_ANIMALS.performance,
    );
  });
});
