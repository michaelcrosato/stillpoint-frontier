import type { GameSystem } from "../core/SystemPipeline";
import type { GameRuntimeContext } from "./runtime";

export class NavigationSystem implements GameSystem<GameRuntimeContext> {
  readonly id = "navigation";
  readonly order = 15;

  update(context: GameRuntimeContext) {
    if (!context.started || context.paused) return;
    context.navigation.update(context.player.position);
  }
}
