import { describe, expect, it } from "vitest";
import { clipSegmentToRect } from "../../lib/game/world/geometry";

describe("macro feature clipping", () => {
  it("clips a road to a chunk rectangle", () => {
    expect(clipSegmentToRect({ x: -10, z: 5 }, { x: 20, z: 5 }, 0, 10, 0, 10)).toEqual({
      start: { x: 0, z: 5 },
      end: { x: 10, z: 5 },
    });
  });

  it("rejects a segment that misses the chunk", () => {
    expect(clipSegmentToRect({ x: -10, z: -5 }, { x: -2, z: -1 }, 0, 10, 0, 10)).toBeNull();
  });

  it("keeps a segment already inside", () => {
    expect(clipSegmentToRect({ x: 2, z: 3 }, { x: 7, z: 8 }, 0, 10, 0, 10)).toEqual({
      start: { x: 2, z: 3 },
      end: { x: 7, z: 8 },
    });
  });
});
