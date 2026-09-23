import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { QUALITY_PRESETS, type QualityLevel } from "../config";
import type { EnvironmentVisualState } from "../environment";
import {
  EnvironmentMapRuntime,
  type EnvironmentMapDiagnostics,
} from "./EnvironmentMapRuntime";
import {
  BLOOM_LAYER,
  BloomCompositeShader,
} from "./Bloom";
import { FieldGradeShader } from "./PostProcessShader";
import {
  composerSampleCount,
  gtaoIsSupported,
  renderPixelRatio,
} from "./RenderingPolicy";
import {
  GpuFrameTimer,
  type GpuFrameTimingSample,
  type GpuFrameTimerStatus,
} from "./GpuFrameTimer";
import type { GraphicsFeatureState } from "./GraphicsFeatures";
import { GraphicsCapabilities } from "./GraphicsCapabilities";
import { AdaptiveResolution, adaptivePixelRatio } from "./AdaptiveResolution";
import { ShortRangeGtaoPass } from "./ShortRangeGtaoPass";

export {
  composerSampleCount,
  gtaoIsSupported,
  renderPixelRatio,
} from "./RenderingPolicy";

const GPU_PROBE_INTERVAL = 15;

export interface RenderPipelineOptions {
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  quality: QualityLevel;
  preserveDrawingBuffer?: boolean;
  /** Off for deterministic test sessions; see AdaptiveResolution. */
  adaptiveResolution?: boolean;
}

export interface GraphicsDiagnostics {
  webgl2: boolean;
  reversedDepth: boolean;
  logarithmicDepth: boolean;
  defaultFramebufferSamples: number;
  compositorSamples: number;
  maxSamples: number;
  quality: QualityLevel;
  postProcessing: boolean;
  postProcessingFallback: boolean;
  postProcessingFailureCount: number;
  bloom: boolean;
  gtao: boolean;
  grading: boolean;
  drawCalls: number;
  triangles: number;
  lines: number;
  points: number;
  drawingBufferWidth: number;
  drawingBufferHeight: number;
  pixelRatio: number;
  cpuRenderMilliseconds: number;
  gpuRenderMilliseconds: number | null;
  gpuTimerSupported: boolean;
  gpuTimerStatus: GpuFrameTimerStatus;
  gpuQueriesPending: number;
  gpuVendor: string;
  gpuRenderer: string;
  environmentMap: EnvironmentMapDiagnostics;
  /** Fraction of the resolved pixel ratio adaptive resolution renders at. */
  resolutionScale: number;
}

type RenderPipelineFeatureState = Pick<
  GraphicsFeatureState,
  | "atmosphericGrade"
  | "selectiveBloom"
  | "ambientOcclusion"
  | "environmentReflections"
>;

export interface RenderFrameMetrics {
  frameToken: number;
  cpuRenderMilliseconds: number;
  gpuQuerySubmitted: boolean;
  gpuSamples: GpuFrameTimingSample[];
}

/**
 * Single owner for renderer and frame-composition lifecycle. World systems do
 * not need to know whether the current quality profile renders directly or
 * through an offscreen pipeline.
 */
export class RenderPipeline {
  readonly renderer: THREE.WebGLRenderer;

  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloomComposer: EffectComposer;
  private readonly bloomRenderPass: RenderPass;
  private readonly gtaoPass: GTAOPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly bloomCompositePass: ShaderPass;
  private readonly gradePass: ShaderPass;
  private readonly outputPass: OutputPass;
  private readonly environmentMap: EnvironmentMapRuntime;
  private readonly gpuFrameTimer: GpuFrameTimer;
  private readonly graphicsCapabilities: GraphicsCapabilities;
  private readonly drawingBufferSize = new THREE.Vector2();
  private readonly bloomBackground = new THREE.Color(0x000000);
  private readonly fallbackClearColor = new THREE.Color();
  private readonly bloomLayer = new THREE.Layers();
  private readonly bloomOccluderMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    depthTest: true,
    depthWrite: true,
    toneMapped: false,
  });
  private readonly bloomMaterials = new Map<
    THREE.Mesh,
    THREE.Material | THREE.Material[]
  >();
  private readonly bloomHidden = new Set<THREE.Object3D>();
  private readonly gtaoCompatible: boolean;
  private features: RenderPipelineFeatureState = {
    atmosphericGrade: true,
    selectiveBloom: true,
    ambientOcclusion: true,
    environmentReflections: true,
  };
  private quality: QualityLevel;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private frameToken = 0;
  private lastCpuRenderMilliseconds = 0;
  private postProcessingFallback = false;
  private postProcessingFailureCount = 0;
  private disposed = false;
  /** Lowers render resolution while the GPU is the limit. */
  private readonly adaptiveResolution: AdaptiveResolution;
  private framesSinceGpuProbe = 0;
  private devicePixelRatio = 1;

  constructor(private readonly options: RenderPipelineOptions) {
    this.quality = options.quality;
    this.adaptiveResolution = new AdaptiveResolution(
      { budgetMilliseconds: 1000 / 60 },
      options.adaptiveResolution !== false,
    );
    this.bloomLayer.set(BLOOM_LAYER);
    const contextAttributes: WebGLContextAttributes = {
      alpha: false,
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
      stencil: false,
    };
    const webglContext = options.canvas.getContext("webgl2", contextAttributes);
    const reversedDepthSupported = Boolean(
      webglContext?.getExtension("EXT_clip_control"),
    );
    // The renderer, both composers and their render targets are live GPU
    // resources the moment they are constructed. A throw in any later
    // allocation would strand them where the caller cannot reach them, because
    // the field this pipeline is being assigned to is still undefined.
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: options.canvas,
        context: webglContext ?? undefined,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
        stencil: false,
        preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
        reversedDepthBuffer: reversedDepthSupported,
        logarithmicDepthBuffer: !reversedDepthSupported,
      });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.12;
      // three 0.185 deprecated PCFSoftShadowMap: WebGLShadowMap warns once per
      // shadow pass and assigns PCFShadowMap itself, so this is what the game
      // has actually been rendering with. Setting it directly is identical and
      // keeps the warning out of every player console.
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      // Any material with transmission > 0 makes Three re-render the opaque
      // scene into a separate target (WebGLRenderer.renderTransmissionPass).
      // That target defaults to full resolution. The only transmissive
      // materials here are small window panes on three authored buildings, one
      // of which is the spawn compound, so every session pays for it. Half
      // resolution quarters the pass and is imperceptible through 4 cm glass.
      this.renderer.transmissionResolutionScale = 0.5;
      // One presented frame can contain bloom, world, GTAO and fullscreen draws.
      // Keep Three from resetting counters for each internal renderer.render call.
      this.renderer.info.autoReset = false;
      this.graphicsCapabilities = new GraphicsCapabilities(this.renderer.getContext());
      this.gpuFrameTimer = new GpuFrameTimer(
        this.renderer.getContext() as WebGL2RenderingContext,
      );

      this.composer = new EffectComposer(
        this.renderer,
        this.createComposerTarget(options.quality),
      );
      this.renderPass = new RenderPass(options.scene, options.camera);
      this.bloomComposer = new EffectComposer(
        this.renderer,
        this.createBloomTarget(),
      );
      this.bloomComposer.renderToScreen = false;
      this.bloomRenderPass = new RenderPass(options.scene, options.camera);
      this.gtaoPass = new ShortRangeGtaoPass(options.scene, options.camera, 64);
      this.gtaoPass.updateGtaoMaterial({
        radius: 1.2,
        distanceExponent: 1.6,
        thickness: 0.8,
        distanceFallOff: 1,
        scale: 1.1,
        samples: 12,
        screenSpaceRadius: false,
      });
      this.gtaoPass.updatePdMaterial({
        lumaPhi: 10,
        depthPhi: 2,
        normalPhi: 3,
        radius: 6,
        radiusExponent: 2,
        rings: 2,
        samples: 8,
      });
      this.gtaoPass.blendIntensity = 0.7;
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0, 0, 1);
      this.bloomCompositePass = new ShaderPass(BloomCompositeShader);
      this.gradePass = new ShaderPass(FieldGradeShader);
      this.outputPass = new OutputPass();
      this.bloomComposer.addPass(this.bloomRenderPass);
      this.bloomComposer.addPass(this.bloomPass);
      this.composer.addPass(this.renderPass);
      this.composer.addPass(this.gtaoPass);
      this.composer.addPass(this.bloomCompositePass);
      this.composer.addPass(this.gradePass);
      this.composer.addPass(this.outputPass);

      // GTAO understands reversed depth, but not the logarithmic fallback used
      // on devices without EXT_clip_control.
      this.gtaoCompatible = !this.renderer.capabilities.logarithmicDepthBuffer;
      this.environmentMap = new EnvironmentMapRuntime(
        this.renderer,
        options.scene,
        options.quality,
      );
      this.configure(options.quality);
    } catch (error) {
      try {
        this.disposeOwned();
      } catch {
        // Best-effort cleanup must not replace the construction failure.
      }
      throw error;
    }
  }

  async compile() {
    const previousTarget = this.renderer.getRenderTarget();
    if (this.usesPostProcessing()) {
      this.renderer.setRenderTarget(this.composer.readBuffer);
    }
    try {
      // Three's asynchronous polling has no cancellation and can outlive
      // material disposal/context restoration. Keep boot warm-up synchronous;
      // Engine still awaits this boundary before its two warm-up renders.
      this.renderer.compile(this.options.scene, this.options.camera);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
    }
  }

  render(deltaSeconds = 0, measureGpu = false): RenderFrameMetrics {
    if (this.disposed) {
      return {
        frameToken: this.frameToken,
        cpuRenderMilliseconds: 0,
        gpuQuerySubmitted: false,
        gpuSamples: [],
      };
    }
    const timerBeforeFrame = this.gpuFrameTimer.diagnostics;
    const gpuSamples = measureGpu || timerBeforeFrame.pendingQueries > 0
      ? this.gpuFrameTimer.poll()
      : [];
    this.applyGpuSamples(gpuSamples, measureGpu);
    const frameToken = ++this.frameToken;
    const gpuQuerySubmitted =
      (measureGpu || this.shouldProbeGpu()) && this.gpuFrameTimer.begin(frameToken);
    const cpuStartedAt = performance.now();
    this.renderer.info.reset();
    try {
      if (this.usesPostProcessing()) {
        const previousAutoClear = this.renderer.autoClear;
        const previousClearAlpha = this.renderer.getClearAlpha();
        const previousOverride = this.options.scene.overrideMaterial;
        this.renderer.getClearColor(this.fallbackClearColor);
        try {
          if (this.bloomPass.enabled) this.renderSelectiveBloom(deltaSeconds);
          this.composer.render(deltaSeconds);
        } catch {
          // Optional full-screen stages must never make the simulation
          // unplayable. Reset Three's target/state and retry the same frame on
          // the direct renderer. A world-material failure will throw again on
          // that direct path and still reach the engine's renderer interrupt.
          this.postProcessingFallback = true;
          this.postProcessingFailureCount += 1;
          this.renderer.setRenderTarget(null);
          this.renderer.resetState();
          this.options.scene.overrideMaterial = previousOverride;
          this.renderer.autoClear = previousAutoClear;
          this.renderer.setClearColor(this.fallbackClearColor, previousClearAlpha);
          this.renderer.render(this.options.scene, this.options.camera);
        }
      } else {
        this.renderer.render(this.options.scene, this.options.camera);
      }
    } finally {
      if (gpuQuerySubmitted) this.gpuFrameTimer.end();
      this.lastCpuRenderMilliseconds = performance.now() - cpuStartedAt;
    }
    return {
      frameToken,
      cpuRenderMilliseconds: this.lastCpuRenderMilliseconds,
      gpuQuerySubmitted,
      gpuSamples,
    };
  }

  get resolutionScale() {
    return this.adaptiveResolution.scale;
  }

  /** Feeds polled GPU times to adaptive resolution; true when it resized. */
  private applyGpuSamples(
    samples: readonly GpuFrameTimingSample[],
    benchmarking: boolean,
  ) {
    // A benchmark measures one fixed resolution.
    if (benchmarking || samples.length === 0) return false;
    let changed = false;
    for (const sample of samples) {
      if (this.adaptiveResolution.sample(sample.milliseconds)) changed = true;
    }
    if (!changed) return false;
    this.resize(this.width, this.height, this.devicePixelRatio);
    return true;
  }

  /** One GPU timing every GPU_PROBE_INTERVAL frames is enough to follow load. */
  private shouldProbeGpu() {
    if (!this.adaptiveResolution.active) return false;
    if (this.gpuFrameTimer.diagnostics.status === "unsupported") return false;
    this.framesSinceGpuProbe += 1;
    if (this.framesSinceGpuProbe < GPU_PROBE_INTERVAL) return false;
    this.framesSinceGpuProbe = 0;
    return true;
  }

  presentEnvironment(state: Readonly<EnvironmentVisualState>) {
    this.environmentMap.present(state);
    this.gradePass.uniforms.uDaylight.value = state.daylight;
    this.gradePass.uniforms.uGoldenHour.value = state.goldenHour;
    this.gradePass.uniforms.uNight.value = state.night;
    this.gradePass.uniforms.uCloudCover.value = state.cloudCover;
    this.gradePass.uniforms.uPrecipitation.value = state.precipitationRate;
    this.gradePass.uniforms.uDust.value = state.dust;
    this.gradePass.uniforms.uLightningFlash.value = state.lightningFlash;
  }

  setFeatures(features: RenderPipelineFeatureState) {
    if (this.disposed) return;
    const changed =
      features.atmosphericGrade !== this.features.atmosphericGrade ||
      features.selectiveBloom !== this.features.selectiveBloom ||
      features.ambientOcclusion !== this.features.ambientOcclusion ||
      features.environmentReflections !== this.features.environmentReflections;
    if (!changed) return;
    this.features = {
      atmosphericGrade: features.atmosphericGrade,
      selectiveBloom: features.selectiveBloom,
      ambientOcclusion: features.ambientOcclusion,
      environmentReflections: features.environmentReflections,
    };
    this.postProcessingFallback = false;
    this.environmentMap.setEnabled(features.environmentReflections);
    this.configure(this.quality);
  }

  resize(width: number, height: number, devicePixelRatio: number) {
    if (this.disposed) return;
    const preset = QUALITY_PRESETS[this.quality];
    this.devicePixelRatio = devicePixelRatio;
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    const context = this.renderer.getContext();
    const maxFramebufferSize = Number(
      context.getParameter(context.MAX_RENDERBUFFER_SIZE),
    );
    this.pixelRatio = adaptivePixelRatio(
      renderPixelRatio(
        devicePixelRatio,
        preset.pixelRatioCap,
        this.width,
        this.height,
        maxFramebufferSize,
      ),
      this.adaptiveResolution.scale,
    );
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(this.width, this.height);
    this.bloomComposer.setPixelRatio(this.pixelRatio);
    this.bloomComposer.setSize(
      Math.max(1, Math.floor(this.width * 0.5)),
      Math.max(1, Math.floor(this.height * 0.5)),
    );
    this.resizeGtao();
    const resolution = this.gradePass.uniforms.uResolution.value as THREE.Vector2;
    resolution.set(this.width * this.pixelRatio, this.height * this.pixelRatio);
  }

  setQuality(quality: QualityLevel) {
    if (this.disposed) return;
    // A new preset starts from its own cap; the caller resizes next.
    this.adaptiveResolution.reset();
    const samplesChanged =
      this.composer.renderTarget1.samples !== this.composerSamples(quality);
    this.quality = quality;
    this.postProcessingFallback = false;
    if (samplesChanged) {
      this.composer.reset(this.createComposerTarget(quality));
    }
    this.environmentMap.setQuality(quality);
    this.configure(quality);
    this.resize(this.width, this.height, window.devicePixelRatio);
  }

  handleContextRestored() {
    if (this.disposed) return;
    this.renderer.resetState();
    this.graphicsCapabilities.refresh(this.renderer.getContext());
    this.gpuFrameTimer.handleContextRestored(
      this.renderer.getContext() as WebGL2RenderingContext,
    );
    this.environmentMap.handleContextRestored();
    this.environmentMap.setEnabled(this.features.environmentReflections);
    this.postProcessingFallback = false;
    this.composer.reset(this.createComposerTarget(this.quality));
    this.bloomComposer.reset(this.createBloomTarget());
    this.resize(this.width, this.height, window.devicePixelRatio);
  }

  get diagnostics(): GraphicsDiagnostics {
    const timer = this.gpuFrameTimer.diagnostics;
    const postProcessing = this.usesPostProcessing();
    this.renderer.getDrawingBufferSize(this.drawingBufferSize);
    return {
      webgl2: this.renderer.capabilities.isWebGL2,
      reversedDepth: this.renderer.capabilities.reversedDepthBuffer,
      logarithmicDepth: this.renderer.capabilities.logarithmicDepthBuffer,
      ...this.graphicsCapabilities.snapshot,
      compositorSamples: this.composer.renderTarget1.samples,
      maxSamples: this.renderer.capabilities.maxSamples,
      quality: this.quality,
      postProcessing,
      postProcessingFallback: this.postProcessingFallback,
      postProcessingFailureCount: this.postProcessingFailureCount,
      bloom: postProcessing && this.bloomPass.enabled,
      gtao: postProcessing && this.gtaoPass.enabled,
      grading: postProcessing && this.gradePass.enabled,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      lines: this.renderer.info.render.lines,
      points: this.renderer.info.render.points,
      drawingBufferWidth: Math.round(this.drawingBufferSize.x),
      drawingBufferHeight: Math.round(this.drawingBufferSize.y),
      pixelRatio: this.pixelRatio,
      cpuRenderMilliseconds: this.lastCpuRenderMilliseconds,
      gpuRenderMilliseconds: timer.lastMilliseconds,
      gpuTimerSupported: timer.supported,
      gpuTimerStatus: timer.status,
      gpuQueriesPending: timer.pendingQueries,
      environmentMap: this.environmentMap.diagnostics,
      resolutionScale: this.adaptiveResolution.scale,
    };
  }

  /**
   * Releases everything construction managed to allocate. These fields are
   * declared non-optional because a constructor that returns always assigns
   * them, but a constructor that throws leaves the later ones unassigned, so
   * each teardown is guarded.
   */
  private disposeOwned() {
    this.gpuFrameTimer?.dispose();
    this.environmentMap?.dispose();
    this.renderPass?.dispose();
    this.gtaoPass?.dispose();
    this.bloomRenderPass?.dispose();
    this.bloomPass?.dispose();
    this.bloomCompositePass?.dispose();
    this.gradePass?.dispose();
    this.outputPass?.dispose();
    this.composer?.dispose();
    this.bloomComposer?.dispose();
    this.bloomOccluderMaterial?.dispose();
    this.renderer?.dispose();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeOwned();
  }

  private configure(quality: QualityLevel) {
    const preset = QUALITY_PRESETS[quality];
    const post = preset.postProcessing;
    this.renderer.shadowMap.enabled = preset.shadows;
    this.gtaoPass.enabled =
      post.enabled &&
      this.features.ambientOcclusion &&
      this.gtaoCompatible &&
      gtaoIsSupported(post.gtao, this.renderer.capabilities.logarithmicDepthBuffer);
    this.bloomPass.enabled =
      post.enabled &&
      this.features.selectiveBloom &&
      post.bloomStrength > 0;
    this.bloomPass.strength = post.bloomStrength;
    this.bloomPass.radius = post.bloomRadius;
    this.bloomPass.threshold = post.bloomThreshold;
    this.bloomCompositePass.enabled = this.bloomPass.enabled;
    this.gradePass.enabled =
      post.enabled &&
      this.features.atmosphericGrade &&
      (post.gradingStrength > 0 ||
        post.vignetteStrength > 0 ||
        post.ditherStrength > 0);
    this.gradePass.uniforms.uGradingStrength.value = post.gradingStrength;
    this.gradePass.uniforms.uVignetteStrength.value = post.vignetteStrength;
    this.gradePass.uniforms.uDitherStrength.value = post.ditherStrength;
    this.outputPass.enabled = post.enabled;
    this.resizeGtao();
  }

  private usesPostProcessing() {
    return (
      QUALITY_PRESETS[this.quality].postProcessing.enabled &&
      !this.postProcessingFallback
    );
  }

  private resizeGtao() {
    const scale = QUALITY_PRESETS[this.quality].postProcessing.gtaoResolutionScale;
    this.gtaoPass.setSize(
      Math.max(1, Math.floor(this.width * this.pixelRatio * scale)),
      Math.max(1, Math.floor(this.height * this.pixelRatio * scale)),
    );
  }

  private composerSamples(quality: QualityLevel) {
    return composerSampleCount(
      QUALITY_PRESETS[quality].postProcessing.msaaSamples,
      this.renderer.capabilities.maxSamples,
    );
  }

  private createComposerTarget(quality: QualityLevel) {
    const target = new THREE.WebGLRenderTarget(
      Math.max(1, Math.floor(this.width * this.pixelRatio)),
      Math.max(1, Math.floor(this.height * this.pixelRatio)),
      {
        type: THREE.HalfFloatType,
        depthBuffer: true,
        stencilBuffer: false,
      },
    );
    target.texture.name = "StillpointComposer";
    target.samples = this.composerSamples(quality);
    return target;
  }

  private createBloomTarget() {
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    target.texture.name = "StillpointSelectiveBloom";
    return target;
  }

  private renderSelectiveBloom(deltaSeconds: number) {
    const background = this.options.scene.background;
    const shadowAutoUpdate = this.renderer.shadowMap.autoUpdate;
    const camera = this.options.camera;
    const cameraLayers = camera.layers.mask;
    try {
      this.options.scene.background = this.bloomBackground;
      // traverseVisible, not traverse: an invisible subtree is not drawn, so
      // darkening it is wasted work on a per-frame full-graph walk.
      this.options.scene.traverseVisible(this.darkenBloomOccluder);
      // Bloom precedes the beauty pass and does not own shadow freshness. The
      // subsequent main RenderPass remains the single shadow-map update.
      this.renderer.shadowMap.autoUpdate = false;
      // Bloom-only sources (the celestial discs) sit on BLOOM_LAYER alone; the
      // camera sees that layer for this render and no other.
      camera.layers.enable(BLOOM_LAYER);
      this.bloomComposer.render(deltaSeconds);
      this.bloomCompositePass.uniforms.tBloom.value =
        this.bloomPass.renderTargetsHorizontal[0].texture;
    } finally {
      camera.layers.mask = cameraLayers;
      this.renderer.shadowMap.autoUpdate = shadowAutoUpdate;
      this.restoreBloomOccluders();
      this.options.scene.background = background;
    }
  }

  private readonly darkenBloomOccluder = (object: THREE.Object3D) => this.darkenForBloom(object);

  /**
   * Bloom sources keep their material and everything else becomes a black
   * occluder. Objects marked hideInBloom (the sky dome) are hidden instead: an
   * occluder writes depth and would cover the celestial discs behind it.
   */
  private darkenForBloom(object: THREE.Object3D) {
    if (this.bloomLayer.test(object.layers)) return;
    const hide =
      object.userData.hideInBloom === true ||
      object instanceof THREE.Points ||
      object instanceof THREE.Line ||
      object instanceof THREE.Sprite;
    if (hide) {
      if (!object.visible) return;
      this.bloomHidden.add(object);
      object.visible = false;
      return;
    }
    if (object instanceof THREE.Mesh) {
      this.bloomMaterials.set(object, object.material);
      object.material = this.bloomOccluderMaterial;
    }
  }

  /**
   * Restores exactly what the darken pass changed. Iterating the two
   * collections avoids a second full scene walk every frame; the previous
   * traversal visited every object in the graph to find the handful it had
   * touched.
   */
  private restoreBloomOccluders() {
    for (const [object, material] of this.bloomMaterials) {
      object.material = material;
    }
    this.bloomMaterials.clear();
    for (const object of this.bloomHidden) {
      object.visible = true;
    }
    this.bloomHidden.clear();
  }
}
