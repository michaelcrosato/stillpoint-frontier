import type * as THREE from "three";
import type { BeaconId } from "../config";
import type { InputManager } from "../input/InputManager";
import type { ChunkManager } from "../world/ChunkManager";

export interface PlayerRuntime {
  position: THREE.Vector3;
  yaw: number;
  pitch: number;
}

export interface GameRuntimeContext {
  input: InputManager;
  camera: THREE.PerspectiveCamera;
  world: ChunkManager;
  player: PlayerRuntime;
  started: boolean;
  paused: boolean;
  testMode: boolean;
  nearbyBeacon: BeaconId | null;
  nearbyDistance: number | null;
  discover(beaconId: BeaconId): void;
  toggleMap(): void;
  toggleQuality(): void;
}
