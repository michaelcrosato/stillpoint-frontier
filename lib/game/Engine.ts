import * as THREE from "three";
import {
  BEACONS,
  MAX_PIXEL_RATIO,
  PLAYER_HEIGHT,
  type BeaconId,
  type QualityLevel,
} from "./config";
import { CitizenEngine } from "./citizens/CitizenEngine";
import { SystemPipeline } from "./core/SystemPipeline";
import { FeatureRegistry } from "./core/FeatureRegistry";
import { createEnvironment, type EnvironmentRuntime } from "./environment";
import { InputManager } from "./input/InputManager";
import { SaveStore } from "./persistence/SaveStore";
import { applyGather, type EntityDiff } from "./gameplay/interactions";
import { EMPTY_INVENTORY, type InventoryState } from "./gameplay/items";
import { InteractionSystem } from "./systems/InteractionSystem";
import { CitizenCrowdSystem } from "./systems/CitizenCrowdSystem";
import { PlayerControllerSystem } from "./systems/PlayerControllerSystem";
import type { GameRuntimeContext } from "./systems/runtime";
import { WorldStreamingSystem } from "./systems/WorldStreamingSystem";
import {
  type GameSnapshot,
  type LastGatherSnapshot,
  INITIAL_SNAPSHOT,
  addDiscovery,
} from "./state";
import { ChunkManager, type WorldTarget } from "./world/ChunkManager";
import { nearestSettlement, sampleClimate } from "./world/macroWorld";
import { sampleTerrainHeight, worldToChunk } from "./world/terrain";

const FIXED_STEP = 1 / 60;
const MAX_FRAME_DELTA = 0.075;

export interface GameTestBridge {
  isReady(): boolean;
  snapshot(): GameSnapshot;
  teleport(x: number, z: number): void;
  faceBeacon(beaconId: BeaconId): void;
  discover(beaconId: BeaconId): void;
  loseContext(): void;
  restoreContext(): void;
  targets(): Array<{ id: string; kind: string; x: number; z: number }>;
  citizens(): {
    visible: number;
    generated: number;
    density: string;
    chunks: number;
    updateHz: number;
    ids: string[];
  };
  faceTarget(id: string): void;
  interactTarget(id: string): void;
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
}

export class Engine {
  private readonly canvas: HTMLCanvasElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(67, 1, 0.08, 920);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly input: InputManager;
  private readonly world: ChunkManager;
  private readonly citizens: CitizenEngine;
  private readonly environment: EnvironmentRuntime;
  private readonly pipeline = new SystemPipeline<GameRuntimeContext>();
  private readonly onSnapshot: (snapshot: GameSnapshot) => void;
  private readonly testMode: boolean;
  private readonly saveStore: SaveStore;
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
  private contextStatus: "ready" | "lost" = "ready";
  private quality: QualityLevel = "cinematic";
  private scanned: BeaconId[] = [];
  private inventory: InventoryState = { ...EMPTY_INVENTORY };
  private worldDiffs: Record<string, EntityDiff> = {};
  private lastDiscovery: BeaconId | null = null;
  private lastGather: LastGatherSnapshot | null = null;
  private snapshot = { ...INITIAL_SNAPSHOT };
  private disposed = false;

  constructor(options: EngineOptions) {
    this.canvas = options.canvas;
    this.testMode = options.testMode ?? false;
    this.onSnapshot = options.onSnapshot;
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

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      stencil: false,
      preserveDrawingBuffer: this.testMode,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.input = new InputManager(this.canvas, this.handlePointerLockChange);
    this.world = new ChunkManager(this.scene, this.quality, this.worldDiffs);
    this.citizens = new CitizenEngine(this.scene, this.quality);
    this.environment = createEnvironment(this.scene, this.quality);
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
      citizens: this.citizens,
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
    };

    new FeatureRegistry(this.pipeline)
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
      });
  }

  async initialize() {
    this.resize();
    this.world.update(this.player.position.x, this.player.position.z);
    this.citizens.updateStreaming(this.player.position.x, this.player.position.z);
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
    this.paused = !this.testMode;
    if (!this.testMode) this.input.requestPointerLock();
    this.emitSnapshot(true);
  }

  resume() {
    if (!this.started) return;
    this.mapOpen = false;
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
    if (open && !this.testMode && this.input.isLocked()) document.exitPointerLock?.();
    this.emitSnapshot(true);
  }

  clearDiscoveryNotice() {
    this.lastDiscovery = null;
    this.emitSnapshot(true);
  }

  clearGatherNotice() {
    this.lastGather = null;
    this.emitSnapshot(true);
  }

  private persist() {
    this.saveStore.save({
      scanned: this.scanned,
      inventory: this.inventory,
      worldDiffs: this.worldDiffs,
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
    this.input.dispose();
    this.pipeline.dispose();
    this.citizens.dispose();
    this.world.dispose();
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
        this.runtime.paused = this.paused || this.mapOpen;
        this.pipeline.update(this.runtime, FIXED_STEP);
        this.accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (steps === 5) this.accumulator = 0;

      this.environment.updateAround(this.player.position);
      this.citizens.present(
        this.started && !this.paused && !this.mapOpen ? this.accumulator : 0,
      );
      this.renderer.render(this.scene, this.camera);
      this.trackPerformance(timestamp);
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
    const heading = ((THREE.MathUtils.radToDeg(this.player.yaw) % 360) + 360) % 360;
    const climate = sampleClimate(this.player.position.x, this.player.position.z);
    const nearest = nearestSettlement(this.player.position.x, this.player.position.z);
    const nearbyTarget = this.runtime.nearbyTarget;
    this.snapshot = {
      ready: this.ready,
      started: this.started,
      paused: this.paused,
      mapOpen: this.mapOpen,
      contextStatus: this.contextStatus,
      position: {
        x: this.player.position.x,
        y: this.player.position.y,
        z: this.player.position.z,
      },
      heading,
      fps: this.fps,
      chunk,
      loadedChunks: this.world.loadedCount,
      citizenCount: this.citizens.visibleCount,
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
          }
        : null,
      nearbyBeacon: nearbyTarget?.beaconId ?? null,
      nearbyDistance: this.runtime.nearbyDistance,
      lastDiscovery: this.lastDiscovery,
      lastGather: this.lastGather,
    };
    this.onSnapshot(this.snapshot);
  }

  private toggleMap() {
    this.setMapOpen(!this.mapOpen);
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
    this.paused = !locked;
    this.emitSnapshot(true);
  };

  private handleVisibilityChange = () => {
    if (document.hidden && this.started) {
      this.paused = true;
      if (this.input.isLocked()) document.exitPointerLock?.();
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
      teleport: (x, z) => {
        this.player.position.set(x, sampleTerrainHeight(x, z), z);
        this.player.verticalVelocity = 0;
        this.player.grounded = true;
        this.player.crouching = false;
        this.camera.position.set(x, this.player.position.y + PLAYER_HEIGHT, z);
        this.world.update(x, z);
        this.citizens.update(x, z, 0, true);
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
          x: target.position.x,
          z: target.position.z,
        })),
      citizens: () => this.citizens.debugSnapshot(),
      faceTarget: (id) => {
        const target = this.world.targets.find((candidate) => candidate.id === id);
        if (!target) return;
        const deltaX = target.position.x - this.player.position.x;
        const deltaZ = target.position.z - this.player.position.z;
        this.player.yaw = Math.atan2(-deltaX, -deltaZ);
        this.player.pitch = -0.04;
        this.camera.rotation.set(this.player.pitch, this.player.yaw, 0, "YXZ");
        this.emitSnapshot(true);
      },
      interactTarget: (id) => {
        const target = this.world.targets.find((candidate) => candidate.id === id);
        if (target) this.performInteraction(target);
      },
    };
  }
}
