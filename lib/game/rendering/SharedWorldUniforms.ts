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
