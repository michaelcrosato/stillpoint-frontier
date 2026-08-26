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
import {
  WORLD_DETAIL_PRESETS,
  worldLodPolicy,
} from "../../lib/game/world/WorldLodPolicy";
import { horizonSceneryRecipes } from "../../lib/game/world/sceneryLod";

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
      expect(diagnostics.terrainTriangles).toBeLessThan(
        WORLD_DETAIL_PRESETS[diagnostics.detailLevel].maxTerrainTriangles,
      );
      expect(diagnostics.settlementInstances).toBeLessThan(200);
      expect(diagnostics.sceneryInstances).toBeGreaterThan(0);
      expect(diagnostics.sceneryInstances).toBeLessThanOrEqual(
        WORLD_DETAIL_PRESETS[diagnostics.detailLevel].maxSceneryInstances,
      );
      expect(diagnostics.sceneryDrawCalls).toBeLessThanOrEqual(3);

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

  it("raises only the render-only near-ring budget when world detail increases", () => {
    const scene = new THREE.Scene();
    const horizon = new HorizonRenderer(scene, "unlimited", 0);
    horizon.update(0, 8);
    const opening = horizon.diagnostics;
    const farBefore = scene.getObjectByName("horizon-terrain:2:north:0");
    expect(opening.nearCellSize).toBe(48);
    expect(opening.sceneryInstances).toBe(0);

    expect(horizon.setDetailLevel(4)).toBe(true);
    const maximum = horizon.diagnostics;
    expect(maximum.nearCellSize).toBe(12);
    expect(maximum.detailDistanceMeters).toBe(1_920);
    expect(maximum.terrainTriangles).toBeGreaterThan(opening.terrainTriangles);
    expect(maximum.terrainTriangles).toBeLessThan(
      WORLD_DETAIL_PRESETS[4].maxTerrainTriangles,
    );
    expect(maximum.sceneryInstances).toBeGreaterThan(0);
    expect(scene.getObjectByName("horizon-terrain:2:north:0")).toBe(farBefore);
    expect(horizon.setDetailLevel(4)).toBe(false);
    horizon.dispose();
  });

  it("keeps the HLOD terrain on the same PBR wet-surface response as loaded terrain", () => {
    const scene = new THREE.Scene();
    const horizon = new HorizonRenderer(scene, "standard", 1);
    horizon.update(0, 8);
    const terrain = scene.getObjectByName("horizon-terrain:0:north:0");
    expect(terrain).toBeInstanceOf(THREE.Mesh);
    const material = (terrain as THREE.Mesh).material;
    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    horizon.presentEnvironment({ surfaceWetness: 1 });
    expect((material as THREE.MeshStandardMaterial).roughness).toBeCloseTo(0.55);
    expect((material as THREE.MeshStandardMaterial).envMapIntensity).toBeGreaterThan(0.72);
    horizon.dispose();
  });

  it("adds capped bloom-ready skyline lights only when night presentation is enabled", () => {
    const scene = new THREE.Scene();
    const horizon = new HorizonRenderer(scene, "unlimited", 2);
    horizon.update(0, 8);
    const diagnostics = horizon.diagnostics;
    expect(diagnostics.settlementLightInstances).toBeGreaterThan(0);
    expect(diagnostics.settlementLightInstances).toBeLessThanOrEqual(320);
    expect(diagnostics.settlementLightDrawCalls).toBeLessThanOrEqual(8);

    horizon.presentEnvironment({ surfaceWetness: 0, night: 1, cloudCover: 0.2 });
    const lights = scene.getObjectByName("horizon-settlement-lights:0") ??
      scene.getObjectByProperty("type", "Points");
    expect(lights).toBeInstanceOf(THREE.Points);
    expect(lights?.visible).toBe(true);
    expect(lights?.layers.isEnabled(1)).toBe(true);

    horizon.setGraphicsFeatures({ horizonLights: false });
    expect(lights?.visible).toBe(false);
    horizon.setGraphicsFeatures({ horizonLights: true });
    expect(lights?.visible).toBe(true);
    horizon.presentEnvironment({ surfaceWetness: 0, night: 0, cloudCover: 0 });
    expect(lights?.visible).toBe(false);
    horizon.dispose();
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
    expect(horizon.diagnostics.terrainTriangles).toBeLessThan(
      WORLD_DETAIL_PRESETS[2].maxTerrainTriangles,
    );
    horizon.dispose();
  });

  it("generates deterministic capped scenery with no gameplay contract", () => {
    const policy = worldLodPolicy(4);
    const first = horizonSceneryRecipes(0, 0, policy);
    const second = horizonSceneryRecipes(0, 0, policy);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThanOrEqual(policy.maxSceneryInstances);
    for (const recipe of first) {
      expect(Math.max(Math.abs(recipe.x), Math.abs(recipe.z))).toBeGreaterThan(
        DETAILED_TERRAIN_HALF_EXTENT,
      );
      expect(Math.max(Math.abs(recipe.x), Math.abs(recipe.z))).toBeLessThanOrEqual(
        policy.sceneryOuter,
      );
      expect(recipe.y).toBeGreaterThan(-2.4);
      expect("collider" in recipe).toBe(false);
      expect("target" in recipe).toBe(false);
      expect("resource" in recipe).toBe(false);
      expect("ai" in recipe).toBe(false);
    }
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
