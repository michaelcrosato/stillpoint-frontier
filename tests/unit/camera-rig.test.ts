import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  CAMERA_FIRST_PERSON_THRESHOLD,
  CAMERA_ISOMETRIC_THRESHOLD,
  CAMERA_MAX_DISTANCE,
  CAMERA_VIEW_PRESETS,
  CameraRig,
  cameraDistanceForPreset,
  cameraModeForDistance,
  cycleCameraDistance,
  isCameraCollider,
  normalizeCameraDistance,
  normalizeIsometricAngle,
  zoomCameraDistance,
  type CameraCollisionWorld,
} from "../../lib/game/camera/CameraRig";
import type { PlanarCollider } from "../../lib/game/systems/collision";

function world(
  colliders: readonly PlanarCollider[] = [],
  sampleGroundHeight: CameraCollisionWorld["sampleGroundHeight"] = () => 0,
  sampleOverheadHeight: CameraCollisionWorld["sampleOverheadHeight"] = () => null,
): CameraCollisionWorld {
  return {
    sampleGroundHeight,
    sampleOverheadHeight,
    queryColliders: () => [...colliders],
  };
}

function present(
  rig: CameraRig,
  options: {
    colliders?: readonly PlanarCollider[];
    ground?: CameraCollisionWorld["sampleGroundHeight"];
    overhead?: CameraCollisionWorld["sampleOverheadHeight"];
    pitch?: number;
    yaw?: number;
    deltaSeconds?: number;
    snap?: boolean;
  } = {},
) {
  const playerCamera = new THREE.PerspectiveCamera(67, 16 / 9, 0.08, 4_800);
  playerCamera.position.set(10, 21.72, 20);
  playerCamera.rotation.set(options.pitch ?? 0, options.yaw ?? 0, 0, "YXZ");
  playerCamera.updateMatrixWorld(true);
  const renderCamera = new THREE.PerspectiveCamera(67, 16 / 9, 0.08, 4_800);
  const diagnostics = rig.present({
    playerCamera,
    renderCamera,
    world: world(options.colliders, options.ground, options.overhead),
    playerPosition: new THREE.Vector3(10, 20, 20),
    eyeHeight: 1.72,
    yaw: options.yaw ?? 0,
    pitch: options.pitch ?? 0,
    baseFov: 67,
    baseFar: 4_800,
    deltaSeconds: options.deltaSeconds ?? 1 / 60,
    snap: options.snap ?? true,
  });
  return { diagnostics, playerCamera, renderCamera };
}

describe("continuous camera view policy", () => {
  it("normalizes settings and derives stable semantic view bands", () => {
    expect(normalizeCameraDistance(Number.NaN)).toBe(0);
    expect(normalizeCameraDistance(-4)).toBe(0);
    expect(normalizeCameraDistance(400)).toBe(CAMERA_MAX_DISTANCE);
    expect(normalizeIsometricAngle(12)).toBe(45);
    expect(normalizeIsometricAngle(90)).toBe(70);
    expect(normalizeIsometricAngle(undefined)).toBe(56);

    expect(cameraModeForDistance(CAMERA_FIRST_PERSON_THRESHOLD)).toBe("firstPerson");
    expect(cameraModeForDistance(CAMERA_FIRST_PERSON_THRESHOLD + 0.01)).toBe("thirdPerson");
    expect(cameraModeForDistance(CAMERA_ISOMETRIC_THRESHOLD)).toBe("isometric");
  });

  it("cycles exact presets and maps inward scrolling through third to first person", () => {
    expect(cameraDistanceForPreset("thirdPerson")).toBe(6.5);
    expect(cycleCameraDistance(0)).toBe(CAMERA_VIEW_PRESETS.thirdPerson.distance);
    expect(cycleCameraDistance(6.5)).toBe(CAMERA_VIEW_PRESETS.isometric.distance);
    expect(cycleCameraDistance(32)).toBe(0);

    expect(zoomCameraDistance(0, 120)).toBeCloseTo(1.68);
    expect(zoomCameraDistance(0, 1)).toBeCloseTo(0.014);
    const nearFirstPerson = zoomCameraDistance(3.2, -120);
    expect(nearFirstPerson).toBeCloseTo(0.8288);
    expect(zoomCameraDistance(nearFirstPerson, -120)).toBe(0);
    expect(zoomCameraDistance(32, -120)).toBeLessThan(32);
    expect(zoomCameraDistance(32, 120)).toBeGreaterThan(32);
    expect(zoomCameraDistance(0, 480)).toBeCloseTo(6.72);
    expect(zoomCameraDistance(9, Number.NaN)).toBe(9);

    let distance = 32;
    for (let index = 0; index < 40; index += 1) {
      distance = zoomCameraDistance(distance, 240);
    }
    expect(distance).toBe(CAMERA_MAX_DISTANCE);
  });
});

describe("camera rig presentation", () => {
  it.each([-1.4, 1.2])("keeps pitch continuous on a tiny zoom at pitch %f", (pitch) => {
    const { renderCamera, playerCamera } = present(new CameraRig(zoomCameraDistance(0, 1)), { pitch });
    expect(renderCamera.quaternion.angleTo(playerCamera.quaternion)).toBeLessThan(0.001);
  });

  it("retains displaced aim projection while returning to first person", () => {
    const rig = new CameraRig(32);
    rig.setDistance(0);
    const frame = present(rig, { snap: false });
    expect(frame.diagnostics.mode).toBe("firstPerson");
    expect(frame.diagnostics.distance).toBeGreaterThan(20);
    expect(rig.projectGameplayAim(frame.playerCamera, frame.renderCamera)?.yPercent).not.toBeCloseTo(50);
  });
  it("preserves the exact player-eye transform at the first-person endpoint", () => {
    const { diagnostics, playerCamera, renderCamera } = present(new CameraRig(0));
    expect(diagnostics.mode).toBe("firstPerson");
    expect(diagnostics.distance).toBe(0);
    expect(renderCamera.position.toArray()).toEqual(playerCamera.position.toArray());
    expect(renderCamera.quaternion.toArray()).toEqual(playerCamera.quaternion.toArray());
    expect(renderCamera.fov).toBe(67);
    expect(renderCamera.near).toBe(0.08);
    expect(renderCamera.far).toBe(4_800);
  });

  it("eases continuously into the exact first-person endpoint", () => {
    const rig = new CameraRig(6.5);
    rig.setDistance(0);
    let previousDistance = 6.5;
    let lastPositiveDistance = previousDistance;
    let reachedEndpoint = false;
    for (let frame = 0; frame < 120; frame += 1) {
      const result = present(rig, { snap: false, deltaSeconds: 1 / 60 });
      expect(result.diagnostics.distance).toBeLessThanOrEqual(previousDistance);
      if (previousDistance < 0.6) {
        expect(previousDistance - result.diagnostics.distance).toBeLessThan(0.1);
      }
      if (result.diagnostics.distance === 0) {
        reachedEndpoint = true;
        break;
      }
      lastPositiveDistance = result.diagnostics.distance;
      previousDistance = result.diagnostics.distance;
    }
    expect(reachedEndpoint).toBe(true);
    expect(lastPositiveDistance).toBeLessThan(0.01);
  });

  it("provides a displaced third-person view and elevated isometric view", () => {
    const third = present(new CameraRig(6.5));
    expect(third.diagnostics.mode).toBe("thirdPerson");
    expect(third.diagnostics.distance).toBeCloseTo(6.5);
    expect(third.renderCamera.position.distanceTo(third.playerCamera.position)).toBeGreaterThan(6);
    expect(third.renderCamera.position.z).toBeGreaterThan(20);
    const thirdAim = new CameraRig(6.5);
    const thirdAimFrame = present(thirdAim);
    const thirdProjection = thirdAim.projectGameplayAim(
      thirdAimFrame.playerCamera,
      thirdAimFrame.renderCamera,
      8,
    );
    expect(thirdProjection?.visible).toBe(true);
    expect(thirdProjection?.xPercent).not.toBeCloseTo(50);

    const isometric = present(new CameraRig(32, 60));
    expect(isometric.diagnostics.mode).toBe("isometric");
    expect(isometric.diagnostics.isometricAngleDegrees).toBe(60);
    expect(isometric.diagnostics.effectiveFov).toBe(48);
    expect(isometric.renderCamera.position.y).toBeGreaterThan(45);
    expect(isometric.renderCamera.rotation.x).toBeCloseTo(-Math.PI / 3, 5);
    expect(isometric.renderCamera.far).toBeCloseTo(4_832);
    const isometricRig = new CameraRig(32, 60);
    const isometricAimFrame = present(isometricRig);
    expect(isometricRig.projectGameplayAim(
      isometricAimFrame.playerCamera,
      isometricAimFrame.renderCamera,
      Number.NaN,
    )?.visible).toBe(true);
  });

  it("retracts immediately at a height-aware building and releases smoothly", () => {
    const wall: PlanarCollider = {
      shape: "box",
      id: "camera-wall",
      x: 10,
      z: 23,
      halfWidth: 3,
      halfDepth: 0.25,
      rotation: 0,
      minY: 18,
      maxY: 24,
    };
    const rig = new CameraRig(6.5);
    const blocked = present(rig, { colliders: [wall] });
    expect(blocked.diagnostics.collisionLimited).toBe(true);
    expect(blocked.diagnostics.distance).toBeGreaterThan(1);
    expect(blocked.diagnostics.distance).toBeLessThan(3);

    const released = present(rig, { snap: false, deltaSeconds: 1 / 60 });
    expect(released.diagnostics.collisionLimited).toBe(false);
    expect(released.diagnostics.distance).toBeGreaterThan(blocked.diagnostics.distance);
    expect(released.diagnostics.distance).toBeLessThan(6.5);
  });

  it("keeps collision active throughout the near first-person transition band", () => {
    const nearWall: PlanarCollider = {
      shape: "box",
      id: "near-camera-wall",
      x: 10,
      z: 20.72,
      halfWidth: 2,
      halfDepth: 0.08,
      rotation: 0,
      minY: 20,
      maxY: 24,
    };
    const result = present(new CameraRig(1), { colliders: [nearWall] });
    expect(result.diagnostics.mode).toBe("firstPerson");
    expect(result.diagnostics.collisionLimited).toBe(true);
    expect(result.diagnostics.distance).toBeLessThan(0.5);
  });

  it("keeps an obstructed isometric camera aimed at its player-eye focus", () => {
    const nearWall: PlanarCollider = {
      shape: "box",
      id: "isometric-near-wall",
      x: 10,
      z: 20.6,
      halfWidth: 2,
      halfDepth: 0.12,
      rotation: 0,
      minY: 20,
      maxY: 25,
    };
    const result = present(new CameraRig(32, 60), { colliders: [nearWall] });
    expect(result.diagnostics.mode).toBe("isometric");
    expect(result.diagnostics.collisionLimited).toBe(true);
    expect(result.diagnostics.distance).toBeLessThan(1);
    expect(result.diagnostics.effectiveFov).toBeCloseTo(67);
    expect(result.renderCamera.near).toBeCloseTo(0.08);
    expect(result.renderCamera.position.distanceTo(result.playerCamera.position))
      .toBeLessThan(1);
    const forward = new THREE.Vector3();
    result.renderCamera.getWorldDirection(forward);
    const toFocus = result.playerCamera.position.clone()
      .sub(result.renderCamera.position)
      .normalize();
    expect(forward.dot(toFocus)).toBeGreaterThan(0.999);
  });

  it("keeps the player-eye focus centered after a partial isometric retraction", () => {
    const wall: PlanarCollider = {
      shape: "box",
      id: "isometric-mid-boom-wall",
      x: 10,
      z: 22.7,
      halfWidth: 2,
      halfDepth: 0.1,
      rotation: 0,
      minY: 20,
      maxY: 40,
    };
    const result = present(new CameraRig(32, 56), { colliders: [wall] });
    expect(result.diagnostics.collisionLimited).toBe(true);
    expect(result.diagnostics.distance).toBeGreaterThan(3);
    expect(result.diagnostics.distance).toBeLessThan(7);
    const forward = new THREE.Vector3();
    result.renderCamera.getWorldDirection(forward);
    const toFocus = result.playerCamera.position.clone()
      .sub(result.renderCamera.position)
      .normalize();
    expect(forward.dot(toFocus)).toBeGreaterThan(0.999);
    const focusNdc = result.playerCamera.position.clone().project(result.renderCamera);
    expect(Math.abs(focusNdc.x)).toBeLessThan(0.01);
    expect(Math.abs(focusNdc.y)).toBeLessThan(0.01);
  });

  it("stays above terrain along a descending camera boom", () => {
    const rig = new CameraRig(6.5);
    const result = present(rig, { pitch: 0.4, ground: () => 20 });
    expect(result.diagnostics.collisionLimited).toBe(true);
    expect(result.renderCamera.position.y).toBeGreaterThanOrEqual(20);
  });

  it("stays below an authored floor crossed by an elevated camera boom", () => {
    const overheadY = 23.5;
    const result = present(new CameraRig(32, 60), {
      overhead: () => overheadY,
    });
    expect(result.diagnostics.collisionLimited).toBe(true);
    expect(result.diagnostics.distance).toBeLessThan(4);
    expect(result.renderCamera.position.y).toBeLessThanOrEqual(overheadY - 0.22);

    const opening = present(new CameraRig(32, 60), {
      overhead: () => null,
    });
    expect(opening.diagnostics.collisionLimited).toBe(false);
    expect(opening.diagnostics.distance).toBe(32);
  });

  it("uses only finite height-aware colliders for the camera boom", () => {
    expect(isCameraCollider({
      shape: "circle",
      id: "bounded",
      x: 0,
      z: 0,
      radius: 1,
      minY: 0,
      maxY: 2,
    })).toBe(true);
    expect(isCameraCollider({
      shape: "circle",
      id: "legacy-planar",
      x: 0,
      z: 0,
      radius: 1,
    })).toBe(false);
  });
});
