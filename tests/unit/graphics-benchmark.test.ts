import { describe, expect, it } from "vitest";
import {
  GraphicsBenchmark,
  type GraphicsBenchmarkContext,
  normalizeGraphicsBenchmarkTarget,
  percentile,
  summarizeMetric,
} from "../../lib/game/developer/GraphicsBenchmark";

function captureContext(): GraphicsBenchmarkContext {
  return {
    capturedAt: "2026-08-25T12:00:00.000Z",
    worldSeed: "STILL-0317",
    quality: "ultra",
    horizonMode: "unlimited",
    worldDetail: 4,
    resolution: { width: 3_840, height: 2_160, pixelRatio: 2 },
    forest: {
      active: true,
      level: 2,
      label: "DENSE",
      trees: 3_000,
      groundcover: 12_000,
      rocks: 400,
      reeds: 1_024,
    },
    viewpoint: { x: 6_144, y: 8, z: -5_930, heading: 0, fov: 76 },
    environment: {
      worldMinutes: 840,
      weatherId: "fair",
      weatherLabel: "Canopy clear",
      visibilityMeters: 8_000,
      precipitation: "none",
    },
    flashlightOn: false,
    hardware: {
      userAgent: "test-browser",
      hardwareConcurrency: 8,
      deviceMemoryGb: 16,
      gpuVendor: "test-vendor",
      gpuRenderer: "test-gpu",
    },
  };
}

describe("graphics benchmark", () => {
  it("calculates stable nearest-rank percentiles and target budgets", () => {
    expect(percentile([8, 2, 4, 6], 0.5)).toBe(4);
    expect(percentile([8, 2, 4, 6], 0.95)).toBe(8);
    expect(percentile([], 0.5)).toBeNull();
    expect(summarizeMetric([1, 2, Number.NaN, -4, 8])).toEqual({
      samples: 3,
      p50: 2,
      p95: 8,
      p99: 8,
      max: 8,
    });
    expect(normalizeGraphicsBenchmarkTarget(142)).toBe(144);
    expect(normalizeGraphicsBenchmarkTarget(Number.NaN)).toBe(60);
  });

  it("excludes warmup, joins delayed GPU samples, and reports headroom", () => {
    const benchmark = new GraphicsBenchmark({
      warmupMs: 100,
      sampleDurationMs: 300,
      gpuDrainMs: 50,
      targetFps: 60,
      minimumSampleFrames: 1,
    });
    expect(benchmark.start(0, true)).toBe(true);
    benchmark.recordFrame({
      frameToken: 1,
      timestampMs: 50,
      frameIntervalMs: 50,
      cpuWorkMs: 99,
      cpuRenderMs: 88,
      drawCalls: 1,
      triangles: 1,
      gpuQuerySubmitted: true,
    });
    benchmark.recordFrame({
      frameToken: 2,
      timestampMs: 100,
      frameIntervalMs: 16.6,
      cpuWorkMs: 4,
      cpuRenderMs: 3,
      drawCalls: 20,
      triangles: 2_000,
      gpuQuerySubmitted: true,
    });
    for (let index = 0; index < 4; index += 1) {
      const frameToken = 10 + index;
      const timestampMs = 175 + index * 100;
      benchmark.recordFrame({
        frameToken,
        timestampMs,
        frameIntervalMs: 16.7,
        cpuWorkMs: 4 + index,
        cpuRenderMs: 2 + index * 0.5,
        drawCalls: 40 + index,
        triangles: 10_000 + index * 1_000,
        gpuQuerySubmitted: true,
      });
      benchmark.resolveGpuSamples([{ frameToken, milliseconds: 6 + index * 0.2 }]);
    }
    const snapshot = benchmark.snapshot;
    expect(snapshot.phase).toBe("complete");
    expect(snapshot.frameInterval?.samples).toBe(4);
    expect(snapshot.cpuWork?.max).toBe(7);
    expect(snapshot.gpu?.samples).toBe(4);
    expect(snapshot.bottleneck).toBe("CPU");
    expect(snapshot.headroomPercent).toBeGreaterThan(50);
    expect(snapshot.onePercentLowFps).toBe(59.9);
    expect(snapshot.grade).toBe("PASS");
    expect(snapshot.delivery).toBe("PASS");
    expect(snapshot.gpuMeasurement).toBe("VALID");
    expect(snapshot.gpuCoveragePercent).toBe(100);
    expect(snapshot.gpuSamplesPending).toBe(0);
  });

  it("supports CPU-only reports, invalid samples, cancellation, and target locks", () => {
    const benchmark = new GraphicsBenchmark({
      warmupMs: 0,
      sampleDurationMs: 100,
      gpuDrainMs: 0,
      targetFps: 144,
      minimumSampleFrames: 1,
    });
    benchmark.start(0, false);
    expect(benchmark.setTarget(60)).toBe(false);
    benchmark.recordFrame({
      frameToken: 1,
      timestampMs: 20,
      frameIntervalMs: 300,
      cpuWorkMs: 3,
      cpuRenderMs: 2,
      drawCalls: 20,
      triangles: 2_000,
      gpuQuerySubmitted: false,
    });
    benchmark.recordFrame({
      frameToken: 2,
      timestampMs: 120,
      frameIntervalMs: 7,
      cpuWorkMs: 3,
      cpuRenderMs: 2,
      drawCalls: 20,
      triangles: 2_000,
      gpuQuerySubmitted: false,
    });
    benchmark.recordFrame({
      frameToken: 3,
      timestampMs: 121,
      frameIntervalMs: 7,
      cpuWorkMs: 3,
      cpuRenderMs: 2,
      drawCalls: 20,
      triangles: 2_000,
      gpuQuerySubmitted: false,
    });
    expect(benchmark.snapshot.phase).toBe("complete");
    expect(benchmark.snapshot.bottleneck).toBe("CPU_ONLY");
    expect(benchmark.snapshot.gpu).toBeNull();

    const cancelled = new GraphicsBenchmark();
    cancelled.start(0, false);
    expect(cancelled.cancel("tab hidden")).toBe(true);
    expect(cancelled.snapshot).toMatchObject({
      phase: "cancelled",
      grade: "CANCELLED",
      cancelledReason: "tab hidden",
    });
    expect(cancelled.cancel()).toBe(false);
    expect(cancelled.resolveGpuSamples([])).toBe(false);
  });

  it("separates engine headroom from refresh-cap-limited delivery", () => {
    const benchmark = new GraphicsBenchmark({
      warmupMs: 0,
      sampleDurationMs: 500,
      gpuDrainMs: 0,
      targetFps: 144,
    });
    benchmark.start(0, false);
    for (let index = 1; index <= 30; index += 1) {
      benchmark.recordFrame({
        frameToken: index,
        timestampMs: index * 16.67,
        frameIntervalMs: 16.67,
        cpuWorkMs: 1,
        cpuRenderMs: 0.5,
        drawCalls: 10,
        triangles: 1_000,
        gpuQuerySubmitted: false,
      });
    }
    benchmark.recordFrame({
      frameToken: 31,
      timestampMs: 501,
      frameIntervalMs: 16.67,
      cpuWorkMs: 1,
      cpuRenderMs: 0.5,
      drawCalls: 10,
      triangles: 1_000,
      gpuQuerySubmitted: false,
    });
    expect(benchmark.snapshot).toMatchObject({
      phase: "complete",
      grade: "PASS",
      delivery: "CAP_LIMITED",
      missedRefreshPercent: 100,
    });
    expect(benchmark.snapshot.onePercentLowFps).toBeCloseTo(60, 0);
    expect(benchmark.snapshot.headroomPercent).toBeGreaterThan(80);
  });

  it("freezes capture context and invalidates a completed run when its target changes", () => {
    const context = captureContext();
    const benchmark = new GraphicsBenchmark({
      warmupMs: 0,
      sampleDurationMs: 100,
      gpuDrainMs: 0,
      targetFps: 60,
      minimumSampleFrames: 1,
    });
    benchmark.start(0, false, context);
    context.forest.label = "OVERLOAD";
    context.resolution.width = 1;
    benchmark.recordFrame({
      frameToken: 1,
      timestampMs: 100,
      frameIntervalMs: 16.67,
      cpuWorkMs: 3,
      cpuRenderMs: 2,
      drawCalls: 20,
      triangles: 2_000,
      gpuQuerySubmitted: false,
    });
    benchmark.recordFrame({
      frameToken: 2,
      timestampMs: 101,
      frameIntervalMs: 16.67,
      cpuWorkMs: 3,
      cpuRenderMs: 2,
      drawCalls: 20,
      triangles: 2_000,
      gpuQuerySubmitted: false,
    });
    expect(benchmark.snapshot.context?.forest.label).toBe("DENSE");
    expect(benchmark.snapshot.context?.resolution.width).toBe(3_840);
    expect(benchmark.setTarget(144)).toBe(true);
    expect(benchmark.snapshot).toMatchObject({ phase: "idle", context: null });
    expect(benchmark.snapshot.frameInterval).toBeNull();
  });

  it("marks supported but incomplete GPU query coverage as inconclusive", () => {
    const benchmark = new GraphicsBenchmark({
      warmupMs: 0,
      sampleDurationMs: 100,
      gpuDrainMs: 0,
      targetFps: 60,
      minimumSampleFrames: 1,
    });
    benchmark.start(0, true);
    for (let index = 1; index <= 5; index += 1) {
      benchmark.recordFrame({
        frameToken: index,
        timestampMs: index * 20,
        frameIntervalMs: 16.67,
        cpuWorkMs: 2,
        cpuRenderMs: 1,
        drawCalls: 20,
        triangles: 2_000,
        gpuQuerySubmitted: true,
      });
    }
    benchmark.resolveGpuSamples([{ frameToken: 1, milliseconds: 4 }]);
    benchmark.recordFrame({
      frameToken: 6,
      timestampMs: 101,
      frameIntervalMs: 16.67,
      cpuWorkMs: 2,
      cpuRenderMs: 1,
      drawCalls: 20,
      triangles: 2_000,
      gpuQuerySubmitted: false,
    });
    expect(benchmark.snapshot).toMatchObject({
      phase: "complete",
      grade: "INCOMPLETE",
      gpuMeasurement: "INCOMPLETE",
      gpuQueriesSubmitted: 5,
      gpuQueriesResolved: 1,
      gpuCoveragePercent: 20,
      bottleneck: "GPU_INCOMPLETE",
      headroomPercent: null,
    });
  });

  it("does not grade an undersampled wall-clock capture", () => {
    const benchmark = new GraphicsBenchmark({
      warmupMs: 0,
      sampleDurationMs: 100,
      gpuDrainMs: 0,
      targetFps: 60,
    });
    benchmark.start(0, false);
    benchmark.recordFrame({
      frameToken: 1,
      timestampMs: 500,
      frameIntervalMs: 500,
      cpuWorkMs: 2,
      cpuRenderMs: 1,
      drawCalls: 20,
      triangles: 2_000,
      gpuQuerySubmitted: false,
    });
    benchmark.recordFrame({
      frameToken: 2,
      timestampMs: 501,
      frameIntervalMs: 16.67,
      cpuWorkMs: 2,
      cpuRenderMs: 1,
      drawCalls: 20,
      triangles: 2_000,
      gpuQuerySubmitted: false,
    });
    expect(benchmark.snapshot).toMatchObject({
      phase: "complete",
      sampledFrames: 1,
      minimumSampleFrames: 30,
      grade: "INCOMPLETE",
      headroomPercent: null,
      delivery: "MISS",
    });
  });

  it("retains long foreground hitches in cadence percentiles", () => {
    const benchmark = new GraphicsBenchmark({
      warmupMs: 0,
      sampleDurationMs: 1_000,
      gpuDrainMs: 0,
      targetFps: 60,
    });
    benchmark.start(0, false);
    let timestampMs = 0;
    let frameToken = 0;
    while (timestampMs < 1_000) {
      frameToken += 1;
      const frameIntervalMs = frameToken === 30 ? 500 : 16.67;
      timestampMs += frameIntervalMs;
      benchmark.recordFrame({
        frameToken,
        timestampMs,
        frameIntervalMs,
        cpuWorkMs: 3,
        cpuRenderMs: 2,
        drawCalls: 20,
        triangles: 2_000,
        gpuQuerySubmitted: false,
      });
    }
    benchmark.recordFrame({
      frameToken: frameToken + 1,
      timestampMs: timestampMs + 1,
      frameIntervalMs: 16.67,
      cpuWorkMs: 3,
      cpuRenderMs: 2,
      drawCalls: 20,
      triangles: 2_000,
      gpuQuerySubmitted: false,
    });
    expect(benchmark.snapshot.frameInterval?.max).toBe(500);
    expect(benchmark.snapshot.onePercentLowFps).toBe(2);
    expect(benchmark.snapshot.delivery).toBe("MISS");
  });
});
