import * as THREE from "three";
import { QUALITY_PRESETS, type QualityLevel } from "../config";
import type { EnvironmentVisualState } from "../environment";
import { environmentMapSignature } from "./RenderingPolicy";

export { environmentMapSignature } from "./RenderingPolicy";

export interface EnvironmentMapDiagnostics {
  active: boolean;
  signature: string | null;
  revision: number;
  size: number;
}

/** Owns the generated environment texture; scene materials only borrow it. */
export class EnvironmentMapRuntime {
  private generator: THREE.PMREMGenerator;
  private readonly environmentScene = new THREE.Scene();
  private readonly material: THREE.ShaderMaterial;
  private readonly sphere: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private target: THREE.WebGLRenderTarget | null = null;
  private signature: string | null = null;
  private revision = 0;
  private quality: QualityLevel;
  private disposed = false;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    quality: QualityLevel,
  ) {
    this.quality = quality;
    this.generator = new THREE.PMREMGenerator(renderer);
    this.material = new THREE.ShaderMaterial({
      name: "StillpointEnvironmentSource",
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      uniforms: {
        uSkyColor: { value: new THREE.Color(0x587682) },
        uHorizonColor: { value: new THREE.Color(0xc5aa80) },
        uGroundColor: { value: new THREE.Color(0x252824) },
        uSunColor: { value: new THREE.Color(0xffe0b2) },
        uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
        uCloudCover: { value: 0 },
        uDaylight: { value: 1 },
        uDust: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDirection;
        void main() {
          vDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSkyColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uGroundColor;
        uniform vec3 uSunColor;
        uniform vec3 uSunDirection;
        uniform float uCloudCover;
        uniform float uDaylight;
        uniform float uDust;
        varying vec3 vDirection;

        void main() {
          vec3 direction = normalize(vDirection);
          float skyAmount = smoothstep(-0.08, 0.48, direction.y);
          vec3 color = mix(uHorizonColor, uSkyColor, skyAmount);
          color = mix(uGroundColor, color, smoothstep(-0.28, 0.02, direction.y));
          float sunCore = pow(max(dot(direction, normalize(uSunDirection)), 0.0), 720.0);
          float sunGlow = pow(max(dot(direction, normalize(uSunDirection)), 0.0), 18.0);
          color += uSunColor * (sunCore * 8.0 + sunGlow * 0.42) * uDaylight;
          color = mix(color, uHorizonColor, uCloudCover * 0.26);
          color = mix(color, vec3(0.48, 0.28, 0.15), uDust * 0.22);
          gl_FragColor = vec4(max(color, 0.0), 1.0);
        }
      `,
    });
    this.sphere = new THREE.Mesh(
      new THREE.SphereGeometry(10, 32, 16),
      this.material,
    );
    this.sphere.frustumCulled = false;
    this.environmentScene.add(this.sphere);
    this.applyQuality();
  }

  setQuality(quality: QualityLevel) {
    if (quality !== this.quality) {
      this.quality = quality;
      this.signature = null;
    }
    this.applyQuality();
  }

  present(state: Readonly<EnvironmentVisualState>) {
    if (this.disposed) return;
    const nextSignature = environmentMapSignature(state, this.quality);
    if (nextSignature === this.signature) return;

    // Store the attempt first so a constrained device cannot trigger a costly
    // failing allocation on every animation frame.
    this.signature = nextSignature;
    const uniforms = this.material.uniforms;
    uniforms.uSkyColor.value.copy(state.skyColor);
    uniforms.uHorizonColor.value.copy(state.horizonColor);
    uniforms.uGroundColor.value
      .copy(state.horizonColor)
      .multiplyScalar(0.22 + state.daylight * 0.16);
    uniforms.uSunColor.value.copy(state.sunColor);
    uniforms.uSunDirection.value.copy(state.sunDirection);
    uniforms.uCloudCover.value = state.cloudCover;
    uniforms.uDaylight.value = state.daylight;
    uniforms.uDust.value = state.dust;

    try {
      const nextTarget = this.generator.fromScene(
        this.environmentScene,
        0.04,
        0.1,
        20,
        { size: QUALITY_PRESETS[this.quality].environmentMap.size },
      );
      const previousTarget = this.target;
      this.target = nextTarget;
      this.scene.environment = nextTarget.texture;
      previousTarget?.dispose();
      this.revision += 1;
    } catch {
      // Direct lights remain the supported fallback on constrained devices.
    }
  }

  handleContextRestored() {
    if (this.disposed) return;
    this.generator.dispose();
    this.generator = new THREE.PMREMGenerator(this.renderer);
    this.target?.dispose();
    this.target = null;
    this.scene.environment = null;
    this.signature = null;
    this.revision = 0;
  }

  get diagnostics(): EnvironmentMapDiagnostics {
    return {
      active: this.scene.environment === this.target?.texture,
      signature: this.signature,
      revision: this.revision,
      size: QUALITY_PRESETS[this.quality].environmentMap.size,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.scene.environment === this.target?.texture) {
      this.scene.environment = null;
    }
    this.target?.dispose();
    this.target = null;
    this.sphere.geometry.dispose();
    this.material.dispose();
    this.generator.dispose();
  }

  private applyQuality() {
    this.scene.environmentIntensity =
      QUALITY_PRESETS[this.quality].environmentMap.intensity;
  }
}
