import { describe, expect, it } from "vitest";
import {
  DEVELOPER_QUICK_START,
  PLAYER_START_POSE,
  SESSION_PROFILES,
  sessionPersists,
} from "../../lib/game/session/sessionPresets";
import { DEVELOPER_SPEED_PROFILES } from "../../lib/game/developer/PlayerSandbox";

describe("session launch profiles", () => {
  it("defines one deterministic, isolated developer quick start", () => {
    expect(PLAYER_START_POSE).toEqual({
      x: 0,
      z: 8,
      yaw: -0.565,
      pitch: -0.035,
    });
    expect(DEVELOPER_QUICK_START).toMatchObject({
      mode: "developer",
      persistence: "ephemeral",
      worldMinutes: 720,
      weatherId: "fair",
      player: {
        invincible: true,
        speedMode: "veryFast",
        fly: true,
      },
    });
    expect(DEVELOPER_SPEED_PROFILES[DEVELOPER_QUICK_START.player.speedMode].multiplier)
      .toBe(20);
    expect(sessionPersists("developer")).toBe(false);
    expect(sessionPersists("survey")).toBe(true);
    expect(sessionPersists(DEVELOPER_QUICK_START.mode)).toBe(
      SESSION_PROFILES[DEVELOPER_QUICK_START.mode].persistence === "persistent",
    );
    expect(SESSION_PROFILES.survey.persistence).toBe("persistent");
  });
});
