import * as THREE from "three";
import type { QualityLevel } from "../config";

export const FLASHLIGHT_RANGE_METERS = 48;
const CORE_INTENSITY = 190;
const SPILL_INTENSITY = 22;

/**
 * A phone-sized field light built from two static spot beams. The narrow core
 * carries cinematic shadows while the broad spill keeps nearby ground legible.
 * The complete rig follows the camera as one rigid transform, so it needs no
 * skeletal animation, physics, or per-object state.
 */
export class PlayerFlashlight {
  private readonly root = new THREE.Group();
  private readonly coreTarget = new THREE.Object3D();
  private readonly spillTarget = new THREE.Object3D();
  private readonly core = new THREE.SpotLight(
    0xfff1d6,
    CORE_INTENSITY,
    FLASHLIGHT_RANGE_METERS,
    THREE.MathUtils.degToRad(17),
    0.42,
    1.45,
  );
  private readonly spill = new THREE.SpotLight(
    0xdde9ff,
    SPILL_INTENSITY,
    11,
    THREE.MathUtils.degToRad(34),
    0.86,
    2,
  );
  private readonly cameraWorldPosition = new THREE.Vector3();
  private readonly cameraWorldQuaternion = new THREE.Quaternion();
  private enabled = false;
  private quality: QualityLevel;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    quality: QualityLevel,
  ) {
    this.quality = quality;
    this.root.name = "player-phone-light";
    this.root.visible = false;
    this.root.position.set(0, 0, 0);

    this.core.name = "player-phone-light:core";
    this.core.position.set(0.1, -0.09, -0.08);
    this.coreTarget.name = "player-phone-light:core-target";
    this.coreTarget.position.set(0, -0.025, -12);
    this.core.target = this.coreTarget;
    this.core.shadow.mapSize.set(1024, 1024);
    this.core.shadow.camera.near = 0.12;
    this.core.shadow.camera.far = FLASHLIGHT_RANGE_METERS;
    this.core.shadow.bias = -0.00018;
    this.core.shadow.normalBias = 0.035;
    this.core.shadow.radius = 2;

    this.spill.name = "player-phone-light:spill";
    this.spill.position.set(0.1, -0.09, -0.06);
    this.spillTarget.name = "player-phone-light:spill-target";
    this.spillTarget.position.set(0, -0.06, -10);
    this.spill.target = this.spillTarget;
    this.spill.castShadow = false;

    this.root.add(this.core, this.coreTarget, this.spill, this.spillTarget);
    this.scene.add(this.root);
    this.setQuality(quality);
  }

  setEnabled(enabled: boolean) {
    if (this.disposed) return false;
    const next = Boolean(enabled);
    if (next === this.enabled) return false;
    this.enabled = next;
    this.applyRuntimeState();
    return true;
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  setQuality(quality: QualityLevel) {
    if (this.disposed) return;
    this.quality = quality;
    this.applyRuntimeState();
  }

  present(camera: THREE.PerspectiveCamera) {
    if (this.disposed) return;
    camera.getWorldPosition(this.cameraWorldPosition);
    camera.getWorldQuaternion(this.cameraWorldQuaternion);
    this.root.position.copy(this.cameraWorldPosition);
    this.root.quaternion.copy(this.cameraWorldQuaternion);
    this.root.updateMatrixWorld(true);
  }

  /** Precompile the spotlight shader path without flashing the entry scene. */
  prepareForCompile() {
    if (this.disposed) return;
    this.root.visible = true;
    this.core.castShadow = this.quality === "cinematic";
    this.core.intensity = 0;
    this.spill.intensity = 0;
  }

  finishCompile() {
    if (this.disposed) return;
    this.core.intensity = CORE_INTENSITY;
    this.spill.intensity = SPILL_INTENSITY;
    this.applyRuntimeState();
  }

  get isEnabled() {
    return this.enabled;
  }

  get diagnostics() {
    return {
      enabled: this.enabled,
      beams: 2,
      rangeMeters: FLASHLIGHT_RANGE_METERS,
      shadowsEnabled: this.core.castShadow,
      quality: this.quality,
    } as const;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    this.scene.remove(this.root);
    this.root.clear();
    this.core.dispose();
    this.spill.dispose();
  }

  private applyRuntimeState() {
    this.root.visible = this.enabled;
    this.core.castShadow = this.enabled && this.quality === "cinematic";
  }
}
