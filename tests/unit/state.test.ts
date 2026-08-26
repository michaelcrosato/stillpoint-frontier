import { describe, expect, it } from "vitest";
import { INITIAL_SNAPSHOT, addDiscovery, nextUnscannedBeacon } from "../../lib/game/state";

describe("survey progression", () => {
  it("starts with developer tools disabled and the biome simulation in control", () => {
    expect(INITIAL_SNAPSHOT.devTools).toMatchObject({
      enabled: false,
      panelOpen: false,
      clockPaused: false,
      weatherOverride: null,
      player: {
        invincible: false,
        speedMode: "normal",
        fly: false,
      },
    });
    expect(INITIAL_SNAPSHOT.devTools.weatherOptions.length).toBeGreaterThan(1);
    expect(INITIAL_SNAPSHOT.environment.clockState).toBe("paused");
    expect(INITIAL_SNAPSHOT.environment.gameMinutesPerRealSecond).toBe(1);
    expect(INITIAL_SNAPSHOT.horizonMode).toBe("standard");
    expect(INITIAL_SNAPSHOT.settings.worldDetail).toBe(2);
    expect(INITIAL_SNAPSHOT.horizonNearCellSize).toBe(24);
    expect(INITIAL_SNAPSHOT.drawDistanceMeters).toBeGreaterThan(0);
    expect(INITIAL_SNAPSHOT.horizonTiles).toBe(0);
    expect(INITIAL_SNAPSHOT.flashlightOn).toBe(false);
    expect(INITIAL_SNAPSHOT.health).toBe(100);
    expect(INITIAL_SNAPSHOT.incapacitated).toBe(false);
    expect(INITIAL_SNAPSHOT.conditions).toEqual([]);
    expect(INITIAL_SNAPSHOT.inventoryOpen).toBe(false);
    expect(INITIAL_SNAPSHOT.settingsOpen).toBe(false);
    expect(INITIAL_SNAPSHOT.settings.interfaceScale).toBe("standard");
    expect(INITIAL_SNAPSHOT.currentLocation.id).toBe("landmark:field-unit-compound");
  });
  it("adds each discovery exactly once", () => {
    const once = addDiscovery([], "amber-relay");
    const twice = addDiscovery(once, "amber-relay");
    expect(once).toEqual(["amber-relay"]);
    expect(twice).toEqual(["amber-relay"]);
    expect(twice).not.toBe(once);
  });

  it("returns the next relay in directive order", () => {
    expect(nextUnscannedBeacon([])?.id).toBe("amber-relay");
    expect(nextUnscannedBeacon(["amber-relay"])?.id).toBe("hollow-array");
    expect(nextUnscannedBeacon(["amber-relay", "hollow-array"])?.id).toBe("meridian-vault");
  });

  it("returns null when the survey is complete", () => {
    expect(nextUnscannedBeacon(["amber-relay", "hollow-array", "meridian-vault"])).toBeNull();
  });
});
