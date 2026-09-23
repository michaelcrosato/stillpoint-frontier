import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  ADAPTIVE_MIN_SCALE,
  AdaptiveResolution,
  adaptivePixelRatio,
} from "../../lib/game/rendering/AdaptiveResolution";
import { RenderPipeline } from "../../lib/game/rendering/RenderPipeline";

const BUDGET = 1000 / 60;
const heavy = BUDGET * 1.5;
const light = BUDGET * 0.4;
const steady = BUDGET * 0.9;

function feed(controller: AdaptiveResolution, milliseconds: number, count: number) {
  let changes = 0;
  for (let index = 0; index < count; index += 1) {
    if (controller.sample(milliseconds)) changes += 1;
  }
  return changes;
}

describe("adaptive resolution", () => {
  it("changes nothing without GPU samples", () => {
    const controller = new AdaptiveResolution({ budgetMilliseconds: BUDGET });
    for (const value of [null, undefined, Number.NaN, 0, -3]) {
      expect(controller.sample(value)).toBe(false);
    }
    expect(controller.scale).toBe(1);
  });

  it("steps down 10 percent only after sustained over-budget GPU time", () => {
    const controller = new AdaptiveResolution({ budgetMilliseconds: BUDGET });
    expect(feed(controller, heavy, 4)).toBe(0);
    expect(controller.sample(heavy)).toBe(true);
    expect(controller.scale).toBeCloseTo(0.9);
  });

  it("waits out a cooldown between steps", () => {
    const controller = new AdaptiveResolution({ budgetMilliseconds: BUDGET });
    feed(controller, heavy, 5);
    expect(feed(controller, heavy, 10)).toBe(0);
    expect(controller.scale).toBeCloseTo(0.9);
    expect(feed(controller, heavy, 5)).toBe(1);
    expect(controller.scale).toBeCloseTo(0.8);
  });

  it("steps back up when the GPU has headroom", () => {
    const controller = new AdaptiveResolution({ budgetMilliseconds: BUDGET });
    feed(controller, heavy, 5);
    feed(controller, light, 10);
    expect(feed(controller, light, 5)).toBe(1);
    expect(controller.scale).toBeCloseTo(1);
  });

  it("holds steady inside the band and resets its evidence", () => {
    const controller = new AdaptiveResolution({ budgetMilliseconds: BUDGET });
    feed(controller, heavy, 4);
    controller.sample(steady);
    expect(feed(controller, heavy, 4)).toBe(0);
    expect(controller.scale).toBe(1);
  });

  it("stays within [0.6, 1]", () => {
    const controller = new AdaptiveResolution({ budgetMilliseconds: BUDGET });
    feed(controller, heavy, 400);
    expect(controller.scale).toBeCloseTo(ADAPTIVE_MIN_SCALE);
    expect(ADAPTIVE_MIN_SCALE).toBeCloseTo(0.6);
    feed(controller, light, 400);
    expect(controller.scale).toBe(1);
  });

  it("never changes while disabled, as in test mode", () => {
    const controller = new AdaptiveResolution({ budgetMilliseconds: BUDGET }, false);
    expect(feed(controller, heavy, 50)).toBe(0);
    expect(controller.scale).toBe(1);
  });

  it("scales the resolved pixel ratio, never below half a pixel", () => {
    expect(adaptivePixelRatio(1.75, 0.6)).toBeCloseTo(1.05);
    expect(adaptivePixelRatio(1, 1)).toBe(1);
    expect(adaptivePixelRatio(0.6, 0.6)).toBe(0.5);
  });

  it("forgets its state on reset, as after a quality change", () => {
    const controller = new AdaptiveResolution({ budgetMilliseconds: BUDGET });
    feed(controller, heavy, 5);
    controller.reset();
    expect(controller.scale).toBe(1);
    expect(feed(controller, heavy, 4)).toBe(0);
  });
});

describe("render pipeline adaptive resolution", () => {
  function pipelineStub(controller = new AdaptiveResolution({ budgetMilliseconds: BUDGET })) {
    const setPixelRatio = vi.fn();
    const pipeline = Object.create(RenderPipeline.prototype) as RenderPipeline;
    Object.assign(pipeline, {
      disposed: false,
      quality: "cinematic",
      width: 1,
      height: 1,
      renderer: {
        getContext: () => ({ getParameter: () => 16_384, MAX_RENDERBUFFER_SIZE: 0x84e8 }),
        setPixelRatio,
        setSize: vi.fn(),
      },
      composer: { setPixelRatio: vi.fn(), setSize: vi.fn() },
      bloomComposer: { setPixelRatio: vi.fn(), setSize: vi.fn() },
      resizeGtao: vi.fn(),
      gradePass: { uniforms: { uResolution: { value: new THREE.Vector2() } } },
      gpuFrameTimer: { diagnostics: { status: "ready" } },
      adaptiveResolution: controller,
      framesSinceGpuProbe: 0,
      devicePixelRatio: 1,
    });
    const internals = pipeline as unknown as {
      applyGpuSamples(samples: { frameToken: number; milliseconds: number }[], benchmarking: boolean): boolean;
      shouldProbeGpu(): boolean;
    };
    return { pipeline, internals, setPixelRatio };
  }

  it("renders at the adaptive fraction of the resolved pixel ratio", () => {
    const controller = new AdaptiveResolution({ budgetMilliseconds: BUDGET });
    feed(controller, heavy, 5);
    const { pipeline, setPixelRatio } = pipelineStub(controller);
    pipeline.resize(1_920, 1_080, 1.5);
    expect(setPixelRatio).toHaveBeenLastCalledWith(1.5 * 0.9);
  });

  it("resizes once the GPU samples move the scale, and never while benchmarking", () => {
    const { pipeline, internals, setPixelRatio } = pipelineStub();
    pipeline.resize(1_920, 1_080, 1);
    const samples = Array.from({ length: 5 }, (_, index) => ({ frameToken: index, milliseconds: heavy }));
    expect(internals.applyGpuSamples(samples, true)).toBe(false);
    expect(internals.applyGpuSamples(samples, false)).toBe(true);
    expect(setPixelRatio).toHaveBeenLastCalledWith(0.9);
    expect(pipeline.resolutionScale).toBeCloseTo(0.9);
  });

  it("probes GPU time on a sparse cadence, and only where timer queries exist", () => {
    const { pipeline, internals } = pipelineStub();
    const probes = Array.from({ length: 30 }, () => internals.shouldProbeGpu()).filter(Boolean);
    expect(probes).toHaveLength(2);
    Object.assign(pipeline, { gpuFrameTimer: { diagnostics: { status: "unsupported" } } });
    expect(Array.from({ length: 30 }, () => internals.shouldProbeGpu()).some(Boolean)).toBe(false);
  });
});
