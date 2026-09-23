import * as THREE from "three";

/**
 * Uniforms whose value is the same for every world material. Installed shader
 * hooks reference these objects rather than owning copies, so one write per
 * frame reaches every program that uses them.
 */
export interface SharedWorldUniforms {
  uStillpointWindEnabled: { value: number };
  uStillpointWindTime: { value: number };
  uStillpointWindDirection: { value: THREE.Vector2 };
  uStillpointWindStrength: { value: number };
  uStillpointDetailEnabled: { value: number };
  uStillpointCloudShadows: { value: number };
  uStillpointCloudCover: { value: number };
  uStillpointCloudOffset: { value: THREE.Vector2 };
  uStillpointDaylight: { value: number };
  uStillpointWetPooling: { value: number };
}

export function createSharedWorldUniforms(): SharedWorldUniforms {
  return {
    uStillpointWindEnabled: { value: 1 },
    uStillpointWindTime: { value: 0 },
    uStillpointWindDirection: { value: new THREE.Vector2(1, 0) },
    uStillpointWindStrength: { value: 0 },
    uStillpointDetailEnabled: { value: 1 },
    uStillpointCloudShadows: { value: 0 },
    uStillpointCloudCover: { value: 0 },
    uStillpointCloudOffset: { value: new THREE.Vector2() },
    uStillpointDaylight: { value: 1 },
    uStillpointWetPooling: { value: 0 },
  };
}

let nextBindingId = 1;
const bindings = new WeakMap<SharedWorldUniforms, { id: number; epoch: number }>();

function binding(shared: SharedWorldUniforms) {
  let entry = bindings.get(shared);
  if (!entry) {
    entry = { id: nextBindingId, epoch: 0 };
    nextBindingId += 1;
    bindings.set(shared, entry);
  }
  return entry;
}

/**
 * Part of every hooked material's program key, so materials hooked through
 * the same record share programs. Three binds a material's uniforms only when
 * that material compiles a key it has not compiled before; returning to a
 * known key reuses whatever uniforms the material bound last.
 */
export function sharedWorldBindingKey(shared: SharedWorldUniforms) {
  const entry = binding(shared);
  return `${entry.id}.${entry.epoch}`;
}

/**
 * Re-keys every material hooked through this record. Call it when hooks are
 * rebuilt on materials that may have rendered without them: the new keys make
 * three run onBeforeCompile again and bind the hooks' uniforms.
 */
export function renewSharedWorldBinding(shared: SharedWorldUniforms) {
  binding(shared).epoch += 1;
}

/** Hooks installed without a library share this record. */
export const DEFAULT_SHARED_WORLD_UNIFORMS = createSharedWorldUniforms();
