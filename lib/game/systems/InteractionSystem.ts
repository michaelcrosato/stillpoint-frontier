import * as THREE from "three";
import type { GameSystem } from "../core/SystemPipeline";
import type { WorldTarget } from "../world/targets";
import type { GameRuntimeContext } from "./runtime";

const forward = new THREE.Vector3();
const toTarget = new THREE.Vector3();

const RESOURCE_MIN_ALIGNMENT = 0.42;
const RESOURCE_ALIGNMENT_WEIGHT = 5;
const DIRECTION_EPSILON = 1e-6;
export const INTERACTION_MAX_VERTICAL_DELTA = 2.05;

type WorldTargetWithInteractionRadius = WorldTarget & {
  interactionRadius?: number;
};

function resourceInteractionRadius(target: WorldTarget) {
  const radius = (target as WorldTargetWithInteractionRadius).interactionRadius;
  if (typeof radius !== "number" || !Number.isFinite(radius) || radius <= 0) return 0;
  return Math.min(radius, target.maxDistance);
}

function targetColliderIds(target: Readonly<WorldTarget>) {
  const ids = [target.id];
  if (target.root.name) ids.push(target.root.name);
  if (target.doorId) ids.push(`authored-door:${target.doorId}`);
  if (target.beaconId) ids.push(`beacon:${target.beaconId}`);
  return [...new Set(ids)];
}

function targetHasLineOfSight(
  context: GameRuntimeContext,
  target: Readonly<WorldTarget>,
) {
  if (
    target.kind !== "resource" &&
    Math.abs(target.position.y - context.camera.position.y) >
      INTERACTION_MAX_VERTICAL_DELTA
  ) {
    return false;
  }
  return context.world.hasLineOfSight(
    context.camera.position,
    target.position,
    {
      ignoredColliderIds: targetColliderIds(target),
      // Resource selection intentionally remains planar and forgiving. Static
      // resources only spawn outdoors; every other interaction must stay on
      // the player's current authored floor.
      maxVerticalDelta:
        target.kind === "resource" ? Infinity : INTERACTION_MAX_VERTICAL_DELTA,
      checkTerrain: true,
      requireSameSupport: target.kind !== "resource",
    },
  );
}

function resourceCandidate(
  target: WorldTarget,
  cameraPosition: THREE.Vector3,
  planarForwardX: number,
  planarForwardZ: number,
) {
  const deltaX = target.position.x - cameraPosition.x;
  const deltaZ = target.position.z - cameraPosition.z;
  const centerDistance = Math.hypot(deltaX, deltaZ);
  const radius = resourceInteractionRadius(target);
  const distance = Math.max(0, centerDistance - radius);
  if (distance > target.maxDistance) return null;

  const alignment = centerDistance <= DIRECTION_EPSILON
    ? 1
    : (planarForwardX * deltaX + planarForwardZ * deltaZ) / centerDistance;
  // An interaction volume may reach into the aim-assist cone, but a resource
  // whose center is behind the player must never steal focus.
  if (alignment <= 0) return null;

  const centerAngle = Math.acos(THREE.MathUtils.clamp(alignment, -1, 1));
  const angularRadius = centerDistance <= DIRECTION_EPSILON
    ? Math.PI / 2
    : Math.asin(THREE.MathUtils.clamp(radius / centerDistance, 0, 1));
  const effectiveAngle = Math.max(0, centerAngle - angularRadius);
  const effectiveAlignment = Math.cos(effectiveAngle);
  if (effectiveAlignment < RESOURCE_MIN_ALIGNMENT) return null;

  return {
    distance,
    // Keep score units comparable with the existing non-resource selector while
    // weighting aim strongly enough that a near edge candidate cannot easily
    // steal focus from the resource under the crosshair.
    score: distance + effectiveAngle * RESOURCE_ALIGNMENT_WEIGHT,
  };
}

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
    if (context.input.consumeActionPressed("map")) context.toggleMap();
    if (context.input.consumeActionPressed("inventory")) context.toggleInventory();
    if (context.input.consumeActionPressed("quality")) context.toggleQuality();
    const usePressed = context.input.consumeActionPressed("interact");
    const harvestPressed = context.input.consumeActionPressed("harvest");

    context.nearbyTarget = null;
    context.nearbyDistance = null;
    if (!context.started || context.paused) return;

    context.camera.getWorldDirection(forward);
    const planarForwardLength = Math.hypot(forward.x, forward.z);
    const planarForwardX = planarForwardLength > DIRECTION_EPSILON
      ? forward.x / planarForwardLength
      : -Math.sin(context.camera.rotation.y);
    const planarForwardZ = planarForwardLength > DIRECTION_EPSILON
      ? forward.z / planarForwardLength
      : -Math.cos(context.camera.rotation.y);
    let bestTarget: WorldTarget | null = null;
    let bestDistance: number | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const target of context.world.targets) {
      if (target.kind === "resource") {
        const candidate = resourceCandidate(
          target,
          context.camera.position,
          planarForwardX,
          planarForwardZ,
        );
        if (
          !candidate ||
          candidate.score >= bestScore ||
          !targetHasLineOfSight(context, target)
        ) continue;
        bestScore = candidate.score;
        bestTarget = target;
        bestDistance = candidate.distance;
        continue;
      }

      toTarget.copy(target.position).sub(context.camera.position);
      const distance = toTarget.length();
      if (distance > target.maxDistance) continue;
      const alignment = forward.dot(toTarget.normalize());
      if (alignment < (target.kind === "pickup" ? 0.5 : 0.58)) continue;
      if (!targetHasLineOfSight(context, target)) continue;
      const priority = ["door", "inspectable", "station", "container", "rest", "npc"]
        .includes(target.kind)
        ? -0.35
        : 0;
      const score = distance + (1 - alignment) * 4 + priority;
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
