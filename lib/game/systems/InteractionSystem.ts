import * as THREE from "three";
import { INTERACTION_DISTANCE } from "../config";
import type { GameSystem } from "../core/SystemPipeline";
import type { GameRuntimeContext } from "./runtime";

const forward = new THREE.Vector3();
const toTarget = new THREE.Vector3();

export class InteractionSystem implements GameSystem<GameRuntimeContext> {
  readonly id = "interaction";
  readonly order = 30;

  update(context: GameRuntimeContext) {
    if (context.input.consumePressed("KeyM")) context.toggleMap();
    if (context.input.consumePressed("KeyQ")) context.toggleQuality();

    context.nearbyBeacon = null;
    context.nearbyDistance = null;
    if (!context.started || context.paused) return;

    context.camera.getWorldDirection(forward);
    let bestScore = Number.POSITIVE_INFINITY;
    for (const interactable of context.world.interactables) {
      toTarget.copy(interactable.position).sub(context.camera.position);
      const distance = toTarget.length();
      if (distance > INTERACTION_DISTANCE) continue;
      const alignment = forward.dot(toTarget.normalize());
      if (alignment < 0.64) continue;
      const score = distance + (1 - alignment) * 4;
      if (score >= bestScore) continue;
      bestScore = score;
      context.nearbyBeacon = interactable.id;
      context.nearbyDistance = distance;
    }

    if (context.nearbyBeacon && context.input.consumePressed("KeyE")) {
      context.discover(context.nearbyBeacon);
    }
  }
}
