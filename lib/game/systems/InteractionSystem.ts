import * as THREE from "three";
import type { GameSystem } from "../core/SystemPipeline";
import {
  worldTargetInteractionPosition,
  type WorldTarget,
} from "../world/ChunkManager";
import type { GameRuntimeContext } from "./runtime";

const forward = new THREE.Vector3();
const toTarget = new THREE.Vector3();
const interactionPosition = new THREE.Vector3();

export class InteractionSystem implements GameSystem<GameRuntimeContext> {
  readonly id = "interaction";
  readonly order = 30;

  update(context: GameRuntimeContext) {
    if (context.input.consumePressed("Backquote")) {
      context.toggleDeveloperPanel();
    }
    if (
      context.developerPanelOpen &&
      context.input.consumePressed("Escape")
    ) {
      context.toggleDeveloperPanel();
    }
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
    const cameraPosition = context.camera.position;
    for (const target of context.world.targets) {
      const maxDistance = target.maxDistance;
      const canPrefilterDistance =
        Number.isFinite(maxDistance) && maxDistance >= 0;
      if (
        canPrefilterDistance &&
        (Math.abs(target.position.x - cameraPosition.x) > maxDistance ||
          Math.abs(target.position.z - cameraPosition.z) > maxDistance)
      ) continue;
      const targetPosition = worldTargetInteractionPosition(
        target,
        context.player.position.y,
        interactionPosition,
      );
      if (!targetPosition) continue;
      if (
        canPrefilterDistance &&
        Math.abs(targetPosition.y - cameraPosition.y) > maxDistance
      ) continue;
      toTarget.copy(targetPosition).sub(cameraPosition);
      const distance = toTarget.length();
      if (distance > maxDistance) continue;
      const alignment = forward.dot(toTarget.normalize());
      if (
        alignment <
        (target.kind === "pickup"
          ? 0.5
          : target.kind === "traversal"
            ? 0.35
            : 0.58)
      ) continue;
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
