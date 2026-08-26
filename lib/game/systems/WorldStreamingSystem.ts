import type { GameSystem } from "../core/SystemPipeline";
import type { GameRuntimeContext } from "./runtime";

export class WorldStreamingSystem implements GameSystem<GameRuntimeContext> {
  readonly id = "world-streaming";
  readonly order = 20;

  update(context: GameRuntimeContext) {
    context.world.update(context.player.position.x, context.player.position.z);
    context.horizon.update(
      context.player.position.x,
      context.player.position.z,
      context.player.position.y,
    );
    const atmosphere = context.environment.getSample();
    context.world.setNightLighting(atmosphere.night);
    context.world.setWorldMinutes(atmosphere.totalMinutes);
  }
}
