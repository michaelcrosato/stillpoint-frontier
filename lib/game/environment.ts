import * as THREE from "three";
import {
  CAMERA_DRAW_DISTANCE,
  SHADOW_MAP_SIZE,
  WORLD_SEED,
  type QualityLevel,
} from "./config";
import { seededRandom } from "./core/random";
import {
  GAME_MINUTES_PER_REAL_SECOND,
  WORLD_START_MINUTES,
  sampleEnvironment,
  sanitizeWorldMinutes,
  type EnvironmentSample,
} from "./environment/model";
import { sampleClimate } from "./world/macroWorld";

const CINEMATIC_PRECIPITATION_POINTS = 720;
const PERFORMANCE_PRECIPITATION_POINTS = 280;

export interface EnvironmentRuntime {
  sun: THREE.DirectionalLight;
  sunTarget: THREE.Object3D;
  tick(position: THREE.Vector3, deltaSeconds: number, running: boolean): void;
  present(position: THREE.Vector3, deltaSeconds: number): void;
  sync(position: THREE.Vector3, snap?: boolean): void;
  setWorldMinutes(minutes: number): void;
  getSample(): EnvironmentSample;
  setQuality(quality: QualityLevel): void;
  dispose(): void;
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
        gl_PointSize = uSize * clamp(110.0 / max(1.0, -viewPosition.z), 0.7, 2.8);
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      uniform vec3 uColor;
      void main() {
        vec2 centered = gl_PointCoord - vec2(0.5);
        float edge = 1.0 - smoothstep(0.08, 0.5, length(centered));
        if (edge <= 0.01) discard;
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
  sun.castShadow = quality === "cinematic";
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 260;
  sun.shadow.camera.left = -88;
  sun.shadow.camera.right = 88;
  sun.shadow.camera.top = 88;
  sun.shadow.camera.bottom = -88;
  sun.shadow.bias = -0.00015;
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
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vWorldPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPosition;
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 groundColor;
      uniform vec3 cloudColor;
      uniform float cloudCover;
      void main() {
        vec3 direction = normalize(vWorldPosition);
        float h = direction.y;
        vec3 color = h > 0.0
          ? mix(horizonColor, topColor, smoothstep(0.0, 0.72, h))
          : mix(horizonColor, groundColor, smoothstep(0.0, 0.32, -h));
        float bands = sin(direction.x * 19.0 + direction.z * 13.0) * 0.5 + 0.5;
        float clouds = smoothstep(0.44, 0.78, bands) * cloudCover * smoothstep(0.02, 0.45, h);
        gl_FragColor = vec4(mix(color, cloudColor, clouds * 0.48), 1.0);
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
  let effectSeconds = 0;
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
  const temporaryColor = new THREE.Color();

  const applyAtmosphere = (position: THREE.Vector3) => {
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

    skyMaterial.uniforms.topColor.value.copy(topColor);
    skyMaterial.uniforms.horizonColor.value.copy(horizonColor);
    skyMaterial.uniforms.groundColor.value.copy(groundColor);
    skyMaterial.uniforms.cloudColor.value.copy(cloudColor);
    skyMaterial.uniforms.cloudCover.value = displaySample.cloudCover;
    fog.color.copy(fogColor);
    fog.density = displaySample.fogDensity * (1 + displaySample.night * 0.08);
    (scene.background as THREE.Color).copy(fogColor).multiplyScalar(0.72);

    const useSun = displaySample.sunElevation > -0.06;
    const celestialAngle = displaySample.sunAzimuth;
    const horizontal = 116;
    const keyX = Math.cos(celestialAngle) * horizontal * (useSun ? 1 : -1);
    const keyZ = Math.sin(celestialAngle) * horizontal * (useSun ? 1 : -1);
    const keyY = useSun
      ? Math.max(7, displaySample.sunElevation * 126)
      : Math.max(28, -displaySample.sunElevation * 96);
    sun.position.set(position.x + keyX, position.y + keyY, position.z + keyZ);
    sunTarget.position.set(position.x, position.y, position.z);
    if (useSun) {
      temporaryColor.lerpColors(sunDay, sunDawn, displaySample.goldenHour * 0.86);
      sun.color.copy(temporaryColor);
      sun.intensity = 4.2 * displaySample.lightScale;
    } else {
      sun.color.copy(moonColor);
      sun.intensity = 0.34 * displaySample.night * (1 - displaySample.cloudCover * 0.52);
    }
    hemisphere.color.copy(topColor).lerp(dayHorizon, 0.34 * displaySample.daylight);
    hemisphere.groundColor.copy(groundColor).multiplyScalar(0.62);
    hemisphere.intensity = 0.32 + displaySample.lightScale * 1.96;
    renderer.toneMappingExposure = displaySample.exposure;

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
  };

  const runtime: EnvironmentRuntime = {
    sun,
    sunTarget,
    tick(position, deltaSeconds, running) {
      const safeDelta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
      if (running) {
        worldMinutes += safeDelta * GAME_MINUTES_PER_REAL_SECOND;
        effectSeconds += safeDelta;
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
      targetSample = sampleEnvironment(worldMinutes, climate);
      if (snap) displaySample = { ...targetSample };
    },
    setWorldMinutes(minutes) {
      worldMinutes = sanitizeWorldMinutes(minutes);
      targetSample = sampleEnvironment(worldMinutes, climate);
      displaySample = { ...targetSample };
    },
    getSample() {
      return { ...targetSample };
    },
    setQuality(nextQuality) {
      sun.castShadow = nextQuality === "cinematic";
      precipitation.points.geometry.setDrawRange(
        0,
        nextQuality === "cinematic"
          ? CINEMATIC_PRECIPITATION_POINTS
          : PERFORMANCE_PRECIPITATION_POINTS,
      );
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
    },
  };

  const openingPosition = new THREE.Vector3(0, 0, 8);
  runtime.setQuality(quality);
  runtime.sync(openingPosition, true);
  runtime.present(openingPosition, 0);
  return runtime;
}
