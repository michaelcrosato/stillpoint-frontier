import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { resolveCircleMovement } from "../../lib/game/systems/collision";

const collider = { id: "rock", x: 0, z: 0, radius: 2 };

describe("player collision", () => {
  it("does not alter a clear movement", () => {
    expect(resolveCircleMovement({ x: 5, z: 5 }, { x: 6, z: 5 }, [collider], 0.5)).toEqual({
      x: 6,
      z: 5,
    });
  });

  it("depenetrates to the combined radius", () => {
    const resolved = resolveCircleMovement({ x: 4, z: 0 }, { x: 1, z: 0 }, [collider], 0.5);
    expect(resolved.x).toBeCloseTo(2.5);
    expect(resolved.z).toBeCloseTo(0);
  });

  it("uses the incoming direction when centered exactly on a collider", () => {
    const resolved = resolveCircleMovement({ x: -4, z: 0 }, { x: 0, z: 0 }, [collider], 0.5);
    expect(resolved.x).toBeCloseTo(-2.5);
  });

  it("never leaves a player inside a single static collider", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -2, max: 2, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -2, max: 2, noNaN: true, noDefaultInfinity: true }),
        (x, z) => {
          const resolved = resolveCircleMovement({ x: 5, z: 0 }, { x, z }, [collider], 0.5);
          expect(Math.hypot(resolved.x, resolved.z)).toBeGreaterThanOrEqual(2.5 - 1e-9);
        },
      ),
    );
  });

  it("supports worlds with no colliders", () => {
    expect(resolveCircleMovement({ x: 0, z: 0 }, { x: 1, z: 2 }, [], 0.5)).toEqual({ x: 1, z: 2 });
  });
});
