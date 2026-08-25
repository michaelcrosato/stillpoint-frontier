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

export {
  composerSampleCount,
  gtaoIsSupported,
  renderPixelRatio,
} from "./RenderingPolicy";

export interface RenderPipelineOptions {
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  quality: QualityLevel;
  preserveDrawingBuffer?: boolean;
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
  bloom: boolean;
  gtao: boolean;
  grading: boolean;
  environmentMap: EnvironmentMapDiagnostics;
}

class ShortRangeGtaoPass extends GTAOPass {
  constructor(
    scene: THREE.Scene,
    private readonly perspectiveCamera: THREE.PerspectiveCamera,
    private readonly maximumDistance: number,
  ) {
    super(scene, perspectiveCamera, 1, 1);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ) {
    const previousFar = this.perspectiveCamera.far;
    const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate;
    this.perspectiveCamera.far = Math.min(previousFar, this.maximumDistance);
    this.perspectiveCamera.updateProjectionMatrix();
    // The main beauty pass has already refreshed shadows. GTAO only needs its
    // own normal/depth buffer and must not pay for another full shadow render.
    renderer.shadowMap.autoUpdate = false;
    try {
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    } finally {
      renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
      this.perspectiveCamera.far = previousFar;
      this.perspectiveCamera.updateProjectionMatrix();
    }
  }
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
  private readonly bloomBackground = new THREE.Color(0x000000);
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
  private quality: QualityLevel;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private disposed = false;

  constructor(private readonly options: RenderPipelineOptions) {
    this.quality = options.quality;
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
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // One presented frame can contain bloom, world, GTAO and fullscreen draws.
    // Keep Three from resetting counters for each internal renderer.render call.
    this.renderer.info.autoReset = false;

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
  }

  async compile() {
    const previousTarget = this.renderer.getRenderTarget();
    if (QUALITY_PRESETS[this.quality].postProcessing.enabled) {
      this.renderer.setRenderTarget(this.composer.readBuffer);
    }
    try {
      await this.renderer.compileAsync(this.options.scene, this.options.camera);
    } catch {
      this.renderer.compile(this.options.scene, this.options.camera);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
    }
  }

  render(deltaSeconds = 0) {
    if (this.disposed) return;
    this.renderer.info.reset();
    if (QUALITY_PRESETS[this.quality].postProcessing.enabled) {
      if (this.bloomPass.enabled) this.renderSelectiveBloom(deltaSeconds);
      this.composer.render(deltaSeconds);
    } else {
      this.renderer.render(this.options.scene, this.options.camera);
    }
  }

  presentEnvironment(state: Readonly<EnvironmentVisualState>) {
    this.environmentMap.present(state);
  }

  resize(width: number, height: number, devicePixelRatio: number) {
    if (this.disposed) return;
    const preset = QUALITY_PRESETS[this.quality];
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    const context = this.renderer.getContext();
    const maxFramebufferSize = Number(
      context.getParameter(context.MAX_RENDERBUFFER_SIZE),
    );
    this.pixelRatio = renderPixelRatio(
      devicePixelRatio,
      preset.pixelRatioCap,
      this.width,
      this.height,
      maxFramebufferSize,
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
    const samplesChanged =
      this.composer.renderTarget1.samples !== this.composerSamples(quality);
    this.quality = quality;
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
    this.environmentMap.handleContextRestored();
    this.composer.reset(this.createComposerTarget(this.quality));
    this.bloomComposer.reset(this.createBloomTarget());
    this.resize(this.width, this.height, window.devicePixelRatio);
  }

  get diagnostics(): GraphicsDiagnostics {
    const context = this.renderer.getContext();
    const preset = QUALITY_PRESETS[this.quality];
    return {
      webgl2: this.renderer.capabilities.isWebGL2,
      reversedDepth: this.renderer.capabilities.reversedDepthBuffer,
      logarithmicDepth: this.renderer.capabilities.logarithmicDepthBuffer,
      defaultFramebufferSamples: Number(context.getParameter(context.SAMPLES)) || 0,
      compositorSamples: this.composer.renderTarget1.samples,
      maxSamples: this.renderer.capabilities.maxSamples,
      quality: this.quality,
      postProcessing: preset.postProcessing.enabled,
      bloom: this.bloomPass.enabled,
      gtao: this.gtaoPass.enabled,
      grading: this.gradePass.enabled,
      environmentMap: this.environmentMap.diagnostics,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.environmentMap.dispose();
    this.renderPass.dispose();
    this.gtaoPass.dispose();
    this.bloomRenderPass.dispose();
    this.bloomPass.dispose();
    this.bloomCompositePass.dispose();
    this.gradePass.dispose();
    this.outputPass.dispose();
    this.composer.dispose();
    this.bloomComposer.dispose();
    this.bloomOccluderMaterial.dispose();
    this.renderer.dispose();
  }

  private configure(quality: QualityLevel) {
    const preset = QUALITY_PRESETS[quality];
    const post = preset.postProcessing;
    this.renderer.shadowMap.enabled = preset.shadows;
    this.gtaoPass.enabled =
      post.enabled &&
      this.gtaoCompatible &&
      gtaoIsSupported(post.gtao, this.renderer.capabilities.logarithmicDepthBuffer);
    this.bloomPass.enabled = post.enabled && post.bloomStrength > 0;
    this.bloomPass.strength = post.bloomStrength;
    this.bloomPass.radius = post.bloomRadius;
    this.bloomPass.threshold = post.bloomThreshold;
    this.bloomCompositePass.enabled = this.bloomPass.enabled;
    this.gradePass.enabled =
      post.enabled &&
      (post.gradingStrength > 0 ||
        post.vignetteStrength > 0 ||
        post.ditherStrength > 0);
    this.gradePass.uniforms.uGradingStrength.value = post.gradingStrength;
    this.gradePass.uniforms.uVignetteStrength.value = post.vignetteStrength;
    this.gradePass.uniforms.uDitherStrength.value = post.ditherStrength;
    this.outputPass.enabled = post.enabled;
    this.resizeGtao();
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
    try {
      this.options.scene.background = this.bloomBackground;
      this.options.scene.traverse(this.darkenBloomOccluder);
      // Bloom precedes the beauty pass and does not own shadow freshness. The
      // subsequent main RenderPass remains the single shadow-map update.
      this.renderer.shadowMap.autoUpdate = false;
      this.bloomComposer.render(deltaSeconds);
      this.bloomCompositePass.uniforms.tBloom.value =
        this.bloomPass.renderTargetsHorizontal[0].texture;
    } finally {
      this.renderer.shadowMap.autoUpdate = shadowAutoUpdate;
      this.options.scene.traverse(this.restoreBloomMaterial);
      this.options.scene.background = background;
    }
  }

  private readonly darkenBloomOccluder = (object: THREE.Object3D) => {
    if (this.bloomLayer.test(object.layers)) return;
    if (object instanceof THREE.Mesh) {
      this.bloomMaterials.set(object, object.material);
      object.material = this.bloomOccluderMaterial;
      return;
    }
    if (
      object.visible &&
      (object instanceof THREE.Points ||
        object instanceof THREE.Line ||
        object instanceof THREE.Sprite)
    ) {
      this.bloomHidden.add(object);
      object.visible = false;
    }
  };

  private readonly restoreBloomMaterial = (object: THREE.Object3D) => {
    if (object instanceof THREE.Mesh) {
      const material = this.bloomMaterials.get(object);
      if (material) {
        object.material = material;
        this.bloomMaterials.delete(object);
      }
    }
    if (this.bloomHidden.delete(object)) object.visible = true;
  };
}
