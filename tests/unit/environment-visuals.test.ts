import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  calculateCelestialDirections,
  sunwardFogTint,
  stabilizeDirectionalShadowAnchor,
} from "../../lib/game/environment";

describe("procedural celestial directions", () => {
  it("returns finite unit opposites for valid and hostile input", () => {
    for (const [elevation, azimuth] of [[1, 0], [0, Math.PI / 2], [-1, Math.PI], [Number.NaN, Number.NaN]]) {
      const sun = new THREE.Vector3();
      const moon = new THREE.Vector3();
      const result = calculateCelestialDirections(elevation, azimuth, sun, moon);
      expect(result.sun).toBe(sun);
      expect(result.moon).toBe(moon);
      expect(sun.length()).toBeCloseTo(1);
      expect(moon.length()).toBeCloseTo(1);
      expect(sun.dot(moon)).toBeCloseTo(-1);
      expect([...sun.toArray(), ...moon.toArray()].every(Number.isFinite)).toBe(true);
    }
  });
});

describe("directional shadow stabilization", () => {
  const camera = new THREE.OrthographicCamera(-88, 88, 88, -88, 1, 260);
  const lightOffset = new THREE.Vector3(70, 92, -38);

  it("quantizes motion in the light plane without changing light depth", () => {
    const first = stabilizeDirectionalShadowAnchor(
      new THREE.Vector3(12.001, 3.5, -8.002),
      lightOffset,
      camera,
      new THREE.Vector2(2_048, 2_048),
    );
    const nearby = stabilizeDirectionalShadowAnchor(
      new THREE.Vector3(12.005, 3.5, -8.004),
      lightOffset,
      camera,
      new THREE.Vector2(2_048, 2_048),
    );
    const forward = lightOffset.clone().normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(forward).normalize();
    const up = forward.clone().cross(right).normalize();
    const snappedDelta = nearby.clone().sub(first);
    expect(Math.abs(snappedDelta.dot(right))).toBeLessThan(0.00001);
    expect(Math.abs(snappedDelta.dot(up))).toBeLessThan(0.00001);
    expect(first.dot(forward)).toBeCloseTo(
      new THREE.Vector3(12.001, 3.5, -8.002).dot(forward),
      5,
    );
  });

  it("halves the world-space shadow texel interval at Ultra resolution", () => {
    const anchor = new THREE.Vector3(8.173, 2.4, 14.619);
    const cinematic = stabilizeDirectionalShadowAnchor(
      anchor,
      lightOffset,
      camera,
      new THREE.Vector2(2_048, 2_048),
    );
    const ultra = stabilizeDirectionalShadowAnchor(
      anchor,
      lightOffset,
      camera,
      new THREE.Vector2(4_096, 4_096),
    );
    const cinematicError = cinematic.distanceTo(anchor);
    const ultraError = ultra.distanceTo(anchor);
    expect(cinematicError).toBeLessThan(Math.SQRT2 * (176 / 2_048) * 0.5);
    expect(ultraError).toBeLessThan(Math.SQRT2 * (176 / 4_096) * 0.5);
  });

  it.each([
    [new THREE.Vector3(1e-4, 1, 0)],
    [new THREE.Vector3(0, 1, -1e-5)],
    [new THREE.Vector3(0, 1, 0)],
    [new THREE.Vector3(0.4, 0.8, 0.3)],
  ])("snaps in the same basis three's shadow camera uses (%o)", (offset) => {
    const camera = new THREE.OrthographicCamera(-88, 88, 88, -88, 1, 260);
    const anchor = new THREE.Vector3(12.37, 4.2, -33.91);
    camera.position.copy(anchor).add(offset);
    camera.lookAt(anchor);
    camera.updateMatrixWorld(true);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const snapped = stabilizeDirectionalShadowAnchor(anchor, offset, camera, new THREE.Vector2(2048, 2048));
    const delta = snapped.clone().sub(anchor);
    const forward = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2);
    expect(Math.abs(delta.dot(forward))).toBeLessThan(1e-9);
    const texel = 176 / 2048;
    expect(Math.abs(delta.dot(right))).toBeLessThanOrEqual(texel / 2 + 1e-9);
    expect(Math.abs(delta.dot(up))).toBeLessThanOrEqual(texel / 2 + 1e-9);
    // The point of snapping: the anchor lands on the shadow camera's own texel grid.
    for (const axis of [right, up]) {
      const texels = snapped.dot(axis) / texel;
      expect(Math.abs(texels - Math.round(texels))).toBeLessThan(1e-6);
    }
  });
});

describe("sunward fog tint", () => {
  const sun = new THREE.Vector3(0.6, 0.12, -0.79).normalize();

  it("peaks facing the sun at golden hour", () => {
    const facing = sunwardFogTint(sun, sun, 1, 0.6);
    expect(facing).toBeGreaterThan(0.5);
    expect(facing).toBeLessThanOrEqual(1);
    const sideways = new THREE.Vector3(0.79, 0, 0.6).normalize();
    expect(sunwardFogTint(sideways, sun, 1, 0.6)).toBeLessThan(facing);
  });

  it("is zero facing away, at night, and outside golden hour", () => {
    expect(sunwardFogTint(sun.clone().negate(), sun, 1, 0.6)).toBe(0);
    expect(sunwardFogTint(sun, sun, 1, 0)).toBe(0);
    expect(sunwardFogTint(sun, sun, 0, 1)).toBe(0);
  });

  it("stays in [0, 1] for hostile input", () => {
    const nan = new THREE.Vector3(Number.NaN, 0, 0);
    expect(sunwardFogTint(nan, sun, 1, 1)).toBe(0);
    expect(sunwardFogTint(new THREE.Vector3(), sun, 1, 1)).toBe(0);
    expect(sunwardFogTint(sun, sun, 7, 7)).toBeLessThanOrEqual(1);
  });
});
