import type { GameSystem } from "../core/SystemPipeline";
import { stepPlayerCondition } from "../gameplay/playerCondition";
import type { GameRuntimeContext } from "./runtime";

export class PlayerConditionSystem implements GameSystem<GameRuntimeContext> {
  readonly id = "player-condition";
  readonly order = 11;

  update(context: GameRuntimeContext, deltaSeconds: number) {
    const recoverPressed = context.input.consumeActionPressed("recover");
    if (recoverPressed && context.player.condition.health <= 0) {
      context.recoverPlayer();
      return;
    }
    if (!context.started || context.paused || context.player.condition.health <= 0) return;
    const atmosphere = context.environment.getSample();
    context.player.sheltered = context.world.isShelteredAt(
      context.player.position.x,
      context.player.position.z,
      context.player.position.y,
    );
    context.player.condition = stepPlayerCondition(
      context.player.condition,
      {
        sheltered: context.player.sheltered,
        precipitation: atmosphere.precipitation,
        precipitationRate: atmosphere.precipitationRate,
        temperatureC: atmosphere.temperatureC,
        windKph: atmosphere.windKph,
        stamina: context.player.stamina,
        inventoryWeight: context.inventoryWeight(),
      },
      deltaSeconds,
    );
  }
}
