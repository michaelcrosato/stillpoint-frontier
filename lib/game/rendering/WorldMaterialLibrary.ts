import * as THREE from "three";
import type { EnvironmentVisualState } from "../environment";

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
}

interface TrackedMaterial {
  material: THREE.MeshStandardMaterial;
  descriptor: Required<WorldMaterialDescriptor>;
  dryRoughness: number;
  dryEnvironmentIntensity: number;
  references: number;
}

const DESCRIPTOR_KEY = "stillpointWorldMaterial";

const finiteOr = (value: number | undefined, fallback: number) =>
  Number.isFinite(value) ? (value as number) : fallback;

const unit = (value: number | undefined, fallback: number) =>
  THREE.MathUtils.clamp(finiteOr(value, fallback), 0, 1);

function normalizeDescriptor(
  descriptor: Readonly<WorldMaterialDescriptor>,
  dryRoughness = 1,
): Required<WorldMaterialDescriptor> {
  return {
    role: descriptor.role,
    weatherExposure: unit(descriptor.weatherExposure, 0),
    wetRoughness: unit(descriptor.wetRoughness, dryRoughness * 0.65),
    environmentScale: Math.max(0, finiteOr(descriptor.environmentScale, 1)),
    wetReflectionBoost: Math.max(
      0,
      finiteOr(descriptor.wetReflectionBoost, 0.35),
    ),
  };
}

export function tagWorldMaterial<T extends THREE.Material>(
  material: T,
  descriptor: Readonly<WorldMaterialDescriptor>,
) {
  material.userData[DESCRIPTOR_KEY] = normalizeDescriptor(descriptor);
  return material;
}

export function worldMaterialDescriptor(
  material: THREE.Material,
): Required<WorldMaterialDescriptor> | null {
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
 * to own and dispose their materials; this class only applies reversible PBR
 * presentation changes to explicitly tagged materials.
 */
export class WorldMaterialLibrary {
  private readonly tracked = new Map<THREE.Material, TrackedMaterial>();
  private readonly roots = new WeakMap<THREE.Object3D, Set<THREE.Material>>();
  private wetness = 0;
  private disposed = false;

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

    for (const material of materials) {
      const existing = this.tracked.get(material);
      if (existing) {
        existing.references += 1;
        continue;
      }
      const standard = material as THREE.MeshStandardMaterial;
      this.tracked.set(material, {
        material: standard,
        descriptor: worldMaterialDescriptor(material)!,
        dryRoughness: standard.roughness,
        dryEnvironmentIntensity: standard.envMapIntensity,
        references: 1,
      });
    }
    this.roots.set(root, materials);
    this.apply();
  }

  untrack(root: THREE.Object3D) {
    const materials = this.roots.get(root);
    if (!materials) return;
    this.roots.delete(root);
    for (const material of materials) {
      const tracked = this.tracked.get(material);
      if (!tracked) continue;
      tracked.references -= 1;
      if (tracked.references > 0) continue;
      tracked.material.roughness = tracked.dryRoughness;
      tracked.material.envMapIntensity = tracked.dryEnvironmentIntensity;
      this.tracked.delete(material);
    }
  }

  present(state: Pick<EnvironmentVisualState, "surfaceWetness">) {
    if (this.disposed) return;
    this.wetness = unit(state.surfaceWetness, 0);
    this.apply();
  }

  get diagnostics() {
    return { trackedMaterials: this.tracked.size, wetness: this.wetness };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const tracked of this.tracked.values()) {
      tracked.material.roughness = tracked.dryRoughness;
      tracked.material.envMapIntensity = tracked.dryEnvironmentIntensity;
    }
    this.tracked.clear();
  }

  private apply() {
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
    }
  }
}
