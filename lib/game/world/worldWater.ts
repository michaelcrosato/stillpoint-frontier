import {
  WORLD_MODEL_SCALE,
  distanceToRiver,
  riverWidth,
} from "./macroWorld";
import { isCanopyBenchmarkLake } from "./benchmarkZone";
import { isCanyonRiverAt } from "./canyonLandmark";

/** Coordinate-based water membership; elevation alone is not water. */
export function isWorldWaterAt(x: number, z: number, padding = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return true;
  const safePadding = Math.max(0, Number.isFinite(padding) ? padding : 0);
  if (distanceToRiver(x, z) <= riverWidth(z) + safePadding) return true;
  if (z >= 4_900 * WORLD_MODEL_SCALE - safePadding) return true;
  if (isCanopyBenchmarkLake(x, z, safePadding)) return true;
  return isCanyonRiverAt(x, z, safePadding);
}
