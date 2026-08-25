import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { calculateCelestialDirections } from "../../lib/game/environment";

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
