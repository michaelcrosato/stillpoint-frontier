import * as THREE from "three";
import {
  BEACONS,
  DEFAULT_HORIZON_MODE,
  HORIZON_PRESETS,
  QUALITY_LEVELS,
  QUALITY_PRESETS,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  WAYPOINT_WORLD_MARKER_DISTANCE,
  type BeaconId,
  type HorizonMode,
  isQualityLevel,
  qualityUsesShadows,
  type QualityLevel,
  isHorizonMode,
} from "./config";
import { CitizenEngine } from "./citizens/CitizenEngine";
import { AnimalEngine } from "./animals/AnimalEngine";
import { EnvironmentalAudio } from "./audio/EnvironmentalAudio";
import { PlayerFlashlight } from "./equipment/PlayerFlashlight";
import { SystemPipeline } from "./core/SystemPipeline";
import { FeatureRegistry } from "./core/FeatureRegistry";
import { createEnvironment, type EnvironmentRuntime } from "./environment";
import {
  GAME_MINUTES_PER_REAL_SECOND,
  type WeatherId,
} from "./environment/model";
import { InputManager } from "./input/InputManager";
import {
  MANUAL_WAYPOINT_ID,
  NavigationService,
  type NavigationTargetInput,
} from "./navigation/NavigationService";
import { clamp, headingFromYaw, unwrappedHeadingFromYaw } from "./navigation/math";
import type { GamePresentation, WaypointScreenProjection } from "./navigation/presentation";
import { SaveStore } from "./persistence/SaveStore";
import { PreferencesStore } from "./persistence/PreferencesStore";
import { applyGather, type EntityDiff } from "./gameplay/interactions";
import {
  EMPTY_INVENTORY,
  ITEM_DEFINITIONS,
  addItem,
  inventoryItemCount,
  inventoryWeight,
  itemUseKind,
  removeItem,
  type InventoryState,
  type ItemId,
} from "./gameplay/items";
import type { GameplayEvent } from "./gameplay/events";
import {
  acceptContract as acceptContractProgress,
  contractById,
  currentContractObjective,
  hasOutstandingContract,
  progressContracts,
  turnInContract as turnInContractProgress,
  type ContractJournalState,
} from "./gameplay/contracts";
import { reconcileContractEvidence } from "./gameplay/contractEvidence";
import {
  craftRecipe as resolveCraftRecipe,
  recipeById,
  type CraftingStationKind,
} from "./gameplay/crafting";
import {
  addFieldGuideEntry,
  fieldGuideEntry,
} from "./gameplay/fieldGuide";
import {
  ensureContainerState,
  takeAllContainerItems as resolveTakeAllContainerItems,
  takeContainerItem as resolveTakeContainerItem,
} from "./gameplay/loot";
import {
  createFeatureProgress,
  type FeatureProgressState,
} from "./gameplay/progression";
import {
  resolveRest,
  type RestOptionId,
} from "./gameplay/resting";
import { interactionPromptFor } from "./gameplay/interactionPrompt";
import {
  INITIAL_PLAYER_CONDITION,
  MAX_HEALTH,
  apparentTemperature,
  applyPlayerDamage,
  deriveConditionTags,
  fallDamageForImpact,
  recoverPlayerCondition,
} from "./gameplay/playerCondition";
import { InteractionSystem } from "./systems/InteractionSystem";
import { ScannerSystem } from "./systems/ScannerSystem";
import { CitizenCrowdSystem } from "./systems/CitizenCrowdSystem";
import { AmbientAnimalSystem } from "./systems/AmbientAnimalSystem";
import { PlayerEquipmentSystem } from "./systems/PlayerEquipmentSystem";
import { EnvironmentSystem } from "./systems/EnvironmentSystem";
import { PlayerControllerSystem } from "./systems/PlayerControllerSystem";
import { PlayerConditionSystem } from "./systems/PlayerConditionSystem";
import { LocationDiscoverySystem } from "./systems/LocationDiscoverySystem";
import { EnvironmentalAudioSystem } from "./systems/EnvironmentalAudioSystem";
import { NavigationSystem } from "./systems/NavigationSystem";
import {
  isPlanarPositionClear,
  resolvePlanarMovement,
  type PlanarCollider,
  type PlanarPosition,
} from "./systems/collision";
import type { GameRuntimeContext } from "./systems/runtime";
import { WorldStreamingSystem } from "./systems/WorldStreamingSystem";
import {
  type GameSnapshot,
  type FeatureNotice,
  type FeatureOverlayState,
  type LastGatherSnapshot,
  INITIAL_SNAPSHOT,
  addDiscovery,
} from "./state";
import { ChunkManager, type WorldTarget } from "./world/ChunkManager";
import { HorizonRenderer, type HorizonDiagnostics } from "./world/HorizonRenderer";
import {
  getFastTravelLocation,
  resolveFastTravelArrival,
} from "./world/fastTravel";
import { WORLD_HALF_EXTENT, nearestSettlement, sampleClimate } from "./world/macroWorld";
import { WATER_LEVEL } from "./world/macroWorld";
import { sampleTerrainHeight, worldToChunk } from "./world/terrain";
import {
  MAX_PLACED_SERIAL,
  nearbyCampModifiers,
  type PlacementArchetype,
  type PlacedEntity,
} from "./world/deployments";
import {
  authoredNpcScheduleAnchor,
  npcById,
} from "./npcs/authoredNpc";
import {
  DEFAULT_GAME_SETTINGS,
  normalizeGameSettings,
  rebindAction,
  type GameAction,
  type GameSettings,
} from "./settings";
import {
  addLocationDiscovery,
  currentDiscoverableLocation,
  type DiscoverableLocation,
} from "./world/locationDiscovery";
import type { InspectionRecord } from "./world/inspectables";

const FIXED_STEP = 1 / 60;
const MAX_FRAME_DELTA = 0.075;

export interface GameTestBridge {
  isReady(): boolean;
  snapshot(): GameSnapshot;
  teleport(x: number, z: number, y?: number): void;
  faceBeacon(beaconId: BeaconId): void;
  discover(beaconId: BeaconId): void;
  loseContext(): void;
  restoreContext(): void;
  targets(): Array<{
    id: string;
    kind: string;
    action: string;
    x: number;
    z: number;
    open: boolean | null;
  }>;
  doors(): Array<{ id: string; open: boolean }>;
  groundHeight(x: number, z: number, referenceY?: number): number;
  citizens(): {
    visible: number;
    generated: number;
    density: string;
    chunks: number;
    updateHz: number;
    activityMultiplier: number;
    ids: string[];
  };
  animals(): {
    visible: number;
    generated: number;
    species: number;
    chunks: number;
    updateHz: number;
    ids: string[];
    bySpecies: Record<string, number | undefined>;
  };
  toggleFlashlight(): boolean;
  setFlashlightEnabled(enabled: boolean): boolean;
  flashlight(): {
    enabled: boolean;
    beams: number;
    rangeMeters: number;
    shadowsEnabled: boolean;
    quality: QualityLevel;
  };
  audio(): EnvironmentalAudio["diagnostics"];
  saveNow(): boolean;
  loadGame(): boolean;
  setFov(fov: number): boolean;
  setLookSensitivity(value: number): boolean;
  setInvertY(enabled: boolean): boolean;
  setKeyBinding(action: GameAction, code: string): boolean;
  setQuality(quality: QualityLevel): boolean;
  setPlayerHealth(health: number): number;
  applyFallImpact(speed: number): number;
  recoverPlayer(): void;
  discoverCurrentLocation(): boolean;
  inspectableIds(): string[];
  nightLighting(): {
    strength: number;
    windows: number;
    visibleWindowMeshes: number;
    areaLights: number;
    activeAreaLights: number;
  };
  faceTarget(id: string): void;
  interactTarget(id: string): void;
  setWaypoint(x: number, z: number): void;
  clearWaypoint(): void;
  fastTravel(locationId: string): void;
  setWorldMinutes(minutes: number): void;
  advanceWorldMinutes(minutes: number): void;
  setDeveloperMode(enabled: boolean): void;
  setDeveloperPanelOpen(open: boolean): void;
  setDeveloperTimeOfDay(minutes: number): void;
  advanceDeveloperMinutes(minutes: number): void;
  setDeveloperClockPaused(paused: boolean): void;
  setDeveloperWeather(weatherId: WeatherId | null): boolean;
  resetDeveloperOverrides(): void;
  setHorizonMode(mode: HorizonMode): boolean;
  horizon(): HorizonDiagnostics;
  setHeading(heading: number): void;
  navigationTargets(): ReturnType<NavigationService["targetsSnapshot"]>;
  colliders(): PlanarCollider[];
  probeCollision(current: PlanarPosition, desired: PlanarPosition, feetY?: number): {
    position: PlanarPosition;
    clear: boolean;
    candidateCount: number;
  };
}

declare global {
  interface Window {
    __STILLPOINT_TEST__?: GameTestBridge;
  }
}

interface EngineOptions {
  canvas: HTMLCanvasElement;
  testMode?: boolean;
  storageEnabled?: boolean;
  onSnapshot: (snapshot: GameSnapshot) => void;
  onPresentation?: (presentation: GamePresentation) => void;
}

export class Engine {
  private readonly canvas: HTMLCanvasElement;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly input: InputManager;
  private readonly world: ChunkManager;
  private readonly horizon: HorizonRenderer;
  private readonly citizens: CitizenEngine;
  private readonly animals: AnimalEngine;
  private readonly flashlight: PlayerFlashlight;
  private readonly audio: EnvironmentalAudio;
  private readonly navigation = new NavigationService();
  private readonly environment: EnvironmentRuntime;
  private readonly pipeline = new SystemPipeline<GameRuntimeContext>();
  private readonly onSnapshot: (snapshot: GameSnapshot) => void;
  private readonly onPresentation: (presentation: GamePresentation) => void;
  private readonly testMode: boolean;
  private readonly saveStore: SaveStore;
  private readonly preferencesStore: PreferencesStore;
  private readonly projectionPoint = new THREE.Vector3();
  private readonly projectionDirection = new THREE.Vector3();
  private readonly cameraDirection = new THREE.Vector3();
  private readonly player = {
    position: new THREE.Vector3(0, 0, 8),
    yaw: -0.565,
    pitch: -0.035,
    verticalVelocity: 0,
    grounded: true,
    crouching: false,
    sprinting: false,
    stamina: 1,
    staminaRecoveryDelay: 0,
    eyeHeight: PLAYER_HEIGHT,
    jumpBufferRemaining: 0,
    coyoteRemaining: 0,
    sheltered: false,
    condition: { ...INITIAL_PLAYER_CONDITION },
    safePosition: new THREE.Vector3(0, 0, 8),
    groundedSafeTime: 0,
  };

  private runtime: GameRuntimeContext;
  private animationFrame = 0;
  private previousTime = 0;
  private accumulator = 0;
  private lastSnapshotTime = 0;
  private framesSinceSample = 0;
  private fpsSampleStarted = 0;
  private fps = 60;
  private ready = false;
  private started = false;
  private paused = false;
  private mapOpen = false;
  private inventoryOpen = false;
  private settingsOpen = false;
  private activeInspection: InspectionRecord | null = null;
  private featureOverlay: FeatureOverlayState = null;
  private developerPanelOpen = false;
  private contextStatus: "ready" | "lost" = "ready";
  private quality: QualityLevel = "cinematic";
  private horizonMode: HorizonMode = DEFAULT_HORIZON_MODE;
  private settings: GameSettings = {
    ...DEFAULT_GAME_SETTINGS,
    keyBindings: { ...DEFAULT_GAME_SETTINGS.keyBindings },
  };
  private scanned: BeaconId[] = [];
  private inventory: InventoryState = { ...EMPTY_INVENTORY };
  private worldDiffs: Record<string, EntityDiff> = {};
  private doorStates: Record<string, boolean> = {};
  private featureProgress: FeatureProgressState = createFeatureProgress();
  private readonly scanner = {
    active: false,
    focusId: null as string | null,
    focusEntryId: null as string | null,
    focusName: null as string | null,
    progress: 0,
  };
  private lastFeatureNotice: FeatureNotice | null = null;
  private lastDiscovery: BeaconId | null = null;
  private lastGather: LastGatherSnapshot | null = null;
  private lastFastTravel: GameSnapshot["lastFastTravel"] = null;
  private discoveredLocations: string[] = [];
  private currentLocation: DiscoverableLocation = currentDiscoverableLocation(0, 8);
  private lastLocationDiscovery: DiscoverableLocation | null = null;
  private saveStatus: GameSnapshot["saveStatus"] = "unavailable";
  private lastSavedAt: number | null = null;
  private lastClockPersistTime = 0;
  private snapshot = { ...INITIAL_SNAPSHOT };
  private disposed = false;

  constructor(options: EngineOptions) {
    this.canvas = options.canvas;
    this.testMode = options.testMode ?? false;
    this.onSnapshot = options.onSnapshot;
    this.onPresentation = options.onPresentation ?? (() => undefined);
    let browserStorage: Storage | null = null;
    const storageEnabled = options.storageEnabled ?? !this.testMode;
    if (storageEnabled) {
      try {
        browserStorage = window.localStorage;
      } catch {
        browserStorage = null;
      }
    }
    this.saveStore = new SaveStore(browserStorage);
    this.preferencesStore = new PreferencesStore(browserStorage);
    const saved = this.saveStore.load();
    this.settings = this.preferencesStore.load(saved.horizonMode);
    this.scanned = saved.scanned;
    this.inventory = saved.inventory;
    this.worldDiffs = saved.worldDiffs;
    this.doorStates = saved.doorStates;
    this.featureProgress = saved.featureProgress;
    this.featureProgress = {
      ...this.featureProgress,
      contractJournal: this.reconcilePersistentContractEvidence(
        this.featureProgress.contractJournal,
      ),
    };
    this.discoveredLocations = saved.discoveredLocations;
    this.horizonMode = this.settings.horizonMode;
    this.quality = this.settings.quality;
    this.saveStatus = browserStorage ? (this.saveStore.hasSave() ? "saved" : "unsaved") : "unavailable";
    if (saved.manualWaypoint) this.navigation.setManualWaypoint(saved.manualWaypoint);
    if (saved.player) {
      this.player.position.set(saved.player.x, saved.player.y, saved.player.z);
      this.player.yaw = saved.player.yaw;
      this.player.pitch = saved.player.pitch;
      this.player.condition = {
        ...INITIAL_PLAYER_CONDITION,
        health: saved.player.health,
        wetness: saved.player.wetness,
        coldStress: saved.player.coldStress,
      };
    }
    this.currentLocation = currentDiscoverableLocation(
      this.player.position.x,
      this.player.position.z,
    );

    this.camera = new THREE.PerspectiveCamera(
      this.settings.fov,
      1,
      0.08,
      HORIZON_PRESETS[this.horizonMode].drawDistanceMeters,
    );

    const contextAttributes: WebGLContextAttributes = {
      alpha: false,
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: this.testMode,
      stencil: false,
    };
    const webglContext = this.canvas.getContext("webgl2", contextAttributes);
    const reversedDepthSupported = Boolean(
      webglContext?.getExtension("EXT_clip_control"),
    );
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      context: webglContext ?? undefined,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      stencil: false,
      preserveDrawingBuffer: this.testMode,
      reversedDepthBuffer: reversedDepthSupported,
      logarithmicDepthBuffer: !reversedDepthSupported,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = qualityUsesShadows(this.quality);
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.input = new InputManager(
      this.canvas,
      this.handlePointerLockChange,
      this.settings.keyBindings,
    );
    this.world = new ChunkManager(
      this.scene,
      this.quality,
      this.worldDiffs,
      this.doorStates,
      this.featureProgress.containerStates,
      this.featureProgress.placedEntities,
    );
    this.horizon = new HorizonRenderer(this.scene, this.horizonMode);
    this.citizens = new CitizenEngine(this.scene, this.quality);
    this.animals = new AnimalEngine(this.scene, this.quality, {
      sampleHeight: sampleTerrainHeight,
      queryColliders: (current, desired, radius, minY, maxY) =>
        this.world.queryColliders(current, desired, radius, minY, maxY),
    });
    this.flashlight = new PlayerFlashlight(this.scene, this.quality);
    this.audio = new EnvironmentalAudio(this.settings, this.testMode);
    this.environment = createEnvironment(
      this.scene,
      this.renderer,
      this.quality,
      saved.worldMinutes,
    );
    this.environment.setHorizonMode(this.horizonMode);
    if (!saved.player) {
      this.player.position.y = sampleTerrainHeight(
        this.player.position.x,
        this.player.position.z,
      );
    }
    this.player.safePosition.copy(this.player.position);
    this.camera.position.set(
      this.player.position.x,
      this.player.position.y + PLAYER_HEIGHT,
      this.player.position.z,
    );
    this.camera.rotation.set(this.player.pitch, this.player.yaw, 0, "YXZ");

    this.runtime = {
      input: this.input,
      camera: this.camera,
      world: this.world,
      horizon: this.horizon,
      citizens: this.citizens,
      animals: this.animals,
      environment: this.environment,
      audio: this.audio,
      navigation: this.navigation,
      settings: this.settings,
      player: this.player,
      started: false,
      paused: false,
      testMode: this.testMode,
      scanner: this.scanner,
      nearbyTarget: null,
      nearbyDistance: null,
      discover: (beaconId) => this.discover(beaconId),
      performInteraction: (target) => this.performInteraction(target),
      toggleMap: () => this.toggleMap(),
      toggleInventory: () => this.toggleInventory(),
      toggleQuality: () => this.toggleQuality(),
      toggleFlashlight: () => this.toggleFlashlight(),
      toggleDeveloperPanel: () => this.toggleDeveloperPanel(),
      toggleOperations: () => this.toggleOperations(),
      scanCandidates: () => [
        ...this.world.scanCandidates,
        ...this.animals.scanCandidates(),
      ],
      completeScan: (entryId) => this.completeScan(entryId),
      hasFieldGuideEntry: (entryId) =>
        this.featureProgress.fieldGuideEntries.includes(entryId),
      discoverCurrentLocation: () => this.discoverCurrentLocation(),
      applyFallImpact: (speed) => this.applyFallImpact(speed),
      recoverPlayer: () => this.recoverPlayer(),
      inventoryWeight: () => inventoryWeight(this.inventory),
      developerPanelOpen: false,
    };

    new FeatureRegistry(this.pipeline)
      .use({
        id: "world-atmosphere",
        install: (registry) => {
          registry.system(new EnvironmentSystem(this.environment));
        },
      })
      .use({
        id: "navigation-core",
        install: (registry) => {
          registry.system(new NavigationSystem());
        },
      })
      .use({
        id: "field-equipment",
        install: (registry) => {
          registry.system(new PlayerEquipmentSystem());
        },
      })
      .use({
        id: "frontier-survey",
        install: (registry) => {
          registry
            .system(new PlayerControllerSystem())
            .system(new PlayerConditionSystem())
            .system(new WorldStreamingSystem())
            .system(new LocationDiscoverySystem())
            .system(new ScannerSystem())
            .system(new InteractionSystem());
        },
      })
      .use({
        id: "ambient-citizens",
        install: (registry) => {
          registry.system(new CitizenCrowdSystem());
        },
      })
      .use({
        id: "ambient-wildlife",
        install: (registry) => {
          registry.system(new AmbientAnimalSystem());
        },
      })
      .use({
        id: "field-audio",
        install: (registry) => {
          registry.system(new EnvironmentalAudioSystem());
        },
      });
  }

  async initialize() {
    this.resize();
    this.world.update(this.player.position.x, this.player.position.z);
    const current = { x: this.player.position.x, z: this.player.position.z };
    const supportY = this.world.sampleGroundHeight(
      current.x,
      current.z,
      this.player.position.y,
    );
    const resolved = resolvePlanarMovement(
      current,
      current,
      this.world.queryColliders(
        current,
        current,
        PLAYER_RADIUS,
        supportY,
        supportY + PLAYER_HEIGHT,
      ),
      PLAYER_RADIUS,
    );
    this.player.position.set(resolved.x, supportY, resolved.z);
    this.player.safePosition.copy(this.player.position);
    this.camera.position.set(resolved.x, supportY + this.player.eyeHeight, resolved.z);
    this.camera.rotation.set(this.player.pitch, this.player.yaw, 0, "YXZ");
    this.currentLocation = currentDiscoverableLocation(resolved.x, resolved.z);
    this.horizon.update(this.player.position.x, this.player.position.z);
    this.citizens.updateStreaming(this.player.position.x, this.player.position.z);
    this.animals.updateStreaming(this.player.position.x, this.player.position.z);
    this.flashlight.present(this.camera);
    this.environment.sync(this.player.position, true);
    this.environment.present(this.player.position, 0);
    this.world.presentEnvironment(this.environment.getVisualState());
    this.synchronizeTimeDependentWorld();
    this.syncPlacedNavigationTargets();
    this.syncContractNavigation();
    for (const beaconId of this.scanned) this.world.markScanned(beaconId);
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.canvas.addEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.addEventListener("webglcontextrestored", this.handleContextRestored);

    this.animationFrame = requestAnimationFrame(this.frame);
    this.flashlight.prepareForCompile();
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      this.renderer.compile(this.scene, this.camera);
    } finally {
      this.flashlight.finishCompile();
    }
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
    this.renderer.render(this.scene, this.camera);
    this.ready = true;
    this.emitSnapshot(true);

    if (this.testMode) this.installTestBridge();
  }

  beginSession() {
    this.started = true;
    this.mapOpen = false;
    this.inventoryOpen = false;
    this.settingsOpen = false;
    this.activeInspection = null;
    this.featureOverlay = null;
    this.developerPanelOpen = false;
    this.paused = !this.testMode;
    this.lastClockPersistTime = performance.now();
    void this.audio.unlock();
    if (!this.testMode) this.input.requestPointerLock();
    this.emitSnapshot(true);
  }

  resume() {
    if (!this.started) return;
    this.mapOpen = false;
    this.inventoryOpen = false;
    this.settingsOpen = false;
    this.activeInspection = null;
    this.featureOverlay = null;
    this.developerPanelOpen = false;
    void this.audio.unlock();
    if (this.testMode) this.paused = false;
    else if (this.input.isLocked()) this.paused = false;
    else {
      this.paused = true;
      this.input.requestPointerLock();
    }
    this.emitSnapshot(true);
  }

  discover(beaconId: BeaconId) {
    const previousLength = this.scanned.length;
    this.scanned = addDiscovery(this.scanned, beaconId);
    this.world.markScanned(beaconId);
    if (this.scanned.length !== previousLength) {
      this.lastDiscovery = beaconId;
      this.persist();
      this.audio.playCue("scan");
    }
    this.emitSnapshot(true);
  }

  performInteraction(target: WorldTarget) {
    if (target.action === "inspect" && target.inspection) {
      this.applyGameplayEvent({ type: "object.inspected", targetId: target.id });
      this.persist();
      this.setInspection(target.inspection);
      this.audio.playCue("inspect");
      return;
    }
    if (target.action === "toggle") {
      if (target.doorId) {
        const result = this.world.toggleDoor(
          target.doorId,
          this.player.position,
          PLAYER_RADIUS,
        );
        if (result === "opened" || result === "closed") {
          this.persist();
          this.audio.playCue(result === "opened" ? "door-open" : "door-close");
        }
      }
      this.emitSnapshot(true);
      return;
    }
    if (target.action === "scan" && target.beaconId) {
      this.discover(target.beaconId);
      return;
    }
    if (target.action === "craft" && target.stationKind) {
      this.setFeatureOverlay({
        kind: "operations",
        tab: "crafting",
        station: target.stationKind,
      });
      this.audio.playCue("inspect");
      return;
    }
    if (target.action === "loot" && target.containerId && target.lootTableId) {
      const ensured = ensureContainerState(
        this.featureProgress.containerStates,
        target.containerId,
        target.lootTableId,
      );
      this.featureProgress = {
        ...this.featureProgress,
        containerStates: ensured.states,
      };
      this.world.setContainerStates(ensured.states);
      this.persist();
      this.setFeatureOverlay({ kind: "container", containerId: target.containerId });
      this.audio.playCue("inspect");
      return;
    }
    if (target.action === "rest" && target.restSite) {
      const modifiers = nearbyCampModifiers(
        this.featureProgress.placedEntities,
        this.player.position.x,
        this.player.position.z,
        this.player.position.y,
      );
      this.setFeatureOverlay({
        kind: "rest",
        site: {
          ...target.restSite,
          sheltered: target.restSite.sheltered || modifiers.sheltered,
          warmth: Math.max(target.restSite.warmth, modifiers.warmth),
        },
      });
      this.audio.playCue("inspect");
      return;
    }
    if (target.action === "talk" && target.npcId) {
      this.talkToNpc(target.npcId);
      return;
    }
    if (
      !target.item ||
      (target.action !== "collect" && target.action !== "harvest")
    ) return;
    const outcome = applyGather(
      { inventory: this.inventory, worldDiffs: this.worldDiffs },
      {
        id: target.id,
        action: target.action,
        item: target.item,
        yieldAmount: target.yieldAmount ?? 0,
        hitsRequired: target.hitsRequired,
      },
    );
    if (outcome.result === "unchanged") return;
    this.inventory = outcome.state.inventory;
    this.worldDiffs = outcome.state.worldDiffs;
    const diff = this.worldDiffs[target.id];
    if (diff) this.world.applyEntityDiff(target.id, diff);
    this.lastGather = {
      targetName: target.name,
      item: target.item,
      quantity: outcome.loot?.quantity ?? 0,
      result: outcome.result,
      remainingHits: outcome.remainingHits,
    };
    if ((outcome.loot?.quantity ?? 0) > 0) {
      this.applyGameplayEvent({
        type: "item.collected",
        item: target.item,
        quantity: outcome.loot!.quantity,
      });
    }
    this.persist();
    this.audio.playCue(outcome.result === "hit" ? "harvest" : "collect");
    this.emitSnapshot(true);
  }

  setFeatureOverlay(overlay: FeatureOverlayState) {
    if (!this.started && overlay) return false;
    this.featureOverlay = overlay
      ? structuredClone(overlay)
      : null;
    this.input.reset();
    if (overlay) {
      this.mapOpen = false;
      this.inventoryOpen = false;
      this.settingsOpen = false;
      this.activeInspection = null;
      this.developerPanelOpen = false;
      this.paused = true;
      if (!this.testMode && this.input.isLocked()) document.exitPointerLock?.();
    }
    this.emitSnapshot(true);
    return true;
  }

  acceptContract(contractId: string) {
    const definition = contractById(contractId);
    if (
      !definition ||
      this.featureProgress.contractJournal.contracts[definition.id] ||
      hasOutstandingContract(this.featureProgress.contractJournal)
    ) {
      return false;
    }
    const acceptedJournal = acceptContractProgress(
      this.featureProgress.contractJournal,
      definition.id,
      this.environment.getPersistentWorldMinutes(),
    );
    this.featureProgress = {
      ...this.featureProgress,
      contractJournal: this.reconcilePersistentContractEvidence(
        acceptedJournal,
      ),
    };
    this.lastFeatureNotice = {
      type: "contract",
      title: `${definition.code} accepted`,
      detail: definition.title,
    };
    this.syncContractNavigation();
    this.persist();
    this.audio.playCue("discover");
    this.emitSnapshot(true);
    return true;
  }

  turnInContract(contractId: string) {
    const definition = contractById(contractId);
    if (!definition) return false;
    const progress = this.featureProgress.contractJournal.contracts[definition.id];
    if (!progress || progress.status !== "ready") return false;
    for (const [item, quantity] of Object.entries(definition.rewards)) {
      const itemId = item as ItemId;
      if (this.inventory[itemId] + (quantity ?? 0) > ITEM_DEFINITIONS[itemId].stackLimit) {
        this.lastFeatureNotice = {
          type: "contract",
          title: "Reward capacity exceeded",
          detail: `Make room for ${ITEM_DEFINITIONS[itemId].name.toLowerCase()} before reporting.`,
        };
        this.emitSnapshot(true);
        return false;
      }
    }
    const outcome = turnInContractProgress(
      this.featureProgress.contractJournal,
      definition.id,
      this.environment.getPersistentWorldMinutes(),
    );
    if (!outcome.rewards) return false;
    let nextInventory = { ...this.inventory };
    for (const [item, quantity] of Object.entries(outcome.rewards)) {
      nextInventory = addItem(nextInventory, item as ItemId, quantity ?? 0);
    }
    this.inventory = nextInventory;
    this.featureProgress = {
      ...this.featureProgress,
      contractJournal: outcome.state,
    };
    this.lastFeatureNotice = {
      type: "contract",
      title: `${definition.code} complete`,
      detail: "Rewards transferred to the field kit.",
    };
    this.syncContractNavigation();
    this.persist();
    this.audio.playCue("discover");
    this.emitSnapshot(true);
    return true;
  }

  craftRecipe(recipeId: string, station: CraftingStationKind) {
    const recipe = recipeById(recipeId);
    const outcome = resolveCraftRecipe(
      this.inventory,
      recipeId,
      station,
      this.featureProgress.unlockedRecipeIds,
    );
    if (!recipe || outcome.result !== "crafted" || !outcome.item) {
      this.lastFeatureNotice = {
        type: "craft",
        title: "Fabrication unavailable",
        detail:
          outcome.result === "wrong_station"
            ? "This recipe requires the Field Unit fabrication bench."
            : outcome.result === "locked"
              ? "The recipe has not been unlocked."
              : "Required materials or inventory capacity are unavailable.",
      };
      this.emitSnapshot(true);
      return false;
    }
    this.inventory = outcome.inventory;
    this.applyGameplayEvent({
      type: "item.crafted",
      recipeId: recipe.id,
      item: outcome.item,
      quantity: outcome.quantity,
    });
    this.lastFeatureNotice = {
      type: "craft",
      title: `${recipe.label} fabricated`,
      detail: `${outcome.quantity} added to the field kit.`,
    };
    this.persist();
    this.audio.playCue("collect");
    this.emitSnapshot(true);
    return true;
  }

  useInventoryItem(item: ItemId) {
    if (!(item in ITEM_DEFINITIONS) || this.inventory[item] <= 0) return false;
    const useKind = itemUseKind(item);
    if (!useKind) return false;
    if (useKind === "heal") {
      if (this.player.condition.health >= MAX_HEALTH) {
        this.lastFeatureNotice = {
          type: "item",
          title: "Vitals nominal",
          detail: "The first-aid kit was not consumed.",
        };
        this.emitSnapshot(true);
        return false;
      }
      const inventory = removeItem(this.inventory, item, 1);
      if (!inventory) return false;
      this.inventory = inventory;
      this.player.condition = {
        ...this.player.condition,
        health: Math.min(MAX_HEALTH, this.player.condition.health + 35),
        damageRecoveryDelay: 0,
      };
      this.applyGameplayEvent({ type: "item.used", item });
      this.lastFeatureNotice = {
        type: "item",
        title: "First aid applied",
        detail: "Health restored by 35 points.",
      };
      this.persist();
      this.audio.playCue("recover");
      this.emitSnapshot(true);
      return true;
    }
    const archetypeByUse = {
      deploy_bedroll: "bedroll",
      deploy_campfire: "campfire",
      deploy_marker: "survey_marker",
      deploy_shelter: "weather_shelter",
      deploy_torch: "field_torch",
    } as const satisfies Record<Exclude<typeof useKind, "heal">, PlacementArchetype>;
    return this.placeInventoryItem(item, archetypeByUse[useKind]);
  }

  takeContainerItem(
    containerId: string,
    item: ItemId,
    quantity = 1,
  ) {
    const outcome = resolveTakeContainerItem(
      this.inventory,
      this.featureProgress.containerStates,
      containerId,
      item,
      quantity,
    );
    if (outcome.quantity <= 0) return false;
    this.inventory = outcome.inventory;
    this.featureProgress = {
      ...this.featureProgress,
      containerStates: outcome.states,
    };
    this.world.setContainerStates(outcome.states);
    this.applyGameplayEvent({
      type: "container.looted",
      containerId,
      quantity: outcome.quantity,
    });
    this.applyGameplayEvent({
      type: "item.collected",
      item,
      quantity: outcome.quantity,
    });
    this.lastFeatureNotice = {
      type: "loot",
      title: `${ITEM_DEFINITIONS[item].name} recovered`,
      detail: `${outcome.quantity} transferred to the field kit.`,
    };
    this.persist();
    this.audio.playCue("collect");
    this.emitSnapshot(true);
    return true;
  }

  takeAllContainerItems(containerId: string) {
    const previousInventory = this.inventory;
    const outcome = resolveTakeAllContainerItems(
      this.inventory,
      this.featureProgress.containerStates,
      containerId,
    );
    if (outcome.quantity <= 0) return false;
    this.inventory = outcome.inventory;
    this.featureProgress = {
      ...this.featureProgress,
      containerStates: outcome.states,
    };
    this.world.setContainerStates(outcome.states);
    this.applyGameplayEvent({
      type: "container.looted",
      containerId,
      quantity: outcome.quantity,
    });
    for (const item of Object.keys(ITEM_DEFINITIONS) as ItemId[]) {
      const quantity = outcome.inventory[item] - previousInventory[item];
      if (quantity > 0) {
        this.applyGameplayEvent({ type: "item.collected", item, quantity });
      }
    }
    this.lastFeatureNotice = {
      type: "loot",
      title: "Container transfer complete",
      detail: `${outcome.quantity} item${outcome.quantity === 1 ? "" : "s"} recovered.`,
    };
    this.persist();
    this.audio.playCue("collect");
    this.emitSnapshot(true);
    return true;
  }

  completeRest(optionId: RestOptionId) {
    if (!this.featureOverlay || this.featureOverlay.kind !== "rest") return false;
    const site = this.featureOverlay.site;
    const outcome = resolveRest(
      this.player.condition,
      site,
      optionId,
      this.environment.getPersistentWorldMinutes(),
    );
    if (!outcome.accepted) return false;
    this.player.condition = outcome.condition;
    this.environment.setWorldMinutes(
      this.environment.getPersistentWorldMinutes() + outcome.minutes,
    );
    this.environment.sync(this.player.position, true);
    this.environment.present(this.player.position, 0);
    this.synchronizeTimeDependentWorld();
    this.featureProgress = {
      ...this.featureProgress,
      lastRestAt: this.environment.getPersistentWorldMinutes(),
    };
    this.applyGameplayEvent({
      type: "rest.completed",
      siteId: site.id,
      minutes: outcome.minutes,
    });
    this.lastFeatureNotice = {
      type: "rest",
      title: "Rest cycle complete",
      detail: `${Math.round(outcome.minutes / 60)} game hour${outcome.minutes === 60 ? "" : "s"} elapsed.`,
    };
    this.persist();
    this.audio.playCue("recover");
    this.emitSnapshot(true);
    return true;
  }

  talkToNpc(npcId: string) {
    const npc = npcById(npcId);
    if (!npc) return false;
    this.applyGameplayEvent({ type: "npc.talked", npcId: npc.id });
    this.persist();
    this.setFeatureOverlay({ kind: "dialogue", npcId: npc.id });
    this.audio.playCue("inspect");
    return true;
  }

  clearFeatureNotice() {
    this.lastFeatureNotice = null;
    this.emitSnapshot(true);
  }

  private completeScan(entryId: string) {
    const entry = fieldGuideEntry(entryId);
    if (!entry || this.featureProgress.fieldGuideEntries.includes(entry.id)) return false;
    this.featureProgress = {
      ...this.featureProgress,
      fieldGuideEntries: addFieldGuideEntry(
        this.featureProgress.fieldGuideEntries,
        entry.id,
      ),
    };
    this.applyGameplayEvent({ type: "subject.scanned", entryId: entry.id });
    this.lastFeatureNotice = {
      type: "scan",
      title: `${entry.title} catalogued`,
      detail: `${entry.category.toUpperCase()} entry added to the field guide.`,
    };
    this.persist();
    this.audio.playCue("scan");
    this.emitSnapshot(true);
    return true;
  }

  private placeInventoryItem(item: ItemId, archetypeId: PlacementArchetype) {
    if (this.featureProgress.placedEntities.length >= 64) {
      this.lastFeatureNotice = {
        type: "placement",
        title: "Deployment registry full",
        detail: "The current field build supports up to 64 persistent placements.",
      };
      this.emitSnapshot(true);
      return false;
    }
    const distance = archetypeId === "weather_shelter" ? 3.1 : 2.35;
    const x = this.player.position.x - Math.sin(this.player.yaw) * distance;
    const z = this.player.position.z - Math.cos(this.player.yaw) * distance;
    const y = this.world.sampleGroundHeight(x, z, this.player.position.y);
    const radius = archetypeId === "weather_shelter" ? 1.5 : archetypeId === "bedroll" ? 0.95 : 0.55;
    const supportHeights = [
      this.world.sampleGroundHeight(x + radius, z, y),
      this.world.sampleGroundHeight(x - radius, z, y),
      this.world.sampleGroundHeight(x, z + radius, y),
      this.world.sampleGroundHeight(x, z - radius, y),
    ];
    const overlap = this.featureProgress.placedEntities.some((record) => {
      const existingRadius = record.archetypeId === "weather_shelter"
        ? 1.5
        : record.archetypeId === "bedroll"
          ? 0.95
          : 0.55;
      return Math.abs(record.y - y) < 1.5 &&
        Math.hypot(record.x - x, record.z - z) < existingRadius + radius + 0.25;
    });
    if (
      !Number.isFinite(y) ||
      !supportHeights.every(Number.isFinite) ||
      y <= WATER_LEVEL + 0.12 ||
      Math.abs(y - this.player.position.y) > 1.1 ||
      Math.max(...supportHeights) - Math.min(...supportHeights) > 0.65 ||
      Math.abs(x) > WORLD_HALF_EXTENT ||
      Math.abs(z) > WORLD_HALF_EXTENT ||
      overlap ||
      !this.world.canStandAt(x, z, y, radius)
    ) {
      this.lastFeatureNotice = {
        type: "placement",
        title: "Clear ground required",
        detail: "Face a dry, unobstructed patch of terrain and try again.",
      };
      this.emitSnapshot(true);
      return false;
    }
    const serial = this.featureProgress.nextPlacedSerial;
    if (
      !Number.isSafeInteger(serial) ||
      serial < 1 ||
      serial > MAX_PLACED_SERIAL ||
      this.featureProgress.placedEntities.some((record) =>
        record.id === `placed:${archetypeId}:${serial}`)
    ) {
      this.lastFeatureNotice = {
        type: "placement",
        title: "Deployment registry unavailable",
        detail: "No safe persistent identifier is available for this placement.",
      };
      this.emitSnapshot(true);
      return false;
    }
    const inventory = removeItem(this.inventory, item, 1);
    if (!inventory) return false;
    const record: PlacedEntity = {
      id: `placed:${archetypeId}:${serial}`,
      archetypeId,
      x,
      y,
      z,
      yaw: this.player.yaw,
    };
    this.inventory = inventory;
    const placedEntities = [...this.featureProgress.placedEntities, record];
    this.featureProgress = {
      ...this.featureProgress,
      placedEntities,
      nextPlacedSerial: serial + 1,
    };
    this.world.setPlacedEntities(placedEntities);
    if (archetypeId === "survey_marker") {
      this.navigation.setTarget({
        id: record.id,
        label: `Survey marker ${serial}`,
        position: { x, z },
        source: { kind: "system", systemId: "survey-markers" },
        arrivalRadius: 3,
        clearOnArrival: false,
      }, false);
    }
    this.applyGameplayEvent({ type: "item.used", item });
    this.applyGameplayEvent({ type: "structure.placed", archetypeId });
    this.lastFeatureNotice = {
      type: "placement",
      title: `${ITEM_DEFINITIONS[item].name} deployed`,
      detail: "Placement registered in the persistent world record.",
    };
    this.persist();
    this.audio.playCue("collect");
    this.emitSnapshot(true);
    return true;
  }

  private applyGameplayEvent(event: GameplayEvent) {
    const previous = JSON.stringify(this.featureProgress.contractJournal);
    const contractJournal = this.reconcilePersistentContractEvidence(
      progressContracts(this.featureProgress.contractJournal, event),
    );
    if (JSON.stringify(contractJournal) === previous) return false;
    this.featureProgress = { ...this.featureProgress, contractJournal };
    const activeId = contractJournal.activeContractId;
    const definition = activeId ? contractById(activeId) : null;
    const progress = definition ? contractJournal.contracts[definition.id] : null;
    const objective = definition && progress
      ? currentContractObjective(definition, progress)
      : null;
    this.lastFeatureNotice = {
      type: "contract",
      title: definition ? `${definition.code} updated` : "Contract updated",
      detail: objective?.label ?? "Objectives complete. Report to the issuer.",
    };
    this.syncContractNavigation();
    return true;
  }

  private reconcilePersistentContractEvidence(
    journal: Readonly<ContractJournalState>,
  ): ContractJournalState {
    return reconcileContractEvidence(journal, {
      inventory: this.inventory,
      fieldGuideEntries: this.featureProgress.fieldGuideEntries,
      containerStates: this.featureProgress.containerStates,
      placedEntities: this.featureProgress.placedEntities,
      lastRestAt: this.featureProgress.lastRestAt,
    });
  }

  private syncContractNavigation(activate = true) {
    const navigationId = "contract:active-objective";
    const activeId = this.featureProgress.contractJournal.activeContractId;
    const definition = activeId ? contractById(activeId) : null;
    const progress = definition
      ? this.featureProgress.contractJournal.contracts[definition.id]
      : null;
    const objective = definition && progress?.status === "active"
      ? currentContractObjective(definition, progress)
      : null;
    const scheduleAnchor = objective?.matcher.type === "return"
      ? authoredNpcScheduleAnchor(this.environment.getSample().totalMinutes)
      : null;
    const targetPosition = scheduleAnchor
      ? { x: scheduleAnchor.x, z: scheduleAnchor.z }
      : objective?.target;
    if (!definition || !objective || !targetPosition) {
      this.navigation.removeTarget(navigationId);
      return;
    }
    const target: NavigationTargetInput = {
      id: navigationId,
      label: objective.label,
      position: targetPosition,
      source: {
        kind: "quest",
        questId: definition.id,
        objectiveId: objective.id,
      },
      arrivalRadius: 4,
      clearOnArrival: false,
    };
    const existing = this.navigation.getTarget(navigationId);
    const shouldActivate = activate &&
      this.navigation.getActiveTarget()?.id !== MANUAL_WAYPOINT_ID;
    const unchanged = existing &&
      existing.label === target.label &&
      existing.position.x === target.position.x &&
      existing.position.z === target.position.z &&
      existing.source.kind === "quest" &&
      existing.source.questId === definition.id &&
      existing.source.objectiveId === objective.id;
    if (!unchanged) {
      this.navigation.setTarget(target, shouldActivate);
    } else if (shouldActivate && this.navigation.getActiveTarget()?.id !== navigationId) {
      this.navigation.activateTarget(navigationId);
    }
  }

  private syncPlacedNavigationTargets() {
    for (const target of this.navigation.targetsSnapshot()) {
      if (target.source.kind === "system" && target.source.systemId === "survey-markers") {
        this.navigation.removeTarget(target.id);
      }
    }
    for (const record of this.featureProgress.placedEntities) {
      if (record.archetypeId !== "survey_marker") continue;
      const serial = record.id.split(":").at(-1) ?? "?";
      this.navigation.setTarget({
        id: record.id,
        label: `Survey marker ${serial}`,
        position: { x: record.x, z: record.z },
        source: { kind: "system", systemId: "survey-markers" },
        arrivalRadius: 3,
        clearOnArrival: false,
      }, false);
    }
  }

  setMapOpen(open: boolean) {
    this.mapOpen = open;
    if (open) {
      this.developerPanelOpen = false;
      this.inventoryOpen = false;
      this.settingsOpen = false;
      this.activeInspection = null;
      this.featureOverlay = null;
    }
    this.input.reset();
    if (open && !this.testMode && this.input.isLocked()) document.exitPointerLock?.();
    this.emitSnapshot(true);
  }

  setInventoryOpen(open: boolean) {
    if (!this.started) return;
    this.inventoryOpen = open;
    this.input.reset();
    if (open) {
      this.mapOpen = false;
      this.settingsOpen = false;
      this.activeInspection = null;
      this.featureOverlay = null;
      this.developerPanelOpen = false;
      this.paused = true;
      if (!this.testMode && this.input.isLocked()) document.exitPointerLock?.();
    }
    this.emitSnapshot(true);
  }

  setSettingsOpen(open: boolean) {
    if (!this.ready) return;
    this.settingsOpen = open;
    this.input.reset();
    if (open) {
      this.mapOpen = false;
      this.inventoryOpen = false;
      this.activeInspection = null;
      this.featureOverlay = null;
      this.developerPanelOpen = false;
      if (this.started) this.paused = true;
      if (!this.testMode && this.input.isLocked()) document.exitPointerLock?.();
    }
    this.emitSnapshot(true);
  }

  setInspection(inspection: InspectionRecord | null) {
    if (!this.started) return;
    this.activeInspection = inspection ? { ...inspection } : null;
    this.input.reset();
    if (inspection) {
      this.mapOpen = false;
      this.inventoryOpen = false;
      this.settingsOpen = false;
      this.developerPanelOpen = false;
      this.featureOverlay = null;
      this.paused = true;
      if (!this.testMode && this.input.isLocked()) document.exitPointerLock?.();
    }
    this.emitSnapshot(true);
  }

  setDeveloperPanelOpen(open: boolean) {
    if (!this.started) return;
    this.developerPanelOpen = open;
    this.input.reset();
    if (open) {
      this.mapOpen = false;
      this.inventoryOpen = false;
      this.settingsOpen = false;
      this.activeInspection = null;
      this.featureOverlay = null;
      this.paused = true;
      if (!this.testMode && this.input.isLocked()) document.exitPointerLock?.();
      this.emitSnapshot(true);
      return;
    }
    this.resume();
  }

  setDeveloperMode(enabled: boolean) {
    this.environment.setDeveloperMode(enabled);
    this.refreshEnvironment();
  }

  setDeveloperTimeOfDay(minutes: number) {
    this.environment.setDeveloperMinuteOfDay(minutes);
    this.refreshEnvironment();
  }

  advanceDeveloperMinutes(minutes: number) {
    this.environment.advanceDeveloperMinutes(minutes);
    this.refreshEnvironment();
  }

  setDeveloperClockPaused(paused: boolean) {
    this.environment.setDeveloperClockPaused(paused);
    this.refreshEnvironment(false);
  }

  setDeveloperWeather(weatherId: WeatherId | null) {
    const accepted = this.environment.setDeveloperWeather(weatherId);
    this.refreshEnvironment();
    return accepted;
  }

  resetDeveloperOverrides() {
    this.environment.resetDeveloperOverrides();
    this.refreshEnvironment();
  }

  setManualWaypoint(x: number, z: number) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const target = this.navigation.setManualWaypoint({
      x: clamp(x, -WORLD_HALF_EXTENT, WORLD_HALF_EXTENT),
      z: clamp(z, -WORLD_HALF_EXTENT, WORLD_HALF_EXTENT),
    });
    if (!target) return null;
    this.persist();
    this.emitPresentation();
    this.emitSnapshot(true);
    return target;
  }

  clearManualWaypoint() {
    const removed = this.navigation.removeTarget(MANUAL_WAYPOINT_ID);
    if (!removed) return false;
    this.syncContractNavigation();
    this.persist();
    this.emitPresentation();
    this.emitSnapshot(true);
    return true;
  }

  fastTravel(locationId: string) {
    const location = getFastTravelLocation(locationId);
    if (!location) return null;

    // Prime the destination ring first, then use its deterministic colliders to
    // choose an arrival that does not overlap a landmark or procedural prop.
    const preliminary = resolveFastTravelArrival(location);
    this.world.update(preliminary.x, preliminary.z);
    const arrival = resolveFastTravelArrival(location, this.world.colliders);
    this.relocatePlayer(arrival.x, arrival.z, arrival.y, location.x, location.z);
    this.lastFastTravel = {
      id: location.id,
      name: location.name,
      kind: location.kind,
    };
    this.persist();
    this.emitSnapshot(true);
    return { location, arrival };
  }

  setWorldMinutes(minutes: number) {
    this.environment.setWorldMinutes(minutes);
    this.environment.sync(this.player.position, true);
    this.environment.present(this.player.position, 0);
    this.synchronizeTimeDependentWorld();
    this.persist();
    this.emitSnapshot(true);
  }

  setHorizonMode(mode: HorizonMode) {
    if (!isHorizonMode(mode) || mode === this.horizonMode) return false;
    this.horizonMode = mode;
    this.settings = { ...this.settings, horizonMode: mode };
    this.runtime.settings = this.settings;
    this.camera.far = HORIZON_PRESETS[mode].drawDistanceMeters;
    this.camera.updateProjectionMatrix();
    this.horizon.setMode(mode);
    this.environment.setHorizonMode(mode);
    this.environment.sync(this.player.position);
    this.environment.present(this.player.position, 0);
    this.persistPreferences();
    this.persist();
    this.emitSnapshot(true);
    return true;
  }

  setFov(fov: number) {
    const next = normalizeGameSettings({ ...this.settings, fov }, this.horizonMode);
    if (next.fov === this.settings.fov) return false;
    this.settings = next;
    this.runtime.settings = this.settings;
    this.camera.fov = next.fov;
    this.camera.updateProjectionMatrix();
    this.persistPreferences();
    this.emitSnapshot(true);
    return true;
  }

  setLookSensitivity(lookSensitivity: number) {
    const next = normalizeGameSettings({ ...this.settings, lookSensitivity }, this.horizonMode);
    if (next.lookSensitivity === this.settings.lookSensitivity) return false;
    this.settings = next;
    this.runtime.settings = this.settings;
    this.persistPreferences();
    this.emitSnapshot(true);
    return true;
  }

  setInvertY(invertY: boolean) {
    if (invertY === this.settings.invertY) return false;
    this.settings = { ...this.settings, invertY };
    this.runtime.settings = this.settings;
    this.persistPreferences();
    this.emitSnapshot(true);
    return true;
  }

  setAudioVolume(
    channel: "masterVolume" | "ambientVolume" | "effectsVolume",
    value: number,
  ) {
    const next = normalizeGameSettings({ ...this.settings, [channel]: value }, this.horizonMode);
    if (next[channel] === this.settings[channel]) return false;
    this.settings = next;
    this.runtime.settings = this.settings;
    this.audio.setSettings(this.settings);
    this.persistPreferences();
    this.emitSnapshot(true);
    return true;
  }

  setKeyBinding(action: GameAction, code: string) {
    const bindings = rebindAction(this.settings.keyBindings, action, code);
    if (!bindings) return false;
    this.settings = { ...this.settings, keyBindings: bindings };
    this.runtime.settings = this.settings;
    this.input.setBindings(bindings);
    this.persistPreferences();
    this.emitSnapshot(true);
    return true;
  }

  resetSettings() {
    this.settings = {
      ...DEFAULT_GAME_SETTINGS,
      keyBindings: { ...DEFAULT_GAME_SETTINGS.keyBindings },
    };
    this.runtime.settings = this.settings;
    this.input.setBindings(this.settings.keyBindings);
    this.audio.setSettings(this.settings);
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
    if (this.quality !== this.settings.quality) this.applyQuality(this.settings.quality);
    if (this.horizonMode !== this.settings.horizonMode) {
      this.horizonMode = this.settings.horizonMode;
      this.camera.far = HORIZON_PRESETS[this.horizonMode].drawDistanceMeters;
      this.camera.updateProjectionMatrix();
      this.horizon.setMode(this.horizonMode);
      this.environment.setHorizonMode(this.horizonMode);
    }
    this.persistPreferences();
    this.persist();
    this.emitSnapshot(true);
  }

  saveNow() {
    const saved = this.persist();
    if (saved) this.audio.playCue("save");
    this.emitSnapshot(true);
    return saved;
  }

  loadGame() {
    if (!this.saveStore.hasSave()) return false;
    const saved = this.saveStore.load();
    this.scanned = [...saved.scanned];
    this.inventory = { ...saved.inventory };
    this.discoveredLocations = [...saved.discoveredLocations];
    this.featureProgress = saved.featureProgress;
    this.featureProgress = {
      ...this.featureProgress,
      contractJournal: this.reconcilePersistentContractEvidence(
        this.featureProgress.contractJournal,
      ),
    };
    const playerState = saved.player;
    const x = playerState?.x ?? 0;
    const z = playerState?.z ?? 8;
    this.world.restorePersistentState(
      saved.worldDiffs,
      saved.doorStates,
      this.scanned,
      x,
      z,
      this.featureProgress.containerStates,
      this.featureProgress.placedEntities,
    );
    for (const key of Object.keys(this.worldDiffs)) delete this.worldDiffs[key];
    Object.assign(this.worldDiffs, saved.worldDiffs);
    for (const key of Object.keys(this.doorStates)) delete this.doorStates[key];
    Object.assign(this.doorStates, saved.doorStates);
    this.navigation.removeTarget(MANUAL_WAYPOINT_ID);
    if (saved.manualWaypoint) this.navigation.setManualWaypoint(saved.manualWaypoint);
    this.environment.setWorldMinutes(saved.worldMinutes);
    this.player.yaw = playerState?.yaw ?? -0.565;
    this.player.pitch = playerState?.pitch ?? -0.035;
    this.player.condition = playerState && playerState.health > 0
      ? {
          ...INITIAL_PLAYER_CONDITION,
          health: playerState.health,
          wetness: playerState.wetness,
          coldStress: playerState.coldStress,
        }
      : recoverPlayerCondition();
    const y = this.world.sampleGroundHeight(x, z, playerState?.y);
    this.relocatePlayer(x, z, y);
    this.currentLocation = currentDiscoverableLocation(x, z);
    this.lastDiscovery = null;
    this.lastGather = null;
    this.lastFastTravel = null;
    this.lastLocationDiscovery = null;
    this.lastFeatureNotice = null;
    this.saveStatus = "saved";
    this.inventoryOpen = false;
    this.settingsOpen = false;
    this.activeInspection = null;
    this.mapOpen = false;
    this.developerPanelOpen = false;
    this.featureOverlay = null;
    this.scanner.active = false;
    this.scanner.focusId = null;
    this.scanner.focusEntryId = null;
    this.scanner.focusName = null;
    this.scanner.progress = 0;
    this.syncPlacedNavigationTargets();
    this.syncContractNavigation();
    this.emitSnapshot(true);
    return true;
  }

  recoverPlayer() {
    this.player.condition = recoverPlayerCondition();
    this.player.sheltered = false;
    this.player.stamina = 1;
    this.relocatePlayer(0, 8);
    this.mapOpen = false;
    this.inventoryOpen = false;
    this.settingsOpen = false;
    this.activeInspection = null;
    this.featureOverlay = null;
    this.developerPanelOpen = false;
    this.paused = !this.testMode;
    this.persist();
    this.audio.playCue("recover");
    if (!this.testMode) this.input.requestPointerLock();
    this.emitSnapshot(true);
  }

  applyFallImpact(speed: number) {
    const damage = fallDamageForImpact(speed);
    if (damage <= 0) return 0;
    const previousHealth = this.player.condition.health;
    this.player.condition = applyPlayerDamage(this.player.condition, damage, "fall");
    if (this.player.condition.health < previousHealth) {
      this.audio.playCue("damage");
      this.persist();
    }
    if (this.player.condition.health <= 0) {
      this.paused = true;
      this.player.sprinting = false;
      if (!this.testMode && this.input.isLocked()) document.exitPointerLock?.();
    }
    this.emitSnapshot(true);
    return previousHealth - this.player.condition.health;
  }

  setPlayerHealth(health: number) {
    if (!Number.isFinite(health)) return this.player.condition.health;
    const previousHealth = this.player.condition.health;
    const safe = THREE.MathUtils.clamp(health, 0, MAX_HEALTH);
    this.player.condition = {
      ...this.player.condition,
      health: safe,
      damageRecoveryDelay: safe < previousHealth ? 8 : 0,
      lastDamage:
        safe < previousHealth
          ? { kind: "exposure", amount: previousHealth - safe }
          : this.player.condition.lastDamage,
    };
    if (safe <= 0) {
      this.paused = true;
      if (!this.testMode && this.input.isLocked()) document.exitPointerLock?.();
    }
    this.emitSnapshot(true);
    return safe;
  }

  advanceWorldMinutes(minutes: number) {
    if (!Number.isFinite(minutes)) return;
    this.setWorldMinutes(this.environment.getPersistentWorldMinutes() + minutes);
  }

  setNavigationTarget(target: NavigationTargetInput, activate = true) {
    const registered = this.navigation.setTarget(target, activate);
    if (!registered) return null;
    this.emitPresentation();
    this.emitSnapshot(true);
    return registered;
  }

  activateNavigationTarget(id: string) {
    const activated = this.navigation.activateTarget(id);
    if (activated) {
      this.emitPresentation();
      this.emitSnapshot(true);
    }
    return activated;
  }

  clearActiveNavigationTarget(expectedId?: string) {
    const previousActiveId = this.navigation.getActiveTarget()?.id ?? null;
    const cleared = this.navigation.clearActive(expectedId);
    if (cleared) {
      if (previousActiveId === MANUAL_WAYPOINT_ID) this.syncContractNavigation();
      this.emitPresentation();
      this.emitSnapshot(true);
    }
    return cleared;
  }

  removeNavigationTarget(id: string) {
    const removed = this.navigation.removeTarget(id);
    if (removed) {
      if (id === MANUAL_WAYPOINT_ID) {
        this.syncContractNavigation();
        this.persist();
      }
      this.emitPresentation();
      this.emitSnapshot(true);
    }
    return removed;
  }

  discoverCurrentLocation() {
    const location = currentDiscoverableLocation(
      this.player.position.x,
      this.player.position.z,
    );
    const changedArea = location.id !== this.currentLocation.id;
    this.currentLocation = location;
    if (this.discoveredLocations.includes(location.id)) {
      if (changedArea) this.emitSnapshot(true);
      return false;
    }
    this.discoveredLocations = addLocationDiscovery(
      this.discoveredLocations,
      location.id,
    );
    this.lastLocationDiscovery = location;
    this.applyGameplayEvent({ type: "location.discovered", locationId: location.id });
    this.persist();
    this.audio.playCue("discover");
    this.emitSnapshot(true);
    return true;
  }

  clearDiscoveryNotice() {
    this.lastDiscovery = null;
    this.emitSnapshot(true);
  }

  clearGatherNotice() {
    this.lastGather = null;
    this.emitSnapshot(true);
  }

  clearLocationDiscoveryNotice() {
    this.lastLocationDiscovery = null;
    this.emitSnapshot(true);
  }

  toggleFlashlight() {
    const enabled = this.flashlight.toggle();
    this.emitSnapshot(true);
    return enabled;
  }

  setFlashlightEnabled(enabled: boolean) {
    this.flashlight.setEnabled(enabled);
    this.emitSnapshot(true);
    return this.flashlight.isEnabled;
  }

  private relocatePlayer(
    x: number,
    z: number,
    y = this.world.sampleGroundHeight(x, z),
    faceX?: number,
    faceZ?: number,
  ) {
    this.player.position.set(x, y, z);
    this.player.verticalVelocity = 0;
    this.player.grounded = true;
    this.player.crouching = false;
    this.player.sprinting = false;
    this.player.staminaRecoveryDelay = 0;
    this.player.eyeHeight = PLAYER_HEIGHT;
    this.player.jumpBufferRemaining = 0;
    this.player.coyoteRemaining = 0;
    this.player.groundedSafeTime = 0;
    this.player.safePosition.set(x, y, z);
    if (faceX !== undefined && faceZ !== undefined) {
      this.player.yaw = Math.atan2(-(faceX - x), -(faceZ - z));
      this.player.pitch = -0.035;
    }
    this.camera.position.set(x, y + PLAYER_HEIGHT, z);
    this.camera.rotation.set(this.player.pitch, this.player.yaw, 0, "YXZ");
    this.runtime.nearbyTarget = null;
    this.runtime.nearbyDistance = null;
    this.world.update(x, z);
    this.horizon.update(x, z);
    this.citizens.update(x, z, 0, true);
    this.animals.update(x, z, 0, true);
    this.navigation.update(this.player.position);
    this.environment.sync(this.player.position, true);
    this.environment.present(this.player.position, 0);
    this.flashlight.present(this.camera);
    this.synchronizeTimeDependentWorld();
    this.currentLocation = currentDiscoverableLocation(x, z);
    this.emitPresentation();
  }

  private persist() {
    const manualWaypoint = this.navigation.getTarget(MANUAL_WAYPOINT_ID)?.position ?? null;
    const saved = this.saveStore.save({
      scanned: this.scanned,
      inventory: this.inventory,
      worldDiffs: this.worldDiffs,
      doorStates: this.doorStates,
      manualWaypoint,
      worldMinutes: this.environment.getPersistentWorldMinutes(),
      horizonMode: this.horizonMode,
      player: {
        x: this.player.position.x,
        y: this.player.position.y,
        z: this.player.position.z,
        yaw: this.player.yaw,
        pitch: this.player.pitch,
        health: this.player.condition.health,
        wetness: this.player.condition.wetness,
        coldStress: this.player.condition.coldStress,
      },
      discoveredLocations: this.discoveredLocations,
      featureProgress: this.featureProgress,
    });
    this.saveStatus = saved ? "saved" : "unavailable";
    if (saved) this.lastSavedAt = Date.now();
    return saved;
  }

  private persistPreferences() {
    return this.preferencesStore.save(this.settings);
  }

  dispose() {
    if (this.disposed) return;
    if (this.started) this.persist();
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
    this.input.dispose();
    this.pipeline.dispose();
    this.navigation.dispose();
    this.citizens.dispose();
    this.animals.dispose();
    this.flashlight.dispose();
    this.audio.dispose();
    this.world.dispose();
    this.horizon.dispose();
    this.environment.dispose();
    this.renderer.dispose();
    if (window.__STILLPOINT_TEST__) delete window.__STILLPOINT_TEST__;
  }

  private frame = (timestamp: number) => {
    if (this.disposed) return;
    const delta = this.previousTime
      ? Math.min((timestamp - this.previousTime) / 1000, MAX_FRAME_DELTA)
      : FIXED_STEP;
    this.previousTime = timestamp;

    if (this.contextStatus === "ready") {
      this.accumulator += delta;
      let steps = 0;
      while (this.accumulator >= FIXED_STEP && steps < 5) {
        this.runtime.started = this.started;
        this.runtime.paused =
          this.paused ||
          this.mapOpen ||
          this.inventoryOpen ||
          this.settingsOpen ||
          this.activeInspection !== null ||
          this.featureOverlay !== null ||
          this.developerPanelOpen ||
          this.player.condition.health <= 0;
        this.runtime.developerPanelOpen = this.developerPanelOpen;
        this.pipeline.update(this.runtime, FIXED_STEP);
        this.updateSafePosition(FIXED_STEP);
        this.accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (steps === 5) this.accumulator = 0;

      this.environment.present(this.player.position, delta);
      this.world.presentEnvironment(this.environment.getVisualState());
      this.citizens.present(
        this.started &&
          !this.paused &&
          !this.mapOpen &&
          !this.inventoryOpen &&
          !this.settingsOpen &&
          !this.activeInspection &&
          !this.featureOverlay &&
          !this.developerPanelOpen
          ? this.accumulator
          : 0,
      );
      this.animals.present(
        this.started &&
          !this.paused &&
          !this.mapOpen &&
          !this.inventoryOpen &&
          !this.settingsOpen &&
          !this.activeInspection &&
          !this.featureOverlay &&
          !this.developerPanelOpen
          ? this.accumulator
          : 0,
      );
      this.flashlight.present(this.camera);
      this.emitPresentation();
      this.renderer.render(this.scene, this.camera);
      this.trackPerformance(timestamp);
      if (
        this.started &&
        !this.testMode &&
        timestamp - this.lastClockPersistTime >= 30_000
      ) {
        this.persist();
        this.lastClockPersistTime = timestamp;
      }
      this.emitSnapshot(timestamp - this.lastSnapshotTime > 140);
    }
    this.animationFrame = requestAnimationFrame(this.frame);
  };

  private trackPerformance(timestamp: number) {
    this.framesSinceSample += 1;
    if (!this.fpsSampleStarted) this.fpsSampleStarted = timestamp;
    const elapsed = timestamp - this.fpsSampleStarted;
    if (elapsed < 650) return;
    this.fps = Math.round((this.framesSinceSample * 1000) / elapsed);
    this.framesSinceSample = 0;
    this.fpsSampleStarted = timestamp;
  }

  private updateSafePosition(deltaSeconds: number) {
    if (!this.player.grounded || this.player.condition.health <= 0) {
      this.player.groundedSafeTime = 0;
      return;
    }
    this.player.groundedSafeTime += deltaSeconds;
    if (this.player.groundedSafeTime >= 0.75) {
      this.player.safePosition.copy(this.player.position);
      this.player.groundedSafeTime = 0.75;
    }
  }

  private emitSnapshot(force = false) {
    if (!force) return;
    this.lastSnapshotTime = performance.now();
    this.syncContractNavigation(false);
    const chunk = worldToChunk(this.player.position.x, this.player.position.z);
    const heading = headingFromYaw(this.player.yaw);
    const climate = sampleClimate(this.player.position.x, this.player.position.z);
    const nearest = nearestSettlement(this.player.position.x, this.player.position.z);
    const atmosphere = this.environment.getSample();
    const developer = this.environment.getDeveloperState();
    const nearbyTarget = this.runtime.nearbyTarget;
    const horizon = this.horizon.diagnostics;
    const carriedWeight = inventoryWeight(this.inventory);
    const carriedItems = inventoryItemCount(this.inventory);
    const conditionInput = {
      sheltered: this.player.sheltered,
      stamina: this.player.stamina,
      inventoryWeight: carriedWeight,
    };
    this.snapshot = {
      ready: this.ready,
      started: this.started,
      paused: this.paused,
      mapOpen: this.mapOpen,
      inventoryOpen: this.inventoryOpen,
      settingsOpen: this.settingsOpen,
      inspectionOpen: this.activeInspection !== null,
      activeInspection: this.activeInspection ? { ...this.activeInspection } : null,
      featureOverlay: this.featureOverlay ? structuredClone(this.featureOverlay) : null,
      devTools: {
        enabled: developer.enabled,
        panelOpen: this.developerPanelOpen,
        clockPaused: developer.clockPaused,
        persistentWorldMinutes: this.environment.getPersistentWorldMinutes(),
        weatherOverride: developer.weatherOverride,
        weatherOptions: this.environment.getDeveloperWeatherOptions(),
      },
      contextStatus: this.contextStatus,
      position: {
        x: this.player.position.x,
        y: this.player.position.y,
        z: this.player.position.z,
      },
      heading,
      navigation: this.navigation.getGuidance(this.player.position, heading),
      navigationTargets: this.navigation.targetsSnapshot(),
      fps: this.fps,
      chunk,
      loadedChunks: this.world.loadedCount,
      drawDistanceMeters: HORIZON_PRESETS[this.horizonMode].drawDistanceMeters,
      horizonMode: this.horizonMode,
      horizonTiles: horizon.terrainTiles,
      horizonTriangles: horizon.terrainTriangles,
      horizonSettlementInstances: horizon.settlementInstances,
      citizenCount: this.citizens.visibleCount,
      citizenActivity: this.citizens.activityMultiplier,
      animalCount: this.animals.visibleCount,
      animalSpecies: this.animals.visibleSpeciesCount,
      crowdDensity: this.citizens.density,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      quality: this.quality,
      scanned: [...this.scanned],
      inventory: { ...this.inventory },
      inventoryWeight: carriedWeight,
      inventoryItemCount: carriedItems,
      worldChanges: Object.values(this.worldDiffs).filter((diff) => diff.removed).length,
      grounded: this.player.grounded,
      crouching: this.player.crouching,
      sprinting: this.player.sprinting,
      stamina: this.player.stamina,
      health: this.player.condition.health,
      maxHealth: MAX_HEALTH,
      wetness: this.player.condition.wetness,
      coldStress: this.player.condition.coldStress,
      apparentTemperatureC: apparentTemperature(
        atmosphere.temperatureC,
        atmosphere.windKph,
        this.player.condition.wetness,
      ),
      sheltered: this.player.sheltered,
      conditions: deriveConditionTags(this.player.condition, conditionInput),
      incapacitated: this.player.condition.health <= 0,
      lastDamage: this.player.condition.lastDamage
        ? { ...this.player.condition.lastDamage }
        : null,
      flashlightOn: this.flashlight.isEnabled,
      settings: {
        ...this.settings,
        keyBindings: { ...this.settings.keyBindings },
      },
      saveStatus: this.saveStatus,
      lastSavedAt: this.lastSavedAt,
      audio: this.audio.diagnostics,
      scanner: { ...this.scanner },
      contractJournal: structuredClone(this.featureProgress.contractJournal),
      fieldGuideEntryIds: [...this.featureProgress.fieldGuideEntries],
      containerStates: structuredClone(this.featureProgress.containerStates),
      placedEntityCount: this.featureProgress.placedEntities.length,
      unlockedRecipeIds: [...this.featureProgress.unlockedRecipeIds],
      lastFeatureNotice: this.lastFeatureNotice
        ? { ...this.lastFeatureNotice }
        : null,
      biome: {
        id: climate.biome.id,
        name: climate.biome.name,
        region: climate.biome.region,
      },
      environment: {
        totalMinutes: atmosphere.totalMinutes,
        day: atmosphere.day,
        hour: atmosphere.hour,
        minute: atmosphere.minute,
        phase: atmosphere.phase,
        weatherId: atmosphere.weatherId,
        weatherLabel: atmosphere.weatherLabel,
        precipitation: atmosphere.precipitation,
        temperatureC: atmosphere.temperatureC,
        windKph: atmosphere.windKph,
        windDirection: atmosphere.windDirection,
        visibilityMeters: atmosphere.visibilityMeters,
        clockState:
          developer.enabled && developer.clockPaused
            ? "frozen"
            : this.testMode
              ? "test_hold"
              : this.started &&
                    this.contextStatus === "ready" &&
                    !this.paused &&
                    !this.mapOpen &&
                    !this.inventoryOpen &&
                    !this.settingsOpen &&
                    !this.activeInspection &&
                    !this.featureOverlay &&
                    !this.developerPanelOpen
                ? "running"
                : "paused",
        gameMinutesPerRealSecond: GAME_MINUTES_PER_REAL_SECOND,
      },
      nearestSettlement: {
        id: nearest.settlement.id,
        name: nearest.settlement.name,
        tier: nearest.settlement.tier,
        distance: nearest.distance,
        economy: nearest.settlement.economy,
        reason: nearest.settlement.reason,
      },
      nearbyTarget: nearbyTarget
        ? {
            id: nearbyTarget.id,
            kind: nearbyTarget.kind,
            action: nearbyTarget.action,
            name: nearbyTarget.name,
            item: nearbyTarget.item ?? null,
            hits: nearbyTarget.hits,
            hitsRequired: nearbyTarget.hitsRequired,
            beaconId: nearbyTarget.beaconId ?? null,
            open: nearbyTarget.open ?? null,
            empty: nearbyTarget.empty ?? null,
            fieldGuideId: nearbyTarget.fieldGuideId ?? null,
          }
        : null,
      interactionPrompt: nearbyTarget
        ? interactionPromptFor(nearbyTarget, this.settings.keyBindings)
        : null,
      nearbyBeacon: nearbyTarget?.beaconId ?? null,
      nearbyDistance: this.runtime.nearbyDistance,
      lastDiscovery: this.lastDiscovery,
      lastGather: this.lastGather,
      lastFastTravel: this.lastFastTravel,
      currentLocation: { ...this.currentLocation },
      discoveredLocationIds: [...this.discoveredLocations],
      lastLocationDiscovery: this.lastLocationDiscovery
        ? { ...this.lastLocationDiscovery }
        : null,
    };
    this.onSnapshot(this.snapshot);
  }

  private projectWaypoint(): WaypointScreenProjection | null {
    const target = this.navigation.getActiveTarget();
    if (!target) return null;
    const distance = Math.hypot(
      target.position.x - this.player.position.x,
      target.position.z - this.player.position.z,
    );
    if (distance > WAYPOINT_WORLD_MARKER_DISTANCE) return null;

    this.camera.updateMatrixWorld();
    this.projectionPoint.set(
      target.position.x,
      sampleTerrainHeight(target.position.x, target.position.z) + 2.4,
      target.position.z,
    );
    this.projectionDirection.copy(this.projectionPoint).sub(this.camera.position).normalize();
    this.camera.getWorldDirection(this.cameraDirection);
    const inFront = this.projectionDirection.dot(this.cameraDirection) > 0;
    this.projectionPoint.project(this.camera);
    const visible =
      inFront &&
      this.projectionPoint.z >= -1 &&
      this.projectionPoint.z <= 1 &&
      Math.abs(this.projectionPoint.x) <= 0.86 &&
      Math.abs(this.projectionPoint.y) <= 0.74;
    return {
      visible,
      xPercent: clamp(50 + this.projectionPoint.x * 50, 7, 93),
      yPercent: clamp(50 - this.projectionPoint.y * 50, 12, 88),
    };
  }

  private emitPresentation() {
    const unwrappedHeading = unwrappedHeadingFromYaw(this.player.yaw);
    const heading = headingFromYaw(this.player.yaw);
    this.onPresentation({
      heading,
      unwrappedHeading,
      navigation: this.navigation.getGuidance(this.player.position, heading),
      waypointScreen: this.projectWaypoint(),
    });
  }

  private toggleMap() {
    this.setMapOpen(!this.mapOpen);
  }

  private toggleInventory() {
    this.setInventoryOpen(!this.inventoryOpen);
  }

  private toggleDeveloperPanel() {
    this.setDeveloperPanelOpen(!this.developerPanelOpen);
  }

  private toggleOperations() {
    if (this.featureOverlay?.kind === "operations") {
      this.setFeatureOverlay(null);
      this.resume();
      return;
    }
    this.setFeatureOverlay({
      kind: "operations",
      tab: "fieldGuide",
      station: "field",
    });
  }

  private refreshEnvironment(snap = true) {
    this.environment.sync(this.player.position, snap);
    this.environment.present(this.player.position, 0);
    this.world.presentEnvironment(this.environment.getVisualState());
    this.synchronizeTimeDependentWorld();
    this.emitSnapshot(true);
  }

  private synchronizeTimeDependentWorld() {
    const atmosphere = this.environment.getSample();
    this.world.setNightLighting(atmosphere.night);
    this.world.setWorldMinutes(atmosphere.totalMinutes);
    this.citizens.setWorldMinutes(atmosphere.totalMinutes);
    this.syncContractNavigation(false);
  }

  setQuality(quality: QualityLevel) {
    if (!isQualityLevel(quality)) return false;
    if (quality === this.quality) return false;
    this.applyQuality(quality);
    this.settings = { ...this.settings, quality };
    this.runtime.settings = this.settings;
    this.persistPreferences();
    this.emitSnapshot(true);
    return true;
  }

  private applyQuality(quality: QualityLevel) {
    this.quality = quality;
    const preset = QUALITY_PRESETS[quality];
    this.renderer.shadowMap.enabled = preset.shadows;
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, preset.pixelRatioCap),
    );
    this.environment.setQuality(this.quality);
    this.world.setQuality(this.quality);
    this.citizens.setQuality(this.quality);
    this.animals.setQuality(this.quality);
    this.flashlight.setQuality(this.quality);
    this.resize();
  }

  private toggleQuality() {
    const currentIndex = QUALITY_LEVELS.indexOf(this.quality);
    this.setQuality(QUALITY_LEVELS[(currentIndex + 1) % QUALITY_LEVELS.length]);
  }

  private resize = () => {
    const width = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, QUALITY_PRESETS[this.quality].pixelRatioCap),
    );
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  private handlePointerLockChange = (locked: boolean) => {
    if (!this.started || this.testMode) return;
    this.paused =
      this.developerPanelOpen ||
      this.mapOpen ||
      this.inventoryOpen ||
      this.settingsOpen ||
      this.activeInspection !== null ||
      this.featureOverlay !== null ||
      this.player.condition.health <= 0 ||
      !locked;
    this.emitSnapshot(true);
  };

  private handleVisibilityChange = () => {
    if (document.hidden && this.started) {
      this.paused = true;
      if (this.input.isLocked()) document.exitPointerLock?.();
      this.persist();
      this.emitSnapshot(true);
    }
  };

  private handleContextLost = (event: Event) => {
    event.preventDefault();
    this.contextStatus = "lost";
    this.paused = true;
    if (this.input.isLocked()) document.exitPointerLock?.();
    this.emitSnapshot(true);
  };

  private handleContextRestored = () => {
    this.contextStatus = "ready";
    this.renderer.resetState();
    this.emitSnapshot(true);
  };

  private installTestBridge() {
    window.__STILLPOINT_TEST__ = {
      isReady: () => this.ready,
      snapshot: () => structuredClone(this.snapshot),
      teleport: (x, z, y) => {
        this.relocatePlayer(x, z, y);
        this.emitSnapshot(true);
      },
      faceBeacon: (beaconId) => {
        const beacon = BEACONS.find((candidate) => candidate.id === beaconId);
        if (!beacon) return;
        const deltaX = beacon.x - this.player.position.x;
        const deltaZ = beacon.z - this.player.position.z;
        this.player.yaw = Math.atan2(-deltaX, -deltaZ);
        this.player.pitch = -0.08;
        this.camera.rotation.set(this.player.pitch, this.player.yaw, 0, "YXZ");
        this.emitPresentation();
        this.emitSnapshot(true);
      },
      discover: (beaconId) => this.discover(beaconId),
      loseContext: () => {
        const extension = this.renderer.getContext().getExtension("WEBGL_lose_context");
        extension?.loseContext();
      },
      restoreContext: () => {
        const extension = this.renderer.getContext().getExtension("WEBGL_lose_context");
        extension?.restoreContext();
      },
      targets: () =>
        this.world.targets.map((target) => ({
          id: target.id,
          kind: target.kind,
          action: target.action,
          x: target.position.x,
          z: target.position.z,
          open: target.open ?? null,
        })),
      doors: () => structuredClone(this.world.doorsSnapshot),
      groundHeight: (x, z, referenceY) =>
        this.world.sampleGroundHeight(x, z, referenceY),
      citizens: () => this.citizens.debugSnapshot(),
      animals: () => this.animals.debugSnapshot(),
      toggleFlashlight: () => this.toggleFlashlight(),
      setFlashlightEnabled: (enabled) => this.setFlashlightEnabled(enabled),
      flashlight: () => this.flashlight.diagnostics,
      audio: () => this.audio.diagnostics,
      saveNow: () => this.saveNow(),
      loadGame: () => this.loadGame(),
      setFov: (fov) => this.setFov(fov),
      setLookSensitivity: (value) => this.setLookSensitivity(value),
      setInvertY: (enabled) => this.setInvertY(enabled),
      setKeyBinding: (action, code) => this.setKeyBinding(action, code),
      setQuality: (quality) => this.setQuality(quality),
      setPlayerHealth: (health) => this.setPlayerHealth(health),
      applyFallImpact: (speed) => this.applyFallImpact(speed),
      recoverPlayer: () => this.recoverPlayer(),
      discoverCurrentLocation: () => this.discoverCurrentLocation(),
      inspectableIds: () => this.world.targets
        .filter((target) => target.kind === "inspectable")
        .map((target) => target.id),
      nightLighting: () => this.world.nightLightingSnapshot,
      faceTarget: (id) => {
        const target = this.world.targets.find((candidate) => candidate.id === id);
        if (!target) return;
        const deltaX = target.position.x - this.player.position.x;
        const deltaZ = target.position.z - this.player.position.z;
        this.player.yaw = Math.atan2(-deltaX, -deltaZ);
        this.player.pitch = -0.04;
        this.camera.rotation.set(this.player.pitch, this.player.yaw, 0, "YXZ");
        this.emitPresentation();
        this.emitSnapshot(true);
      },
      interactTarget: (id) => {
        const target = this.world.targets.find((candidate) => candidate.id === id);
        if (target) this.performInteraction(target);
      },
      setWaypoint: (x, z) => {
        this.setManualWaypoint(x, z);
      },
      clearWaypoint: () => {
        this.clearManualWaypoint();
      },
      fastTravel: (locationId) => {
        this.fastTravel(locationId);
      },
      setWorldMinutes: (minutes) => {
        this.setWorldMinutes(minutes);
      },
      advanceWorldMinutes: (minutes) => {
        this.advanceWorldMinutes(minutes);
      },
      setDeveloperMode: (enabled) => {
        this.setDeveloperMode(enabled);
      },
      setDeveloperPanelOpen: (open) => {
        this.setDeveloperPanelOpen(open);
      },
      setDeveloperTimeOfDay: (minutes) => {
        this.setDeveloperTimeOfDay(minutes);
      },
      advanceDeveloperMinutes: (minutes) => {
        this.advanceDeveloperMinutes(minutes);
      },
      setDeveloperClockPaused: (paused) => {
        this.setDeveloperClockPaused(paused);
      },
      setDeveloperWeather: (weatherId) => this.setDeveloperWeather(weatherId),
      resetDeveloperOverrides: () => {
        this.resetDeveloperOverrides();
      },
      setHorizonMode: (mode) => this.setHorizonMode(mode),
      horizon: () => this.horizon.diagnostics,
      setHeading: (heading) => {
        this.player.yaw = (-heading * Math.PI) / 180;
        this.camera.rotation.set(this.player.pitch, this.player.yaw, 0, "YXZ");
        this.emitPresentation();
        this.emitSnapshot(true);
      },
      navigationTargets: () => this.navigation.targetsSnapshot(),
      colliders: () => structuredClone(this.world.colliders),
      probeCollision: (current, desired, feetY) => {
        const groundY = feetY ?? this.world.sampleGroundHeight(current.x, current.z);
        const candidates = this.world.queryColliders(
          current,
          desired,
          PLAYER_RADIUS,
          groundY,
          groundY + PLAYER_HEIGHT,
        );
        const position = resolvePlanarMovement(
          current,
          desired,
          candidates,
          PLAYER_RADIUS,
        );
        return {
          position,
          clear: isPlanarPositionClear(position, candidates, PLAYER_RADIUS),
          candidateCount: candidates.length,
        };
      },
    };
  }
}
