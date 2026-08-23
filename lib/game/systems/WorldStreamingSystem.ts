import type { GameSystem } from "../core/SystemPipeline";
import type { GameRuntimeContext } from "./runtime";

export class WorldStreamingSystem implements GameSystem<GameRuntimeContext> {
  readonly id = "world-streaming";
  readonly order = 20;

  update(context: GameRuntimeContext) {
    context.world.update(context.player.position.x, context.player.position.z);
    context.world.setNightLighting(context.environment.getSample().night);
  }
}
