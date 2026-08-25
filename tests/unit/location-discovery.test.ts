import { describe, expect, it } from "vitest";
import {
  DISCOVERABLE_LOCATIONS,
  addLocationDiscovery,
  currentDiscoverableLocation,
  getDiscoverableLocation,
  isKnownLocationId,
} from "../../lib/game/world/locationDiscovery";
import { getSettlement } from "../../lib/game/world/macroWorld";

describe("location discovery", () => {
  it("prioritizes the spawn landmark over its underlying biome", () => {
    expect(currentDiscoverableLocation(0, 8).id).toBe("landmark:field-unit-compound");
  });

  it("prioritizes settlements at their authored boundary", () => {
    const dustmere = getSettlement("dustmere")!;
    expect(currentDiscoverableLocation(dustmere.x, dustmere.z).id).toBe("settlement:dustmere");
    expect(currentDiscoverableLocation(dustmere.x + dustmere.radius, dustmere.z).id).toBe("settlement:dustmere");
  });

  it("falls back to a biome everywhere else in the atlas", () => {
    expect(currentDiscoverableLocation(-20_000, -20_000).kind).toBe("biome");
  });

  it("deduplicates known IDs and rejects invented locations", () => {
    const once = addLocationDiscovery([], "settlement:dustmere");
    expect(addLocationDiscovery(once, "settlement:dustmere")).toEqual(once);
    expect(addLocationDiscovery(once, "settlement:invented")).toEqual(once);
  });

  it("publishes a unique immutable catalog with usable copy", () => {
    const ids = DISCOVERABLE_LOCATIONS.map((location) => location.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DISCOVERABLE_LOCATIONS.every((location) => location.name && location.note)).toBe(true);
    expect(isKnownLocationId("biome:grey_meadow")).toBe(true);
    expect(getDiscoverableLocation("missing")).toBeNull();
  });
});
