import * as THREE from "three";
import {
  BEACONS,
  DEFAULT_HORIZON_MODE,
  HORIZON_PRESETS,
  MAX_PIXEL_RATIO,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  WAYPOINT_WORLD_MARKER_DISTANCE,
  type BeaconId,
  type HorizonMode,
  type QualityLevel,
  isHorizonMode,
} from "./config";
import { CitizenEngine } from "./citizens/CitizenEngine";
import { AnimalEngine } from "./animals/AnimalEngine";
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
import { applyGather, type EntityDiff } from "./gameplay/interactions";
import { EMPTY_INVENTORY, type InventoryState } from "./gameplay/items";
import { InteractionSystem } from "./systems/InteractionSystem";
import { CitizenCrowdSystem } from "./systems/CitizenCrowdSystem";
import { AmbientAnimalSystem } from "./systems/AmbientAnimalSystem";
import { EnvironmentSystem } from "./systems/EnvironmentSystem";
import { PlayerControllerSystem } from "./systems/PlayerControllerSystem";
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
import { sampleTerrainHeight, worldToChunk } from "./world/terrain";

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
  private readonly navigation = new NavigationService();
  private readonly environment: EnvironmentRuntime;
  private readonly pipeline = new SystemPipeline<GameRuntimeContext>();
  private readonly onSnapshot: (snapshot: GameSnapshot) => void;
  private readonly onPresentation: (presentation: GamePresentation) => void;
  private readonly testMode: boolean;
  private readonly saveStore: SaveStore;
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
  private developerPanelOpen = false;
  private contextStatus: "ready" | "lost" = "ready";
  private quality: QualityLevel = "cinematic";
  private horizonMode: HorizonMode = DEFAULT_HORIZON_MODE;
  private scanned: BeaconId[] = [];
  private inventory: InventoryState = { ...EMPTY_INVENTORY };
  private worldDiffs: Record<string, EntityDiff> = {};
  private doorStates: Record<string, boolean> = {};
  private lastDiscovery: BeaconId | null = null;
  private lastGather: LastGatherSnapshot | null = null;
  private lastFastTravel: GameSnapshot["lastFastTravel"] = null;
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
    const saved = this.saveStore.load();
    this.scanned = saved.scanned;
    this.inventory = saved.inventory;
    this.worldDiffs = saved.worldDiffs;
    this.doorStates = saved.doorStates;
    this.horizonMode = saved.horizonMode;
    if (saved.manualWaypoint) this.navigation.setManualWaypoint(saved.manualWaypoint);

    this.camera = new THREE.PerspectiveCamera(
      67,
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
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.input = new InputManager(this.canvas, this.handlePointerLockChange);
    this.world = new ChunkManager(
      this.scene,
      this.quality,
      this.worldDiffs,
      this.doorStates,
    );
    this.horizon = new HorizonRenderer(this.scene, this.horizonMode);
    this.citizens = new CitizenEngine(this.scene, this.quality);
    this.animals = new AnimalEngine(this.scene, this.quality);
    this.environment = createEnvironment(
      this.scene,
      this.renderer,
      this.quality,
      saved.worldMinutes,
    );
    this.environment.setHorizonMode(this.horizonMode);
    this.player.position.y = sampleTerrainHeight(
      this.player.position.x,
      this.player.position.z,
    );
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
      navigation: this.navigation,
      player: this.player,
      started: false,
      paused: false,
      testMode: this.testMode,
      nearbyTarget: null,
      nearbyDistance: null,
      discover: (beaconId) => this.discover(beaconId),
      performInteraction: (target) => this.performInteraction(target),
      toggleMap: () => this.toggleMap(),
      toggleQuality: () => this.toggleQuality(),
      toggleDeveloperPanel: () => this.toggleDeveloperPanel(),
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
        id: "frontier-survey",
        install: (registry) => {
          registry
            .system(new PlayerControllerSystem())
            .system(new WorldStreamingSystem())
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
      });
  }

  async initialize() {
    this.resize();
    this.world.update(this.player.position.x, this.player.position.z);
    this.horizon.update(this.player.position.x, this.player.position.z);
    this.citizens.updateStreaming(this.player.position.x, this.player.position.z);
    this.animals.updateStreaming(this.player.position.x, this.player.position.z);
    this.environment.sync(this.player.position, true);
    this.environment.present(this.player.position, 0);
    this.synchronizeTimeDependentWorld();
    for (const beaconId of this.scanned) this.world.markScanned(beaconId);
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.canvas.addEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.addEventListener("webglcontextrestored", this.handleContextRestored);

    this.animationFrame = requestAnimationFrame(this.frame);
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      this.renderer.compile(this.scene, this.camera);
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
    this.developerPanelOpen = false;
    this.paused = !this.testMode;
    this.lastClockPersistTime = performance.now();
    if (!this.testMode) this.input.requestPointerLock();
    this.emitSnapshot(true);
  }

  resume() {
    if (!this.started) return;
    this.mapOpen = false;
    this.developerPanelOpen = false;
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
    }
    this.emitSnapshot(true);
  }

  performInteraction(target: WorldTarget) {
    if (target.action === "toggle") {
      if (target.doorId) {
        const result = this.world.toggleDoor(
          target.doorId,
          this.player.position,
          PLAYER_RADIUS,
        );
        if (result === "opened" || result === "closed") this.persist();
      }
      this.emitSnapshot(true);
      return;
    }
    if (target.action === "scan" && target.beaconId) {
      this.discover(target.beaconId);
      return;
    }
    if (!target.item || target.action === "scan") return;
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
    this.persist();
    this.emitSnapshot(true);
  }

  setMapOpen(open: boolean) {
    this.mapOpen = open;
    if (open) this.developerPanelOpen = false;
    this.input.reset();
    if (open && !this.testMode && this.input.isLocked()) document.exitPointerLock?.();
    this.emitSnapshot(true);
  }

  setDeveloperPanelOpen(open: boolean) {
    if (!this.started) return;
    this.developerPanelOpen = open;
    this.input.reset();
    if (open) {
      this.mapOpen = false;
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
    this.camera.far = HORIZON_PRESETS[mode].drawDistanceMeters;
    this.camera.updateProjectionMatrix();
    this.horizon.setMode(mode);
    this.environment.setHorizonMode(mode);
    this.environment.sync(this.player.position);
    this.environment.present(this.player.position, 0);
    this.persist();
    this.emitSnapshot(true);
    return true;
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
    const cleared = this.navigation.clearActive(expectedId);
    if (cleared) {
      this.emitPresentation();
      this.emitSnapshot(true);
    }
    return cleared;
  }

  removeNavigationTarget(id: string) {
    const removed = this.navigation.removeTarget(id);
    if (removed) {
      if (id === MANUAL_WAYPOINT_ID) this.persist();
      this.emitPresentation();
      this.emitSnapshot(true);
    }
    return removed;
  }

  clearDiscoveryNotice() {
    this.lastDiscovery = null;
    this.emitSnapshot(true);
  }

  clearGatherNotice() {
    this.lastGather = null;
    this.emitSnapshot(true);
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
    this.synchronizeTimeDependentWorld();
    this.emitPresentation();
  }

  private persist() {
    const manualWaypoint = this.navigation.getTarget(MANUAL_WAYPOINT_ID)?.position ?? null;
    this.saveStore.save({
      scanned: this.scanned,
      inventory: this.inventory,
      worldDiffs: this.worldDiffs,
      doorStates: this.doorStates,
      manualWaypoint,
      worldMinutes: this.environment.getPersistentWorldMinutes(),
      horizonMode: this.horizonMode,
    });
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
          this.paused || this.mapOpen || this.developerPanelOpen;
        this.runtime.developerPanelOpen = this.developerPanelOpen;
        this.pipeline.update(this.runtime, FIXED_STEP);
        this.accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (steps === 5) this.accumulator = 0;

      this.environment.present(this.player.position, delta);
      this.citizens.present(
        this.started &&
          !this.paused &&
          !this.mapOpen &&
          !this.developerPanelOpen
          ? this.accumulator
          : 0,
      );
      this.animals.present(
        this.started &&
          !this.paused &&
          !this.mapOpen &&
          !this.developerPanelOpen
          ? this.accumulator
          : 0,
      );
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

  private emitSnapshot(force = false) {
    if (!force) return;
    this.lastSnapshotTime = performance.now();
    const chunk = worldToChunk(this.player.position.x, this.player.position.z);
    const heading = headingFromYaw(this.player.yaw);
    const climate = sampleClimate(this.player.position.x, this.player.position.z);
    const nearest = nearestSettlement(this.player.position.x, this.player.position.z);
    const atmosphere = this.environment.getSample();
    const developer = this.environment.getDeveloperState();
    const nearbyTarget = this.runtime.nearbyTarget;
    const horizon = this.horizon.diagnostics;
    this.snapshot = {
      ready: this.ready,
      started: this.started,
      paused: this.paused,
      mapOpen: this.mapOpen,
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
      worldChanges: Object.values(this.worldDiffs).filter((diff) => diff.removed).length,
      grounded: this.player.grounded,
      crouching: this.player.crouching,
      sprinting: this.player.sprinting,
      stamina: this.player.stamina,
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
          }
        : null,
      nearbyBeacon: nearbyTarget?.beaconId ?? null,
      nearbyDistance: this.runtime.nearbyDistance,
      lastDiscovery: this.lastDiscovery,
      lastGather: this.lastGather,
      lastFastTravel: this.lastFastTravel,
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

  private toggleDeveloperPanel() {
    this.setDeveloperPanelOpen(!this.developerPanelOpen);
  }

  private refreshEnvironment(snap = true) {
    this.environment.sync(this.player.position, snap);
    this.environment.present(this.player.position, 0);
    this.synchronizeTimeDependentWorld();
    this.emitSnapshot(true);
  }

  private synchronizeTimeDependentWorld() {
    const atmosphere = this.environment.getSample();
    this.world.setNightLighting(atmosphere.night);
    this.citizens.setWorldMinutes(atmosphere.totalMinutes);
  }

  private toggleQuality() {
    this.quality = this.quality === "cinematic" ? "performance" : "cinematic";
    const cinematic = this.quality === "cinematic";
    this.renderer.shadowMap.enabled = cinematic;
    this.renderer.setPixelRatio(
      cinematic ? Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO) : 1,
    );
    this.environment.setQuality(this.quality);
    this.world.setQuality(this.quality);
    this.citizens.setQuality(this.quality);
    this.animals.setQuality(this.quality);
    this.resize();
    this.emitSnapshot(true);
  }

  private resize = () => {
    const width = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.renderer.setPixelRatio(
      this.quality === "cinematic"
        ? Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO)
        : 1,
    );
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  private handlePointerLockChange = (locked: boolean) => {
    if (!this.started || this.testMode) return;
    this.paused = this.developerPanelOpen || !locked;
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
