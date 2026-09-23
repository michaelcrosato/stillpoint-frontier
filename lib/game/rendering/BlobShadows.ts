import * as THREE from "three";

/** Lift above the ground so the blob wins the depth test on flat terrain. */
export const BLOB_SHADOW_LIFT = 0.03;

/**
 * Blob radius per unit of body footprint. The shader holds a blob above half
 * strength only within about half its radius, so a blob twice the footprint
 * shows around the feet instead of hiding under the body.
 */
export const BLOB_FOOTPRINT_SPREAD = 2;

/** Half the larger horizontal extent of a geometry: its footprint radius. */
export function footprintRadius(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return 0.3;
  return Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
}

export interface BlobShadowOptions {
  name: string;
  capacity: number;
  /** Distance where fading begins, and where the blob is gone. */
  fadeStart: number;
  fadeEnd: number;
  opacity?: number;
}

const VERTEX_SHADER = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float blobStrength;
varying vec2 vBlobUv;
varying float vBlobStrength;
void main() {
  vBlobUv = uv;
  vBlobStrength = blobStrength;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const FRAGMENT_SHADER = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform float uOpacity;
varying vec2 vBlobUv;
varying float vBlobStrength;
void main() {
  #include <logdepthbuf_fragment>
  float radius = length(vBlobUv - 0.5) * 2.0;
  float falloff = 1.0 - smoothstep(0.25, 1.0, radius);
  gl_FragColor = vec4(0.0, 0.0, 0.0, falloff * falloff * uOpacity * vBlobStrength);
}
`;

/**
 * Soft contact shadows for agents that do not cast into the shadow map, drawn
 * as one instanced, depth-tested but non-writing quad per agent. Each frame:
 * begin(view), add() each agent, end(). Agents past fadeEnd get no blob.
 */
export class BlobShadows {
  readonly mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly strengths: THREE.InstancedBufferAttribute;
  private readonly view = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private count = 0;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly options: Readonly<BlobShadowOptions>,
  ) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    this.strengths = new THREE.InstancedBufferAttribute(new Float32Array(options.capacity), 1);
    this.strengths.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("blobStrength", this.strengths);
    const material = new THREE.ShaderMaterial({
      name: "BlobShadow",
      uniforms: { uOpacity: { value: options.opacity ?? 0.34 } },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, options.capacity);
    this.mesh.name = options.name;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.userData.shadow = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  begin(viewPosition: Readonly<THREE.Vector3>) {
    this.view.copy(viewPosition);
    this.count = 0;
  }

  /** Adds one agent's blob; false when it is too far away or the layer is full. */
  add(x: number, groundY: number, z: number, radius: number) {
    if (this.disposed || this.count >= this.options.capacity) return false;
    if (![x, groundY, z, radius].every(Number.isFinite) || radius <= 0) return false;
    const distance = Math.hypot(x - this.view.x, groundY - this.view.y, z - this.view.z);
    const strength = 1 - THREE.MathUtils.smoothstep(distance, this.options.fadeStart, this.options.fadeEnd);
    if (strength <= 0) return false;
    this.matrix.makeScale(radius * 2, 1, radius * 2).setPosition(x, groundY + BLOB_SHADOW_LIFT, z);
    this.mesh.setMatrixAt(this.count, this.matrix);
    this.strengths.setX(this.count, strength);
    this.count += 1;
    return true;
  }

  end() {
    if (this.disposed) return;
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.strengths.needsUpdate = true;
    if (this.count > 0) this.mesh.computeBoundingSphere();
  }

  strengthAt(index: number) {
    return this.strengths.getX(index);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.mesh);
    this.mesh.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
