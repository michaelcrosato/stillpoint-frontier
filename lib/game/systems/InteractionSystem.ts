import * as THREE from "three";
import type { GameSystem } from "../core/SystemPipeline";
import type { WorldTarget } from "../world/ChunkManager";
import type { GameRuntimeContext } from "./runtime";

const forward = new THREE.Vector3();
const toTarget = new THREE.Vector3();

export class InteractionSystem implements GameSystem<GameRuntimeContext> {
  readonly id = "interaction";
  readonly order = 30;

  update(context: GameRuntimeContext) {
    if (context.input.consumePressed("KeyM")) context.toggleMap();
    if (context.input.consumePressed("KeyQ")) context.toggleQuality();
    const usePressed = context.input.consumePressed("KeyE");
    const harvestPressed =
      context.input.consumePressed("KeyF") || context.input.consumePressed("Mouse0");

    context.nearbyTarget = null;
    context.nearbyDistance = null;
    if (!context.started || context.paused) return;

    context.camera.getWorldDirection(forward);
    let bestTarget: WorldTarget | null = null;
    let bestDistance: number | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const target of context.world.targets) {
      toTarget.copy(target.position).sub(context.camera.position);
      const distance = toTarget.length();
      if (distance > target.maxDistance) continue;
      const alignment = forward.dot(toTarget.normalize());
      if (alignment < (target.kind === "pickup" ? 0.5 : 0.58)) continue;
      const score = distance + (1 - alignment) * 4;
      if (score >= bestScore) continue;
      bestScore = score;
      bestTarget = target;
      bestDistance = distance;
    }

    context.nearbyTarget = bestTarget;
    context.nearbyDistance = bestDistance;
    if (!bestTarget) return;
    const pressed = bestTarget.action === "harvest" ? harvestPressed : usePressed;
    if (pressed) context.performInteraction(bestTarget);
  }
}
