import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  AVATAR_FADE_END_DISTANCE,
  AVATAR_FADE_START_DISTANCE,
  PlayerAvatar,
  avatarOpacityForDistance,
} from "../../lib/game/camera/PlayerAvatar";
import type { CameraRigDiagnostics } from "../../lib/game/camera/CameraRig";

const diagnostics = (
  mode: CameraRigDiagnostics["mode"],
  distance: number,
): CameraRigDiagnostics => ({
  mode,
  targetDistance: distance,
  distance,
  collisionLimited: false,
  isometricAngleDegrees: 56,
  effectiveFov: 67,
});

describe("rigid player avatar", () => {
  it("appears only for displaced views and follows the player root", () => {
    const scene = new THREE.Scene();
    const avatar = new PlayerAvatar(scene, "performance");
    avatar.present(new THREE.Vector3(4, 8, -2), 0.75, 1.72, diagnostics("firstPerson", 0));
    expect(avatar.root.visible).toBe(false);

    avatar.present(new THREE.Vector3(4, 8, -2), 0.75, 1.72, diagnostics("thirdPerson", 6.5));
    expect(avatar.root.visible).toBe(true);
    expect(avatar.root.position.toArray()).toEqual([4, 8, -2]);
    expect(avatar.root.rotation.y).toBeCloseTo(0.75);

    avatar.setQuality("ultra");
    avatar.root.traverse((object) => {
      if (object instanceof THREE.Mesh) expect(object.castShadow).toBe(true);
    });
    const disposeGeometry = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    avatar.dispose();
    expect(avatar.root.parent).toBeNull();
    expect(disposeGeometry).toHaveBeenCalledTimes(6);
    disposeGeometry.mockRestore();
  });

  it("fades monotonically when collision contracts the boom into the player", () => {
    const avatar = new PlayerAvatar(new THREE.Scene(), "cinematic");
    avatar.present(
      new THREE.Vector3(),
      0,
      1.2,
      diagnostics("thirdPerson", AVATAR_FADE_START_DISTANCE),
    );
    expect(avatar.root.visible).toBe(false);

    const midpoint = (AVATAR_FADE_START_DISTANCE + AVATAR_FADE_END_DISTANCE) * 0.5;
    avatar.present(new THREE.Vector3(), 0, 1.72, diagnostics("thirdPerson", midpoint));
    expect(avatar.root.visible).toBe(true);
    const material = (avatar.root.children[0] as THREE.Mesh)
      .material as THREE.MeshStandardMaterial;
    expect(material.opacity).toBeCloseTo(0.5);
    expect(material.transparent).toBe(true);
    expect((avatar.root.children[0] as THREE.Mesh).castShadow).toBe(false);

    avatar.present(
      new THREE.Vector3(),
      0,
      1.72,
      diagnostics("firstPerson", AVATAR_FADE_END_DISTANCE),
    );
    expect(material.opacity).toBe(1);
    expect(material.transparent).toBe(false);
    expect((avatar.root.children[0] as THREE.Mesh).castShadow).toBe(true);
    expect(avatarOpacityForDistance(AVATAR_FADE_START_DISTANCE)).toBe(0);
    expect(avatarOpacityForDistance(midpoint)).toBeCloseTo(0.5);
    expect(avatarOpacityForDistance(AVATAR_FADE_END_DISTANCE)).toBe(1);
    expect(avatarOpacityForDistance(Number.NaN)).toBe(0);
    avatar.dispose();
  });
});
