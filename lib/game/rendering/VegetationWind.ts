import * as THREE from "three";

export const VEGETATION_WIND_ATTRIBUTE = "stillpointWindWeight";

export interface VegetationWindUniforms {
  uStillpointWindEnabled: { value: number };
  uStillpointWindTime: { value: number };
  uStillpointWindDirection: { value: THREE.Vector2 };
  uStillpointWindStrength: { value: number };
  uStillpointWindAmplitude: { value: number };
}

export interface InstalledVegetationWind {
  uniforms: VegetationWindUniforms;
  dispose(): void;
}

export interface VegetationShadowMaterials {
  depth: THREE.MeshDepthMaterial;
  distance: THREE.MeshDistanceMaterial;
  dispose(): void;
}

export function vegetationWindStrength(windKph: number) {
  if (!Number.isFinite(windKph) || windKph <= 2) return 0;
  const normalized = THREE.MathUtils.clamp((windKph - 2) / 48, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

/**
 * Adds a root-to-crown flexibility attribute and expands culling bounds by the
 * maximum horizontal sway. The geometry remains static on the CPU.
 */
export function prepareVegetationGeometry<T extends THREE.BufferGeometry>(
  geometry: T,
  maximumSwayMeters: number,
): T {
  const position = geometry.getAttribute("position");
  if (!position) return geometry;
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const minimumY = bounds?.min.y ?? 0;
  const height = Math.max(0.001, (bounds?.max.y ?? minimumY + 1) - minimumY);
  const weights = new Float32Array(position.count);
  for (let index = 0; index < position.count; index += 1) {
    const linear = THREE.MathUtils.clamp(
      (position.getY(index) - minimumY) / height,
      0,
      1,
    );
    weights[index] = linear * linear * (3 - 2 * linear);
  }
  geometry.setAttribute(
    VEGETATION_WIND_ATTRIBUTE,
    new THREE.BufferAttribute(weights, 1),
  );

  const sway = Number.isFinite(maximumSwayMeters)
    ? Math.max(0, maximumSwayMeters)
    : 0;
  geometry.computeBoundingBox();
  geometry.boundingBox?.min.add(new THREE.Vector3(-sway, 0, -sway));
  geometry.boundingBox?.max.add(new THREE.Vector3(sway, 0, sway));
  geometry.computeBoundingSphere();
  if (geometry.boundingSphere) geometry.boundingSphere.radius += sway;
  geometry.userData.stillpointMaximumWindSway = sway;
  return geometry;
}

function createUniforms(amplitude: number): VegetationWindUniforms {
  return {
    uStillpointWindEnabled: { value: 1 },
    uStillpointWindTime: { value: 0 },
    uStillpointWindDirection: { value: new THREE.Vector2(1, 0) },
    uStillpointWindStrength: { value: 0 },
    uStillpointWindAmplitude: {
      value: Number.isFinite(amplitude)
        ? THREE.MathUtils.clamp(amplitude, 0, 1.5)
        : 0,
    },
  };
}

const WIND_VERTEX_PARS = /* glsl */ `
attribute float stillpointWindWeight;
uniform float uStillpointWindEnabled;
uniform float uStillpointWindTime;
uniform vec2 uStillpointWindDirection;
uniform float uStillpointWindStrength;
uniform float uStillpointWindAmplitude;
`;

const WIND_VERTEX_BODY = /* glsl */ `
if (
  uStillpointWindEnabled > 0.5 &&
  uStillpointWindStrength > 0.0001 &&
  stillpointWindWeight > 0.0001
) {
  mat4 stillpointObjectToWorld = modelMatrix;
  #ifdef USE_INSTANCING
    stillpointObjectToWorld = modelMatrix * instanceMatrix;
  #endif
  vec3 stillpointWorldOrigin =
    (stillpointObjectToWorld * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 stillpointWorldWind = normalize(vec3(
    uStillpointWindDirection.x,
    0.0,
    uStillpointWindDirection.y
  ));
  mat3 stillpointWorldBasis = mat3(stillpointObjectToWorld);
  float stillpointAxisXLength = length(stillpointWorldBasis[0]);
  float stillpointAxisZLength = length(stillpointWorldBasis[2]);
  if (min(stillpointAxisXLength, stillpointAxisZLength) > 0.00001) {
    vec3 stillpointLocalWind = vec3(
      dot(
        stillpointWorldWind,
        stillpointWorldBasis[0] / stillpointAxisXLength
      ),
      0.0,
      dot(
        stillpointWorldWind,
        stillpointWorldBasis[2] / stillpointAxisZLength
      )
    );
    float stillpointLocalWindLength = length(stillpointLocalWind);
    if (stillpointLocalWindLength > 0.00001) {
      stillpointLocalWind /= stillpointLocalWindLength;
      vec3 stillpointLocalCross = vec3(
        -stillpointLocalWind.z,
        0.0,
        stillpointLocalWind.x
      );
      float stillpointPhase = dot(
        stillpointWorldOrigin.xz,
        vec2(0.071, 0.053)
      );
      float stillpointPrimary = sin(
        uStillpointWindTime * (0.72 + uStillpointWindStrength * 0.84) +
        stillpointPhase
      );
      float stillpointGust = sin(
        uStillpointWindTime * 1.91 +
        stillpointPhase * 1.73
      );
      float stillpointFlutter = sin(
        uStillpointWindTime * 3.35 +
        stillpointPhase * 2.47 +
        position.y * 0.82
      );
      float stillpointBend =
        (stillpointPrimary * 0.68 + stillpointGust * 0.24) *
        uStillpointWindAmplitude *
        uStillpointWindStrength *
        stillpointWindWeight;
      float stillpointSideBend =
        stillpointFlutter *
        uStillpointWindAmplitude *
        uStillpointWindStrength *
        stillpointWindWeight *
        0.13;
      transformed += stillpointLocalWind * stillpointBend;
      transformed += stillpointLocalCross * stillpointSideBend;
    }
  }
}
`;

function patchWindVertexShader(source: string) {
  return source
    .replace(
      "#include <common>",
      `#include <common>\n${WIND_VERTEX_PARS}`,
    )
    .replace(
      "#include <project_vertex>",
      `${WIND_VERTEX_BODY}\n#include <project_vertex>`,
    );
}

function installWindShader(
  material: THREE.Material,
  uniforms: VegetationWindUniforms,
) {
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey;
  const compile: THREE.Material["onBeforeCompile"] = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = patchWindVertexShader(shader.vertexShader);
  };
  const cacheKey = () =>
    `${previousCacheKey.call(material)}|stillpoint-vegetation-wind-v1`;
  material.onBeforeCompile = compile;
  material.customProgramCacheKey = cacheKey;
  material.needsUpdate = true;
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (material.onBeforeCompile === compile) {
      material.onBeforeCompile = previousCompile;
    }
    if (material.customProgramCacheKey === cacheKey) {
      material.customProgramCacheKey = previousCacheKey;
    }
    material.needsUpdate = true;
  };
}

export function installVegetationWind(
  material: THREE.MeshStandardMaterial,
  amplitude: number,
): InstalledVegetationWind {
  const uniforms = createUniforms(amplitude);
  const uninstall = installWindShader(material, uniforms);
  return { uniforms, dispose: uninstall };
}

export function createVegetationShadowMaterials(
  uniforms: VegetationWindUniforms,
): VegetationShadowMaterials {
  const depth = new THREE.MeshDepthMaterial();
  const distance = new THREE.MeshDistanceMaterial();
  const uninstallDepth = installWindShader(depth, uniforms);
  const uninstallDistance = installWindShader(distance, uniforms);
  return {
    depth,
    distance,
    dispose() {
      uninstallDistance();
      uninstallDepth();
      distance.dispose();
      depth.dispose();
    },
  };
}
