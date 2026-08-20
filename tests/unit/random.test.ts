import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { hashString, mulberry32, randomRange, seededRandom } from "../../lib/game/core/random";

describe("seeded random", () => {
  it("replays the exact same sequence for the same seed", () => {
    const first = seededRandom("frontier:0:0");
    const second = seededRandom("frontier:0:0");
    expect(Array.from({ length: 32 }, first)).toEqual(Array.from({ length: 32 }, second));
  });

  it("separates different world seeds", () => {
    const first = seededRandom("frontier:0:0");
    const second = seededRandom("frontier:0:1");
    expect(Array.from({ length: 8 }, first)).not.toEqual(Array.from({ length: 8 }, second));
  });

  it("hashes text to stable unsigned values", () => {
    expect(hashString("STILL-0317")).toBe(hashString("STILL-0317"));
    expect(hashString("STILL-0317")).toBeGreaterThanOrEqual(0);
    expect(hashString("STILL-0317")).toBeLessThanOrEqual(0xffffffff);
  });

  it("always returns values in the PRNG contract", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const random = mulberry32(seed);
        for (let index = 0; index < 100; index += 1) {
          const value = random();
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThan(1);
        }
      }),
    );
  });

  it("maps random values into a requested range", () => {
    expect(randomRange(() => 0, -4, 6)).toBe(-4);
    expect(randomRange(() => 0.5, -4, 6)).toBe(1);
    expect(randomRange(() => 1, -4, 6)).toBe(6);
  });
});
