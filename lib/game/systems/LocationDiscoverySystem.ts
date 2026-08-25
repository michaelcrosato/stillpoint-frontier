import type { GameSystem } from "../core/SystemPipeline";
import type { GameRuntimeContext } from "./runtime";

export class LocationDiscoverySystem implements GameSystem<GameRuntimeContext> {
  readonly id = "location-discovery";
  readonly order = 24;

  update(context: GameRuntimeContext) {
    if (!context.started || context.paused) return;
    context.discoverCurrentLocation();
  }
}
