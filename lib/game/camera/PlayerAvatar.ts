import * as THREE from "three";
import { PLAYER_HEIGHT, qualityUsesShadows, type QualityLevel } from "../config";
import {
  NO_SHADOW_INVALIDATOR,
  type ShadowInvalidator,
} from "../rendering/ShadowUpdatePolicy";
import type { CameraRigDiagnostics } from "./CameraRig";

export const AVATAR_FADE_START_DISTANCE = 0.65;
export const AVATAR_FADE_END_DISTANCE = 2.25;

export function avatarOpacityForDistance(distance: number) {
  if (!Number.isFinite(distance)) return 0;
  return THREE.MathUtils.smoothstep(
    distance,
    AVATAR_FADE_START_DISTANCE,
    AVATAR_FADE_END_DISTANCE,
  );
}

/**
 * A deliberately rigid, low-poly field silhouette for displaced camera views.
 * It follows the project's no-skeletal-animation rule and adds no simulation
 * state, targets, collision, or persistence.
 */
export class PlayerAvatar {
  readonly root = new THREE.Group();
  private readonly materials: THREE.MeshStandardMaterial[];
  private castsShadows = false;
  private casting = false;
  private opacity = 0;

  constructor(
    scene: THREE.Scene,
    quality: QualityLevel,
    /** Told when the avatar's contribution to the sun's shadow changes. */
    private readonly shadowInvalidator: ShadowInvalidator = NO_SHADOW_INVALIDATOR,
  ) {
    this.root.name = "player-avatar";
    this.root.visible = false;

    const field = new THREE.MeshStandardMaterial({
      color: 0x343a38,
      roughness: 0.88,
      metalness: 0.04,
      flatShading: true,
    });
    const cloth = new THREE.MeshStandardMaterial({
      color: 0x676358,
      roughness: 0.96,
      metalness: 0.01,
      flatShading: true,
    });
    const signal = new THREE.MeshStandardMaterial({
      color: 0xb86737,
      emissive: 0x4a1f0c,
      emissiveIntensity: 0.48,
      roughness: 0.62,
      metalness: 0.1,
      flatShading: true,
    });
    this.materials = [field, cloth, signal];

    const add = (
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      position: readonly [number, number, number],
    ) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.receiveShadow = true;
      this.root.add(mesh);
      return mesh;
    };

    add(new THREE.CapsuleGeometry(0.25, 0.58, 3, 8), field, [0, 1.12, 0]);
    add(new THREE.SphereGeometry(0.2, 10, 6), cloth, [0, 1.61, 0]);
    add(new THREE.BoxGeometry(0.4, 0.54, 0.18), cloth, [0, 1.18, 0.24]);
    add(new THREE.BoxGeometry(0.2, 0.12, 0.055), signal, [0, 1.31, 0.345]);
    add(new THREE.CylinderGeometry(0.105, 0.12, 0.7, 7), field, [-0.14, 0.4, 0]);
    add(new THREE.CylinderGeometry(0.105, 0.12, 0.7, 7), field, [0.14, 0.4, 0]);
    this.setQuality(quality);
    scene.add(this.root);
  }

  present(
    position: Readonly<THREE.Vector3>,
    yaw: number,
    eyeHeight: number,
    camera: Readonly<CameraRigDiagnostics>,
  ) {
    // Follow the presented boom, not its requested label. The short opacity
    // handoff prevents a full opaque body from popping into a near camera.
    const opacity = avatarOpacityForDistance(camera.distance);
    this.opacity = opacity;
    this.root.visible = opacity > 0.001;
    for (const material of this.materials) {
      const transparent = opacity < 0.999;
      if (material.transparent !== transparent) material.needsUpdate = true;
      material.transparent = transparent;
      material.opacity = opacity;
      material.depthWrite = !transparent;
    }
    this.applyCasting();
    if (!this.root.visible) return;
    const scaleY = THREE.MathUtils.clamp(eyeHeight / PLAYER_HEIGHT, 0.72, 1);
    if (
      this.casting &&
      (!this.root.position.equals(position) ||
        this.root.rotation.y !== yaw ||
        this.root.scale.y !== scaleY)
    ) {
      this.shadowInvalidator.markDirty("avatar");
    }
    this.root.position.copy(position);
    this.root.rotation.set(0, yaw, 0);
    this.root.scale.set(1, scaleY, 1);
  }

  setQuality(quality: QualityLevel) {
    this.castsShadows = qualityUsesShadows(quality);
    this.applyCasting();
  }

  private applyCasting() {
    const casting = this.castsShadows && this.opacity >= 0.999;
    if (casting === this.casting) return;
    this.casting = casting;
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = casting;
    });
    this.shadowInvalidator.markDirty("avatar");
  }

  dispose() {
    this.root.removeFromParent();
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    this.materials.forEach((material) => material.dispose());
  }
}
