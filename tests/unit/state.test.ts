import { describe, expect, it } from "vitest";
import { addDiscovery, nextUnscannedBeacon } from "../../lib/game/state";

describe("survey progression", () => {
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
