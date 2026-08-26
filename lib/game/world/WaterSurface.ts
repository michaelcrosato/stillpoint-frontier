import * as THREE from "three";
import {
  qualityUsesHighDetail,
  type QualityLevel,
} from "../config";
import type { EnvironmentVisualState } from "../environment";

export type WaterSurfaceKind = "river" | "sea";

export interface WaterSurfaceUniforms {
  [uniform: string]: THREE.IUniform;
  uTime: { value: number };
  uSunDirection: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uSkyColor: { value: THREE.Color };
  uHorizonColor: { value: THREE.Color };
  uWind: { value: THREE.Vector2 };
  uCloudCover: { value: number };
  uPrecipitation: { value: number };
  uDaylight: { value: number };
  uDust: { value: number };
  uDetail: { value: number };
  uWaterKind: { value: number };
}

const clamp01 = (value: number) =>
  THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);

/**
 * One material is shared by every river and sea chunk. Ripples are sampled in
 * absolute world space, so streaming boundaries never reset their phase.
 */
export class WaterSurfaceRuntime {
  readonly uniforms: WaterSurfaceUniforms;
  readonly material: THREE.ShaderMaterial;
  private disposed = false;

  constructor(quality: QualityLevel) {
    this.uniforms = {
      // ShaderMaterial does not inject fog uniforms automatically. Declaring
      // the fog chunks while omitting these wrappers makes Three's
      // refreshFogUniforms() dereference undefined as soon as water enters the
      // camera frustum.
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: { value: 0 },
      uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(0xffddb0) },
      uSkyColor: { value: new THREE.Color(0x587682) },
      uHorizonColor: { value: new THREE.Color(0xc5aa80) },
      uWind: { value: new THREE.Vector2(1, 0) },
      uCloudCover: { value: 0 },
      uPrecipitation: { value: 0 },
      uDaylight: { value: 1 },
      uDust: { value: 0 },
      uDetail: { value: qualityUsesHighDetail(quality) ? 1 : 0 },
      uWaterKind: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      name: "shared-world-water",
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      fog: true,
      vertexShader: `
        #include <fog_pars_vertex>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          vec4 mvPosition = viewMatrix * worldPosition;
          gl_Position = projectionMatrix * mvPosition;
          #include <logdepthbuf_vertex>
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        #include <fog_pars_fragment>
        #include <logdepthbuf_pars_fragment>
        uniform float uTime;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        uniform vec3 uSkyColor;
        uniform vec3 uHorizonColor;
        uniform vec2 uWind;
        uniform float uCloudCover;
        uniform float uPrecipitation;
        uniform float uDaylight;
        uniform float uDust;
        uniform float uDetail;
        uniform float uWaterKind;
        varying vec3 vWorldPosition;

        void main() {
          float windMagnitude = clamp(length(uWind), 0.2, 2.4);
          vec2 wind = normalize(uWind + vec2(0.0001));
          vec2 crossWind = vec2(-wind.y, wind.x);
          vec2 point = vWorldPosition.xz;
          float windTime = uTime * mix(0.64, 1.28, (windMagnitude - 0.2) / 2.2);
          float phaseA = dot(point, wind) * 0.115 + windTime * 0.82;
          float phaseB = dot(point, crossWind) * 0.173 - windTime * 0.53;
          float phaseC = dot(point, normalize(wind + crossWind * 0.46)) * 0.31 + windTime * 1.19;
          float detailStrength = mix(0.55, 1.0, uDetail);
          vec2 gradient = wind * cos(phaseA) * 0.052;
          gradient += crossWind * cos(phaseB) * 0.034;
          gradient += normalize(wind + crossWind * 0.46) * cos(phaseC) * 0.018 * detailStrength;
          gradient *= mix(0.72, 1.36, (windMagnitude - 0.2) / 2.2)
            * (1.0 + uPrecipitation * 0.48);
          vec3 normal = normalize(vec3(-gradient.x, 1.0, -gradient.y));
          vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
          float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 4.1);

          vec3 riverDeep = vec3(0.055, 0.145, 0.16);
          vec3 seaDeep = vec3(0.035, 0.105, 0.135);
          vec3 deepColor = mix(riverDeep, seaDeep, uWaterKind);
          vec3 shallowColor = mix(vec3(0.19, 0.37, 0.38), vec3(0.12, 0.32, 0.37), uWaterKind);
          float ripples = sin(phaseA) * 0.5 + sin(phaseB) * 0.28 + sin(phaseC) * 0.12;
          vec3 waterColor = mix(deepColor, shallowColor, 0.42 + ripples * 0.12);
          vec3 reflectedSky = mix(uHorizonColor, uSkyColor, clamp(normal.y * 0.72 + fresnel * 0.28, 0.0, 1.0));
          waterColor = mix(waterColor, reflectedSky, 0.16 + fresnel * 0.52);

          vec3 reflectedSun = reflect(-normalize(uSunDirection), normal);
          float glint = pow(max(dot(reflectedSun, viewDirection), 0.0), mix(70.0, 118.0, uDetail));
          glint *= uDaylight * (1.0 - uCloudCover * 0.78);
          waterColor += uSunColor * glint * 1.75;
          waterColor = mix(waterColor, vec3(0.30, 0.22, 0.14), uDust * 0.16);

          float opacity = mix(0.86, 0.91, uWaterKind) + fresnel * 0.045;
          #include <logdepthbuf_fragment>
          gl_FragColor = vec4(waterColor, opacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
    });
  }

  present(state: Readonly<EnvironmentVisualState>) {
    if (this.disposed) return;
    this.uniforms.uTime.value = Number.isFinite(state.effectSeconds)
      ? Math.max(0, state.effectSeconds)
      : 0;
    this.uniforms.uSunDirection.value.copy(state.sunDirection);
    if (this.uniforms.uSunDirection.value.lengthSq() < 0.0001) {
      this.uniforms.uSunDirection.value.set(0, 1, 0);
    } else {
      this.uniforms.uSunDirection.value.normalize();
    }
    this.uniforms.uSunColor.value.copy(state.sunColor);
    this.uniforms.uSkyColor.value.copy(state.skyColor);
    this.uniforms.uHorizonColor.value.copy(state.horizonColor);
    const radians = ((Number.isFinite(state.windDirection) ? state.windDirection : 0) * Math.PI) / 180;
    const windStrength = THREE.MathUtils.clamp(
      (Number.isFinite(state.windKph) ? state.windKph : 0) / 35,
      0.2,
      2.4,
    );
    this.uniforms.uWind.value.set(
      Math.cos(radians) * windStrength,
      Math.sin(radians) * windStrength,
    );
    this.uniforms.uCloudCover.value = clamp01(state.cloudCover);
    this.uniforms.uPrecipitation.value = clamp01(state.precipitationRate);
    this.uniforms.uDaylight.value = clamp01(state.daylight);
    this.uniforms.uDust.value = clamp01(state.dust);
  }

  bind(mesh: THREE.Mesh, kind: WaterSurfaceKind) {
    mesh.userData.waterSurfaceKind = kind;
    const waterKind = kind === "sea" ? 1 : 0;
    mesh.onBeforeRender = () => {
      if (this.uniforms.uWaterKind.value === waterKind) return;
      this.uniforms.uWaterKind.value = waterKind;
      this.material.uniformsNeedUpdate = true;
    };
  }

  setQuality(quality: QualityLevel) {
    if (this.disposed) return;
    this.uniforms.uDetail.value = qualityUsesHighDetail(quality) ? 1 : 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.material.dispose();
  }
}
