import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  SHADOW_DIRECTION_THRESHOLD_RADIANS,
  SHADOW_MOVEMENT_TOLERANCE_METERS,
  SHADOW_SAFETY_REFRESH_EVALUATIONS,
  ShadowUpdatePolicy,
} from "../../lib/game/rendering/ShadowUpdatePolicy";

const anchor = new THREE.Vector3(12, 4, -8);
const direction = new THREE.Vector3(0.4, 0.8, 0.3).normalize();
const axis = new THREE.Vector3(0.3, -0.2, 0.9).normalize();

function turned(radians: number) {
  return direction.clone().applyAxisAngle(axis, radians);
}

function rendered() {
  const policy = new ShadowUpdatePolicy();
  expect(policy.shouldRender(anchor, direction)).toBe(true);
  return policy;
}

describe("sun shadow update policy", () => {
  it("renders the first evaluation", () => {
    rendered();
  });

  it("skips an evaluation whose inputs have not changed", () => {
    expect(rendered().shouldRender(anchor.clone(), direction.clone())).toBe(false);
  });

  it("renders when the player has moved beyond the tolerance", () => {
    const policy = rendered();
    const moved = anchor.clone().setX(anchor.x + SHADOW_MOVEMENT_TOLERANCE_METERS * 1.5);
    expect(policy.shouldRender(moved, direction)).toBe(true);
    expect(policy.shouldRender(moved.clone(), direction)).toBe(false);
  });

  it("ignores movement within the tolerance", () => {
    const moved = anchor.clone().setZ(anchor.z + SHADOW_MOVEMENT_TOLERANCE_METERS * 0.4);
    expect(rendered().shouldRender(moved, direction)).toBe(false);
  });

  it("measures movement from the last rendered position, so a slow walk still updates", () => {
    const policy = rendered();
    const step = SHADOW_MOVEMENT_TOLERANCE_METERS * 0.4;
    expect(policy.shouldRender(anchor.clone().setX(anchor.x + step), direction)).toBe(false);
    expect(policy.shouldRender(anchor.clone().setX(anchor.x + step * 2), direction)).toBe(false);
    expect(policy.shouldRender(anchor.clone().setX(anchor.x + step * 3), direction)).toBe(true);
  });

  it("ignores a light turn below the threshold", () => {
    expect(rendered().shouldRender(anchor, turned(SHADOW_DIRECTION_THRESHOLD_RADIANS * 0.5)))
      .toBe(false);
  });

  it("renders a light turn above the threshold", () => {
    expect(rendered().shouldRender(anchor, turned(SHADOW_DIRECTION_THRESHOLD_RADIANS * 2)))
      .toBe(true);
  });

  it("measures turns from the last rendered direction, so a slow sun still updates", () => {
    const policy = rendered();
    const step = SHADOW_DIRECTION_THRESHOLD_RADIANS * 0.4;
    expect(policy.shouldRender(anchor, turned(step))).toBe(false);
    expect(policy.shouldRender(anchor, turned(step * 2))).toBe(false);
    expect(policy.shouldRender(anchor, turned(step * 3))).toBe(true);
  });

  it("renders exactly once after markDirty", () => {
    const policy = rendered();
    policy.markDirty("door");
    expect(policy.shouldRender(anchor, direction)).toBe(true);
    expect(policy.shouldRender(anchor, direction)).toBe(false);
    expect(policy.diagnostics.lastReason).toBe("door");
  });

  it("refreshes on the 30th idle evaluation in case a change went unreported", () => {
    expect(SHADOW_SAFETY_REFRESH_EVALUATIONS).toBe(30);
    const policy = rendered();
    for (let evaluation = 1; evaluation < SHADOW_SAFETY_REFRESH_EVALUATIONS; evaluation += 1) {
      expect(policy.shouldRender(anchor, direction)).toBe(false);
    }
    expect(policy.shouldRender(anchor, direction)).toBe(true);
    expect(policy.shouldRender(anchor, direction)).toBe(false);
  });

  it("counts renders and skips for diagnostics", () => {
    const policy = rendered();
    policy.shouldRender(anchor, direction);
    policy.shouldRender(anchor, direction);
    expect(policy.diagnostics).toMatchObject({ renders: 1, skipped: 2 });
  });
});
