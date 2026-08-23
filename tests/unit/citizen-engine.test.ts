import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CITIZEN_RESIDENT_CHUNKS } from "../../lib/game/config";
import { CitizenEngine } from "../../lib/game/citizens/CitizenEngine";

describe("citizen presentation", () => {
  it("interpolates instance transforms between fixed simulation ticks", () => {
    const scene = new THREE.Scene();
    const citizens = new CitizenEngine(scene, "cinematic");
    citizens.updateStreaming(0, 8);
    expect(citizens.loadedCount).toBe(CITIZEN_RESIDENT_CHUNKS);
    const mesh = scene.children.find(
      (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
    );
    expect(mesh).toBeDefined();
    expect(mesh?.count ?? 0).toBeGreaterThan(0);
    if (!mesh) return;

    citizens.update(0, 8, 1 / 60, false);
    citizens.present(0);
    const fixedPose = new THREE.Matrix4();
    mesh.getMatrixAt(0, fixedPose);

    citizens.present(1 / 120);
    const interpolatedPose = new THREE.Matrix4();
    mesh.getMatrixAt(0, interpolatedPose);

    const fixedPosition = new THREE.Vector3().setFromMatrixPosition(fixedPose);
    const interpolatedPosition = new THREE.Vector3().setFromMatrixPosition(interpolatedPose);
    expect(interpolatedPosition.distanceTo(fixedPosition)).toBeGreaterThan(0);
    expect(citizens.debugSnapshot().updateHz).toBe(60);

    const cinematicCount = citizens.visibleCount;
    citizens.setQuality("performance");
    expect(citizens.visibleCount).toBeLessThanOrEqual(cinematicCount);
    expect(() => citizens.present(Number.NaN)).not.toThrow();

    citizens.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
