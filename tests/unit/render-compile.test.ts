import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { RenderPipeline } from "../../lib/game/rendering/RenderPipeline";

describe("renderer startup compilation lifetime", () => {
  it.each([false, true])("finishes compilation before yielding with compositor=%s", async (postProcessing) => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const previous = new THREE.WebGLRenderTarget();
    const readBuffer = new THREE.WebGLRenderTarget();
    let target: THREE.WebGLRenderTarget | null = previous;
    const renderer = {
      getRenderTarget: () => target,
      setRenderTarget: vi.fn((next) => { target = next; }),
      compile: vi.fn(() => { expect(target).toBe(postProcessing ? readBuffer : previous); }),
      compileAsync: vi.fn(),
    };
    const pipeline = Object.create(RenderPipeline.prototype) as RenderPipeline;
    Object.assign(pipeline, {
      renderer, options: { scene, camera }, composer: { readBuffer },
      usesPostProcessing: () => postProcessing,
    });
    const completion = pipeline.compile();
    // Cleanup can run before the await continuation; no shader poll survives it.
    expect(renderer.compile).toHaveBeenCalledWith(scene, camera);
    expect(renderer.compileAsync).not.toHaveBeenCalled();
    expect(target).toBe(previous);
    await completion;
    renderer.compile.mockImplementationOnce(() => { throw new Error("compile failed"); });
    await expect(pipeline.compile()).rejects.toThrow("compile failed");
    expect(target).toBe(previous);
    previous.dispose();
    readBuffer.dispose();
  });
});
