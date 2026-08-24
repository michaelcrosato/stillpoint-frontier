import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  DETAILED_TERRAIN_HALF_EXTENT,
  HORIZON_PRESETS,
  WORLD_RESIDENT_CHUNKS,
  type HorizonMode,
} from "../../lib/game/config";
import {
  HorizonRenderer,
  horizonSettlementRecipes,
} from "../../lib/game/world/HorizonRenderer";
import { WORLD_HALF_EXTENT } from "../../lib/game/world/macroWorld";

const MODES = Object.keys(HORIZON_PRESETS) as HorizonMode[];

describe("fixed-budget horizon HLOD", () => {
  it("defines finite monotonic profiles without changing the detailed chunk budget", () => {
    expect(WORLD_RESIDENT_CHUNKS).toBe(81);
    expect(HORIZON_PRESETS.standard.drawDistanceMeters)
      .toBeLessThan(HORIZON_PRESETS.extended.drawDistanceMeters);
    expect(HORIZON_PRESETS.extended.drawDistanceMeters)
      .toBeLessThan(HORIZON_PRESETS.unlimited.drawDistanceMeters);

    for (const mode of MODES) {
      const preset = HORIZON_PRESETS[mode];
      expect(Number.isFinite(preset.drawDistanceMeters)).toBe(true);
      expect(preset.rings[0].inner).toBe(DETAILED_TERRAIN_HALF_EXTENT);
      expect(preset.rings.length).toBeLessThanOrEqual(4);
      preset.rings.forEach((ring, index) => {
        expect(ring.outer).toBeGreaterThan(ring.inner);
        expect(ring.cellSize).toBeGreaterThan(0);
        if (index > 0) expect(ring.inner).toBe(preset.rings[index - 1].outer);
      });
    }
  });

  it("builds a bounded frustum-cullable terrain ring for every profile", () => {
    for (const mode of MODES) {
      const scene = new THREE.Scene();
      const horizon = new HorizonRenderer(scene, mode);
      expect(horizon.update(0, 8)).toBe(true);
      const diagnostics = horizon.diagnostics;
      expect(diagnostics.mode).toBe(mode);
      expect(diagnostics.terrainTiles).toBe(HORIZON_PRESETS[mode].rings.length * 16);
      expect(diagnostics.terrainTriangles).toBeGreaterThan(0);
      expect(diagnostics.terrainTriangles).toBeLessThan(60_000);
      expect(diagnostics.settlementInstances).toBeLessThan(200);

      scene.traverse((object) => {
        if (!object.name.startsWith("horizon-")) return;
        expect(object.castShadow).toBe(false);
        expect(object.receiveShadow).toBe(false);
        expect(object.frustumCulled).toBe(true);
      });
      horizon.dispose();
      expect(scene.getObjectByName("horizon-hlod")).toBeUndefined();
    }
  });

  it("only rebuilds on a snapped chunk crossing or a real mode change", () => {
    const scene = new THREE.Scene();
    const horizon = new HorizonRenderer(scene, "standard");
    horizon.update(0, 8);
    const opening = horizon.diagnostics;
    expect(horizon.update(40, 40)).toBe(false);
    expect(horizon.diagnostics.rebuilds).toBe(opening.rebuilds);
    expect(horizon.setMode("standard")).toBe(false);
    expect(horizon.setMode("extended")).toBe(true);
    expect(horizon.diagnostics.rebuilds).toBe(opening.rebuilds + 1);
    const nearBefore = scene.getObjectByName("horizon-terrain:0:north:0");
    const farBefore = scene.getObjectByName("horizon-terrain:2:north:0");
    expect(horizon.update(97, 8)).toBe(true);
    expect(horizon.diagnostics.anchor).toEqual({ x: 96, z: 0 });
    expect(scene.getObjectByName("horizon-terrain:0:north:0")).not.toBe(nearBefore);
    expect(scene.getObjectByName("horizon-terrain:2:north:0")).toBe(farBefore);
    horizon.dispose();
  });

  it("keeps atlas-edge vertices finite and inside the authored territory", () => {
    const scene = new THREE.Scene();
    const horizon = new HorizonRenderer(scene, "unlimited");
    horizon.update(WORLD_HALF_EXTENT - 1, WORLD_HALF_EXTENT - 1);
    const root = scene.getObjectByName("horizon-hlod");
    expect(root).toBeDefined();
    root?.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
      const positions = object.geometry.getAttribute("position");
      for (let index = 0; index < positions.count; index += 1) {
        expect(Number.isFinite(positions.getY(index))).toBe(true);
        expect(Math.abs(positions.getX(index))).toBeLessThanOrEqual(WORLD_HALF_EXTENT);
        expect(Math.abs(positions.getZ(index))).toBeLessThanOrEqual(WORLD_HALF_EXTENT);
      }
    });
    expect(horizon.diagnostics.terrainTriangles).toBeLessThan(60_000);
    horizon.dispose();
  });

  it("generates stable non-interactive settlement silhouettes only inside the horizon", () => {
    const first = horizonSettlementRecipes(0, 0, 12_000);
    const second = horizonSettlementRecipes(0, 0, 12_000);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(200);
    for (const recipe of first) {
      expect(Math.hypot(recipe.x, recipe.z)).toBeGreaterThan(
        DETAILED_TERRAIN_HALF_EXTENT,
      );
      expect(Math.hypot(recipe.x, recipe.z)).toBeLessThanOrEqual(12_000);
      expect(recipe.height).toBeGreaterThan(0);
      expect(recipe.sector).toBeGreaterThanOrEqual(0);
      expect(recipe.sector).toBeLessThan(8);
      expect("collider" in recipe).toBe(false);
      expect("target" in recipe).toBe(false);
      expect("citizen" in recipe).toBe(false);
    }
  });
});
