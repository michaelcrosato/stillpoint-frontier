import { describe, expect, it, vi } from "vitest";
import {
  resampleGroundAnimalPose,
  resolveGroundAnimalMovement,
  type AnimalGroundNavigation,
} from "../../lib/game/animals/groundMotion";
import { isPlanarPositionClear, type PlanarCollider } from "../../lib/game/systems/collision";
import { WATER_LEVEL } from "../../lib/game/world/macroWorld";

describe("ground animal motion", () => {
  it("resamples the final reacted XZ position instead of retaining the route's stale Y", () => {
    const navigation: AnimalGroundNavigation = {
      sampleHeight: (x, z) => x * 0.5 - z * 0.25,
    };
    expect(
      resampleGroundAnimalPose(
        { x: 8, y: 99, z: -4, yaw: 0.7 },
        navigation,
      ),
    ).toEqual({ x: 8, y: 5, z: -4, yaw: 0.7 });
  });

  it("does not cross a wet strip even when both the start and destination are dry", () => {
    const navigation: AnimalGroundNavigation = {
      sampleHeight: (x) =>
        x > 0.55 && x < 1.45 ? WATER_LEVEL - 0.4 : WATER_LEVEL + 3,
    };
    const first = resolveGroundAnimalMovement(
      "animal:bank:test",
      { x: 0, z: 0 },
      { x: 2, z: 0 },
      { radius: 0.16, height: 0.8 },
      navigation,
    );
    const second = resolveGroundAnimalMovement(
      "animal:bank:test",
      { x: 0, z: 0 },
      { x: 2, z: 0 },
      { radius: 0.16, height: 0.8 },
      navigation,
    );

    expect(first).toEqual(second);
    expect(first).not.toEqual({ x: 2, z: 0 });
    expect(navigation.sampleHeight(first.x, first.z)).toBeGreaterThan(
      WATER_LEVEL + 0.18,
    );
  });

  it("queries vertically relevant colliders and returns a non-penetrating detour", () => {
    const blocker: PlanarCollider = {
      shape: "box",
      id: "tree:test",
      x: 1,
      z: 0,
      halfWidth: 0.25,
      halfDepth: 0.65,
      rotation: 0,
      minY: 1,
      maxY: 4,
    };
    const queryColliders = vi.fn(
      (
        _current: Readonly<{ x: number; z: number }>,
        _desired: Readonly<{ x: number; z: number }>,
        _radius: number,
        _minY: number,
        _maxY: number,
      ) => {
        void [_current, _desired, _radius, _minY, _maxY];
        return [blocker];
      },
    );
    const resolved = resolveGroundAnimalMovement(
      "animal:obstacle:test",
      { x: 0, z: 0 },
      { x: 2, z: 0 },
      { radius: 0.2, height: 0.9 },
      {
        sampleHeight: () => 1,
        queryColliders,
      },
    );

    expect(queryColliders).toHaveBeenCalled();
    const [, , radius, minY, maxY] = queryColliders.mock.calls[0];
    expect(radius).toBe(0.2);
    expect(minY).toBe(1);
    expect(maxY).toBe(1.9);
    expect(isPlanarPositionClear(resolved, [blocker], 0.2)).toBe(true);
    expect(Math.hypot(resolved.x, resolved.z)).toBeGreaterThan(0.25);
  });

  it("contains invalid destinations without emitting non-finite coordinates", () => {
    const resolved = resolveGroundAnimalMovement(
      "animal:corrupt:test",
      { x: 3, z: -2 },
      { x: Number.NaN, z: Number.POSITIVE_INFINITY },
      { radius: Number.NaN, height: Number.NaN },
      { sampleHeight: () => 2 },
    );
    expect(resolved).toEqual({ x: 3, z: -2 });
  });
});
