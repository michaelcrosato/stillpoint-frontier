import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { AdaptiveResolution } from "../../lib/game/rendering/AdaptiveResolution";
import { RenderPipeline } from "../../lib/game/rendering/RenderPipeline";

describe("optional compositor direct-render fallback", () => {
  it.each(["bloom", "composer"])("restores clear and material state after %s throws", (stage) => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const original = new THREE.MeshBasicMaterial();
    scene.overrideMaterial = original;
    const color = new THREE.Color(0x123456);
    let alpha = 0.8;
    const renderer = {
      autoClear: true,
      info: { reset: vi.fn() },
      getClearAlpha: () => alpha,
      getClearColor: (target: THREE.Color) => target.copy(color),
      setClearColor: (next: THREE.Color, nextAlpha: number) => { color.copy(next); alpha = nextAlpha; },
      setRenderTarget: vi.fn(), resetState: vi.fn(),
      render: vi.fn(() => {
        expect(renderer.autoClear).toBe(true);
        expect(scene.overrideMaterial).toBe(original);
        expect(color.getHex()).toBe(0x123456);
        expect(alpha).toBe(0.8);
      }),
    };
    const fail = () => {
      renderer.autoClear = false;
      color.setHex(0xff0000);
      alpha = 1;
      scene.overrideMaterial = null;
      throw new Error("optional stage failed");
    };
    const pipeline = Object.create(RenderPipeline.prototype) as RenderPipeline;
    Object.assign(pipeline, {
      disposed: false, frameToken: 0, postProcessingFailureCount: 0,
      renderer, options: { scene, camera }, fallbackClearColor: new THREE.Color(),
      gpuFrameTimer: { diagnostics: { pendingQueries: 0 } },
      adaptiveResolution: new AdaptiveResolution({ budgetMilliseconds: 1000 / 60 }, false),
      usesPostProcessing: () => true,
      bloomPass: { enabled: stage === "bloom" },
      renderSelectiveBloom: fail, composer: { render: fail },
    });
    expect(pipeline.render().frameToken).toBe(1);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.setRenderTarget).toHaveBeenCalledWith(null);
    expect(pipeline).toMatchObject({ postProcessingFallback: true, postProcessingFailureCount: 1 });
    renderer.render.mockImplementationOnce(() => { throw new Error("world material failed"); });
    expect(() => pipeline.render()).toThrow("world material failed");
    original.dispose();
  });
});
