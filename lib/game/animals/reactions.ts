import type { AnimalBodyKind, AnimalPose, AnimalRecipe } from "./animalRecipes";

export type AnimalReactionMode = "calm" | "alert" | "flee" | "return";

export interface AnimalReactionState {
  mode: AnimalReactionMode;
  offsetX: number;
  offsetZ: number;
  yaw: number;
  modeSeconds: number;
}

export interface AnimalReactionProfile {
  alertRadius: number;
  fleeRadius: number;
  safeRadius: number;
  fleeSpeed: number;
}

export function reactionProfile(body: AnimalBodyKind, flying: boolean): AnimalReactionProfile {
  if (flying) return { alertRadius: 28, fleeRadius: 18, safeRadius: 38, fleeSpeed: 7.4 };
  if (body === "small" || body === "reptile") {
    return { alertRadius: 16, fleeRadius: 9, safeRadius: 24, fleeSpeed: 5.2 };
  }
  return { alertRadius: 22, fleeRadius: 13, safeRadius: 31, fleeSpeed: 4.6 };
}

export function createAnimalReactionState(recipe: Readonly<AnimalRecipe>): AnimalReactionState {
  return {
    mode: "calm",
    offsetX: 0,
    offsetZ: 0,
    yaw: recipe.heading,
    modeSeconds: 0,
  };
}

export function stepAnimalReaction(
  state: Readonly<AnimalReactionState>,
  basePose: Readonly<AnimalPose>,
  player: Readonly<{ x: number; z: number }>,
  profile: Readonly<AnimalReactionProfile>,
  deltaSeconds: number,
): AnimalReactionState {
  const delta = Number.isFinite(deltaSeconds) ? Math.min(0.1, Math.max(0, deltaSeconds)) : 0;
  const offsetXInput = Number.isFinite(state.offsetX) ? state.offsetX : 0;
  const offsetZInput = Number.isFinite(state.offsetZ) ? state.offsetZ : 0;
  const yawInput = Number.isFinite(state.yaw) ? state.yaw : basePose.yaw;
  const modeSecondsInput = Number.isFinite(state.modeSeconds)
    ? Math.max(0, state.modeSeconds)
    : 0;
  if (delta === 0) {
    return {
      mode: state.mode,
      offsetX: offsetXInput,
      offsetZ: offsetZInput,
      yaw: yawInput,
      modeSeconds: modeSecondsInput,
    };
  }
  const playerX = Number.isFinite(player.x) ? player.x : basePose.x + 1_000_000;
  const playerZ = Number.isFinite(player.z) ? player.z : basePose.z + 1_000_000;
  const x = basePose.x + offsetXInput;
  const z = basePose.z + offsetZInput;
  const dx = x - playerX;
  const dz = z - playerZ;
  const distance = Math.hypot(dx, dz);
  const awayX = distance > 0.001 ? dx / distance : Math.sin(basePose.yaw);
  const awayZ = distance > 0.001 ? dz / distance : Math.cos(basePose.yaw);
  let mode = state.mode;
  if (distance <= profile.fleeRadius) mode = "flee";
  else if (mode === "flee" && distance < profile.safeRadius && state.modeSeconds < 4) mode = "flee";
  else if (mode === "flee") mode = "return";
  else if (distance <= profile.alertRadius) mode = "alert";
  else if (Math.hypot(state.offsetX, state.offsetZ) > 0.08) mode = "return";
  else mode = "calm";

  let offsetX = offsetXInput;
  let offsetZ = offsetZInput;
  let yaw = basePose.yaw;
  if (mode === "alert") {
    yaw = Math.atan2(-awayX, -awayZ);
  } else if (mode === "flee") {
    offsetX += awayX * profile.fleeSpeed * delta;
    offsetZ += awayZ * profile.fleeSpeed * delta;
    const offsetLength = Math.hypot(offsetX, offsetZ);
    const maxOffset = profile.safeRadius * 0.72;
    if (offsetLength > maxOffset) {
      offsetX = (offsetX / offsetLength) * maxOffset;
      offsetZ = (offsetZ / offsetLength) * maxOffset;
    }
    yaw = Math.atan2(awayX, awayZ);
  } else if (mode === "return") {
    const length = Math.hypot(offsetX, offsetZ);
    const returnDistance = Math.min(length, profile.fleeSpeed * 0.48 * delta);
    if (length > 0.001) {
      offsetX -= (offsetX / length) * returnDistance;
      offsetZ -= (offsetZ / length) * returnDistance;
      yaw = Math.atan2(-offsetX, -offsetZ);
    }
  } else if (Math.hypot(offsetX, offsetZ) <= 0.08) {
    // Snap a completed return to the analytic route. Leaving a sub-centimetre
    // residual would otherwise accumulate as animals stream out and back in.
    offsetX = 0;
    offsetZ = 0;
  }
  return {
    mode,
    offsetX,
    offsetZ,
    yaw,
    modeSeconds: mode === state.mode ? modeSecondsInput + delta : 0,
  };
}

export function applyAnimalReactionPose(
  basePose: Readonly<AnimalPose>,
  state: Readonly<AnimalReactionState>,
): AnimalPose {
  const offsetX = Number.isFinite(state.offsetX) ? state.offsetX : 0;
  const offsetZ = Number.isFinite(state.offsetZ) ? state.offsetZ : 0;
  const yaw = Number.isFinite(state.yaw) ? state.yaw : basePose.yaw;
  return {
    x: basePose.x + offsetX,
    y: basePose.y,
    z: basePose.z + offsetZ,
    yaw: state.mode === "calm" ? basePose.yaw : yaw,
  };
}
