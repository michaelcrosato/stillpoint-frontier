import type * as THREE from "three";
import type { AnimalEngine } from "../animals/AnimalEngine";
import type { AudioPort } from "../audio/port";
import type { BeaconId } from "../config";
import type { CitizenEngine } from "../citizens/CitizenEngine";
import type { EnvironmentRuntime } from "../environment";
import type { InputManager } from "../input/InputManager";
import type { NavigationService } from "../navigation/NavigationService";
import type { ChunkManager } from "../world/ChunkManager";
import type { HorizonRenderer } from "../world/HorizonRenderer";
import type { WorldTarget } from "../world/targets";
import type { PlayerConditionState } from "../gameplay/playerCondition";
import type { GameSettings } from "../settings";
import type { ScanCandidate } from "../gameplay/fieldGuide";

export interface ScannerRuntimeState {
  active: boolean;
  focusId: string | null;
  focusEntryId: string | null;
  focusName: string | null;
  progress: number;
}

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
  eyeHeight: number;
  jumpBufferRemaining: number;
  coyoteRemaining: number;
  sheltered: boolean;
  condition: PlayerConditionState;
  safePosition: THREE.Vector3;
  groundedSafeTime: number;
}

export interface GameRuntimeContext {
  input: InputManager;
  camera: THREE.PerspectiveCamera;
  world: ChunkManager;
  horizon: HorizonRenderer;
  citizens: CitizenEngine;
  animals: AnimalEngine;
  environment: EnvironmentRuntime;
  audio: AudioPort;
  navigation: NavigationService;
  settings: GameSettings;
  player: PlayerRuntime;
  started: boolean;
  paused: boolean;
  testMode: boolean;
  developerPanelOpen: boolean;
  scanner: ScannerRuntimeState;
  nearbyTarget: WorldTarget | null;
  nearbyDistance: number | null;
  discover(beaconId: BeaconId): void;
  performInteraction(target: WorldTarget): void;
  toggleMap(): void;
  toggleInventory(): void;
  toggleQuality(): void;
  toggleFlashlight(): void;
  toggleDeveloperPanel(): void;
  toggleOperations(): void;
  scanCandidates(): readonly ScanCandidate[];
  completeScan(entryId: string): boolean;
  hasFieldGuideEntry(entryId: string): boolean;
  discoverCurrentLocation(): void;
  applyFallImpact(speed: number): void;
  recoverPlayer(): void;
  inventoryWeight(): number;
}
