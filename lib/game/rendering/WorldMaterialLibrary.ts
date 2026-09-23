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
  createSharedWorldUniforms,
  renewSharedWorldBinding,
} from "./SharedWorldUniforms";
import {
  installVegetationWind,
  vegetationWindStrength,
  type InstalledVegetationWind,
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
  /** An authored envMap is left alone; otherwise the library assigns one. */
  ownEnvironmentMap: THREE.Texture | null;
  dryEnvironmentRotation: THREE.Euler;
  references: number;
  surfaceDetail: InstalledSurfaceDetail | null;
  vegetationWind: InstalledVegetationWind | null;
}

interface TrackedRoot {
  materials: Set<THREE.Material>;
}

export interface WorldMaterialFeatureState {
  surfaceDetail: boolean;
  vegetationWind: boolean;
  cloudShadows: boolean;
  wetSurfaces: boolean;
}

interface WorldMaterialEnvironmentInput {
  surfaceWetness: number;
  effectSeconds?: number;
  windKph?: number;
  windDirection?: number;
  cloudOffset?: Readonly<THREE.Vector2>;
  cloudCover?: number;
  daylight?: number;
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
 * hooks; shadow rendering deliberately stays on Three's native depth path.
 */
export class WorldMaterialLibrary {
  private readonly tracked = new Map<THREE.Material, TrackedMaterial>();
  private readonly roots = new Map<THREE.Object3D, TrackedRoot>();
  private wetness = 0;
  private effectSeconds = 0;
  private windKph = 0;
  private windDirection = 0;
  private readonly cloudOffset = new THREE.Vector2();
  private cloudCover = 0;
  private daylight = 1;
  private quality: QualityLevel = "cinematic";
  private features: WorldMaterialFeatureState = {
    surfaceDetail: true,
    vegetationWind: true,
    cloudShadows: true,
    wetSurfaces: true,
  };
  private disposed = false;
  /** One set of globally identical uniforms, referenced by every hook. */
  private readonly shared = createSharedWorldUniforms();
  /** Wetness last written to every material; null forces the next pass. */
  private appliedWetness: number | null = null;
  private environment: THREE.Texture | null = null;
  private environmentIntensity = 1;
  /** One rotation for every tracked environment map. */
  readonly environmentRotation = new THREE.Euler();

  /**
   * Registers the tagged materials under root as they are now. The set is a
   * snapshot: a material added to the tree later is not tracked until the
   * root is untracked and tracked again.
   */
  track(root: THREE.Object3D) {
    if (this.disposed || this.roots.has(root)) return;
    const materials = new Set<THREE.Material>();
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
      }
    });

    for (const material of materials) this.retainMaterial(material);
    this.roots.set(root, { materials });
  }

  untrack(root: THREE.Object3D) {
    const trackedRoot = this.roots.get(root);
    if (!trackedRoot) return;
    this.roots.delete(root);
    for (const material of trackedRoot.materials) this.releaseMaterial(material);
  }

  present(state: WorldMaterialEnvironmentInput) {
    if (this.disposed) return;
    this.wetness = unit(state.surfaceWetness, 0);
    this.effectSeconds = Math.max(0, finiteOr(state.effectSeconds, this.effectSeconds));
    this.windKph = Math.max(0, finiteOr(state.windKph, this.windKph));
    this.windDirection = finiteOr(state.windDirection, this.windDirection);
    if (state.cloudOffset) {
      this.cloudOffset.set(
        finiteOr(state.cloudOffset.x, this.cloudOffset.x),
        finiteOr(state.cloudOffset.y, this.cloudOffset.y),
      );
    }
    this.cloudCover = unit(state.cloudCover, this.cloudCover);
    this.daylight = unit(state.daylight, this.daylight);
    this.apply();
  }

  setFeatures(
    features: Pick<
      GraphicsFeatureState,
      "surfaceDetail" | "vegetationWind" | "cloudShadows" | "wetSurfaces"
    >,
  ) {
    if (this.disposed) return;
    const next = {
      surfaceDetail: features.surfaceDetail,
      vegetationWind: features.vegetationWind,
      cloudShadows: features.cloudShadows,
      wetSurfaces: features.wetSurfaces,
    };
    if (
      next.surfaceDetail === this.features.surfaceDetail &&
      next.vegetationWind === this.features.vegetationWind &&
      next.cloudShadows === this.features.cloudShadows &&
      next.wetSurfaces === this.features.wetSurfaces
    ) return;
    // Uniforms gate each effect, so only a change in which hooks are needed
    // rebuilds them. A rebuild re-keys every hooked material: it may have
    // rendered without its hooks meanwhile, and three binds hook uniforms
    // only when it compiles a key that is new to the material.
    const rebuild =
      this.needsSurfaceShader(next) !== this.needsSurfaceShader() ||
      next.vegetationWind !== this.features.vegetationWind;
    this.features = next;
    if (rebuild) {
      renewSharedWorldBinding(this.shared);
      for (const tracked of this.tracked.values()) {
        this.rebuildShaderHooks(tracked);
      }
      this.appliedWetness = null;
    }
    this.apply();
  }

  /**
   * The environment the tracked materials reflect, null while reflections are
   * off. Three uses a material's envMapIntensity only when the material has
   * its own envMap; one borrowed from scene.environment always gets
   * scene.environmentIntensity. So the library assigns the map itself, and
   * the per-role scale and wet boost apply on top of this quality intensity.
   */
  setEnvironment(texture: THREE.Texture | null, intensity: number) {
    if (this.disposed) return;
    const nextIntensity = Math.max(0, finiteOr(intensity, 0));
    if (texture === this.environment && nextIntensity === this.environmentIntensity) return;
    this.environment = texture;
    this.environmentIntensity = nextIntensity;
    this.appliedWetness = null;
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
    let cloudShadowMaterials = 0;
    let wetSurfaceMaterials = 0;
    for (const tracked of this.tracked.values()) {
      if (tracked.surfaceDetail && this.features.surfaceDetail) detailMaterials += 1;
      if (tracked.vegetationWind) windMaterials += 1;
      if (tracked.surfaceDetail && this.features.cloudShadows) {
        cloudShadowMaterials += 1;
      }
      if (tracked.surfaceDetail && this.features.wetSurfaces) {
        wetSurfaceMaterials += 1;
      }
    }
    return {
      trackedMaterials: this.tracked.size,
      wetness: this.wetness,
      surfaceDetail: this.features.surfaceDetail,
      detailMaterials,
      vegetationWind: this.features.vegetationWind,
      windMaterials,
      cloudShadows: this.features.cloudShadows,
      cloudShadowMaterials,
      wetSurfaces: this.features.wetSurfaces,
      wetSurfaceMaterials,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
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
    const surfaceDetail = this.needsSurfaceShader() && descriptor.detail
      ? installProceduralSurfaceDetail(material, descriptor.detail, this.shared)
      : null;
    const vegetationWind = this.features.vegetationWind && descriptor.windAmplitude > 0
      ? installVegetationWind(material, descriptor.windAmplitude, this.shared)
      : null;
    const tracked: TrackedMaterial = {
      material,
      descriptor,
      dryRoughness: material.roughness,
      dryEnvironmentIntensity: material.envMapIntensity,
      ownEnvironmentMap: material.envMap,
      dryEnvironmentRotation: material.envMapRotation,
      references: 1,
      surfaceDetail,
      vegetationWind,
    };
    if (!tracked.ownEnvironmentMap) material.envMapRotation = this.environmentRotation;
    this.tracked.set(material, tracked);
    // Streamed roots only need to initialize newly registered materials.
    this.apply([tracked]);
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
    this.removeShaderHooks(tracked);
    tracked.material.roughness = tracked.dryRoughness;
    tracked.material.envMapIntensity = tracked.dryEnvironmentIntensity;
    tracked.material.envMap = tracked.ownEnvironmentMap;
    tracked.material.envMapRotation = tracked.dryEnvironmentRotation;
  }

  /**
   * Hooks are a stack: surface detail is installed first and wind wraps it.
   * Always remove them in reverse order and rebuild the complete stack so an
   * independent feature toggle can never leave a stale callback underneath.
   */
  private rebuildShaderHooks(tracked: TrackedMaterial) {
    this.removeShaderHooks(tracked);
    if (this.needsSurfaceShader() && tracked.descriptor.detail) {
      tracked.surfaceDetail = installProceduralSurfaceDetail(
        tracked.material,
        tracked.descriptor.detail,
        this.shared,
      );
    }
    if (this.features.vegetationWind && tracked.descriptor.windAmplitude > 0) {
      tracked.vegetationWind = installVegetationWind(
        tracked.material,
        tracked.descriptor.windAmplitude,
        this.shared,
      );
    }
  }

  private removeShaderHooks(tracked: TrackedMaterial) {
    tracked.vegetationWind?.dispose();
    tracked.vegetationWind = null;
    tracked.surfaceDetail?.dispose();
    tracked.surfaceDetail = null;
  }

  private needsSurfaceShader(features: WorldMaterialFeatureState = this.features) {
    return features.surfaceDetail || features.cloudShadows || features.wetSurfaces;
  }

  /**
   * Globally identical values go to the shared uniforms: one write per frame.
   * Per-material values depend only on wetness, so the per-material pass runs
   * when the effective wetness changes, or for newly tracked materials.
   */
  private apply(materials?: Iterable<TrackedMaterial>) {
    this.applyShared();
    if (materials) {
      this.applyMaterials(materials);
      return;
    }
    const wetness = this.effectiveWetness();
    if (wetness === this.appliedWetness) return;
    this.appliedWetness = wetness;
    this.applyMaterials(this.tracked.values());
  }

  private effectiveWetness() {
    return this.features.wetSurfaces ? this.wetness : 0;
  }

  private applyShared() {
    const worldEffects = QUALITY_PRESETS[this.quality].worldEffects;
    const shared = this.shared;
    shared.uStillpointDetailEnabled.value = this.features.surfaceDetail
      ? worldEffects.surfaceDetailStrength
      : 0;
    shared.uStillpointCloudShadows.value = this.features.cloudShadows
      ? worldEffects.surfaceDetailStrength
      : 0;
    shared.uStillpointWetPooling.value = this.features.wetSurfaces
      ? worldEffects.surfaceDetailStrength
      : 0;
    shared.uStillpointCloudCover.value = this.cloudCover;
    shared.uStillpointDaylight.value = this.daylight;
    shared.uStillpointCloudOffset.value.copy(this.cloudOffset);
    const windRadians = (this.windDirection * Math.PI) / 180;
    shared.uStillpointWindEnabled.value = this.features.vegetationWind ? 1 : 0;
    shared.uStillpointWindTime.value = this.effectSeconds;
    shared.uStillpointWindDirection.value.set(Math.cos(windRadians), Math.sin(windRadians));
    shared.uStillpointWindStrength.value =
      vegetationWindStrength(this.windKph) * worldEffects.vegetationWindStrength;
  }

  private applyMaterials(materials: Iterable<TrackedMaterial>) {
    const wetness = this.effectiveWetness();
    for (const tracked of materials) {
      const exposure = tracked.descriptor.weatherExposure * wetness;
      tracked.material.roughness = THREE.MathUtils.lerp(
        tracked.dryRoughness,
        tracked.descriptor.wetRoughness,
        exposure,
      );
      tracked.material.envMapIntensity =
        tracked.dryEnvironmentIntensity *
        this.environmentIntensity *
        tracked.descriptor.environmentScale *
        (1 + tracked.descriptor.wetReflectionBoost * exposure);
      if (!tracked.ownEnvironmentMap) tracked.material.envMap = this.environment;
      if (tracked.surfaceDetail) {
        tracked.surfaceDetail.uniforms.uStillpointSurfaceWetness.value = exposure;
        tracked.surfaceDetail.uniforms.uStillpointWeatherExposure.value =
          tracked.descriptor.weatherExposure;
      }
    }
  }
}
