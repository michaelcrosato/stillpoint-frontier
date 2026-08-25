import * as THREE from "three";
import { QUALITY_PRESETS, type QualityLevel } from "../config";
import type { GraphicsFeatureState } from "./GraphicsFeatures";
import {
  installProceduralSurfaceDetail,
  surfaceDetailProfile,
  type InstalledSurfaceDetail,
  type ProceduralSurfaceDetailProfile,
} from "./ProceduralSurfaceDetail";
import {
  createVegetationShadowMaterials,
  installVegetationWind,
  vegetationWindStrength,
  type InstalledVegetationWind,
  type VegetationShadowMaterials,
} from "./VegetationWind";

export type WorldMaterialRole =
  | "terrain"
  | "road"
  | "rock"
  | "building"
  | "roof"
  | "metal"
  | "glass"
  | "vegetation"
  | "fabric"
  | "prop";

export interface WorldMaterialDescriptor {
  role: WorldMaterialRole;
  /** Outdoor exposure. Untagged materials and a value of zero stay dry. */
  weatherExposure?: number;
  /** Target roughness at full exposure and full wetness. */
  wetRoughness?: number;
  /** Per-role multiplier for image-based lighting. */
  environmentScale?: number;
  /** Additional image-based reflection at full wetness. */
  wetReflectionBoost?: number;
  /** False disables role-default procedural surface detail. */
  detail?: false | Partial<ProceduralSurfaceDetailProfile>;
  /** Maximum horizontal GPU vertex displacement at full wind. */
  windAmplitude?: number;
}

export interface ResolvedWorldMaterialDescriptor {
  role: WorldMaterialRole;
  weatherExposure: number;
  wetRoughness: number;
  environmentScale: number;
  wetReflectionBoost: number;
  detail: ProceduralSurfaceDetailProfile | null;
  windAmplitude: number;
}

interface TrackedMaterial {
  material: THREE.MeshStandardMaterial;
  descriptor: ResolvedWorldMaterialDescriptor;
  dryRoughness: number;
  dryEnvironmentIntensity: number;
  references: number;
  surfaceDetail: InstalledSurfaceDetail | null;
  vegetationWind: InstalledVegetationWind | null;
  shadowMaterials: VegetationShadowMaterials | null;
}

interface WindShadowBinding {
  mesh: THREE.Mesh;
  previousDepth: THREE.Material | undefined;
  previousDistance: THREE.Material | undefined;
  materials: VegetationShadowMaterials;
}

interface TrackedRoot {
  materials: Set<THREE.Material>;
  windShadows: WindShadowBinding[];
}

export interface WorldMaterialFeatureState {
  surfaceDetail: boolean;
  vegetationWind: boolean;
}

interface WorldMaterialEnvironmentInput {
  surfaceWetness: number;
  effectSeconds?: number;
  windKph?: number;
  windDirection?: number;
}

const DESCRIPTOR_KEY = "stillpointWorldMaterial";

const finiteOr = (value: number | undefined, fallback: number) =>
  Number.isFinite(value) ? (value as number) : fallback;

const unit = (value: number | undefined, fallback: number) =>
  THREE.MathUtils.clamp(finiteOr(value, fallback), 0, 1);

function normalizeDescriptor(
  descriptor: Readonly<WorldMaterialDescriptor>,
  dryRoughness = 1,
): ResolvedWorldMaterialDescriptor {
  const storedDetail = (
    descriptor as WorldMaterialDescriptor & {
      detail?: false | Partial<ProceduralSurfaceDetailProfile> | null;
    }
  ).detail;
  return {
    role: descriptor.role,
    weatherExposure: unit(descriptor.weatherExposure, 0),
    wetRoughness: unit(descriptor.wetRoughness, dryRoughness * 0.65),
    environmentScale: Math.max(0, finiteOr(descriptor.environmentScale, 1)),
    wetReflectionBoost: Math.max(
      0,
      finiteOr(descriptor.wetReflectionBoost, 0.35),
    ),
    detail: surfaceDetailProfile(
      descriptor.role,
      storedDetail === null ? false : storedDetail,
    ),
    windAmplitude: THREE.MathUtils.clamp(
      finiteOr(descriptor.windAmplitude, 0),
      0,
      1.5,
    ),
  };
}

export function tagWorldMaterial<T extends THREE.Material>(
  material: T,
  descriptor: Readonly<WorldMaterialDescriptor>,
) {
  material.userData[DESCRIPTOR_KEY] = normalizeDescriptor(
    descriptor,
    material instanceof THREE.MeshStandardMaterial ? material.roughness : 1,
  );
  return material;
}

export function worldMaterialDescriptor(
  material: THREE.Material,
): ResolvedWorldMaterialDescriptor | null {
  const value = material.userData[DESCRIPTOR_KEY] as
    | WorldMaterialDescriptor
    | undefined;
  if (!value || typeof value.role !== "string") return null;
  return normalizeDescriptor(
    value,
    material instanceof THREE.MeshStandardMaterial ? material.roughness : 1,
  );
}

/**
 * A non-owning registry for world-surface policy. Geometry factories continue
 * to own and dispose their materials. The library owns only reversible shader
 * hooks and the auxiliary depth materials required to match wind deformation.
 */
export class WorldMaterialLibrary {
  private readonly tracked = new Map<THREE.Material, TrackedMaterial>();
  private readonly roots = new Map<THREE.Object3D, TrackedRoot>();
  private wetness = 0;
  private effectSeconds = 0;
  private windKph = 0;
  private windDirection = 0;
  private quality: QualityLevel = "cinematic";
  private features: WorldMaterialFeatureState = {
    surfaceDetail: true,
    vegetationWind: true,
  };
  private disposed = false;

  track(root: THREE.Object3D) {
    if (this.disposed || this.roots.has(root)) return;
    const materials = new Set<THREE.Material>();
    const windMeshes: Array<{
      mesh: THREE.Mesh;
      material: THREE.MeshStandardMaterial;
    }> = [];
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const candidates = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of candidates) {
        const descriptor = worldMaterialDescriptor(material);
        if (!descriptor || !(material instanceof THREE.MeshStandardMaterial)) {
          continue;
        }
        materials.add(material);
        if (
          candidates.length === 1 &&
          descriptor.windAmplitude > 0 &&
          (object.castShadow || object.userData.shadowCandidate === true)
        ) {
          windMeshes.push({ mesh: object, material });
        }
      }
    });

    for (const material of materials) this.retainMaterial(material);

    const windShadows: WindShadowBinding[] = [];
    for (const { mesh, material } of windMeshes) {
      const tracked = this.tracked.get(material);
      const wind = tracked?.vegetationWind;
      if (!wind) continue;
      const shadowMaterials = tracked.shadowMaterials;
      if (!shadowMaterials) continue;
      const previousDepth = mesh.customDepthMaterial;
      const previousDistance = mesh.customDistanceMaterial;
      mesh.customDepthMaterial = shadowMaterials.depth;
      mesh.customDistanceMaterial = shadowMaterials.distance;
      windShadows.push({
        mesh,
        previousDepth,
        previousDistance,
        materials: shadowMaterials,
      });
    }
    this.roots.set(root, { materials, windShadows });
    this.apply();
  }

  untrack(root: THREE.Object3D) {
    const trackedRoot = this.roots.get(root);
    if (!trackedRoot) return;
    this.roots.delete(root);
    this.releaseWindShadows(trackedRoot.windShadows);
    for (const material of trackedRoot.materials) this.releaseMaterial(material);
  }

  present(state: WorldMaterialEnvironmentInput) {
    if (this.disposed) return;
    this.wetness = unit(state.surfaceWetness, 0);
    this.effectSeconds = Math.max(0, finiteOr(state.effectSeconds, this.effectSeconds));
    this.windKph = Math.max(0, finiteOr(state.windKph, this.windKph));
    this.windDirection = finiteOr(state.windDirection, this.windDirection);
    this.apply();
  }

  setFeatures(
    features: Pick<GraphicsFeatureState, "surfaceDetail" | "vegetationWind">,
  ) {
    if (this.disposed) return;
    this.features = {
      surfaceDetail: features.surfaceDetail,
      vegetationWind: features.vegetationWind,
    };
    this.apply();
  }

  setQuality(quality: QualityLevel) {
    if (this.disposed || this.quality === quality) return;
    this.quality = quality;
    this.apply();
  }

  get diagnostics() {
    let detailMaterials = 0;
    let windMaterials = 0;
    for (const tracked of this.tracked.values()) {
      if (tracked.surfaceDetail) detailMaterials += 1;
      if (tracked.vegetationWind) windMaterials += 1;
    }
    let windShadowMeshes = 0;
    for (const root of this.roots.values()) {
      windShadowMeshes += root.windShadows.length;
    }
    return {
      trackedMaterials: this.tracked.size,
      wetness: this.wetness,
      surfaceDetail: this.features.surfaceDetail,
      detailMaterials,
      vegetationWind: this.features.vegetationWind,
      windMaterials,
      windShadowMeshes,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const root of this.roots.values()) {
      this.releaseWindShadows(root.windShadows);
    }
    this.roots.clear();
    for (const tracked of this.tracked.values()) this.restoreMaterial(tracked);
    this.tracked.clear();
  }

  private retainMaterial(material: THREE.Material) {
    const existing = this.tracked.get(material);
    if (existing) {
      existing.references += 1;
      return;
    }
    if (!(material instanceof THREE.MeshStandardMaterial)) return;
    const descriptor = worldMaterialDescriptor(material);
    if (!descriptor) return;
    const surfaceDetail = descriptor.detail
      ? installProceduralSurfaceDetail(material, descriptor.detail)
      : null;
    const vegetationWind = descriptor.windAmplitude > 0
      ? installVegetationWind(material, descriptor.windAmplitude)
      : null;
    const shadowMaterials = vegetationWind
      ? createVegetationShadowMaterials(vegetationWind.uniforms)
      : null;
    this.tracked.set(material, {
      material,
      descriptor,
      dryRoughness: material.roughness,
      dryEnvironmentIntensity: material.envMapIntensity,
      references: 1,
      surfaceDetail,
      vegetationWind,
      shadowMaterials,
    });
  }

  private releaseMaterial(material: THREE.Material) {
    const tracked = this.tracked.get(material);
    if (!tracked) return;
    tracked.references -= 1;
    if (tracked.references > 0) return;
    this.restoreMaterial(tracked);
    this.tracked.delete(material);
  }

  private restoreMaterial(tracked: TrackedMaterial) {
    tracked.shadowMaterials?.dispose();
    tracked.vegetationWind?.dispose();
    tracked.surfaceDetail?.dispose();
    tracked.material.roughness = tracked.dryRoughness;
    tracked.material.envMapIntensity = tracked.dryEnvironmentIntensity;
  }

  private releaseWindShadows(bindings: readonly WindShadowBinding[]) {
    for (const binding of bindings) {
      if (binding.mesh.customDepthMaterial === binding.materials.depth) {
        binding.mesh.customDepthMaterial = binding.previousDepth;
      }
      if (binding.mesh.customDistanceMaterial === binding.materials.distance) {
        binding.mesh.customDistanceMaterial = binding.previousDistance;
      }
    }
  }

  private apply() {
    const worldEffects = QUALITY_PRESETS[this.quality].worldEffects;
    const windRadians = (this.windDirection * Math.PI) / 180;
    const windStrength = vegetationWindStrength(this.windKph);
    for (const tracked of this.tracked.values()) {
      const exposure = tracked.descriptor.weatherExposure * this.wetness;
      tracked.material.roughness = THREE.MathUtils.lerp(
        tracked.dryRoughness,
        tracked.descriptor.wetRoughness,
        exposure,
      );
      tracked.material.envMapIntensity =
        tracked.dryEnvironmentIntensity *
        tracked.descriptor.environmentScale *
        (1 + tracked.descriptor.wetReflectionBoost * exposure);

      if (tracked.surfaceDetail) {
        tracked.surfaceDetail.uniforms.uStillpointDetailEnabled.value =
          this.features.surfaceDetail
            ? worldEffects.surfaceDetailStrength
            : 0;
        tracked.surfaceDetail.uniforms.uStillpointSurfaceWetness.value = exposure;
      }
      if (tracked.vegetationWind) {
        const uniforms = tracked.vegetationWind.uniforms;
        uniforms.uStillpointWindEnabled.value =
          this.features.vegetationWind ? 1 : 0;
        uniforms.uStillpointWindTime.value = this.effectSeconds;
        uniforms.uStillpointWindDirection.value.set(
          Math.cos(windRadians),
          Math.sin(windRadians),
        );
        uniforms.uStillpointWindStrength.value =
          windStrength * worldEffects.vegetationWindStrength;
      }
    }
  }
}
