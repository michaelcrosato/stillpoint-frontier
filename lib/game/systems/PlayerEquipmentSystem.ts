import type { GameSystem } from "../core/SystemPipeline";
import type { GameRuntimeContext } from "./runtime";

export class PlayerEquipmentSystem implements GameSystem<GameRuntimeContext> {
  readonly id = "player-equipment";
  readonly order = 12;

  update(context: GameRuntimeContext) {
    const togglePressed = context.input.consumeActionPressed("flashlight");
    if (togglePressed && context.started && !context.paused) {
      context.toggleFlashlight();
    }
  }
}
