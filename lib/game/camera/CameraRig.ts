import * as THREE from "three";
import {
  firstColliderSegmentHitFraction,
  firstOverheadSegmentHitFraction,
  firstTerrainSegmentHitFraction,
  type PlanarCollider,
  type SpatialPosition,
} from "../systems/collision";

export const CAMERA_VIEW_MODES = [
  "firstPerson",
  "thirdPerson",
  "isometric",
] as const;

export type CameraViewMode = (typeof CAMERA_VIEW_MODES)[number];

export const CAMERA_MIN_DISTANCE = 0;
export const CAMERA_MAX_DISTANCE = 96;
export const CAMERA_FIRST_PERSON_THRESHOLD = 1.15;
export const CAMERA_ISOMETRIC_THRESHOLD = 15;
export const CAMERA_ISOMETRIC_ANGLE_MIN = 45;
export const CAMERA_ISOMETRIC_ANGLE_MAX = 70;
export const DEFAULT_ISOMETRIC_ANGLE = 56;

export const CAMERA_VIEW_PRESETS: Readonly<
  Record<CameraViewMode, { label: string; distance: number; description: string }>
> = Object.freeze({
  firstPerson: {
    label: "FIRST PERSON",
    distance: 0,
    description: "Eye-level field view",
  },
  thirdPerson: {
    label: "THIRD PERSON",
    distance: 6.5,
    description: "Over-shoulder follow view",
  },
  isometric: {
    label: "ISOMETRIC",
    distance: 32,
    description: "Elevated survey view",
  },
});

export interface CameraRigDiagnostics {
  mode: CameraViewMode;
  targetDistance: number;
  distance: number;
  collisionLimited: boolean;
  isometricAngleDegrees: number;
  effectiveFov: number;
}

export interface CameraAimProjection {
  visible: boolean;
  xPercent: number;
  yPercent: number;
}

export interface CameraCollisionWorld {
  sampleGroundHeight(x: number, z: number, referenceY?: number): number;
  /** Lowest authored support at or above the inclusive local sweep bound. */
  sampleOverheadHeight(x: number, z: number, minimumY: number): number | null;
  queryColliders(
    current: { x: number; z: number },
    desired: { x: number; z: number },
    radius: number,
    minY: number,
    maxY: number,
  ): readonly PlanarCollider[];
}

export interface CameraRigFrame {
  playerCamera: THREE.PerspectiveCamera;
  renderCamera: THREE.PerspectiveCamera;
  world: CameraCollisionWorld;
  playerPosition: Readonly<THREE.Vector3>;
  eyeHeight: number;
  yaw: number;
  pitch: number;
  baseFov: number;
  baseFar: number;
  deltaSeconds: number;
  snap?: boolean;
}

const CAMERA_COLLISION_RADIUS = 0.22;
const CAMERA_COLLISION_SKIN = 0.18;
const CAMERA_TERRAIN_SPACING = 0.55;
const CAMERA_ENDPOINT_EPSILON = 0.005;
const THIRD_PERSON_SHOULDER_OFFSET = 0.5;
const THIRD_PERSON_VERTICAL_OFFSET = 0.18;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothstep(minimum: number, maximum: number, value: number) {
  if (maximum <= minimum) return value >= maximum ? 1 : 0;
  const normalized = clamp((value - minimum) / (maximum - minimum), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function damp(current: number, target: number, lambda: number, deltaSeconds: number) {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return current;
  return THREE.MathUtils.lerp(
    current,
    target,
    1 - Math.exp(-lambda * Math.min(deltaSeconds, 0.1)),
  );
}

export function normalizeCameraDistance(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, CAMERA_MIN_DISTANCE, CAMERA_MAX_DISTANCE)
    : CAMERA_VIEW_PRESETS.firstPerson.distance;
}

export function normalizeIsometricAngle(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, CAMERA_ISOMETRIC_ANGLE_MIN, CAMERA_ISOMETRIC_ANGLE_MAX)
    : DEFAULT_ISOMETRIC_ANGLE;
}

export function cameraModeForDistance(distance: number): CameraViewMode {
  const safe = normalizeCameraDistance(distance);
  if (safe <= CAMERA_FIRST_PERSON_THRESHOLD) return "firstPerson";
  if (safe < CAMERA_ISOMETRIC_THRESHOLD) return "thirdPerson";
  return "isometric";
}

export function cameraDistanceForPreset(mode: CameraViewMode) {
  return CAMERA_VIEW_PRESETS[mode].distance;
}

export function cycleCameraDistance(distance: number) {
  const mode = cameraModeForDistance(distance);
  const index = CAMERA_VIEW_MODES.indexOf(mode);
  return cameraDistanceForPreset(
    CAMERA_VIEW_MODES[(index + 1) % CAMERA_VIEW_MODES.length],
  );
}

/**
 * Browser wheel deltas vary between stepped wheels and trackpads. Distance-
 * scaled linear motion preserves fine control at the player and accelerates
 * across the wide isometric range without a discontinuity at either view
 * boundary.
 */
export function zoomCameraDistance(distance: number, wheelDeltaY: number) {
  const current = normalizeCameraDistance(distance);
  if (!Number.isFinite(wheelDeltaY) || Math.abs(wheelDeltaY) < 0.01) return current;
  const delta = clamp(wheelDeltaY, -480, 480);
  const metersPerDelta = 0.014 + current * 0.0018;
  return normalizeCameraDistance(current + delta * metersPerDelta);
}

export function isCameraCollider(collider: Readonly<PlanarCollider>) {
  return collider.minY !== undefined &&
    collider.maxY !== undefined &&
    Number.isFinite(collider.minY) &&
    Number.isFinite(collider.maxY);
}

function directionFromYawPitch(yaw: number, pitch: number, target: THREE.Vector3) {
  const cosinePitch = Math.cos(pitch);
  return target.set(
    -Math.sin(yaw) * cosinePitch,
    Math.sin(pitch),
    -Math.cos(yaw) * cosinePitch,
  );
}

export class CameraRig {
  private targetDistance: number;
  private smoothedDistance: number;
  private presentedDistance: number;
  private isometricAngleDegrees: number;
  private readonly focus = new THREE.Vector3();
  private readonly desiredPosition = new THREE.Vector3();
  private readonly presentedPosition = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly aimPoint = new THREE.Vector3();
  private readonly aimDirection = new THREE.Vector3();
  private readonly viewDirection = new THREE.Vector3();
  private readonly cameraToAim = new THREE.Vector3();
  private diagnosticsState: CameraRigDiagnostics;

  constructor(distance = 0, isometricAngleDegrees = DEFAULT_ISOMETRIC_ANGLE) {
    this.targetDistance = normalizeCameraDistance(distance);
    this.smoothedDistance = this.targetDistance;
    this.presentedDistance = this.targetDistance;
    this.isometricAngleDegrees = normalizeIsometricAngle(isometricAngleDegrees);
    this.diagnosticsState = {
      mode: cameraModeForDistance(this.targetDistance),
      targetDistance: this.targetDistance,
      distance: this.presentedDistance,
      collisionLimited: false,
      isometricAngleDegrees: this.isometricAngleDegrees,
      effectiveFov: 67,
    };
  }

  get diagnostics(): CameraRigDiagnostics {
    return { ...this.diagnosticsState };
  }

  setDistance(distance: number, snap = false) {
    this.targetDistance = normalizeCameraDistance(distance);
    if (snap) {
      this.smoothedDistance = this.targetDistance;
      this.presentedDistance = this.targetDistance;
    }
    this.diagnosticsState = {
      ...this.diagnosticsState,
      mode: cameraModeForDistance(this.targetDistance),
      targetDistance: this.targetDistance,
      distance: snap ? this.targetDistance : this.diagnosticsState.distance,
      collisionLimited: this.targetDistance <= 0.0001
        ? false
        : this.diagnosticsState.collisionLimited,
    };
    return this.targetDistance;
  }

  setIsometricAngle(angleDegrees: number) {
    this.isometricAngleDegrees = normalizeIsometricAngle(angleDegrees);
    this.diagnosticsState = {
      ...this.diagnosticsState,
      isometricAngleDegrees: this.isometricAngleDegrees,
    };
    return this.isometricAngleDegrees;
  }

  /**
   * Projects the player-eye aim ray through the displaced render camera. The
   * reticle keeps interaction and scanner intent visible without moving their
   * authoritative origin behind the player or into the sky.
   */
  projectGameplayAim(
    playerCamera: THREE.PerspectiveCamera,
    renderCamera: THREE.PerspectiveCamera,
    distance = 8,
  ): CameraAimProjection | null {
    const safeDistance = Number.isFinite(distance)
      ? clamp(distance, 1, 24)
      : 8;
    playerCamera.updateMatrixWorld(true);
    renderCamera.updateMatrixWorld(true);
    playerCamera.getWorldDirection(this.aimDirection);
    this.aimPoint
      .copy(playerCamera.position)
      .addScaledVector(this.aimDirection, safeDistance);
    this.cameraToAim.copy(this.aimPoint).sub(renderCamera.position).normalize();
    renderCamera.getWorldDirection(this.viewDirection);
    const inFront = this.cameraToAim.dot(this.viewDirection) > 0;
    this.aimPoint.project(renderCamera);
    if (
      !Number.isFinite(this.aimPoint.x) ||
      !Number.isFinite(this.aimPoint.y) ||
      !Number.isFinite(this.aimPoint.z)
    ) {
      return null;
    }
    return {
      visible: inFront && this.aimPoint.z >= -1 && this.aimPoint.z <= 1,
      xPercent: clamp(50 + this.aimPoint.x * 50, 8, 92),
      yPercent: clamp(50 - this.aimPoint.y * 50, 8, 88),
    };
  }

  present(frame: CameraRigFrame): CameraRigDiagnostics {
    const safeDelta = Number.isFinite(frame.deltaSeconds)
      ? Math.max(0, frame.deltaSeconds)
      : 0;
    if (frame.snap) {
      this.smoothedDistance = this.targetDistance;
      this.presentedDistance = this.targetDistance;
    } else {
      this.smoothedDistance = damp(
        this.smoothedDistance,
        this.targetDistance,
        9,
        safeDelta,
      );
      if (
        this.targetDistance === 0 &&
        this.smoothedDistance < CAMERA_ENDPOINT_EPSILON
      ) {
        this.smoothedDistance = 0;
      }
    }

    const mode = cameraModeForDistance(this.targetDistance);
    const isoBlend = smoothstep(
      CAMERA_ISOMETRIC_THRESHOLD * 0.72,
      CAMERA_ISOMETRIC_THRESHOLD * 1.75,
      this.smoothedDistance,
    );
    const thirdPersonPitch = THREE.MathUtils.lerp(
      frame.pitch,
      clamp(frame.pitch, -1.08, 0.58),
      smoothstep(0, 3.2, this.smoothedDistance),
    );
    const isometricPitch = -THREE.MathUtils.degToRad(this.isometricAngleDegrees);
    const visualPitch = THREE.MathUtils.lerp(
      thirdPersonPitch,
      isometricPitch,
      isoBlend,
    );
    const separationBlend = smoothstep(
      CAMERA_FIRST_PERSON_THRESHOLD,
      3.2,
      this.smoothedDistance,
    );
    this.focus.set(
      frame.playerPosition.x,
      frame.playerPosition.y + frame.eyeHeight,
      frame.playerPosition.z,
    );
    directionFromYawPitch(frame.yaw, visualPitch, this.forward);
    this.right.set(Math.cos(frame.yaw), 0, -Math.sin(frame.yaw));
    this.desiredPosition
      .copy(this.focus)
      .addScaledVector(this.forward, -this.smoothedDistance)
      .addScaledVector(
        this.right,
        THIRD_PERSON_SHOULDER_OFFSET * separationBlend * (1 - isoBlend),
      );
    this.desiredPosition.y +=
      THIRD_PERSON_VERTICAL_OFFSET * separationBlend * (1 - isoBlend);

    let collisionDistance = this.smoothedDistance;
    let collisionLimited = false;
    if (this.smoothedDistance > 0.0001) {
      const minimumY = Math.min(this.focus.y, this.desiredPosition.y);
      const maximumY = Math.max(this.focus.y, this.desiredPosition.y);
      const colliders = frame.world.queryColliders(
        this.focus,
        this.desiredPosition,
        CAMERA_COLLISION_RADIUS,
        minimumY - CAMERA_COLLISION_RADIUS,
        maximumY + CAMERA_COLLISION_RADIUS,
      ).filter(isCameraCollider);
      const origin: SpatialPosition = this.focus;
      const target: SpatialPosition = this.desiredPosition;
      const colliderHit = firstColliderSegmentHitFraction(
        origin,
        target,
        colliders,
        CAMERA_COLLISION_RADIUS,
      );
      const terrainHit = firstTerrainSegmentHitFraction(
        origin,
        target,
        (x, z) => frame.world.sampleGroundHeight(x, z, frame.playerPosition.y),
        CAMERA_COLLISION_RADIUS,
        CAMERA_TERRAIN_SPACING,
      );
      const overheadHit = firstOverheadSegmentHitFraction(
        origin,
        target,
        (x, z, minimumY) => frame.world.sampleOverheadHeight(x, z, minimumY),
        CAMERA_COLLISION_RADIUS,
        CAMERA_TERRAIN_SPACING,
      );
      const hit = Math.min(
        colliderHit ?? 1,
        terrainHit ?? 1,
        overheadHit ?? 1,
      );
      if (hit < 1) {
        collisionLimited = true;
        collisionDistance = Math.max(
          0,
          this.smoothedDistance * hit - CAMERA_COLLISION_SKIN,
        );
      }
    }

    if (frame.snap || collisionLimited || collisionDistance < this.presentedDistance) {
      this.presentedDistance = collisionDistance;
    } else {
      this.presentedDistance = damp(
        this.presentedDistance,
        collisionDistance,
        6.5,
        safeDelta,
      );
    }
    if (
      this.targetDistance === 0 &&
      this.presentedDistance < CAMERA_ENDPOINT_EPSILON
    ) {
      this.presentedDistance = 0;
    }

    const presentedScale = this.smoothedDistance > 0.0001
      ? this.presentedDistance / this.smoothedDistance
      : 0;
    this.presentedPosition
      .copy(this.focus)
      .lerp(this.desiredPosition, presentedScale);

    const presentedIsoBlend = smoothstep(
      CAMERA_ISOMETRIC_THRESHOLD * 0.72,
      CAMERA_ISOMETRIC_THRESHOLD * 1.75,
      this.presentedDistance,
    );
    const effectiveFov = THREE.MathUtils.lerp(
      frame.baseFov,
      Math.min(frame.baseFov, 48),
      presentedIsoBlend,
    );
    const effectiveFar = frame.baseFar + this.presentedDistance;
    const effectiveNear = Math.min(
      THREE.MathUtils.lerp(0.08, 0.32, presentedIsoBlend),
      Math.max(0.08, this.presentedDistance * 0.35),
    );

    if (this.presentedDistance <= 0.0001) {
      frame.renderCamera.position.copy(frame.playerCamera.position);
      frame.renderCamera.quaternion.copy(frame.playerCamera.quaternion);
    } else {
      frame.renderCamera.position.copy(this.presentedPosition);
      // Collision shortens the clear requested boom; it does not redefine the
      // requested view. Keep rotation on that same ray so the focus cannot
      // drift offscreen while a wall or ceiling retracts the camera.
      frame.renderCamera.rotation.set(visualPitch, frame.yaw, 0, "YXZ");
    }
    const projectionChanged =
      Math.abs(frame.renderCamera.fov - effectiveFov) > 0.001 ||
      Math.abs(frame.renderCamera.far - effectiveFar) > 0.001 ||
      Math.abs(frame.renderCamera.near - effectiveNear) > 0.001;
    frame.renderCamera.fov = effectiveFov;
    frame.renderCamera.far = effectiveFar;
    frame.renderCamera.near = effectiveNear;
    if (projectionChanged) frame.renderCamera.updateProjectionMatrix();
    frame.renderCamera.updateMatrixWorld(true);

    this.diagnosticsState = {
      mode,
      targetDistance: this.targetDistance,
      distance: this.presentedDistance,
      collisionLimited,
      isometricAngleDegrees: this.isometricAngleDegrees,
      effectiveFov,
    };
    return this.diagnostics;
  }
}
