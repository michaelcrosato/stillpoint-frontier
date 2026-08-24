import * as THREE from "three";
import {
  CROUCH_HEIGHT,
  CROUCH_SPEED,
  JUMP_SPEED,
  MAX_STEP_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  SPRINT_SPEED,
  WALK_SPEED,
} from "../config";
import type { GameSystem } from "../core/SystemPipeline";
import { resolvePlanarMovement } from "./collision";
import { stepStamina, stepVertical } from "./locomotion";
import type { GameRuntimeContext } from "./runtime";

const LOOK_SENSITIVITY = 0.00175;

export class PlayerControllerSystem implements GameSystem<GameRuntimeContext> {
  readonly id = "player-controller";
  readonly order = 10;

  update(context: GameRuntimeContext, deltaSeconds: number) {
    if (!context.started || context.paused) {
      context.player.sprinting = false;
      return;
    }
    if (!context.testMode && !context.input.isLocked()) return;

    const look = context.input.consumeLookDelta();
    context.player.yaw -= look.x * LOOK_SENSITIVITY;
    context.player.pitch = THREE.MathUtils.clamp(
      context.player.pitch - look.y * LOOK_SENSITIVITY,
      -Math.PI * 0.48,
      Math.PI * 0.48,
    );

    let inputX = 0;
    let inputZ = 0;
    if (context.input.isDown("KeyA")) inputX -= 1;
    if (context.input.isDown("KeyD")) inputX += 1;
    if (context.input.isDown("KeyW")) inputZ -= 1;
    if (context.input.isDown("KeyS")) inputZ += 1;
    const inputLength = Math.hypot(inputX, inputZ);

    context.player.crouching =
      context.input.isDown("ControlLeft") ||
      context.input.isDown("ControlRight") ||
      context.input.isDown("KeyC");
    const eyeHeight = context.player.crouching ? CROUCH_HEIGHT : PLAYER_HEIGHT;
    const sprintHeld =
      context.input.isDown("ShiftLeft") || context.input.isDown("ShiftRight");
    context.player.sprinting =
      inputLength > 0 &&
      sprintHeld &&
      !context.player.crouching &&
      context.player.grounded &&
      context.player.stamina > 0;

    const staminaStep = stepStamina(
      context.player.stamina,
      context.player.staminaRecoveryDelay,
      context.player.sprinting,
      deltaSeconds,
    );
    context.player.stamina = staminaStep.stamina;
    context.player.staminaRecoveryDelay = staminaStep.recoveryDelay;

    if (
      context.input.consumePressed("Space") &&
      context.player.grounded &&
      !context.player.crouching &&
      context.player.stamina >= 0.08
    ) {
      context.player.verticalVelocity = JUMP_SPEED;
      context.player.grounded = false;
      context.player.stamina = Math.max(0, context.player.stamina - 0.08);
      context.player.staminaRecoveryDelay = Math.max(context.player.staminaRecoveryDelay, 0.35);
    }

    if (inputLength > 0) {
      inputX /= inputLength;
      inputZ /= inputLength;
      const speed = context.player.crouching
        ? CROUCH_SPEED
        : context.player.sprinting
          ? SPRINT_SPEED
          : WALK_SPEED;
      const sin = Math.sin(context.player.yaw);
      const cos = Math.cos(context.player.yaw);
      const worldX = inputX * cos + inputZ * sin;
      const worldZ = inputZ * cos - inputX * sin;
      const current = { x: context.player.position.x, z: context.player.position.z };
      const desired = {
        x: current.x + worldX * speed * deltaSeconds,
        z: current.z + worldZ * speed * deltaSeconds,
      };
      const resolved = resolvePlanarMovement(
        current,
        desired,
        context.world.queryColliders(
          current,
          desired,
          PLAYER_RADIUS,
          context.player.position.y,
          context.player.position.y + eyeHeight,
        ),
        PLAYER_RADIUS,
      );
      context.player.position.x = resolved.x;
      context.player.position.z = resolved.z;
    }

    const groundY = context.world.sampleGroundHeight(
      context.player.position.x,
      context.player.position.z,
      context.player.position.y,
    );
    const vertical = stepVertical(
      context.player.position.y,
      context.player.verticalVelocity,
      groundY,
      deltaSeconds,
      context.player.grounded,
      MAX_STEP_HEIGHT,
    );
    context.player.position.y = vertical.y;
    context.player.verticalVelocity = vertical.velocity;
    context.player.grounded = vertical.grounded;

    context.camera.position.set(
      context.player.position.x,
      context.player.position.y + eyeHeight,
      context.player.position.z,
    );
    context.camera.rotation.set(context.player.pitch, context.player.yaw, 0, "YXZ");
  }
}
