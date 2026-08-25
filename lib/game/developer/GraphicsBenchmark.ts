import type { GpuFrameTimingSample } from "../rendering/GpuFrameTimer";
import type { GraphicsFeatureState } from "../rendering/GraphicsFeatures";

export const GRAPHICS_BENCHMARK_TARGETS = [60, 90, 120, 144, 165, 240] as const;
export type GraphicsBenchmarkTarget =
  (typeof GRAPHICS_BENCHMARK_TARGETS)[number];

export type GraphicsBenchmarkPhase =
  | "idle"
  | "warming"
  | "sampling"
  | "finalizing"
  | "complete"
  | "cancelled";

export type GraphicsBenchmarkGrade =
  | "PENDING"
  | "PASS"
  | "MARGIN"
  | "FAIL"
  | "INCOMPLETE"
  | "CANCELLED";

export type GraphicsBenchmarkDelivery =
  | "PENDING"
  | "PASS"
  | "MISS"
  | "CAP_LIMITED"
  | "CANCELLED";

export interface GraphicsBenchmarkContext {
  capturedAt: string;
  worldSeed: string;
  quality: string;
  horizonMode: string;
  worldDetail: number;
  resolution: {
    width: number;
    height: number;
    pixelRatio: number;
  };
  forest: {
    active: boolean;
    level: number;
    label: string;
    trees: number;
    groundcover: number;
    rocks: number;
    reeds: number;
  };
  viewpoint: {
    x: number;
    y: number;
    z: number;
    heading: number;
    fov: number;
  };
  environment: {
    worldMinutes: number;
    weatherId: string;
    weatherLabel: string;
    visibilityMeters: number;
    precipitation: string;
  };
  flashlightOn: boolean;
  graphicsFeatures: GraphicsFeatureState;
  hardware: {
    userAgent: string;
    hardwareConcurrency: number | null;
    deviceMemoryGb: number | null;
    gpuVendor: string;
    gpuRenderer: string;
  };
}

export interface MetricSummary {
  samples: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface GraphicsBenchmarkFrame {
  frameToken: number;
  timestampMs: number;
  frameIntervalMs: number;
  cpuWorkMs: number;
  cpuRenderMs: number;
  drawCalls: number;
  triangles: number;
  gpuQuerySubmitted: boolean;
  hidden?: boolean;
}

export interface GraphicsBenchmarkSnapshot {
  phase: GraphicsBenchmarkPhase;
  targetFps: GraphicsBenchmarkTarget;
  budgetMs: number;
  progress: number;
  warmupMs: number;
  sampleDurationMs: number;
  minimumSampleFrames: number;
  elapsedMs: number;
  frameInterval: MetricSummary | null;
  cpuWork: MetricSummary | null;
  cpuRender: MetricSummary | null;
  gpu: MetricSummary | null;
  drawCalls: MetricSummary | null;
  triangles: MetricSummary | null;
  gpuSupported: boolean;
  sampledFrames: number;
  gpuQueriesSubmitted: number;
  gpuQueriesResolved: number;
  gpuSubmissionPercent: number | null;
  gpuCoveragePercent: number | null;
  gpuMeasurement: "UNSUPPORTED" | "PENDING" | "VALID" | "INCOMPLETE";
  gpuSamplesPending: number;
  bottleneck: "CPU" | "GPU" | "CPU_ONLY" | "GPU_INCOMPLETE" | null;
  headroomPercent: number | null;
  estimatedMaxFps: number | null;
  observedFps: number | null;
  onePercentLowFps: number | null;
  missedRefreshPercent: number | null;
  grade: GraphicsBenchmarkGrade;
  delivery: GraphicsBenchmarkDelivery;
  cancelledReason: string | null;
  context: Readonly<GraphicsBenchmarkContext> | null;
}

interface GraphicsBenchmarkOptions {
  warmupMs?: number;
  sampleDurationMs?: number;
  gpuDrainMs?: number;
  targetFps?: GraphicsBenchmarkTarget;
  minimumSampleFrames?: number;
}

function round(value: number, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function finiteNonNegative(value: number) {
  return Number.isFinite(value) && value >= 0;
}

export function percentile(values: readonly number[], fraction: number) {
  const sorted = values
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const clamped = Math.min(1, Math.max(0, fraction));
  const index = Math.max(0, Math.ceil(clamped * sorted.length) - 1);
  return sorted[index];
}

export function summarizeMetric(
  values: readonly number[],
): MetricSummary | null {
  const finite = values.filter(finiteNonNegative);
  if (finite.length === 0) return null;
  return {
    samples: finite.length,
    p50: round(percentile(finite, 0.5) ?? 0),
    p95: round(percentile(finite, 0.95) ?? 0),
    p99: round(percentile(finite, 0.99) ?? 0),
    max: round(Math.max(...finite)),
  };
}

export function normalizeGraphicsBenchmarkTarget(
  value: number,
): GraphicsBenchmarkTarget {
  if (!Number.isFinite(value)) return 60;
  return GRAPHICS_BENCHMARK_TARGETS.reduce((best, candidate) =>
    Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best,
  );
}

export class GraphicsBenchmark {
  private readonly warmupMs: number;
  private readonly sampleDurationMs: number;
  private readonly gpuDrainMs: number;
  private readonly minimumSampleFrames: number;
  private targetFps: GraphicsBenchmarkTarget;
  private phase: GraphicsBenchmarkPhase = "idle";
  private phaseStartedAt = 0;
  private captureStartedAt = 0;
  private lastTimestamp = 0;
  private gpuSupported = false;
  private cancelledReason: string | null = null;
  private captureContext: Readonly<GraphicsBenchmarkContext> | null = null;
  private readonly frameIntervals: number[] = [];
  private readonly cpuWork: number[] = [];
  private readonly cpuRender: number[] = [];
  private readonly gpu = new Map<number, number>();
  private readonly expectedGpuFrames = new Set<number>();
  private readonly drawCalls: number[] = [];
  private readonly triangles: number[] = [];

  constructor(options: GraphicsBenchmarkOptions = {}) {
    this.warmupMs = Math.max(0, options.warmupMs ?? 2_000);
    this.sampleDurationMs = Math.max(100, options.sampleDurationMs ?? 10_000);
    this.gpuDrainMs = Math.max(0, options.gpuDrainMs ?? 1_250);
    this.minimumSampleFrames = Math.max(
      1,
      Math.floor(options.minimumSampleFrames ?? 30),
    );
    this.targetFps = normalizeGraphicsBenchmarkTarget(options.targetFps ?? 60);
  }

  setTarget(target: number) {
    if (
      this.phase === "warming" ||
      this.phase === "sampling" ||
      this.phase === "finalizing"
    ) {
      return false;
    }
    const normalized = normalizeGraphicsBenchmarkTarget(target);
    if (normalized === this.targetFps) return false;
    if (this.phase !== "idle") this.resetToIdle();
    this.targetFps = normalized;
    return true;
  }

  start(
    timestampMs: number,
    gpuSupported: boolean,
    context: GraphicsBenchmarkContext | null = null,
  ) {
    if (!Number.isFinite(timestampMs)) return false;
    this.clearSamples();
    this.phase = this.warmupMs > 0 ? "warming" : "sampling";
    this.phaseStartedAt = timestampMs;
    this.captureStartedAt = timestampMs;
    this.lastTimestamp = timestampMs;
    this.gpuSupported = gpuSupported;
    this.cancelledReason = null;
    this.captureContext = context ? freezeCaptureContext(context) : null;
    return true;
  }

  get isActive() {
    return this.phase === "warming" ||
      this.phase === "sampling" ||
      this.phase === "finalizing";
  }

  get isMeasuringGpu() {
    return this.phase === "sampling";
  }

  cancel(reason = "Capture cancelled") {
    if (!this.isActive) return false;
    this.phase = "cancelled";
    this.cancelledReason = reason;
    return true;
  }

  invalidate(reason = "Capture configuration changed") {
    if (this.phase === "idle") return false;
    if (this.isActive) {
      this.phase = "cancelled";
      this.cancelledReason = reason;
      return true;
    }
    this.resetToIdle();
    return true;
  }

  reset(target: number = this.targetFps) {
    this.resetToIdle();
    this.targetFps = normalizeGraphicsBenchmarkTarget(target);
  }

  recordFrame(frame: Readonly<GraphicsBenchmarkFrame>) {
    if (
      this.phase !== "warming" &&
      this.phase !== "sampling" &&
      this.phase !== "finalizing"
    ) {
      return false;
    }
    if (!Number.isFinite(frame.timestampMs)) return false;
    this.lastTimestamp = frame.timestampMs;

    if (this.phase === "warming") {
      if (frame.timestampMs - this.phaseStartedAt < this.warmupMs) return false;
      this.phase = "sampling";
      this.phaseStartedAt = frame.timestampMs;
      return true;
    }

    if (this.phase === "sampling") {
      if (
        !frame.hidden &&
        finiteNonNegative(frame.frameIntervalMs) &&
        finiteNonNegative(frame.cpuWorkMs) &&
        finiteNonNegative(frame.cpuRenderMs)
      ) {
        this.frameIntervals.push(frame.frameIntervalMs);
        this.cpuWork.push(frame.cpuWorkMs);
        this.cpuRender.push(frame.cpuRenderMs);
        this.drawCalls.push(Math.max(0, frame.drawCalls));
        this.triangles.push(Math.max(0, frame.triangles));
        if (frame.gpuQuerySubmitted) {
          this.expectedGpuFrames.add(frame.frameToken);
        }
      }
      if (frame.timestampMs - this.phaseStartedAt >= this.sampleDurationMs) {
        this.phase = "finalizing";
        this.phaseStartedAt = frame.timestampMs;
      }
      return true;
    }

    this.tryFinalize(frame.timestampMs);
    return true;
  }

  resolveGpuSamples(samples: readonly GpuFrameTimingSample[]) {
    if (!this.isActive) return false;
    let changed = false;
    for (const sample of samples) {
      if (
        this.expectedGpuFrames.has(sample.frameToken) &&
        finiteNonNegative(sample.milliseconds)
      ) {
        this.gpu.set(sample.frameToken, sample.milliseconds);
        changed = true;
      }
    }
    if (this.phase === "finalizing") this.tryFinalize(this.lastTimestamp);
    return changed;
  }

  get snapshot(): GraphicsBenchmarkSnapshot {
    const frameInterval = summarizeMetric(this.frameIntervals);
    const cpuWork = summarizeMetric(this.cpuWork);
    const cpuRender = summarizeMetric(this.cpuRender);
    const gpu = summarizeMetric([...this.gpu.values()]);
    const drawCalls = summarizeMetric(this.drawCalls);
    const triangles = summarizeMetric(this.triangles);
    const budgetMs = 1_000 / this.targetFps;
    const sampledFrames = this.frameIntervals.length;
    const gpuQueriesSubmitted = this.expectedGpuFrames.size;
    const gpuQueriesResolved = this.gpu.size;
    const gpuSubmissionPercent = sampledFrames > 0
      ? round((gpuQueriesSubmitted / sampledFrames) * 100, 1)
      : null;
    const gpuCoveragePercent = gpuQueriesSubmitted > 0
      ? round((gpuQueriesResolved / gpuQueriesSubmitted) * 100, 1)
      : null;
    const requiredGpuSamples = Math.min(30, sampledFrames);
    const sampleIncomplete =
      this.phase === "complete" && sampledFrames < this.minimumSampleFrames;
    const gpuReliable = !this.gpuSupported || (
      requiredGpuSamples > 0 &&
      gpuQueriesSubmitted >= Math.ceil(requiredGpuSamples * 0.8) &&
      gpuQueriesResolved >= Math.ceil(gpuQueriesSubmitted * 0.8)
    );
    const gpuMeasurement: GraphicsBenchmarkSnapshot["gpuMeasurement"] =
      !this.gpuSupported
        ? "UNSUPPORTED"
        : this.phase !== "complete"
          ? "PENDING"
          : gpuReliable
            ? "VALID"
            : "INCOMPLETE";
    const cpuP95 = cpuWork?.p95 ?? null;
    const gpuP95 = gpu?.p95 ?? null;
    const reliableGpuP95 = this.gpuSupported && !gpuReliable ? null : gpuP95;
    const gpuIncomplete =
      this.phase === "complete" && this.gpuSupported && !gpuReliable;
    const bottleneckMs = cpuP95 === null || gpuIncomplete || sampleIncomplete
      ? null
      : reliableGpuP95 === null
        ? cpuP95
        : Math.max(cpuP95, reliableGpuP95);
    let bottleneck: GraphicsBenchmarkSnapshot["bottleneck"] = null;
    if (cpuP95 !== null && !sampleIncomplete) {
      if (gpuIncomplete) bottleneck = "GPU_INCOMPLETE";
      else if (reliableGpuP95 === null) bottleneck = "CPU_ONLY";
      else bottleneck = reliableGpuP95 > cpuP95 ? "GPU" : "CPU";
    }
    const headroomPercent = bottleneckMs === null
      ? null
      : round((1 - bottleneckMs / budgetMs) * 100, 1);
    const elapsedMs = Math.max(0, this.lastTimestamp - this.captureStartedAt);
    const progress = this.progress(elapsedMs);
    const missedRefreshPercent = frameInterval
      ? round(
          (this.frameIntervals.filter((value) => value > budgetMs * 1.2).length /
            this.frameIntervals.length) *
            100,
          1,
        )
      : null;
    const observedFps = frameInterval && frameInterval.p50 > 0
      ? round(1_000 / frameInterval.p50, 1)
      : null;
    let grade: GraphicsBenchmarkGrade = "PENDING";
    let delivery: GraphicsBenchmarkDelivery = "PENDING";
    if (this.phase === "cancelled") grade = "CANCELLED";
    if (this.phase === "cancelled") delivery = "CANCELLED";
    else if (this.phase === "complete" && (sampleIncomplete || gpuIncomplete)) {
      grade = "INCOMPLETE";
    } else if (this.phase === "complete" && bottleneckMs !== null) {
      grade = bottleneckMs > budgetMs * 0.9
        ? "FAIL"
        : bottleneckMs <= budgetMs * 0.75
          ? "PASS"
          : "MARGIN";
    }
    if (this.phase === "complete") {
      const deliveryPasses =
        (missedRefreshPercent ?? 100) <= 1 &&
        (frameInterval && frameInterval.p99 > 0
          ? 1_000 / frameInterval.p99 >= this.targetFps * 0.9
          : false);
      delivery = deliveryPasses
        ? "PASS"
        : bottleneckMs !== null &&
            bottleneckMs <= budgetMs * 0.9 &&
            sampledFrames >= 30 &&
            frameInterval !== null &&
            frameInterval.p99 <= frameInterval.p50 * 1.12 &&
            (observedFps ?? 0) < this.targetFps * 0.9
          ? "CAP_LIMITED"
          : "MISS";
    }
    return {
      phase: this.phase,
      targetFps: this.targetFps,
      budgetMs: round(budgetMs),
      progress,
      warmupMs: this.warmupMs,
      sampleDurationMs: this.sampleDurationMs,
      minimumSampleFrames: this.minimumSampleFrames,
      elapsedMs: round(elapsedMs),
      frameInterval,
      cpuWork,
      cpuRender,
      gpu,
      drawCalls,
      triangles,
      gpuSupported: this.gpuSupported,
      sampledFrames,
      gpuQueriesSubmitted,
      gpuQueriesResolved,
      gpuSubmissionPercent,
      gpuCoveragePercent,
      gpuMeasurement,
      gpuSamplesPending: Math.max(
        0,
        this.expectedGpuFrames.size - this.gpu.size,
      ),
      bottleneck,
      headroomPercent,
      estimatedMaxFps: bottleneckMs && bottleneckMs > 0
        ? round(1_000 / bottleneckMs, 1)
        : null,
      observedFps,
      onePercentLowFps: frameInterval && frameInterval.p99 > 0
        ? round(1_000 / frameInterval.p99, 1)
        : null,
      missedRefreshPercent,
      grade,
      delivery,
      cancelledReason: this.cancelledReason,
      context: this.captureContext,
    };
  }

  private tryFinalize(timestampMs: number) {
    const gpuComplete =
      !this.gpuSupported ||
      this.gpu.size >= this.expectedGpuFrames.size;
    if (
      gpuComplete ||
      timestampMs - this.phaseStartedAt >= this.gpuDrainMs
    ) {
      this.phase = "complete";
    }
  }

  private progress(elapsedMs: number) {
    const total = this.warmupMs + this.sampleDurationMs;
    if (this.phase === "complete") return 1;
    if (this.phase === "idle" || this.phase === "cancelled") return 0;
    if (this.phase === "finalizing") return 0.98;
    return round(Math.min(0.98, elapsedMs / Math.max(1, total)), 3);
  }

  private clearSamples() {
    this.frameIntervals.length = 0;
    this.cpuWork.length = 0;
    this.cpuRender.length = 0;
    this.gpu.clear();
    this.expectedGpuFrames.clear();
    this.drawCalls.length = 0;
    this.triangles.length = 0;
  }

  private resetToIdle() {
    this.clearSamples();
    this.phase = "idle";
    this.phaseStartedAt = 0;
    this.captureStartedAt = 0;
    this.lastTimestamp = 0;
    this.gpuSupported = false;
    this.cancelledReason = null;
    this.captureContext = null;
  }
}

function freezeCaptureContext(
  context: GraphicsBenchmarkContext,
): Readonly<GraphicsBenchmarkContext> {
  return Object.freeze({
    ...context,
    resolution: Object.freeze({ ...context.resolution }),
    forest: Object.freeze({ ...context.forest }),
    viewpoint: Object.freeze({ ...context.viewpoint }),
    environment: Object.freeze({ ...context.environment }),
    hardware: Object.freeze({ ...context.hardware }),
  });
}

export function initialGraphicsBenchmarkSnapshot() {
  return new GraphicsBenchmark().snapshot;
}
