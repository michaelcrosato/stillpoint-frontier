import * as THREE from "three";
import {
  DETAILED_TERRAIN_HALF_EXTENT,
  WORLD_SEED,
} from "../config";
import { seededRandom } from "../core/random";
import type { WorldLodPolicy } from "./WorldLodPolicy";
import {
  WATER_LEVEL,
  WORLD_HALF_EXTENT,
  riverWidth,
  sampleClimate,
} from "./macroWorld";
import { proceduralSurfaceColor } from "./surfaceVariation";
import { sampleTerrainHeightLod } from "./terrain";
import { selectWoodySpecies } from "./vegetation";
import { isCanopyBenchmarkClearing } from "./benchmarkZone";

export interface HorizonTreeRecipe {
  kind: "tree";
  x: number;
  y: number;
  z: number;
  yaw: number;
  height: number;
  width: number;
  trunkColor: number;
  foliageColor: number;
}

export interface HorizonRockRecipe {
  kind: "rock";
  x: number;
  y: number;
  z: number;
  yaw: number;
  height: number;
  width: number;
  color: number;
}

export type HorizonSceneryRecipe = HorizonTreeRecipe | HorizonRockRecipe;

/**
 * Stable visual-only silhouettes for the gap between populated chunks and the
 * macro horizon. Recipes intentionally carry no collision, target, AI, light,
 * resource, or persistence data.
 */
export function horizonSceneryRecipes(
  anchorX: number,
  anchorZ: number,
  policy: Readonly<WorldLodPolicy>,
): HorizonSceneryRecipe[] {
  if (
    policy.sceneryDensity <= 0 ||
    policy.sceneryOuter <= DETAILED_TERRAIN_HALF_EXTENT ||
    policy.maxSceneryInstances <= 0
  ) {
    return [];
  }

  const recipes: HorizonSceneryRecipe[] = [];
  const spacing = policy.scenerySpacing;
  const minimumGridX = Math.floor((anchorX - policy.sceneryOuter) / spacing);
  const maximumGridX = Math.ceil((anchorX + policy.sceneryOuter) / spacing);
  const minimumGridZ = Math.floor((anchorZ - policy.sceneryOuter) / spacing);
  const maximumGridZ = Math.ceil((anchorZ + policy.sceneryOuter) / spacing);
  const rockColor = new THREE.Color();

  for (let gridZ = minimumGridZ; gridZ <= maximumGridZ; gridZ += 1) {
    for (let gridX = minimumGridX; gridX <= maximumGridX; gridX += 1) {
      const random = seededRandom(`${WORLD_SEED}:scenery-lod:v1:${gridX}:${gridZ}`);
      const x = (gridX + 0.5 + (random() - 0.5) * 0.72) * spacing;
      const z = (gridZ + 0.5 + (random() - 0.5) * 0.72) * spacing;
      const distance = Math.max(Math.abs(x - anchorX), Math.abs(z - anchorZ));
      if (
        distance <= DETAILED_TERRAIN_HALF_EXTENT + spacing * 0.28 ||
        distance > policy.sceneryOuter ||
        Math.abs(x) > WORLD_HALF_EXTENT ||
        Math.abs(z) > WORLD_HALF_EXTENT
      ) {
        continue;
      }

      const climate = sampleClimate(x, z);
      if (climate.riverDistance <= riverWidth(z) + 12) continue;
      if (isCanopyBenchmarkClearing(x, z, 2)) continue;
      const y = sampleTerrainHeightLod(x, z, policy.nearCellSize);
      if (y <= WATER_LEVEL + 0.3) continue;

      const treeChance = climate.biome.treeDensity * policy.sceneryDensity * 0.44;
      const rockChance = climate.biome.rockDensity * policy.sceneryDensity * 0.31;
      const selection = random();
      if (selection < treeChance) {
        const species = selectWoodySpecies(climate.biome.id, random());
        if (!species) continue;
        const height = THREE.MathUtils.lerp(5.2, 10.8, random()) * species.relativeHeight;
        recipes.push({
          kind: "tree",
          x,
          y,
          z,
          yaw: random() * Math.PI * 2,
          height,
          width:
            height * THREE.MathUtils.lerp(0.2, 0.31, random()) * species.relativeWidth,
          trunkColor: species.trunkColor,
          foliageColor: random() < 0.28
            ? species.accentColor
            : species.foliageColor,
        });
      } else if (selection < treeChance + rockChance) {
        const height = THREE.MathUtils.lerp(0.65, 2.45, random());
        recipes.push({
          kind: "rock",
          x,
          y,
          z,
          yaw: random() * Math.PI,
          height,
          width: height * THREE.MathUtils.lerp(0.8, 1.75, random()),
          color: proceduralSurfaceColor(
            rockColor,
            0x5d584c,
            "rock",
            x,
            z,
          ).getHex(),
        });
      }

      if (recipes.length >= policy.maxSceneryInstances) return recipes;
    }
  }
  return recipes;
}
