import type { GameSystem } from "../core/SystemPipeline";
import type { GameRuntimeContext } from "./runtime";

export class CitizenCrowdSystem implements GameSystem<GameRuntimeContext> {
  readonly id = "ambient-citizen-crowd";
  readonly order = 25;

  update(context: GameRuntimeContext, deltaSeconds: number) {
    context.citizens.setWorldMinutes(
      context.environment.getSample().totalMinutes,
    );
    context.citizens.update(
      context.player.position.x,
      context.player.position.z,
      deltaSeconds,
      !context.started || context.paused,
    );
  }
}
