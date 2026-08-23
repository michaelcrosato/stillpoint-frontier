import type { EnvironmentRuntime } from "../environment";
import type { GameSystem } from "../core/SystemPipeline";
import type { GameRuntimeContext } from "./runtime";

/**
 * Owns simulation-time atmosphere updates without coupling weather rules to
 * movement, streaming, React, or wall-clock time.
 */
export class EnvironmentSystem implements GameSystem<GameRuntimeContext> {
  readonly id = "world-atmosphere";
  readonly order = 5;

  constructor(private readonly environment: EnvironmentRuntime) {}

  update(context: GameRuntimeContext, deltaSeconds: number) {
    this.environment.tick(
      context.player.position,
      deltaSeconds,
      context.started && !context.paused && !context.testMode,
    );
  }
}
