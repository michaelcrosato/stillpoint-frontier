import { describe, expect, it } from "vitest";
import { CHUNK_LOAD_RADIUS, CHUNK_SIZE } from "../../lib/game/config";
import {
  BIOMES,
  ROAD_LINKS,
  SETTLEMENTS,
  WORLD_AREA_KM2,
  WORLD_HALF_EXTENT,
  riverCenterX,
  roadEndpoints,
  sampleClimate,
  siteSuitability,
} from "../../lib/game/world/macroWorld";
import { sampleTerrainHeight } from "../../lib/game/world/terrain";

describe("authored macro world", () => {
  it("is at least one hundred resident footprints in area", () => {
    const residentWidth = CHUNK_SIZE * (CHUNK_LOAD_RADIUS * 2 + 1);
    const residentAreaKm2 = (residentWidth * residentWidth) / 1_000_000;
    expect(WORLD_AREA_KM2 / residentAreaKm2).toBeGreaterThanOrEqual(100);
    expect(WORLD_AREA_KM2).toBe(9_216);
  });

  it("contains a useful, unique settlement hierarchy", () => {
    const tiers = (tier: string) => SETTLEMENTS.filter((settlement) => settlement.tier === tier);
    expect(tiers("megacity")).toHaveLength(1);
    expect(tiers("megacity")[0].population).toBeGreaterThanOrEqual(10_000_000);
    expect(tiers("megacity")[0].radius).toBeGreaterThanOrEqual(8_000);
    expect(tiers("city").length).toBeGreaterThanOrEqual(4);
    expect(tiers("town").length).toBeGreaterThanOrEqual(6);
    expect(tiers("village").length).toBeGreaterThanOrEqual(10);
    expect(new Set(SETTLEMENTS.map((settlement) => settlement.id)).size).toBe(SETTLEMENTS.length);
    for (const settlement of SETTLEMENTS) {
      expect(Math.abs(settlement.x)).toBeLessThan(WORLD_HALF_EXTENT);
      expect(Math.abs(settlement.z)).toBeLessThan(WORLD_HALF_EXTENT);
      expect(settlement.economy.length).toBeGreaterThan(8);
      expect(settlement.reason.length).toBeGreaterThan(30);
      expect(Object.values(siteSuitability(settlement.x, settlement.z)).every(Number.isFinite)).toBe(true);
    }
  });

  it("connects every settlement to the trade-road graph", () => {
    const neighbors = new Map<string, Set<string>>();
    for (const link of ROAD_LINKS) {
      expect(roadEndpoints(link)).not.toBeNull();
      if (!neighbors.has(link.from)) neighbors.set(link.from, new Set());
      if (!neighbors.has(link.to)) neighbors.set(link.to, new Set());
      neighbors.get(link.from)?.add(link.to);
      neighbors.get(link.to)?.add(link.from);
    }
    const visited = new Set<string>();
    const queue = [SETTLEMENTS[0].id];
    while (queue.length) {
      const id = queue.shift();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      queue.push(...(neighbors.get(id) ?? []));
    }
    expect(visited.size).toBe(SETTLEMENTS.length);
  });

  it("exposes every declared biome across the atlas", () => {
    const sampled = new Set<string>();
    for (let z = -WORLD_HALF_EXTENT; z <= WORLD_HALF_EXTENT; z += 2_000) {
      for (let x = -WORLD_HALF_EXTENT; x <= WORLD_HALF_EXTENT; x += 2_000) {
        sampled.add(sampleClimate(x, z).biome.id);
      }
    }
    expect(sampled).toEqual(new Set(Object.keys(BIOMES)));
  });

  it("keeps the Greywater channel deterministic and below its banks", () => {
    for (const z of [-35_000, -12_000, 0, 18_000, 35_000]) {
      const riverX = riverCenterX(z);
      expect(riverX).toBe(riverCenterX(z));
      expect(sampleTerrainHeight(riverX, z)).toBeLessThan(sampleTerrainHeight(riverX + 1_000, z));
    }
  });
});
