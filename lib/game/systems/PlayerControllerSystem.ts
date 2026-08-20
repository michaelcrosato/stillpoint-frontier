import * as THREE from "three";
import {
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  SPRINT_SPEED,
  WALK_SPEED,
} from "../config";
import type { GameSystem } from "../core/SystemPipeline";
import { sampleTerrainHeight } from "../world/terrain";
import { resolveCircleMovement } from "./collision";
import type { GameRuntimeContext } from "./runtime";

const LOOK_SENSITIVITY = 0.00175;

export class PlayerControllerSystem implements GameSystem<GameRuntimeContext> {
  readonly id = "player-controller";
  readonly order = 10;

  update(context: GameRuntimeContext, deltaSeconds: number) {
    if (!context.started || context.paused) return;
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
    if (inputLength > 0) {
      inputX /= inputLength;
      inputZ /= inputLength;
      const sprinting =
        context.input.isDown("ShiftLeft") || context.input.isDown("ShiftRight");
      const speed = sprinting ? SPRINT_SPEED : WALK_SPEED;
      const sin = Math.sin(context.player.yaw);
      const cos = Math.cos(context.player.yaw);
      const worldX = inputX * cos + inputZ * sin;
      const worldZ = inputZ * cos - inputX * sin;
      const current = {
        x: context.player.position.x,
        z: context.player.position.z,
      };
      const desired = {
        x: current.x + worldX * speed * deltaSeconds,
        z: current.z + worldZ * speed * deltaSeconds,
      };
      const resolved = resolveCircleMovement(
        current,
        desired,
        context.world.colliders,
        PLAYER_RADIUS,
      );
      context.player.position.x = resolved.x;
      context.player.position.z = resolved.z;
    }

    context.player.position.y =
      sampleTerrainHeight(context.player.position.x, context.player.position.z) +
      PLAYER_HEIGHT;
    context.camera.position.copy(context.player.position);
    context.camera.rotation.set(
      context.player.pitch,
      context.player.yaw,
      0,
      "YXZ",
    );
  }
}
