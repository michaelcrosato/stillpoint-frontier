import { describe, expect, it } from "vitest";
import {
  accumulateCameraWheelDelta,
  normalizeCameraWheelDelta,
} from "../../lib/game/input/InputManager";

describe("camera wheel normalization", () => {
  it("normalizes pixel, line, and page units into bounded deltas", () => {
    expect(normalizeCameraWheelDelta(12, 0)).toBe(12);
    expect(normalizeCameraWheelDelta(-2, 1)).toBe(-36);
    expect(normalizeCameraWheelDelta(1, 2)).toBe(180);
    expect(normalizeCameraWheelDelta(50, 1)).toBe(240);
    expect(normalizeCameraWheelDelta(-50, 1)).toBe(-240);
  });

  it("rejects modified and malformed gestures", () => {
    expect(normalizeCameraWheelDelta(80, 0, true)).toBe(0);
    expect(normalizeCameraWheelDelta(Number.NaN, 0)).toBe(0);
  });

  it("preserves a multi-event frame up to the shared consumer limit", () => {
    expect(accumulateCameraWheelDelta(0, 240)).toBe(240);
    expect(accumulateCameraWheelDelta(240, 240)).toBe(480);
    expect(accumulateCameraWheelDelta(480, 120)).toBe(480);
    expect(accumulateCameraWheelDelta(-240, -240)).toBe(-480);
    expect(accumulateCameraWheelDelta(Number.NaN, Number.NaN)).toBe(0);
  });
});
