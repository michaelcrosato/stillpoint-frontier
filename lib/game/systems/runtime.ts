import type * as THREE from "three";
import type { BeaconId } from "../config";
import type { InputManager } from "../input/InputManager";
import type { ChunkManager } from "../world/ChunkManager";
import type { WorldTarget } from "../world/ChunkManager";

export interface PlayerRuntime {
  /** Feet position; the camera is offset by the current eye height. */
  position: THREE.Vector3;
  yaw: number;
  pitch: number;
  verticalVelocity: number;
  grounded: boolean;
  crouching: boolean;
  sprinting: boolean;
  stamina: number;
  staminaRecoveryDelay: number;
}

export interface GameRuntimeContext {
  input: InputManager;
  camera: THREE.PerspectiveCamera;
  world: ChunkManager;
  player: PlayerRuntime;
  started: boolean;
  paused: boolean;
  testMode: boolean;
  nearbyTarget: WorldTarget | null;
  nearbyDistance: number | null;
  discover(beaconId: BeaconId): void;
  performInteraction(target: WorldTarget): void;
  toggleMap(): void;
  toggleQuality(): void;
}
