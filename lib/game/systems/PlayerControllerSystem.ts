import * as THREE from "three";
import {
  CROUCH_HEIGHT,
  CROUCH_SPEED,
  GRAVITY,
  JUMP_SPEED,
  MAX_STEP_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  SPRINT_SPEED,
  WALK_SPEED,
} from "../config";
import type { GameSystem } from "../core/SystemPipeline";
import { ENCUMBERED_WEIGHT } from "../gameplay/playerCondition";
import {
  MAX_DEVELOPER_FLIGHT_ALTITUDE,
  developerFlightDirection,
  developerSpeedMultiplier,
} from "../developer/PlayerSandbox";
import { WORLD_HALF_EXTENT } from "../world/macroWorld";
import { resolvePlanarMovement } from "./collision";
import {
  COYOTE_TIME_SECONDS,
  JUMP_BUFFER_SECONDS,
  stepEyeHeight,
  stepStamina,
  stepVertical,
} from "./locomotion";
import type { GameRuntimeContext } from "./runtime";

const BASE_LOOK_SENSITIVITY = 0.00175;
const WORLD_PLAYER_LIMIT = WORLD_HALF_EXTENT - PLAYER_RADIUS;

export class PlayerControllerSystem implements GameSystem<GameRuntimeContext> {
  readonly id = "player-controller";
  readonly order = 10;

  update(context: GameRuntimeContext, deltaSeconds: number) {
    const jumpPressed = context.input.consumeActionPressed("jump");
    if (!context.started || context.paused) {
      context.player.sprinting = false;
      context.player.jumpBufferRemaining = 0;
      return;
    }
    if (context.player.condition.health <= 0) {
      context.player.sprinting = false;
      return;
    }
    if (!context.testMode && !context.input.isLocked()) return;

    const look = context.input.consumeLookDelta();
    const sensitivity = BASE_LOOK_SENSITIVITY * context.settings.lookSensitivity;
    context.player.yaw -= look.x * sensitivity;
    const verticalLook = look.y * (context.settings.invertY ? -1 : 1);
    context.player.pitch = THREE.MathUtils.clamp(
      context.player.pitch - verticalLook * sensitivity,
      -Math.PI * 0.48,
      Math.PI * 0.48,
    );

    let inputX = 0;
    let inputZ = 0;
    if (context.input.isActionDown("moveLeft")) inputX -= 1;
    if (context.input.isActionDown("moveRight")) inputX += 1;
    if (context.input.isActionDown("moveForward")) inputZ -= 1;
    if (context.input.isActionDown("moveBackward")) inputZ += 1;
    const inputLength = Math.hypot(inputX, inputZ);
    const sprintHeld = context.input.isActionDown("sprint");
    const movementMultiplier = developerSpeedMultiplier(
      context.developerPlayer.speedMode,
    );

    if (context.developerPlayer.fly) {
      context.player.eyeHeight = PLAYER_HEIGHT;
      const direction = developerFlightDirection({
        inputX,
        inputZ,
        ascend: context.input.isActionDown("jump"),
        descend: context.input.isActionDown("crouch"),
        yaw: context.player.yaw,
        pitch: context.player.pitch,
      });
      const speed = (sprintHeld ? SPRINT_SPEED : WALK_SPEED) * movementMultiplier;
      const nextX = THREE.MathUtils.clamp(
        context.player.position.x + direction.x * speed * deltaSeconds,
        -WORLD_PLAYER_LIMIT,
        WORLD_PLAYER_LIMIT,
      );
      const nextZ = THREE.MathUtils.clamp(
        context.player.position.z + direction.z * speed * deltaSeconds,
        -WORLD_PLAYER_LIMIT,
        WORLD_PLAYER_LIMIT,
      );
      const groundY = context.world.sampleGroundHeight(
        nextX,
        nextZ,
        context.player.position.y,
      );
      context.player.position.set(
        nextX,
        THREE.MathUtils.clamp(
          context.player.position.y + direction.y * speed * deltaSeconds,
          groundY + 0.05,
          MAX_DEVELOPER_FLIGHT_ALTITUDE,
        ),
        nextZ,
      );
      context.player.verticalVelocity = 0;
      context.player.grounded = false;
      context.player.crouching = false;
      context.player.sprinting = false;
      context.player.stamina = 1;
      context.player.staminaRecoveryDelay = 0;
      context.player.jumpBufferRemaining = 0;
      context.player.coyoteRemaining = 0;
      context.camera.position.set(
        context.player.position.x,
        context.player.position.y + context.player.eyeHeight,
        context.player.position.z,
      );
      context.camera.rotation.set(context.player.pitch, context.player.yaw, 0, "YXZ");
      return;
    }

    const crouchHeld = context.input.isActionDown("crouch");
    context.player.crouching = crouchHeld ||
      !context.world.canStandAt(
        context.player.position.x,
        context.player.position.z,
        context.player.position.y,
        PLAYER_RADIUS,
      );
    const targetEyeHeight = context.player.crouching ? CROUCH_HEIGHT : PLAYER_HEIGHT;
    context.player.eyeHeight = stepEyeHeight(
      context.player.eyeHeight,
      targetEyeHeight,
      deltaSeconds,
    );
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

    context.player.coyoteRemaining = context.player.grounded
      ? COYOTE_TIME_SECONDS
      : Math.max(0, context.player.coyoteRemaining - deltaSeconds);
    context.player.jumpBufferRemaining = jumpPressed
      ? JUMP_BUFFER_SECONDS
      : Math.max(0, context.player.jumpBufferRemaining - deltaSeconds);

    if (
      context.player.jumpBufferRemaining > 0 &&
      (context.player.grounded || context.player.coyoteRemaining > 0) &&
      !context.player.crouching &&
      context.player.stamina >= 0.08
    ) {
      context.player.verticalVelocity = JUMP_SPEED;
      context.player.grounded = false;
      context.player.stamina = Math.max(0, context.player.stamina - 0.08);
      context.player.staminaRecoveryDelay = Math.max(context.player.staminaRecoveryDelay, 0.35);
      context.player.jumpBufferRemaining = 0;
      context.player.coyoteRemaining = 0;
    }

    if (inputLength > 0) {
      inputX /= inputLength;
      inputZ /= inputLength;
      const baseSpeed = context.player.crouching
        ? CROUCH_SPEED
        : context.player.sprinting
          ? SPRINT_SPEED
          : WALK_SPEED;
      const speed =
        baseSpeed *
        movementMultiplier *
        (context.inventoryWeight() >= ENCUMBERED_WEIGHT ? 0.84 : 1);
      const sin = Math.sin(context.player.yaw);
      const cos = Math.cos(context.player.yaw);
      const worldX = inputX * cos + inputZ * sin;
      const worldZ = inputZ * cos - inputX * sin;
      const current = { x: context.player.position.x, z: context.player.position.z };
      const desired = {
        x: THREE.MathUtils.clamp(
          current.x + worldX * speed * deltaSeconds,
          -WORLD_PLAYER_LIMIT,
          WORLD_PLAYER_LIMIT,
        ),
        z: THREE.MathUtils.clamp(
          current.z + worldZ * speed * deltaSeconds,
          -WORLD_PLAYER_LIMIT,
          WORLD_PLAYER_LIMIT,
        ),
      };
      const resolved = resolvePlanarMovement(
        current,
        desired,
        context.world.queryColliders(
          current,
          desired,
          PLAYER_RADIUS,
          context.player.position.y,
          context.player.position.y + targetEyeHeight,
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
    const wasGrounded = context.player.grounded;
    const preStepVelocity = context.player.verticalVelocity;
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
    if (!wasGrounded && vertical.grounded) {
      context.applyFallImpact(Math.max(0, -(preStepVelocity - GRAVITY * deltaSeconds)));
    }

    context.camera.position.set(
      context.player.position.x,
      context.player.position.y + context.player.eyeHeight,
      context.player.position.z,
    );
    context.camera.rotation.set(context.player.pitch, context.player.yaw, 0, "YXZ");
  }
}
