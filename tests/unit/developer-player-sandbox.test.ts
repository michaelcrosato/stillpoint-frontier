import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEVELOPER_PLAYER_SANDBOX,
  DEVELOPER_SPEED_MODES,
  developerFlightDirection,
  developerSpeedMultiplier,
  isDeveloperSpeedMode,
  resetDeveloperPlayerSandbox,
} from "../../lib/game/developer/PlayerSandbox";

describe("developer player sandbox", () => {
  it("defines bounded discrete speed tiers and rejects unknown modes", () => {
    expect(DEVELOPER_SPEED_MODES).toEqual(["normal", "fast", "veryFast"]);
    expect(developerSpeedMultiplier("normal")).toBe(1);
    expect(developerSpeedMultiplier("fast")).toBe(3);
    expect(developerSpeedMultiplier("veryFast")).toBe(8);
    expect(isDeveloperSpeedMode("veryFast")).toBe(true);
    expect(isDeveloperSpeedMode("ludicrous")).toBe(false);
  });

  it("resets the shared runtime object without replacing its identity", () => {
    const state = { invincible: true, speedMode: "veryFast" as const, fly: true };
    expect(resetDeveloperPlayerSandbox(state)).toBe(state);
    expect(state).toEqual(DEFAULT_DEVELOPER_PLAYER_SANDBOX);
  });

  it("builds normalized camera-relative flight with cancelling vertical controls", () => {
    expect(developerFlightDirection({
      inputX: 0,
      inputZ: -1,
      ascend: false,
      descend: false,
      yaw: 0,
      pitch: 0,
    })).toEqual({ x: 0, y: 0, z: -1 });

    const pitched = developerFlightDirection({
      inputX: 1,
      inputZ: -1,
      ascend: true,
      descend: true,
      yaw: Math.PI / 2,
      pitch: 0.3,
    });
    expect(Math.hypot(pitched.x, pitched.y, pitched.z)).toBeCloseTo(1);
    expect(pitched.y).toBeGreaterThan(0);

    expect(developerFlightDirection({
      inputX: 0,
      inputZ: 0,
      ascend: true,
      descend: true,
      yaw: 0,
      pitch: 0,
    })).toEqual({ x: 0, y: 0, z: 0 });
  });
});
