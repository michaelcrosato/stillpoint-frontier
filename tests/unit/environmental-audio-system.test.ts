import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { EnvironmentalAudioSystem } from "../../lib/game/systems/EnvironmentalAudioSystem";
import type { GameRuntimeContext } from "../../lib/game/systems/runtime";

function runtime() {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.72, 8);
  return {
    started: true,
    paused: false,
    player: {
      position: new THREE.Vector3(0, 0, 8),
      grounded: true,
      sprinting: false,
      crouching: false,
      sheltered: false,
    },
    environment: {
      getSample: () => ({
        windKph: 20,
        precipitation: "none",
        precipitationRate: 0,
        night: 0,
      }),
    },
    animals: { visibleCount: 3 },
    camera,
    audio: {
      setListenerPose: vi.fn(),
      updateMix: vi.fn(),
      playFootstep: vi.fn(),
    },
  } as unknown as GameRuntimeContext;
}

describe("environmental audio system", () => {
  it("updates a bounded ambient mix and steps by distance", () => {
    const context = runtime();
    const system = new EnvironmentalAudioSystem();
    system.update(context);
    expect(context.audio.setListenerPose).toHaveBeenCalledTimes(1);
    expect(context.audio.updateMix).toHaveBeenCalledTimes(1);
    expect(context.audio.playFootstep).not.toHaveBeenCalled();

    context.player.position.x += 1.2;
    system.update(context);
    expect(context.audio.playFootstep).toHaveBeenCalledTimes(1);
    expect(context.audio.playFootstep).toHaveBeenCalledWith(
      "grass",
      0.78,
      expect.objectContaining({ referenceDistance: 1.2, maxDistance: 12 }),
    );
  });

  it("silences the mix and resets cadence while paused", () => {
    const context = runtime();
    context.paused = true;
    new EnvironmentalAudioSystem().update(context);
    expect(context.audio.updateMix).toHaveBeenCalledWith(expect.objectContaining({
      wind: 0,
      weather: 0,
    }));
    expect(context.audio.playFootstep).not.toHaveBeenCalled();
  });
});
