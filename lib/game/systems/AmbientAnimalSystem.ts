import type { GameSystem } from "../core/SystemPipeline";
import type { GameRuntimeContext } from "./runtime";

export class AmbientAnimalSystem implements GameSystem<GameRuntimeContext> {
  readonly id = "ambient-animal-population";
  readonly order = 26;

  update(context: GameRuntimeContext, deltaSeconds: number) {
    context.animals.update(
      context.player.position.x,
      context.player.position.z,
      deltaSeconds,
      !context.started || context.paused,
    );
  }
}
