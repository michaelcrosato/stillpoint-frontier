import { describe, expect, it } from "vitest";
import { BEACONS } from "../../lib/game/config";
import {
  FAST_TRAVEL_LOCATIONS,
  FAST_TRAVEL_PLAYTEST_UNLOCKED,
  getFastTravelLocation,
  resolveFastTravelArrival,
  type FastTravelLocation,
} from "../../lib/game/world/fastTravel";
import {
  SETTLEMENTS,
  WORLD_HALF_EXTENT,
  WORLD_MODEL_SCALE,
  distanceToRiver,
  riverWidth,
} from "../../lib/game/world/macroWorld";
import { sampleTerrainHeight } from "../../lib/game/world/terrain";
import {
  MOUNTAIN_LANDMARK,
  isMountainTrailClearing,
} from "../../lib/game/world/mountainLandmark";
import {
  CANYON_LANDMARK,
  isCanyonRimTrailClearing,
} from "../../lib/game/world/canyonLandmark";
import { AUTHORED_LANDMARK_WAYPOINTS } from "../../lib/game/world/authoredLandmarks";
import { isWorldWaterAt } from "../../lib/game/world/worldWater";

describe("temporary playtest fast travel", () => {
  it("unlocks every authored settlement and relay through unique stable IDs", () => {
    expect(FAST_TRAVEL_PLAYTEST_UNLOCKED).toBe(true);
    expect(FAST_TRAVEL_LOCATIONS).toHaveLength(
      SETTLEMENTS.length + BEACONS.length + AUTHORED_LANDMARK_WAYPOINTS.length,
    );
    expect(new Set(FAST_TRAVEL_LOCATIONS.map((location) => location.id)).size).toBe(
      FAST_TRAVEL_LOCATIONS.length,
    );
    expect(FAST_TRAVEL_LOCATIONS.filter((location) => location.kind === "relay")).toHaveLength(
      BEACONS.length,
    );
    expect(getFastTravelLocation("settlement:vesper-crown")?.name).toBe("Vesper Crown");
    expect(getFastTravelLocation("relay:amber-relay")?.name).toBe("Amber Relay");
    expect(getFastTravelLocation(MOUNTAIN_LANDMARK.fastTravelId)).toMatchObject({
      kind: "landmark",
      sourceId: MOUNTAIN_LANDMARK.id,
      x: MOUNTAIN_LANDMARK.baseWaypoint.x,
      z: MOUNTAIN_LANDMARK.baseWaypoint.z,
    });
    expect(getFastTravelLocation(CANYON_LANDMARK.fastTravelId)).toMatchObject({
      kind: "landmark",
      sourceId: CANYON_LANDMARK.id,
      x: CANYON_LANDMARK.overlookWaypoint.x,
      z: CANYON_LANDMARK.overlookWaypoint.z,
    });
    expect(getFastTravelLocation("invented:place")).toBeNull();
  });

  it("resolves deterministic, dry, bounded arrivals for every location tier", () => {
    const kinds = new Set<string>();
    for (const location of FAST_TRAVEL_LOCATIONS) {
      kinds.add(location.kind);
      const arrival = resolveFastTravelArrival(location);
      expect(resolveFastTravelArrival(location)).toEqual(arrival);
      expect(Object.values(arrival).every(Number.isFinite)).toBe(true);
      expect(Math.abs(arrival.x)).toBeLessThan(WORLD_HALF_EXTENT);
      expect(Math.abs(arrival.z)).toBeLessThan(WORLD_HALF_EXTENT);
      expect(arrival.y).toBe(sampleTerrainHeight(arrival.x, arrival.z));
      expect(isWorldWaterAt(arrival.x, arrival.z), location.id).toBe(false);
      expect(
        distanceToRiver(arrival.x, arrival.z) > riverWidth(arrival.z),
        location.id,
      ).toBe(true);
      expect(arrival.z, location.id).toBeLessThanOrEqual(4_900 * WORLD_MODEL_SCALE);
    }
    expect(kinds).toEqual(
      new Set(["megacity", "city", "town", "village", "relay", "landmark"]),
    );
  });

  it("tries another candidate when the preferred arrival is obstructed", () => {
    const location = getFastTravelLocation("relay:amber-relay");
    expect(location).not.toBeNull();
    if (!location) return;
    const preferred = resolveFastTravelArrival(location);
    const redirected = resolveFastTravelArrival(location, [
      { shape: "circle", id: "test-obstruction", x: preferred.x, z: preferred.z, radius: 4 },
    ]);
    expect(Math.hypot(redirected.x - preferred.x, redirected.z - preferred.z)).toBeGreaterThan(1);
    expect(Math.hypot(redirected.x - preferred.x, redirected.z - preferred.z)).toBeGreaterThan(
      4,
    );
  });

  it("arrives beside the Crownspire cairn on the cleared trail shoulder", () => {
    const location = getFastTravelLocation(MOUNTAIN_LANDMARK.fastTravelId);
    expect(location).not.toBeNull();
    if (!location) return;
    const arrival = resolveFastTravelArrival(location);
    expect(isMountainTrailClearing(arrival.x, arrival.z)).toBe(true);
    expect(Math.hypot(
      arrival.x - MOUNTAIN_LANDMARK.baseWaypoint.x,
      arrival.z - MOUNTAIN_LANDMARK.baseWaypoint.z,
    )).toBeGreaterThan(1.7);
  });

  it("arrives beside the Sunscar railing on the cleared rim trail shoulder", () => {
    const location = getFastTravelLocation(CANYON_LANDMARK.fastTravelId);
    expect(location).not.toBeNull();
    if (!location) return;
    const arrival = resolveFastTravelArrival(location);
    expect(isCanyonRimTrailClearing(arrival.x, arrival.z)).toBe(true);
    expect(isWorldWaterAt(arrival.x, arrival.z)).toBe(false);
    expect(Math.hypot(
      arrival.x - CANYON_LANDMARK.overlookWaypoint.x,
      arrival.z - CANYON_LANDMARK.overlookWaypoint.z,
    )).toBeGreaterThan(3.7);
  });

  it("contains edge locations and has a deterministic last-resort fallback", () => {
    const edge: FastTravelLocation = {
      id: "settlement:test-edge",
      sourceId: "test-edge",
      name: "Edge Test",
      kind: "village",
      x: WORLD_HALF_EXTENT + 500,
      z: -WORLD_HALF_EXTENT - 500,
      detail: "test",
    };
    const blocked = resolveFastTravelArrival(edge, [
      {
        shape: "circle",
        id: "world-blocker",
        x: 0,
        z: 0,
        radius: WORLD_HALF_EXTENT * 4,
      },
    ]);
    expect(blocked.x).toBeLessThanOrEqual(WORLD_HALF_EXTENT - 2);
    expect(blocked.z).toBeGreaterThanOrEqual(-WORLD_HALF_EXTENT + 2);
    expect(resolveFastTravelArrival(edge, [
      {
        shape: "circle",
        id: "world-blocker",
        x: 0,
        z: 0,
        radius: WORLD_HALF_EXTENT * 4,
      },
    ])).toEqual(blocked);
  });

  it("avoids oriented building footprints as well as circular obstacles", () => {
    const location = getFastTravelLocation("relay:hollow-array");
    expect(location).not.toBeNull();
    if (!location) return;
    const preferred = resolveFastTravelArrival(location);
    const redirected = resolveFastTravelArrival(location, [{
      shape: "box",
      id: "arrival-building",
      x: preferred.x,
      z: preferred.z,
      halfWidth: 12,
      halfDepth: 5,
      rotation: Math.PI / 5,
    }]);
    expect(redirected).not.toEqual(preferred);
  });
});
