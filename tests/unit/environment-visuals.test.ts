import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  calculateCelestialDirections,
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
});
