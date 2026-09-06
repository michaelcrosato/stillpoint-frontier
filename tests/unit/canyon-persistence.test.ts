import { describe, expect, it } from "vitest";
import { SaveStore, createEmptyFrontierSave } from "../../lib/game/persistence/SaveStore";
import { canyonChannelOffset, canyonWorldCoordinates } from "../../lib/game/world/canyonLandmark";
import { normalizePlacedEntities, type PlacedEntity } from "../../lib/game/world/deployments";
import { sampleTerrainHeight } from "../../lib/game/world/terrain";
import { isWorldWaterAt } from "../../lib/game/world/worldWater";

describe("canyon survey persistence", () => {
  const ground = canyonWorldCoordinates(0, canyonChannelOffset(0) + 100);
  const y = sampleTerrainHeight(ground.x, ground.z);
  const placement: PlacedEntity = {
    id: "placed:bedroll:1", archetypeId: "bedroll", ...ground, y, yaw: 0,
  };

  it("keeps a player and camp on dry ground below the old save limit", () => {
    expect(y).toBeLessThan(-600);
    expect(isWorldWaterAt(ground.x, ground.z, 2)).toBe(false);
    expect(normalizePlacedEntities([placement])).toEqual([placement]);
    let raw: string | null = null;
    const store = new SaveStore({
      getItem: () => raw,
      setItem: (_key, value) => { raw = value; },
    });
    const save = createEmptyFrontierSave();
    const player = { ...ground, y, yaw: 0, pitch: 0, health: 80, wetness: 0.2, coldStress: 0 };
    expect(store.save({
      ...save, player,
      featureProgress: { ...save.featureProgress, placedEntities: [placement], nextPlacedSerial: 2 },
    })).toBe(true);
    expect(store.load()).toMatchObject({
      version: 8, player,
      featureProgress: { placedEntities: [placement], nextPlacedSerial: 2 },
    });
  });

  it.each([-1_001, 5_001, Infinity, -Infinity, NaN])(
    "still rejects an invalid player and placement height: %s", (height) => {
      expect(normalizePlacedEntities([{ ...placement, y: height }])).toEqual([]);
      const save = createEmptyFrontierSave();
      const raw = JSON.stringify({
        ...save,
        player: { ...ground, y: height, yaw: 0, pitch: 0 },
      });
      const store = new SaveStore({ getItem: () => raw, setItem() {} });
      expect(store.load().player).toBeNull();
    },
  );
});
