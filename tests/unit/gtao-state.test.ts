import * as THREE from "three";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortRangeGtaoPass } from "../../lib/game/rendering/ShortRangeGtaoPass";

afterEach(() => vi.restoreAllMocks());

describe("optional GTAO state safety", () => {
  it.each(["normal-failure", "fullscreen-failure", "success"])("restores render state after %s", (stage) => {
    const scene = new THREE.Scene();
    const points = new THREE.Points();
    const hiddenLine = new THREE.Line();
    hiddenLine.visible = false;
    scene.add(points, hiddenLine);
    const previousMaterial = new THREE.MeshBasicMaterial();
    scene.overrideMaterial = previousMaterial;
    const camera = new THREE.PerspectiveCamera(67, 1, 0.1, 4800);
    const pass = new ShortRangeGtaoPass(scene, camera, 80);
    const target = new THREE.WebGLRenderTarget(1, 1);
    let currentTarget: THREE.WebGLRenderTarget | null = null;
    const clearColor = new THREE.Color(0x123456);
    let clearAlpha = 0.7;
    const renderer = {
      shadowMap: { autoUpdate: true }, autoClear: true,
      getRenderTarget: () => currentTarget,
      setRenderTarget: (next: THREE.WebGLRenderTarget | null) => { currentTarget = next; },
      getClearAlpha: () => clearAlpha,
      getClearColor: (value: THREE.Color) => value.copy(clearColor),
      setClearColor: (value: THREE.Color, alpha: number) => { clearColor.copy(value); clearAlpha = alpha; },
    };
    vi.spyOn(GTAOPass.prototype, "render").mockImplementation(function (this: GTAOPass) {
      expect(camera.far).toBe(80);
      expect(renderer.shadowMap.autoUpdate).toBe(false);
      const internal = this as unknown as { _overrideVisibility(): void; _restoreVisibility(): void };
      internal._overrideVisibility();
      expect(points.visible).toBe(false);
      if (stage === "fullscreen-failure") internal._restoreVisibility();
      scene.overrideMaterial = pass.normalMaterial;
      renderer.autoClear = false;
      renderer.setRenderTarget(target);
      renderer.setClearColor(new THREE.Color(0xff0000), 1);
      if (stage !== "success") throw new Error(stage);
    });
    const render = () => pass.render(renderer as unknown as THREE.WebGLRenderer, target, target, 0, false);
    if (stage === "success") render(); else expect(render).toThrow(stage);
    expect(scene.overrideMaterial).toBe(previousMaterial);
    expect(points.visible).toBe(true);
    expect(hiddenLine.visible).toBe(false);
    expect(renderer.autoClear).toBe(true);
    expect(renderer.shadowMap.autoUpdate).toBe(true);
    expect(currentTarget).toBeNull();
    expect(clearColor.getHex()).toBe(0x123456);
    expect(clearAlpha).toBe(0.7);
    expect(camera.far).toBe(4800);
    pass.dispose();
    target.dispose();
    previousMaterial.dispose();
    points.geometry.dispose();
    (points.material as THREE.Material).dispose();
    hiddenLine.geometry.dispose();
    (hiddenLine.material as THREE.Material).dispose();
  });
});
