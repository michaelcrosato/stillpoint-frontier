import { describe, expect, it } from "vitest";
import { INSPECTABLES, createInspectableTarget } from "../../lib/game/world/inspectables";

describe("spawn inspectables", () => {
  it("uses unique stable IDs and complete readable records", () => {
    expect(new Set(INSPECTABLES.map((item) => item.id)).size).toBe(INSPECTABLES.length);
    expect(INSPECTABLES).toHaveLength(3);
    expect(INSPECTABLES.every((item) => item.title && item.body && item.source)).toBe(true);
  });

  it("creates low-cost inspect targets for both quality profiles", () => {
    for (const quality of ["cinematic", "performance"] as const) {
      const target = createInspectableTarget(INSPECTABLES[0], quality);
      expect(target.kind).toBe("inspectable");
      expect(target.action).toBe("inspect");
      expect(target.maxDistance).toBeLessThanOrEqual(5);
      expect(target.inspection?.body).toBe(INSPECTABLES[0].body);
      expect(target.root.children).toHaveLength(3);
    }
  });
});
