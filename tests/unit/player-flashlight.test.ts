import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  FLASHLIGHT_RANGE_METERS,
  PlayerFlashlight,
} from "../../lib/game/equipment/PlayerFlashlight";

describe("player phone flashlight", () => {
  it("tracks the camera, toggles two bounded beams, and scales shadows by quality", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const flashlight = new PlayerFlashlight(scene, "cinematic");
    const root = scene.getObjectByName("player-phone-light");
    const core = scene.getObjectByName("player-phone-light:core");
    const spill = scene.getObjectByName("player-phone-light:spill");
    expect(root).toBeInstanceOf(THREE.Group);
    expect(core).toBeInstanceOf(THREE.SpotLight);
    expect(spill).toBeInstanceOf(THREE.SpotLight);
    expect(root?.visible).toBe(false);
    expect(flashlight.diagnostics).toEqual({
      enabled: false,
      beams: 2,
      rangeMeters: FLASHLIGHT_RANGE_METERS,
      shadowsEnabled: false,
      quality: "cinematic",
    });

    expect(flashlight.setEnabled(true)).toBe(true);
    expect(flashlight.setEnabled(true)).toBe(false);
    expect(root?.visible).toBe(true);
    expect(core).toBeInstanceOf(THREE.SpotLight);
    expect(spill).toBeInstanceOf(THREE.SpotLight);
    if (!(core instanceof THREE.SpotLight) || !(spill instanceof THREE.SpotLight)) return;
    expect(core.distance).toBe(FLASHLIGHT_RANGE_METERS);
    expect(core.castShadow).toBe(true);
    expect(spill.castShadow).toBe(false);
    expect(core.shadow.mapSize.width).toBe(1024);
    expect(core.shadow.camera.far).toBe(FLASHLIGHT_RANGE_METERS);

    camera.position.set(12, 7, -19);
    camera.rotation.set(-0.18, 1.12, 0, "YXZ");
    flashlight.present(camera);
    expect(root?.position.toArray()).toEqual(camera.position.toArray());
    expect(root?.quaternion.angleTo(camera.quaternion)).toBeCloseTo(0);
    camera.updateMatrixWorld(true);
    const cameraForward = new THREE.Vector3();
    const corePosition = new THREE.Vector3();
    const targetPosition = new THREE.Vector3();
    camera.getWorldDirection(cameraForward);
    core.getWorldPosition(corePosition);
    core.target.getWorldPosition(targetPosition);
    expect(targetPosition.sub(corePosition).normalize().dot(cameraForward)).toBeGreaterThan(0.995);

    flashlight.setQuality("performance");
    expect(core.castShadow).toBe(false);
    expect(flashlight.diagnostics.quality).toBe("performance");
    flashlight.setQuality("cinematic");
    expect(core.castShadow).toBe(true);
    expect(flashlight.toggle()).toBe(false);
    expect(root?.visible).toBe(false);
    flashlight.prepareForCompile();
    expect(root?.visible).toBe(true);
    expect(core.castShadow).toBe(true);
    expect(core.intensity).toBe(0);
    flashlight.finishCompile();
    expect(root?.visible).toBe(false);
    expect(core.castShadow).toBe(false);
    expect(core.intensity).toBeGreaterThan(0);

    flashlight.dispose();
    flashlight.dispose();
    expect(scene.getObjectByName("player-phone-light")).toBeUndefined();
    expect(flashlight.setEnabled(true)).toBe(false);
  });
});
