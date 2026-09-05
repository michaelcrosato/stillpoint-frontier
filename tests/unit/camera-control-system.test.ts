import { describe, expect, it, vi } from "vitest";
import { CameraControlSystem } from "../../lib/game/systems/CameraControlSystem";
import type { GameRuntimeContext } from "../../lib/game/systems/runtime";

function context({ started = true, paused = false, zoom = 120, cycle = true } = {}) {
  return {
    started,
    paused,
    input: {
      consumeCameraZoomDelta: vi.fn(() => zoom),
      consumeActionPressed: vi.fn((action: string) => cycle && action === "cameraView"),
    },
    adjustCameraZoom: vi.fn(),
    cycleCameraView: vi.fn(),
  } as unknown as GameRuntimeContext;
}

describe("camera control input", () => {
  it("routes wheel distance and the view-cycle action during active play", () => {
    const runtime = context();
    new CameraControlSystem().update(runtime);
    expect(runtime.input.consumeCameraZoomDelta).toHaveBeenCalledOnce();
    expect(runtime.input.consumeActionPressed).toHaveBeenCalledWith("cameraView");
    expect(runtime.adjustCameraZoom).toHaveBeenCalledWith(120);
    expect(runtime.cycleCameraView).toHaveBeenCalledOnce();
  });

  it("drains input without changing the view while inactive or paused", () => {
    for (const runtime of [context({ started: false }), context({ paused: true })]) {
      new CameraControlSystem().update(runtime);
      expect(runtime.input.consumeCameraZoomDelta).toHaveBeenCalledOnce();
      expect(runtime.input.consumeActionPressed).toHaveBeenCalledWith("cameraView");
      expect(runtime.adjustCameraZoom).not.toHaveBeenCalled();
      expect(runtime.cycleCameraView).not.toHaveBeenCalled();
    }
  });

  it("does not dispatch neutral input", () => {
    const runtime = context({ zoom: 0, cycle: false });
    new CameraControlSystem().update(runtime);
    expect(runtime.adjustCameraZoom).not.toHaveBeenCalled();
    expect(runtime.cycleCameraView).not.toHaveBeenCalled();
  });
});
