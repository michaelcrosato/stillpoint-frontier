import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  PlanarCollisionIndex,
  colliderIntersectsVerticalRange,
  isColliderLineOfSightClear,
  isPlanarPositionClear,
  isTerrainLineOfSightClear,
  resolvePlanarMovement,
  type BoxCollider,
  type CircleCollider,
  type PlanarCollider,
} from "../../lib/game/systems/collision";

const PLAYER_RADIUS = 0.5;
const circle: CircleCollider = {
  shape: "circle",
  id: "rock",
  x: 0,
  z: 0,
  radius: 1,
};
const building: BoxCollider = {
  shape: "box",
  id: "building",
  x: 0,
  z: 0,
  halfWidth: 1,
  halfDepth: 1,
  rotation: 0,
};

function expectClear(position: { x: number; z: number }, colliders: readonly PlanarCollider[]) {
  expect(isPlanarPositionClear(position, colliders, PLAYER_RADIUS)).toBe(true);
}

describe("continuous player collision", () => {
  it("treats omitted vertical bounds as infinite and bounded floors independently", () => {
    expect(colliderIntersectsVerticalRange(circle, 100, 102)).toBe(true);
    const upperWall: BoxCollider = {
      ...building,
      id: "upper-wall",
      minY: 3.5,
      maxY: 7,
    };
    expect(colliderIntersectsVerticalRange(upperWall, 0, 1.72)).toBe(false);
    expect(colliderIntersectsVerticalRange(upperWall, 3.5, 5.22)).toBe(true);
    expect(colliderIntersectsVerticalRange(upperWall, Number.NaN, Infinity)).toBe(true);
  });

  it("does not alter clear movement or worlds without colliders", () => {
    expect(resolvePlanarMovement({ x: 5, z: 5 }, { x: 6, z: 5 }, [circle], PLAYER_RADIUS))
      .toEqual({ x: 6, z: 5 });
    expect(resolvePlanarMovement({ x: 0, z: 0 }, { x: 1, z: 2 }, [], PLAYER_RADIUS))
      .toEqual({ x: 1, z: 2 });
  });

  it("stops high-speed movement on the entry side of a circle", () => {
    const resolved = resolvePlanarMovement(
      { x: -8, z: 0 },
      { x: 8, z: 0 },
      [circle],
      PLAYER_RADIUS,
    );
    expect(resolved.x).toBeCloseTo(-1.5, 3);
    expect(resolved.x).toBeLessThan(-1.499);
    expect(resolved.z).toBeCloseTo(0);
    expectClear(resolved, [circle]);
  });

  it("allows an exact tangent and a near miss", () => {
    expect(resolvePlanarMovement(
      { x: -4, z: 1.5 },
      { x: 4, z: 1.5 },
      [circle],
      PLAYER_RADIUS,
    )).toEqual({ x: 4, z: 1.5 });
    expect(resolvePlanarMovement(
      { x: -4, z: 1.501 },
      { x: 4, z: 1.501 },
      [circle],
      PLAYER_RADIUS,
    )).toEqual({ x: 4, z: 1.501 });
  });

  it("allows movement away from exact contact but blocks movement inward", () => {
    const contact = { x: -1.5, z: 0 };
    expect(resolvePlanarMovement(contact, { x: -3, z: 0 }, [circle], PLAYER_RADIUS))
      .toEqual({ x: -3, z: 0 });
    const inward = resolvePlanarMovement(contact, { x: 0, z: 0 }, [circle], PLAYER_RADIUS);
    expect(inward.x).toBeLessThan(-1.499);
    expectClear(inward, [circle]);
  });

  it("slides along a building wall without crossing it", () => {
    const wall: BoxCollider = {
      ...building,
      id: "long-wall",
      halfDepth: 10,
    };
    const resolved = resolvePlanarMovement(
      { x: -3, z: -4 },
      { x: 3, z: 4 },
      [wall],
      PLAYER_RADIUS,
    );
    expect(resolved.x).toBeCloseTo(-1.5, 3);
    expect(resolved.z).toBeCloseTo(4, 3);
    expectClear(resolved, [wall]);
  });

  it("cannot tunnel through a thin building at extreme speed", () => {
    const thinWall: BoxCollider = {
      ...building,
      halfWidth: 0.08,
      halfDepth: 6,
    };
    const resolved = resolvePlanarMovement(
      { x: -1_000, z: 0 },
      { x: 1_000, z: 0 },
      [thinWall],
      PLAYER_RADIUS,
    );
    expect(resolved.x).toBeCloseTo(-0.58, 3);
    expectClear(resolved, [thinWall]);
  });

  it("uses the rounded footprint at building corners without square snagging", () => {
    const hit = resolvePlanarMovement(
      { x: -3, z: 1.4 },
      { x: 3, z: 1.4 },
      [building],
      PLAYER_RADIUS,
    );
    expect(hit).not.toEqual({ x: 3, z: 1.4 });
    expect(hit.z).toBeGreaterThan(1.4);
    expectClear(hit, [building]);

    const nearMiss = resolvePlanarMovement(
      { x: -3, z: 1.501 },
      { x: 3, z: 1.501 },
      [building],
      PLAYER_RADIUS,
    );
    expect(nearMiss).toEqual({ x: 3, z: 1.501 });
  });

  it("resolves rotated building footprints and remains collision-free", () => {
    const rotated: BoxCollider = {
      ...building,
      id: "rotated-building",
      halfWidth: 2,
      halfDepth: 0.45,
      rotation: Math.PI / 4,
    };
    const resolved = resolvePlanarMovement(
      { x: -5, z: 0 },
      { x: 5, z: 0 },
      [rotated],
      PLAYER_RADIUS,
    );
    expect(resolved).not.toEqual({ x: 5, z: 0 });
    expect(Math.abs(resolved.z)).toBeGreaterThan(0.25);
    expectClear(resolved, [rotated]);
  });

  it("does not leak through perpendicular walls or their shared corner", () => {
    const colliders: PlanarCollider[] = [
      { ...building, id: "vertical", halfWidth: 0.1, halfDepth: 10 },
      { ...building, id: "horizontal", halfWidth: 10, halfDepth: 0.1 },
    ];
    const resolved = resolvePlanarMovement(
      { x: -3, z: -3 },
      { x: 3, z: 3 },
      colliders,
      PLAYER_RADIUS,
    );
    expect(resolved.x).toBeLessThanOrEqual(-0.599);
    expect(resolved.z).toBeLessThanOrEqual(-0.599);
    expectClear(resolved, colliders);
  });

  it("depenetrates an invalid spawn inside a box even with no intended movement", () => {
    const resolved = resolvePlanarMovement(
      { x: 0, z: 0 },
      { x: 0, z: 0 },
      [building],
      PLAYER_RADIUS,
    );
    expect(resolved.x).toBeGreaterThan(1.5);
    expect(resolved.z).toBeCloseTo(0);
    expectClear(resolved, [building]);
  });

  it("is deterministic and independent of collider array order", () => {
    const colliders: PlanarCollider[] = [
      { ...circle, id: "a", x: -0.8 },
      { ...building, id: "b", x: 1.4, rotation: 0.2 },
      { ...circle, id: "c", x: 3, z: 1.5, radius: 0.7 },
    ];
    const forward = resolvePlanarMovement(
      { x: -6, z: -2 },
      { x: 6, z: 2 },
      colliders,
      PLAYER_RADIUS,
    );
    const reverse = resolvePlanarMovement(
      { x: -6, z: -2 },
      { x: 6, z: 2 },
      [...colliders].reverse(),
      PLAYER_RADIUS,
    );
    expect(reverse.x).toBeCloseTo(forward.x, 9);
    expect(reverse.z).toBeCloseTo(forward.z, 9);
    expectClear(forward, colliders);
  });

  it("stays stable through repeated pressure into a corner", () => {
    const colliders: PlanarCollider[] = [
      { ...building, id: "vertical", halfWidth: 0.1, halfDepth: 10 },
      { ...building, id: "horizontal", halfWidth: 10, halfDepth: 0.1 },
    ];
    let position = { x: -1, z: -1 };
    for (let step = 0; step < 1_000; step += 1) {
      position = resolvePlanarMovement(
        position,
        { x: position.x + 0.2, z: position.z + 0.2 },
        colliders,
        PLAYER_RADIUS,
      );
      expect(Object.values(position).every(Number.isFinite)).toBe(true);
      expectClear(position, colliders);
    }
    expect(position.x).toBeCloseTo(-0.6, 3);
    expect(position.z).toBeCloseTo(-0.6, 3);
  });

  it("returns finite safe output for invalid requests and ignores malformed colliders", () => {
    const malformed = {
      shape: "circle",
      id: "bad",
      x: Number.NaN,
      z: 0,
      radius: Number.POSITIVE_INFINITY,
    } as CircleCollider;
    expect(resolvePlanarMovement(
      { x: 2, z: 3 },
      { x: Number.NaN, z: Number.POSITIVE_INFINITY },
      [malformed],
      Number.NaN,
    )).toEqual({ x: 2, z: 3 });
  });

  it("never leaves a feasible high-speed circle crossing overlapped", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 5, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.1, max: 2, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -0.95, max: 0.95, noNaN: true, noDefaultInfinity: true }),
        (obstacleRadius, playerRadius, verticalFactor) => {
          const combined = obstacleRadius + playerRadius;
          const obstacle: CircleCollider = { ...circle, radius: obstacleRadius };
          const z = verticalFactor * combined;
          const resolved = resolvePlanarMovement(
            { x: -combined - 20, z },
            { x: combined + 20, z },
            [obstacle],
            playerRadius,
          );
          expect(isPlanarPositionClear(resolved, [obstacle], playerRadius)).toBe(true);
          expect(Object.values(resolved).every(Number.isFinite)).toBe(true);
        },
      ),
      { numRuns: 250 },
    );
  });
});

describe("collision spatial index", () => {
  it("returns the same movement result as the full collider set", () => {
    const colliders: PlanarCollider[] = [
      { ...circle, id: "west", x: -7, z: 2, radius: 2 },
      { ...building, id: "center", rotation: 0.4, halfWidth: 3, halfDepth: 1 },
      { ...circle, id: "east", x: 8, z: -3, radius: 1.5 },
      { ...building, id: "north", x: 3, z: 9, rotation: -0.2 },
    ];
    const index = new PlanarCollisionIndex(4);
    index.rebuild(colliders);

    fc.assert(
      fc.property(
        fc.record({
          x: fc.double({ min: -20, max: 20, noNaN: true, noDefaultInfinity: true }),
          z: fc.double({ min: -20, max: 20, noNaN: true, noDefaultInfinity: true }),
        }),
        fc.record({
          x: fc.double({ min: -20, max: 20, noNaN: true, noDefaultInfinity: true }),
          z: fc.double({ min: -20, max: 20, noNaN: true, noDefaultInfinity: true }),
        }),
        (current, desired) => {
          const full = resolvePlanarMovement(current, desired, colliders, PLAYER_RADIUS);
          const indexed = resolvePlanarMovement(
            current,
            desired,
            index.querySweep(current, desired, PLAYER_RADIUS),
            PLAYER_RADIUS,
          );
          expect(indexed.x).toBeCloseTo(full.x, 9);
          expect(indexed.z).toBeCloseTo(full.z, 9);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("deduplicates colliders spanning several cells and validates its cell size", () => {
    const index = new PlanarCollisionIndex(1);
    index.rebuild([{ ...building, halfWidth: 4, halfDepth: 4 }]);
    expect(index.querySweep({ x: -8, z: 0 }, { x: 8, z: 0 }, PLAYER_RADIUS))
      .toHaveLength(1);
    expect(() => new PlanarCollisionIndex(0)).toThrow(/positive and finite/i);
  });
});

describe("line-of-sight collision", () => {
  const origin = { x: 0, y: 1.6, z: 0 };
  const target = { x: 0, y: 1.6, z: -4 };
  const wall: BoxCollider = {
    ...building,
    id: "sight-wall",
    z: -2,
    halfWidth: 2,
    halfDepth: 0.1,
    minY: 0,
    maxY: 3,
  };

  it("blocks an interior prism but respects height and ignored target surfaces", () => {
    expect(isColliderLineOfSightClear(origin, target, [wall])).toBe(false);
    expect(isColliderLineOfSightClear(
      { ...origin, y: 4 },
      { ...target, y: 4 },
      [wall],
    )).toBe(true);
    expect(isColliderLineOfSightClear(
      origin,
      target,
      [wall],
      new Set([wall.id]),
    )).toBe(true);
  });

  it("does not flicker closed on a mathematical tangent", () => {
    expect(isColliderLineOfSightClear(
      { x: 1, y: 1, z: -2 },
      { x: 1, y: 1, z: 2 },
      [{ ...circle, minY: 0, maxY: 2 }],
    )).toBe(true);
  });

  it("rejects terrain ridges while leaving a clear sampled segment visible", () => {
    const far = { x: 0, y: 1.6, z: -10 };
    expect(isTerrainLineOfSightClear(origin, far, () => 0)).toBe(true);
    expect(isTerrainLineOfSightClear(
      origin,
      far,
      (_x, z) => z < -4 && z > -6 ? 2.2 : 0,
    )).toBe(false);
    expect(isTerrainLineOfSightClear(origin, far, () => Number.NaN)).toBe(false);
  });
});
