import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CITIZEN_RESIDENT_CHUNKS } from "../../lib/game/config";
import { CitizenEngine } from "../../lib/game/citizens/CitizenEngine";
import { getSettlement } from "../../lib/game/world/macroWorld";

describe("citizen presentation", () => {
  it("streams crowd chunks incrementally with safe load budgets", () => {
    const settlement = getSettlement("vesper-crown");
    expect(settlement).not.toBeNull();
    if (!settlement) return;
    const scene = new THREE.Scene();
    const citizens = new CitizenEngine(scene, "cinematic");

    citizens.updateStreaming(settlement.x, settlement.z);
    expect(citizens.streamingSnapshot).toEqual({
      loaded: 1,
      pending: CITIZEN_RESIDENT_CHUNKS - 1,
      desired: CITIZEN_RESIDENT_CHUNKS,
      ready: false,
    });
    citizens.advanceStreaming(Number.NaN);
    expect(citizens.streamingSnapshot.loaded).toBe(2);
    citizens.advanceStreaming(Number.POSITIVE_INFINITY);
    expect(citizens.streamingSnapshot.loaded).toBe(3);
    citizens.flushStreamingForTests();
    expect(citizens.streamingSnapshot).toEqual({
      loaded: CITIZEN_RESIDENT_CHUNKS,
      pending: 0,
      desired: CITIZEN_RESIDENT_CHUNKS,
      ready: true,
    });
    citizens.dispose();
  });

  it("interpolates instance transforms between fixed simulation ticks", () => {
    const scene = new THREE.Scene();
    const citizens = new CitizenEngine(scene, "cinematic");
    citizens.updateStreaming(0, 8);
    citizens.flushStreamingForTests();
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

  it("thins the same deterministic city crowd sharply at 03:00", () => {
    const settlement = getSettlement("vesper-crown");
    expect(settlement).not.toBeNull();
    if (!settlement) return;
    const scene = new THREE.Scene();
    const citizens = new CitizenEngine(scene, "cinematic");
    citizens.updateStreaming(settlement.x, settlement.z);
    citizens.flushStreamingForTests();
    citizens.setWorldMinutes(12 * 60);
    citizens.present();
    const noon = citizens.debugSnapshot();
    const firstMesh = scene.children.find(
      (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
    );
    expect(firstMesh).toBeDefined();
    const matrixVersionAtNoon = firstMesh?.instanceMatrix.version ?? -1;

    citizens.setWorldMinutes(3 * 60);
    expect(firstMesh?.instanceMatrix.version).toBe(matrixVersionAtNoon);
    citizens.present();
    expect(firstMesh?.instanceMatrix.version ?? -1).toBeGreaterThan(matrixVersionAtNoon);
    const threeAm = citizens.debugSnapshot();
    expect(noon.visible).toBeGreaterThan(3_000);
    expect(threeAm.visible).toBeLessThan(noon.visible / 4);
    expect(threeAm.visible).toBeGreaterThan(0);
    expect(threeAm.generated).toBe(noon.generated);
    expect(new Set(threeAm.ids).size).toBe(threeAm.ids.length);
    expect(threeAm.activityMultiplier).toBeCloseTo(0.18, 2);

    citizens.setWorldMinutes(12 * 60);
    citizens.present();
    expect(citizens.debugSnapshot().ids).toEqual(noon.ids);

    citizens.setWorldMinutes(Number.NaN);
    expect(citizens.activityMultiplier).toBeCloseTo(1, 2);
    citizens.dispose();
  });
});
