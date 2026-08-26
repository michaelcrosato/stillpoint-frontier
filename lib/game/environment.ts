import * as THREE from "three";
import {
  CAMERA_DRAW_DISTANCE,
  HORIZON_PRESETS,
  QUALITY_PRESETS,
  WORLD_SEED,
  qualityUsesHighDetail,
  qualityUsesShadows,
  type HorizonMode,
  type QualityLevel,
} from "./config";
import { seededRandom } from "./core/random";
import {
  advanceDeveloperMinutes,
  createDeveloperEnvironmentState,
  developerWeatherOptions,
  ensureDeveloperWeatherIsValid,
  resetDeveloperEnvironment,
  setDeveloperMinuteOfDay,
  setDeveloperMode,
  setDeveloperWeather,
  tickDeveloperEnvironment,
  type DeveloperEnvironmentState,
  type DeveloperWeatherOption,
} from "./developer/environmentState";
import {
  GAME_MINUTES_PER_REAL_SECOND,
  WORLD_START_MINUTES,
  sampleEnvironment,
  sanitizeWorldMinutes,
  type EnvironmentSample,
  type WeatherId,
} from "./environment/model";
import { sampleClimate } from "./world/macroWorld";

const CINEMATIC_PRECIPITATION_POINTS = 720;
const PERFORMANCE_PRECIPITATION_POINTS = 280;

export function stormLightningFlash(
  seconds: number,
  weatherId: WeatherId,
  precipitationRate: number,
  enabled = true,
) {
  if (!enabled || weatherId !== "storm") return 0;
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const strength = THREE.MathUtils.clamp(
    (Number.isFinite(precipitationRate) ? precipitationRate : 0) * 1.35 - 0.35,
    0,
    1,
  );
  if (strength <= 0) return 0;
  const cycleLength = 12.4;
  const cycle = Math.floor(safeSeconds / cycleLength);
  const local = safeSeconds - cycle * cycleLength;
  const random = Math.sin((cycle + 1) * 12.9898 + 78.233) * 43_758.5453;
  const offset = 2.1 + (random - Math.floor(random)) * 6.4;
  const pulse = (center: number, width: number) => {
    const amount = Math.max(0, 1 - Math.abs(local - center) / width);
    return amount * amount * (3 - 2 * amount);
  };
  return THREE.MathUtils.clamp(
    Math.max(
      pulse(offset, 0.075),
      pulse(offset + 0.18, 0.055) * 0.62,
      pulse(offset + 0.43, 0.14) * 0.24,
    ) * strength,
    0,
    1,
  );
}

export interface EnvironmentRuntime {
  sun: THREE.DirectionalLight;
  sunTarget: THREE.Object3D;
  tick(position: THREE.Vector3, deltaSeconds: number, running: boolean): void;
  present(position: THREE.Vector3, deltaSeconds: number): void;
  sync(position: THREE.Vector3, snap?: boolean): void;
  setWorldMinutes(minutes: number): void;
  getPersistentWorldMinutes(): number;
  getSample(): EnvironmentSample;
  getVisualState(): Readonly<EnvironmentVisualState>;
  setDeveloperMode(enabled: boolean): void;
  setDeveloperClockPaused(paused: boolean): void;
  setDeveloperMinuteOfDay(minutes: number): void;
  advanceDeveloperMinutes(minutes: number): void;
  setDeveloperWeather(weatherId: WeatherId | null): boolean;
  resetDeveloperOverrides(): void;
  getDeveloperState(): DeveloperEnvironmentState;
  getDeveloperWeatherOptions(): DeveloperWeatherOption[];
  setQuality(quality: QualityLevel): void;
  setShadowStabilization(enabled: boolean): void;
  setStormLightning(enabled: boolean): void;
  setHorizonMode(mode: HorizonMode): void;
  dispose(): void;
}

export interface DirectionalShadowSnapScratch {
  forward: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
}

/**
 * Quantizes a moving directional-light anchor in the light's projection plane.
 * The correction never changes the light direction or its along-ray position.
 */
export function stabilizeDirectionalShadowAnchor(
  anchor: Readonly<THREE.Vector3>,
  lightOffset: Readonly<THREE.Vector3>,
  camera: Readonly<THREE.OrthographicCamera>,
  mapSize: Readonly<THREE.Vector2>,
  output = new THREE.Vector3(),
  scratch: DirectionalShadowSnapScratch = {
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    up: new THREE.Vector3(),
  },
) {
  const width = Math.max(0.001, camera.right - camera.left);
  const height = Math.max(0.001, camera.top - camera.bottom);
  const texelX = width / Math.max(1, mapSize.x);
  const texelY = height / Math.max(1, mapSize.y);
  scratch.forward.copy(lightOffset).normalize();
  scratch.right.set(0, 1, 0).cross(scratch.forward);
  if (scratch.right.lengthSq() < 0.000001) scratch.right.set(1, 0, 0);
  else scratch.right.normalize();
  scratch.up.copy(scratch.forward).cross(scratch.right).normalize();
  const projectedX = scratch.right.dot(anchor);
  const projectedY = scratch.up.dot(anchor);
  const correctionX = Math.round(projectedX / texelX) * texelX - projectedX;
  const correctionY = Math.round(projectedY / texelY) * texelY - projectedY;
  return output
    .copy(anchor)
    .addScaledVector(scratch.right, correctionX)
    .addScaledVector(scratch.up, correctionY);
}

export interface EnvironmentVisualState {
  effectSeconds: number;
  /** Continuously integrated cloud travel; avoids discontinuities when wind changes. */
  cloudOffset: THREE.Vector2;
  cloudCover: number;
  precipitationRate: number;
  daylight: number;
  goldenHour: number;
  night: number;
  dust: number;
  /** Smoothed outdoor surface saturation: fast to accumulate, slow to dry. */
  surfaceWetness: number;
  lightningFlash: number;
  windKph: number;
  windDirection: number;
  sunDirection: THREE.Vector3;
  moonDirection: THREE.Vector3;
  sunColor: THREE.Color;
  skyColor: THREE.Color;
  horizonColor: THREE.Color;
}

/** One celestial solution drives both the visible discs and the key light. */
export function calculateCelestialDirections(
  sunElevation: number,
  sunAzimuth: number,
  sunTarget = new THREE.Vector3(),
  moonTarget = new THREE.Vector3(),
) {
  const elevation = THREE.MathUtils.clamp(
    Number.isFinite(sunElevation) ? sunElevation : 0,
    -1,
    1,
  );
  const azimuth = Number.isFinite(sunAzimuth) ? sunAzimuth : 0;
  const horizontal = Math.sqrt(Math.max(0, 1 - elevation * elevation));
  sunTarget.set(
    Math.cos(azimuth) * horizontal,
    elevation,
    Math.sin(azimuth) * horizontal,
  ).normalize();
  moonTarget.copy(sunTarget).multiplyScalar(-1);
  return { sun: sunTarget, moon: moonTarget };
}

interface PrecipitationRuntime {
  points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  uniforms: {
    uTime: { value: number };
    uOpacity: { value: number };
    uColor: { value: THREE.Color };
    uSpeed: { value: number };
    uSize: { value: number };
    uRadius: { value: number };
    uHeight: { value: number };
    uWind: { value: THREE.Vector2 };
  };
}

const BLENDED_SAMPLE_FIELDS = [
  "sunElevation",
  "sunAzimuth",
  "daylight",
  "goldenHour",
  "night",
  "cloudCover",
  "fogDensity",
  "precipitationRate",
  "windKph",
  "windDirection",
  "temperatureC",
  "dust",
  "lightScale",
  "exposure",
] as const satisfies readonly (keyof EnvironmentSample)[];

function createPrecipitation(): PrecipitationRuntime {
  const radius = 58;
  const height = 40;
  const random = seededRandom(`${WORLD_SEED}:atmosphere:precipitation:v1`);
  const positions = new Float32Array(CINEMATIC_PRECIPITATION_POINTS * 3);
  for (let index = 0; index < CINEMATIC_PRECIPITATION_POINTS; index += 1) {
    const offset = index * 3;
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * radius;
    positions[offset] = Math.cos(angle) * distance;
    positions[offset + 1] = (random() - 0.5) * height;
    positions[offset + 2] = Math.sin(angle) * distance;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const uniforms = {
    uTime: { value: 0 },
    uOpacity: { value: 0 },
    uColor: { value: new THREE.Color(0xb9c8cf) },
    uSpeed: { value: 20 },
    uSize: { value: 2 },
    uRadius: { value: radius },
    uHeight: { value: height },
    uWind: { value: new THREE.Vector2() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: `
      #include <logdepthbuf_pars_vertex>
      uniform float uTime;
      uniform float uSpeed;
      uniform float uSize;
      uniform float uRadius;
      uniform float uHeight;
      uniform vec2 uWind;
      void main() {
        vec3 particle = position;
        particle.y = mod(position.y - uTime * uSpeed + uHeight * 0.5, uHeight) - uHeight * 0.5;
        particle.x = mod(position.x + uTime * uWind.x + uRadius, uRadius * 2.0) - uRadius;
        particle.z = mod(position.z + uTime * uWind.y + uRadius, uRadius * 2.0) - uRadius;
        vec4 viewPosition = modelViewMatrix * vec4(particle, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        #include <logdepthbuf_vertex>
        gl_PointSize = uSize * clamp(110.0 / max(1.0, -viewPosition.z), 0.7, 2.8);
      }
    `,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      uniform float uOpacity;
      uniform vec3 uColor;
      void main() {
        vec2 centered = gl_PointCoord - vec2(0.5);
        float edge = 1.0 - smoothstep(0.08, 0.5, length(centered));
        if (edge <= 0.01) discard;
        #include <logdepthbuf_fragment>
        gl_FragColor = vec4(uColor, uOpacity * edge);
      }
    `,
  });
  const points = new THREE.Points(geometry, material);
  points.name = "biome-precipitation";
  points.frustumCulled = false;
  points.renderOrder = 5;
  return { points, uniforms };
}

function createStars() {
  const random = seededRandom(`${WORLD_SEED}:atmosphere:stars:v1`);
  const positions = new Float32Array(480 * 3);
  const radius = CAMERA_DRAW_DISTANCE * 0.84;
  for (let index = 0; index < 480; index += 1) {
    const offset = index * 3;
    const azimuth = random() * Math.PI * 2;
    const elevation = random() * Math.PI * 0.48 + Math.PI * 0.03;
    positions[offset] = Math.cos(azimuth) * Math.sin(elevation) * radius;
    positions[offset + 1] = Math.cos(elevation) * radius;
    positions[offset + 2] = Math.sin(azimuth) * Math.sin(elevation) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xdbe5e7,
    size: 1.45,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = "static-star-field";
  points.frustumCulled = false;
  points.renderOrder = -2;
  return { points, geometry, material };
}

export function createEnvironment(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  quality: QualityLevel,
  initialWorldMinutes = WORLD_START_MINUTES,
): EnvironmentRuntime {
  const fog = new THREE.FogExp2(0x8f7657, 0.00365);
  scene.fog = fog;
  scene.background = new THREE.Color(0x171a18);

  const hemisphere = new THREE.HemisphereLight(0xe7cda0, 0x252722, 2.25);
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight(0xffd5a0, 4.1);
  sun.position.set(-70, 92, 38);
  sun.castShadow = qualityUsesShadows(quality);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 260;
  sun.shadow.camera.left = -88;
  sun.shadow.camera.right = 88;
  sun.shadow.camera.top = 88;
  sun.shadow.camera.bottom = -88;
  const sunTarget = new THREE.Object3D();
  scene.add(sun, sunTarget);
  sun.target = sunTarget;

  const skyGeometry = new THREE.SphereGeometry(CAMERA_DRAW_DISTANCE * 0.91, 32, 16);
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x1c2526) },
      horizonColor: { value: new THREE.Color(0xc18d62) },
      groundColor: { value: new THREE.Color(0x594b3d) },
      cloudColor: { value: new THREE.Color(0x70777a) },
      cloudCover: { value: 0.1 },
      sunDirection: { value: new THREE.Vector3(0, 1, 0) },
      moonDirection: { value: new THREE.Vector3(0, -1, 0) },
      sunDiscColor: { value: new THREE.Color(0xffe2ae) },
      moonDiscColor: { value: new THREE.Color(0xaabbd0) },
      cloudOffset: { value: new THREE.Vector2() },
      daylight: { value: 1 },
      night: { value: 0 },
      goldenHour: { value: 0 },
      dust: { value: 0 },
      lightningFlash: { value: 0 },
    },
    vertexShader: `
      #include <logdepthbuf_pars_vertex>
      varying vec3 vWorldPosition;
      void main() {
        vWorldPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      varying vec3 vWorldPosition;
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 groundColor;
      uniform vec3 cloudColor;
      uniform float cloudCover;
      uniform vec3 sunDirection;
      uniform vec3 moonDirection;
      uniform vec3 sunDiscColor;
      uniform vec3 moonDiscColor;
      uniform vec2 cloudOffset;
      uniform float daylight;
      uniform float night;
      uniform float goldenHour;
      uniform float dust;
      uniform float lightningFlash;

      float hash31(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }

      float valueNoise(vec3 p) {
        vec3 cell = floor(p);
        vec3 local = fract(p);
        local = local * local * (3.0 - 2.0 * local);
        float n000 = hash31(cell + vec3(0.0, 0.0, 0.0));
        float n100 = hash31(cell + vec3(1.0, 0.0, 0.0));
        float n010 = hash31(cell + vec3(0.0, 1.0, 0.0));
        float n110 = hash31(cell + vec3(1.0, 1.0, 0.0));
        float n001 = hash31(cell + vec3(0.0, 0.0, 1.0));
        float n101 = hash31(cell + vec3(1.0, 0.0, 1.0));
        float n011 = hash31(cell + vec3(0.0, 1.0, 1.0));
        float n111 = hash31(cell + vec3(1.0, 1.0, 1.0));
        float nx00 = mix(n000, n100, local.x);
        float nx10 = mix(n010, n110, local.x);
        float nx01 = mix(n001, n101, local.x);
        float nx11 = mix(n011, n111, local.x);
        return mix(mix(nx00, nx10, local.y), mix(nx01, nx11, local.y), local.z);
      }

      float cloudFbm(vec3 p) {
        float result = valueNoise(p) * 0.58;
        result += valueNoise(p * 2.03 + 7.1) * 0.28;
        result += valueNoise(p * 4.07 - 3.6) * 0.14;
        return result;
      }

      void main() {
        vec3 direction = normalize(vWorldPosition);
        float h = direction.y;
        vec3 color = h > 0.0
          ? mix(horizonColor, topColor, smoothstep(0.0, 0.72, h))
          : mix(horizonColor, groundColor, smoothstep(0.0, 0.32, -h));
        float sunDot = dot(direction, normalize(sunDirection));
        float moonDot = dot(direction, normalize(moonDirection));
        float sunDisc = smoothstep(0.99972, 0.99991, sunDot) * daylight;
        float sunHalo = smoothstep(0.955, 1.0, sunDot) * (0.18 + goldenHour * 0.34) * daylight;
        float moonDisc = smoothstep(0.99942, 0.99978, moonDot) * night;
        float moonHalo = smoothstep(0.972, 1.0, moonDot) * 0.16 * night;
        color += sunDiscColor * (sunDisc * 2.2 + sunHalo);
        color += moonDiscColor * (moonDisc * 1.15 + moonHalo);

        vec3 cloudPoint = direction * 3.45;
        cloudPoint.xz += cloudOffset * 0.012;
        float broad = cloudFbm(cloudPoint);
        float secondLayer = cloudFbm(direction * 7.3 - vec3(cloudOffset.y, 0.0, cloudOffset.x) * 0.006);
        float field = broad * 0.78 + secondLayer * 0.22;
        float threshold = mix(0.76, 0.39, cloudCover);
        float clouds = smoothstep(threshold, threshold + 0.17, field)
          * smoothstep(-0.015, 0.32, h)
          * smoothstep(0.0, 0.08, cloudCover);
        clouds *= mix(0.74, 1.0, cloudCover);
        vec3 weatherCloud = mix(cloudColor, vec3(0.42, 0.34, 0.28), dust * 0.34);
        #include <logdepthbuf_fragment>
        vec3 finalColor = mix(color, weatherCloud, clouds * 0.68);
        finalColor += vec3(0.58, 0.72, 1.0) * lightningFlash *
          (0.18 + clouds * 0.34);
        gl_FragColor = vec4(finalColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeometry, skyMaterial);
  sky.name = "atmosphere-sky";
  sky.frustumCulled = false;
  sky.renderOrder = -3;
  scene.add(sky);

  const stars = createStars();
  scene.add(stars.points);
  const precipitation = createPrecipitation();
  scene.add(precipitation.points);

  let worldMinutes = sanitizeWorldMinutes(initialWorldMinutes);
  let developerState = createDeveloperEnvironmentState(worldMinutes);
  let effectSeconds = 0;
  const cloudOffset = new THREE.Vector2();
  let horizonMode: HorizonMode = "standard";
  let climate = sampleClimate(0, 8);
  let targetSample = sampleEnvironment(worldMinutes, climate);
  let displaySample = { ...targetSample };
  const topColor = new THREE.Color();
  const horizonColor = new THREE.Color();
  const groundColor = new THREE.Color();
  const fogColor = new THREE.Color();
  const cloudColor = new THREE.Color();
  const nightTop = new THREE.Color(0x050910);
  const nightHorizon = new THREE.Color(0x151c22);
  const nightGround = new THREE.Color(0x171b1b);
  const dayTop = new THREE.Color(0x587682);
  const dayHorizon = new THREE.Color(0xc5aa80);
  const dayGround = new THREE.Color(0x5b5c50);
  const dawnHorizon = new THREE.Color(0xd87943);
  const overcast = new THREE.Color(0x697276);
  const dustTint = new THREE.Color(0x9a6949);
  const sunDay = new THREE.Color(0xffe0b2);
  const sunDawn = new THREE.Color(0xff9a56);
  const moonColor = new THREE.Color(0x91a9c8);
  const lightningColor = new THREE.Color(0xbdd8ff);
  const temporaryColor = new THREE.Color();
  const sunDirection = new THREE.Vector3();
  const moonDirection = new THREE.Vector3();
  const shadowAnchor = new THREE.Vector3();
  const shadowLightOffset = new THREE.Vector3();
  const shadowSnapScratch: DirectionalShadowSnapScratch = {
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    up: new THREE.Vector3(),
  };
  let shadowStabilization = true;
  let stormLightningEnabled = true;
  let surfaceWetness = 0;
  const visualState: EnvironmentVisualState = {
    effectSeconds,
    cloudOffset: new THREE.Vector2(),
    cloudCover: displaySample.cloudCover,
    precipitationRate: displaySample.precipitationRate,
    daylight: displaySample.daylight,
    goldenHour: displaySample.goldenHour,
    night: displaySample.night,
    dust: displaySample.dust,
    surfaceWetness,
    lightningFlash: 0,
    windKph: displaySample.windKph,
    windDirection: displaySample.windDirection,
    sunDirection,
    moonDirection,
    sunColor: new THREE.Color(0xffe0b2),
    skyColor: new THREE.Color(),
    horizonColor: new THREE.Color(),
  };

  const effectiveFogMultiplier = (sample: EnvironmentSample) => {
    const presetMultiplier = HORIZON_PRESETS[horizonMode].hazeMultiplier;
    if (presetMultiplier >= 1) return 1;
    const hazard = Math.max(
      sample.weatherId === "fog" ? 1 : 0,
      sample.precipitationRate,
      sample.dust,
    );
    const hazardousMultiplier = horizonMode === "extended" ? 0.72 : 0.68;
    return THREE.MathUtils.lerp(presetMultiplier, hazardousMultiplier, hazard);
  };

  const effectiveFogDensity = (sample: EnvironmentSample) =>
    sample.fogDensity * effectiveFogMultiplier(sample) * (1 + sample.night * 0.08);

  const applyAtmosphere = (position: THREE.Vector3) => {
    const lightningFlash = stormLightningFlash(
      effectSeconds,
      displaySample.weatherId,
      displaySample.precipitationRate,
      stormLightningEnabled,
    );
    topColor.lerpColors(nightTop, dayTop, displaySample.daylight);
    horizonColor.lerpColors(nightHorizon, dayHorizon, displaySample.daylight);
    groundColor.lerpColors(nightGround, dayGround, displaySample.daylight);
    horizonColor.lerp(dawnHorizon, displaySample.goldenHour * 0.78);
    topColor.lerp(overcast, displaySample.cloudCover * 0.42);
    horizonColor.lerp(overcast, displaySample.cloudCover * 0.28);
    groundColor.lerp(dustTint, displaySample.dust * 0.5);
    horizonColor.lerp(dustTint, displaySample.dust * 0.64);
    fogColor.lerpColors(groundColor, horizonColor, 0.7);
    cloudColor.lerpColors(overcast, dustTint, displaySample.dust * 0.7);
    topColor.lerp(lightningColor, lightningFlash * 0.24);
    horizonColor.lerp(lightningColor, lightningFlash * 0.34);
    cloudColor.lerp(lightningColor, lightningFlash * 0.52);

    skyMaterial.uniforms.topColor.value.copy(topColor);
    skyMaterial.uniforms.horizonColor.value.copy(horizonColor);
    skyMaterial.uniforms.groundColor.value.copy(groundColor);
    skyMaterial.uniforms.cloudColor.value.copy(cloudColor);
    skyMaterial.uniforms.cloudCover.value = displaySample.cloudCover;
    skyMaterial.uniforms.cloudOffset.value.copy(cloudOffset);
    skyMaterial.uniforms.daylight.value = displaySample.daylight;
    skyMaterial.uniforms.night.value = displaySample.night;
    skyMaterial.uniforms.goldenHour.value = displaySample.goldenHour;
    skyMaterial.uniforms.dust.value = displaySample.dust;
    skyMaterial.uniforms.lightningFlash.value = lightningFlash;
    fog.color.copy(fogColor);
    fog.density = effectiveFogDensity(displaySample);
    (scene.background as THREE.Color).copy(fogColor).multiplyScalar(0.72);

    const useSun = displaySample.sunElevation > -0.06;
    calculateCelestialDirections(
      displaySample.sunElevation,
      displaySample.sunAzimuth,
      sunDirection,
      moonDirection,
    );
    skyMaterial.uniforms.sunDirection.value.copy(sunDirection);
    skyMaterial.uniforms.moonDirection.value.copy(moonDirection);
    const keyDirection = useSun ? sunDirection : moonDirection;
    const horizontal = 116;
    const keyX = keyDirection.x * horizontal;
    const keyZ = keyDirection.z * horizontal;
    const keyY = useSun
      ? Math.max(7, keyDirection.y * 126)
      : Math.max(28, keyDirection.y * 96);
    shadowLightOffset.set(keyX, keyY, keyZ);
    if (shadowStabilization && sun.castShadow) {
      stabilizeDirectionalShadowAnchor(
        position,
        shadowLightOffset,
        sun.shadow.camera,
        sun.shadow.mapSize,
        shadowAnchor,
        shadowSnapScratch,
      );
    } else {
      shadowAnchor.copy(position);
    }
    sun.position.copy(shadowAnchor).add(shadowLightOffset);
    sunTarget.position.copy(shadowAnchor);
    if (useSun) {
      temporaryColor.lerpColors(sunDay, sunDawn, displaySample.goldenHour * 0.86);
      sun.color.copy(temporaryColor);
      skyMaterial.uniforms.sunDiscColor.value.copy(temporaryColor);
      sun.intensity = 4.2 * displaySample.lightScale;
    } else {
      sun.color.copy(moonColor);
      sun.intensity = 0.34 * displaySample.night * (1 - displaySample.cloudCover * 0.52);
    }
    if (lightningFlash > 0) {
      sun.color.lerp(lightningColor, lightningFlash * 0.9);
      sun.intensity += lightningFlash * 7.5;
    }
    hemisphere.color.copy(topColor).lerp(dayHorizon, 0.34 * displaySample.daylight);
    hemisphere.groundColor.copy(groundColor).multiplyScalar(0.62);
    hemisphere.intensity =
      0.32 + displaySample.lightScale * 1.96 + lightningFlash * 2.8;
    renderer.toneMappingExposure =
      displaySample.exposure * (1 + lightningFlash * 0.26);

    sky.position.copy(position);
    stars.points.position.copy(position);
    stars.material.opacity = Math.max(0, displaySample.night - displaySample.cloudCover * 0.66);
    precipitation.points.position.set(position.x, position.y + 18, position.z);
    precipitation.uniforms.uTime.value = effectSeconds;

    const isDust = displaySample.dust > displaySample.precipitationRate;
    const effectStrength = Math.max(displaySample.precipitationRate, displaySample.dust);
    precipitation.points.visible = effectStrength > 0.025;
    precipitation.uniforms.uOpacity.value = effectStrength * (isDust ? 0.34 : 0.72);
    precipitation.uniforms.uSpeed.value = isDust
      ? 1.8
      : displaySample.precipitation === "snow"
        ? 3.2
        : displaySample.precipitation === "sleet"
          ? 15
          : 24;
    precipitation.uniforms.uSize.value = isDust
      ? 4.2
      : displaySample.precipitation === "snow"
        ? 3.4
        : 1.45;
    precipitation.uniforms.uColor.value.setHex(
      isDust
        ? 0xc18b5c
        : displaySample.precipitation === "snow"
          ? 0xe4eaeb
          : 0xaebfc8,
    );
    const windRadians = (displaySample.windDirection * Math.PI) / 180;
    const drift = Math.min(5, displaySample.windKph / 18);
    precipitation.uniforms.uWind.value.set(
      Math.cos(windRadians) * drift,
      Math.sin(windRadians) * drift,
    );

    visualState.effectSeconds = effectSeconds;
    visualState.cloudOffset.copy(cloudOffset);
    visualState.cloudCover = displaySample.cloudCover;
    visualState.precipitationRate = displaySample.precipitationRate;
    visualState.daylight = displaySample.daylight;
    visualState.goldenHour = displaySample.goldenHour;
    visualState.night = displaySample.night;
    visualState.dust = displaySample.dust;
    visualState.surfaceWetness = surfaceWetness;
    visualState.lightningFlash = lightningFlash;
    visualState.windKph = displaySample.windKph;
    visualState.windDirection = displaySample.windDirection;
    visualState.sunColor.copy(sun.color);
    visualState.skyColor.copy(topColor);
    visualState.horizonColor.copy(horizonColor);
  };

  const runtime: EnvironmentRuntime = {
    sun,
    sunTarget,
    tick(position, deltaSeconds, running) {
      const safeDelta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
      if (running) {
        effectSeconds += safeDelta;
        const precipitationWetsSurfaces =
          displaySample.precipitation === "rain" ||
          displaySample.precipitation === "sleet";
        const targetWetness = precipitationWetsSurfaces
          ? displaySample.precipitationRate
          : 0;
        const wetnessRate = targetWetness > surfaceWetness ? 0.18 : 0.025;
        surfaceWetness = THREE.MathUtils.lerp(
          surfaceWetness,
          targetWetness,
          1 - Math.exp(-wetnessRate * safeDelta),
        );
        const windRadians = (displaySample.windDirection * Math.PI) / 180;
        const cloudSpeed = THREE.MathUtils.clamp(displaySample.windKph * 0.018, 0.025, 1.8);
        cloudOffset.x += Math.cos(windRadians) * safeDelta * cloudSpeed;
        cloudOffset.y += Math.sin(windRadians) * safeDelta * cloudSpeed;
        if (developerState.enabled) {
          developerState = tickDeveloperEnvironment(
            developerState,
            safeDelta,
            true,
          );
        } else {
          worldMinutes += safeDelta * GAME_MINUTES_PER_REAL_SECOND;
        }
      }
      runtime.sync(position);
    },
    present(position, deltaSeconds) {
      const safeDelta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
      const alpha = 1 - Math.exp(-safeDelta * 2.25);
      for (const field of BLENDED_SAMPLE_FIELDS) {
        displaySample[field] =
          displaySample[field] + (targetSample[field] - displaySample[field]) * alpha;
      }
      displaySample.weatherId = targetSample.weatherId;
      displaySample.weatherLabel = targetSample.weatherLabel;
      displaySample.precipitation = targetSample.precipitation;
      applyAtmosphere(position);
    },
    sync(position, snap = false) {
      climate = sampleClimate(position.x, position.z);
      developerState = ensureDeveloperWeatherIsValid(
        developerState,
        climate.biome.id,
      );
      const effectiveMinutes = developerState.enabled
        ? developerState.worldMinutes
        : worldMinutes;
      targetSample = sampleEnvironment(
        effectiveMinutes,
        climate,
        WORLD_SEED,
        developerState.enabled ? developerState.weatherOverride : null,
      );
      if (snap) displaySample = { ...targetSample };
    },
    setWorldMinutes(minutes) {
      worldMinutes = sanitizeWorldMinutes(minutes);
      if (developerState.enabled) {
        developerState = {
          ...developerState,
          worldMinutes,
        };
      }
      targetSample = sampleEnvironment(
        worldMinutes,
        climate,
        WORLD_SEED,
        developerState.enabled ? developerState.weatherOverride : null,
      );
      displaySample = { ...targetSample };
    },
    getPersistentWorldMinutes() {
      return worldMinutes;
    },
    getSample() {
      const density = effectiveFogDensity(targetSample);
      return {
        ...targetSample,
        visibilityMeters: Math.round(
          Math.min(HORIZON_PRESETS[horizonMode].drawDistanceMeters, 1.978 / density),
        ),
      };
    },
    getVisualState() {
      return visualState;
    },
    setDeveloperMode(enabled) {
      developerState = setDeveloperMode(developerState, enabled, worldMinutes);
    },
    setDeveloperClockPaused(paused) {
      if (!developerState.enabled) return;
      developerState = { ...developerState, clockPaused: paused };
    },
    setDeveloperMinuteOfDay(minutes) {
      developerState = setDeveloperMinuteOfDay(developerState, minutes);
    },
    advanceDeveloperMinutes(minutes) {
      developerState = advanceDeveloperMinutes(developerState, minutes);
    },
    setDeveloperWeather(weatherId) {
      if (!developerState.enabled) return false;
      const next = setDeveloperWeather(
        developerState,
        weatherId,
        climate.biome.id,
      );
      const accepted = weatherId === null || next.weatherOverride === weatherId;
      developerState = next;
      return accepted;
    },
    resetDeveloperOverrides() {
      developerState = resetDeveloperEnvironment(developerState, worldMinutes);
    },
    getDeveloperState() {
      return { ...developerState };
    },
    getDeveloperWeatherOptions() {
      return developerWeatherOptions(climate.biome.id);
    },
    setQuality(nextQuality) {
      const preset = QUALITY_PRESETS[nextQuality];
      sun.castShadow = qualityUsesShadows(nextQuality);
      const maximumTextureSize = renderer.capabilities.maxTextureSize || preset.sunShadowMapSize;
      const shadowMapSize = Math.min(preset.sunShadowMapSize, maximumTextureSize);
      if (sun.shadow.mapSize.width !== shadowMapSize) {
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
        sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
        sun.shadow.needsUpdate = true;
      }
      sun.shadow.bias = nextQuality === "ultra" ? -0.00008 : -0.00015;
      sun.shadow.normalBias = nextQuality === "ultra" ? 0.015 : 0.02;
      precipitation.points.geometry.setDrawRange(
        0,
        qualityUsesHighDetail(nextQuality)
          ? CINEMATIC_PRECIPITATION_POINTS
          : PERFORMANCE_PRECIPITATION_POINTS,
      );
    },
    setShadowStabilization(enabled) {
      shadowStabilization = enabled;
    },
    setStormLightning(enabled) {
      stormLightningEnabled = enabled;
    },
    setHorizonMode(mode) {
      horizonMode = mode;
    },
    dispose() {
      scene.remove(
        hemisphere,
        sun,
        sunTarget,
        sky,
        stars.points,
        precipitation.points,
      );
      skyGeometry.dispose();
      skyMaterial.dispose();
      stars.geometry.dispose();
      stars.material.dispose();
      precipitation.points.geometry.dispose();
      precipitation.points.material.dispose();
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      sun.dispose();
    },
  };

  const openingPosition = new THREE.Vector3(0, 0, 8);
  runtime.setQuality(quality);
  runtime.sync(openingPosition, true);
  runtime.present(openingPosition, 0);
  return runtime;
}
