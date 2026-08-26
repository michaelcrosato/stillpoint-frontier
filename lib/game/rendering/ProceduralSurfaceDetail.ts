import * as THREE from "three";
import type { WorldMaterialRole } from "./WorldMaterialLibrary";

export const SURFACE_DETAIL_PERIOD_METERS = 256;
const surfaceDetailInstallGenerations = new WeakMap<THREE.Material, number>();

export interface ProceduralSurfaceDetailProfile {
  frequency: number;
  colorStrength: number;
  roughnessStrength: number;
  normalStrength: number;
  fadeStart: number;
  fadeEnd: number;
}

export interface ProceduralSurfaceDetailUniforms {
  uStillpointDetailEnabled: { value: number };
  uStillpointDetailFrequency: { value: number };
  uStillpointDetailColor: { value: number };
  uStillpointDetailRoughness: { value: number };
  uStillpointDetailNormal: { value: number };
  uStillpointDetailFade: { value: THREE.Vector2 };
  uStillpointSurfaceWetness: { value: number };
  uStillpointCloudShadows: { value: number };
  uStillpointCloudCover: { value: number };
  uStillpointDaylight: { value: number };
  uStillpointWetPooling: { value: number };
  uStillpointCloudOffset: { value: THREE.Vector2 };
  uStillpointWeatherExposure: { value: number };
}

export interface InstalledSurfaceDetail {
  uniforms: ProceduralSurfaceDetailUniforms;
  dispose(): void;
}

const ROLE_PROFILES: Readonly<
  Partial<Record<WorldMaterialRole, ProceduralSurfaceDetailProfile>>
> = {
  terrain: {
    frequency: 192,
    colorStrength: 0.075,
    roughnessStrength: 0.12,
    normalStrength: 0.055,
    fadeStart: 24,
    fadeEnd: 230,
  },
  road: {
    frequency: 320,
    colorStrength: 0.065,
    roughnessStrength: 0.15,
    normalStrength: 0.045,
    fadeStart: 18,
    fadeEnd: 175,
  },
  rock: {
    frequency: 384,
    colorStrength: 0.09,
    roughnessStrength: 0.16,
    normalStrength: 0.085,
    fadeStart: 16,
    fadeEnd: 145,
  },
  building: {
    frequency: 128,
    colorStrength: 0.048,
    roughnessStrength: 0.1,
    normalStrength: 0.035,
    fadeStart: 24,
    fadeEnd: 190,
  },
  roof: {
    frequency: 192,
    colorStrength: 0.06,
    roughnessStrength: 0.13,
    normalStrength: 0.045,
    fadeStart: 20,
    fadeEnd: 205,
  },
  metal: {
    frequency: 256,
    colorStrength: 0.025,
    roughnessStrength: 0.07,
    normalStrength: 0.018,
    fadeStart: 14,
    fadeEnd: 110,
  },
  fabric: {
    frequency: 256,
    colorStrength: 0.035,
    roughnessStrength: 0.08,
    normalStrength: 0.025,
    fadeStart: 10,
    fadeEnd: 90,
  },
  prop: {
    frequency: 192,
    colorStrength: 0.035,
    roughnessStrength: 0.08,
    normalStrength: 0.025,
    fadeStart: 12,
    fadeEnd: 105,
  },
};

const finiteClamp = (
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) =>
  Number.isFinite(value)
    ? THREE.MathUtils.clamp(value as number, minimum, maximum)
    : fallback;

export function surfaceDetailProfile(
  role: WorldMaterialRole,
  override?: Partial<ProceduralSurfaceDetailProfile> | false,
): ProceduralSurfaceDetailProfile | null {
  if (override === false) return null;
  const base = ROLE_PROFILES[role];
  if (!base) return null;
  const fadeStart = finiteClamp(override?.fadeStart, base.fadeStart, 0, 500);
  return {
    // Quarter-frequency harmonics must also complete an integer number of
    // cycles so wrapping the camera every 256 m remains visually seamless.
    frequency: Math.round(
      finiteClamp(override?.frequency, base.frequency, 32, 1_024) / 4,
    ) * 4,
    colorStrength: finiteClamp(
      override?.colorStrength,
      base.colorStrength,
      0,
      0.2,
    ),
    roughnessStrength: finiteClamp(
      override?.roughnessStrength,
      base.roughnessStrength,
      0,
      0.35,
    ),
    normalStrength: finiteClamp(
      override?.normalStrength,
      base.normalStrength,
      0,
      0.2,
    ),
    fadeStart,
    fadeEnd: Math.max(
      fadeStart + 1,
      finiteClamp(override?.fadeEnd, base.fadeEnd, 1, 600),
    ),
  };
}

export function wrapSurfaceDetailCoordinate(value: number) {
  if (!Number.isFinite(value)) return 0;
  return (
    (value % SURFACE_DETAIL_PERIOD_METERS) + SURFACE_DETAIL_PERIOD_METERS
  ) % SURFACE_DETAIL_PERIOD_METERS;
}

function createUniforms(
  profile: ProceduralSurfaceDetailProfile,
): ProceduralSurfaceDetailUniforms {
  return {
    uStillpointDetailEnabled: { value: 1 },
    uStillpointDetailFrequency: { value: profile.frequency },
    uStillpointDetailColor: { value: profile.colorStrength },
    uStillpointDetailRoughness: { value: profile.roughnessStrength },
    uStillpointDetailNormal: { value: profile.normalStrength },
    uStillpointDetailFade: {
      value: new THREE.Vector2(profile.fadeStart, profile.fadeEnd),
    },
    uStillpointSurfaceWetness: { value: 0 },
    uStillpointCloudShadows: { value: 0 },
    uStillpointCloudCover: { value: 0 },
    uStillpointDaylight: { value: 1 },
    uStillpointWetPooling: { value: 0 },
    uStillpointCloudOffset: { value: new THREE.Vector2() },
    uStillpointWeatherExposure: { value: 1 },
  };
}

const SURFACE_DETAIL_PARS = /* glsl */ `
uniform float uStillpointDetailEnabled;
uniform float uStillpointDetailFrequency;
uniform float uStillpointDetailColor;
uniform float uStillpointDetailRoughness;
uniform float uStillpointDetailNormal;
uniform vec2 uStillpointDetailFade;
uniform float uStillpointSurfaceWetness;
uniform float uStillpointCloudShadows;
uniform float uStillpointCloudCover;
uniform float uStillpointDaylight;
uniform float uStillpointWetPooling;
uniform vec2 uStillpointCloudOffset;
uniform float uStillpointWeatherExposure;

float stillpointPlaneDetail(vec2 point, float frequency) {
  const float stillpointTau = 6.28318530718;
  vec2 periodic = point * (stillpointTau / 256.0);
  float broad = sin(
    periodic.x * frequency +
    sin(periodic.y * frequency * 0.5) * 1.35
  );
  float crossing = sin(
    periodic.y * frequency * 0.75 -
    cos(periodic.x * frequency * 0.25) * 1.8
  );
  float grain = sin(
    (periodic.x + periodic.y) * frequency * 1.5 + broad * 0.7
  );
  return clamp(0.5 + broad * 0.23 + crossing * 0.18 + grain * 0.09, 0.0, 1.0);
}

float stillpointSurfaceDetail(vec3 worldPosition, float frequency) {
  vec3 dx = dFdx(worldPosition);
  vec3 dy = dFdy(worldPosition);
  vec3 geometricNormal = abs(normalize(cross(dx, dy)));
  geometricNormal = max(pow(geometricNormal, vec3(4.0)), vec3(0.0001));
  geometricNormal /= geometricNormal.x + geometricNormal.y + geometricNormal.z;
  return
    stillpointPlaneDetail(worldPosition.yz, frequency) * geometricNormal.x +
    stillpointPlaneDetail(worldPosition.xz, frequency) * geometricNormal.y +
    stillpointPlaneDetail(worldPosition.xy, frequency) * geometricNormal.z;
}

float stillpointCloudField(vec2 point) {
  const float stillpointTau = 6.28318530718;
  vec2 periodic = point * (stillpointTau / 2048.0);
  float broad = sin(periodic.x * 6.0 + sin(periodic.y * 3.0) * 1.7);
  float crossing = sin(periodic.y * 9.0 - cos(periodic.x * 4.0) * 1.25);
  float detail = sin((periodic.x + periodic.y) * 13.0 + broad * 0.82);
  return clamp(0.5 + broad * 0.24 + crossing * 0.17 + detail * 0.09, 0.0, 1.0);
}
`;

const SURFACE_DETAIL_COLOR = /* glsl */ `
vec3 stillpointViewWorld = (vec4(-vViewPosition, 0.0) * viewMatrix).xyz;
float stillpointDetailDistance = length(stillpointViewWorld);
vec3 stillpointWrappedCamera =
  mod(mod(cameraPosition, 256.0) + 256.0, 256.0);
vec3 stillpointDetailPosition = stillpointViewWorld + stillpointWrappedCamera;
float stillpointDetailValue = 0.5;
float stillpointDetailAmount = 0.0;
float stillpointCenteredDetail = 0.0;
float stillpointWetPoolAmount = 0.0;
float stillpointFootprint = max(
  length(dFdx(stillpointViewWorld)),
  length(dFdy(stillpointViewWorld))
) * uStillpointDetailFrequency / 256.0;
if (
  uStillpointDetailEnabled > 0.0001 &&
  stillpointDetailDistance < uStillpointDetailFade.y
) {
  stillpointDetailValue = stillpointSurfaceDetail(
    stillpointDetailPosition,
    uStillpointDetailFrequency
  );
  float stillpointDistanceFade = 1.0 - smoothstep(
    uStillpointDetailFade.x,
    uStillpointDetailFade.y,
    stillpointDetailDistance
  );
  float stillpointAliasFade =
    1.0 - smoothstep(0.32, 1.2, stillpointFootprint);
  stillpointDetailAmount =
    uStillpointDetailEnabled * stillpointDistanceFade * stillpointAliasFade;
  stillpointCenteredDetail = stillpointDetailValue * 2.0 - 1.0;
  diffuseColor.rgb *= 1.0 +
    stillpointCenteredDetail * uStillpointDetailColor * stillpointDetailAmount;
}

if (
  uStillpointCloudShadows > 0.0001 &&
  uStillpointCloudCover > 0.04 &&
  stillpointDetailDistance < 432.0
) {
  vec3 stillpointCloudCamera =
    mod(mod(cameraPosition, 2048.0) + 2048.0, 2048.0);
  vec2 stillpointCloudPoint =
    (stillpointViewWorld + stillpointCloudCamera).xz -
    uStillpointCloudOffset * 4.0;
  float stillpointCloud = stillpointCloudField(stillpointCloudPoint);
  float stillpointCloudThreshold = mix(0.77, 0.39, uStillpointCloudCover);
  float stillpointCloudMask = smoothstep(
    stillpointCloudThreshold,
    stillpointCloudThreshold + 0.18,
    stillpointCloud
  );
  float stillpointCloudFade = 1.0 - smoothstep(
    240.0,
    432.0,
    stillpointDetailDistance
  );
  float stillpointCloudAmount =
    stillpointCloudMask *
    smoothstep(0.04, 0.48, uStillpointCloudCover) *
    uStillpointDaylight *
    uStillpointWeatherExposure *
    uStillpointCloudShadows *
    stillpointCloudFade;
  diffuseColor.rgb *= 1.0 - stillpointCloudAmount * 0.18;
}

if (
  uStillpointWetPooling > 0.0001 &&
  uStillpointSurfaceWetness > 0.015 &&
  stillpointDetailDistance < 210.0
) {
  vec3 stillpointPoolDx = dFdx(stillpointDetailPosition);
  vec3 stillpointPoolDy = dFdy(stillpointDetailPosition);
  vec3 stillpointPoolNormal = cross(stillpointPoolDx, stillpointPoolDy);
  float stillpointPoolNormalLength = max(length(stillpointPoolNormal), 0.0001);
  float stillpointUpFacing = abs(stillpointPoolNormal.y / stillpointPoolNormalLength);
  float stillpointPoolField = stillpointPlaneDetail(
    stillpointDetailPosition.xz,
    24.0
  );
  stillpointWetPoolAmount =
    smoothstep(0.59, 0.82, stillpointPoolField) *
    smoothstep(0.68, 0.96, stillpointUpFacing) *
    uStillpointSurfaceWetness *
    uStillpointWetPooling *
    (1.0 - smoothstep(110.0, 210.0, stillpointDetailDistance));
  diffuseColor.rgb *= 1.0 - stillpointWetPoolAmount * 0.085;
}
`;

const SURFACE_DETAIL_ROUGHNESS = /* glsl */ `
roughnessFactor = clamp(
  roughnessFactor +
    stillpointCenteredDetail *
    uStillpointDetailRoughness *
    stillpointDetailAmount *
    (1.0 - uStillpointSurfaceWetness * 0.45),
  0.04,
  1.0
);
roughnessFactor = mix(
  roughnessFactor,
  max(0.04, roughnessFactor * 0.38),
  stillpointWetPoolAmount * 0.76
);
`;

const SURFACE_DETAIL_NORMAL = /* glsl */ `
vec3 stillpointDpdx = mat3(viewMatrix) * dFdx(stillpointDetailPosition);
vec3 stillpointDpdy = mat3(viewMatrix) * dFdy(stillpointDetailPosition);
float stillpointDhdx = dFdx(stillpointDetailValue);
float stillpointDhdy = dFdy(stillpointDetailValue);
if (
  stillpointDetailAmount > 0.0001 &&
  uStillpointDetailNormal > 0.0001
) {
  vec3 stillpointR1 = cross(stillpointDpdy, normal);
  vec3 stillpointR2 = cross(normal, stillpointDpdx);
  float stillpointDeterminant = dot(stillpointDpdx, stillpointR1);
  vec3 stillpointGradient = sign(stillpointDeterminant) *
    (stillpointDhdx * stillpointR1 + stillpointDhdy * stillpointR2);
  float stillpointNormalAmount =
    uStillpointDetailNormal *
    stillpointDetailAmount *
    (1.0 - uStillpointSurfaceWetness * 0.35);
  normal = normalize(
    abs(stillpointDeterminant) * normal -
    stillpointNormalAmount * stillpointGradient
  );
}
`;

function patchFragmentShader(source: string) {
  return source
    .replace(
      "#include <common>",
      `#include <common>\n${SURFACE_DETAIL_PARS}`,
    )
    .replace(
      "#include <color_fragment>",
      `#include <color_fragment>\n${SURFACE_DETAIL_COLOR}`,
    )
    .replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>\n${SURFACE_DETAIL_ROUGHNESS}`,
    )
    .replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>\n${SURFACE_DETAIL_NORMAL}`,
    );
}

/** Installs a reversible fragment-only detail layer on one PBR material. */
export function installProceduralSurfaceDetail(
  material: THREE.MeshStandardMaterial,
  profile: ProceduralSurfaceDetailProfile,
): InstalledSurfaceDetail {
  const uniforms = createUniforms(profile);
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey;
  const installGeneration =
    (surfaceDetailInstallGenerations.get(material) ?? 0) + 1;
  surfaceDetailInstallGenerations.set(material, installGeneration);
  const compile: THREE.Material["onBeforeCompile"] = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = patchFragmentShader(shader.fragmentShader);
  };
  const cacheKey = () =>
    `${previousCacheKey.call(material)}|stillpoint-surface-detail-v2-${installGeneration}`;
  material.onBeforeCompile = compile;
  material.customProgramCacheKey = cacheKey;
  material.needsUpdate = true;

  let disposed = false;
  return {
    uniforms,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (material.onBeforeCompile === compile) {
        material.onBeforeCompile = previousCompile;
      }
      if (material.customProgramCacheKey === cacheKey) {
        material.customProgramCacheKey = previousCacheKey;
      }
      material.needsUpdate = true;
    },
  };
}
