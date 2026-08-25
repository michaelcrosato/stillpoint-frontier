import type * as THREE from "three";
import type { AnimalEngine } from "../animals/AnimalEngine";
import type { BeaconId } from "../config";
import type { CitizenEngine } from "../citizens/CitizenEngine";
import type { EnvironmentRuntime } from "../environment";
import type { InputManager } from "../input/InputManager";
import type { NavigationService } from "../navigation/NavigationService";
import type { ChunkManager } from "../world/ChunkManager";
import type { HorizonRenderer } from "../world/HorizonRenderer";
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
  horizon: HorizonRenderer;
  citizens: CitizenEngine;
  animals: AnimalEngine;
  environment: EnvironmentRuntime;
  navigation: NavigationService;
  player: PlayerRuntime;
  started: boolean;
  paused: boolean;
  testMode: boolean;
  developerPanelOpen: boolean;
  nearbyTarget: WorldTarget | null;
  nearbyDistance: number | null;
  discover(beaconId: BeaconId): void;
  performInteraction(target: WorldTarget): void;
  toggleMap(): void;
  toggleQuality(): void;
  toggleDeveloperPanel(): void;
}
