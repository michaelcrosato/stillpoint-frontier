import type { GameSystem } from "../core/SystemPipeline";
import type { GameRuntimeContext } from "./runtime";

export class CameraControlSystem implements GameSystem<GameRuntimeContext> {
  readonly id = "camera-control";
  readonly order = 11;

  update(context: GameRuntimeContext) {
    const zoomDelta = context.input.consumeCameraZoomDelta();
    const cyclePressed = context.input.consumeActionPressed("cameraView");
    if (!context.started || context.paused) return;
    if (zoomDelta !== 0) context.adjustCameraZoom(zoomDelta);
    if (cyclePressed) context.cycleCameraView();
  }
}
