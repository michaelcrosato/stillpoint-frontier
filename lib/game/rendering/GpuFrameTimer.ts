export interface GpuFrameTimingSample {
  frameToken: number;
  milliseconds: number;
}

export type GpuFrameTimerStatus =
  | "unsupported"
  | "ready"
  | "pending"
  | "disjoint";

interface DisjointTimerQueryExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

interface PendingQuery {
  query: WebGLQuery;
  frameToken: number;
}

const MAX_PENDING_QUERIES = 16;

/**
 * Non-blocking WebGL2 GPU timings. Results are polled on later frames; this
 * class never calls finish(), waits, or reads an unavailable query result.
 */
export class GpuFrameTimer {
  private extension: DisjointTimerQueryExtension | null = null;
  private pending: PendingQuery[] = [];
  private active: PendingQuery | null = null;
  private disposed = false;
  private disjointEvents = 0;
  private skippedFrames = 0;
  private lastMilliseconds: number | null = null;
  private status: GpuFrameTimerStatus = "unsupported";

  constructor(private context: WebGL2RenderingContext) {
    this.acquireExtension();
  }

  begin(frameToken: number) {
    if (
      this.disposed ||
      !this.extension ||
      this.active ||
      this.pending.length >= MAX_PENDING_QUERIES ||
      !Number.isSafeInteger(frameToken)
    ) {
      if (this.extension && this.pending.length >= MAX_PENDING_QUERIES) {
        this.skippedFrames += 1;
      }
      return false;
    }
    const query = this.context.createQuery();
    if (!query) {
      this.skippedFrames += 1;
      return false;
    }
    try {
      this.context.beginQuery(this.extension.TIME_ELAPSED_EXT, query);
      this.active = { query, frameToken };
      this.status = "pending";
      return true;
    } catch {
      this.deleteQuerySafely(query);
      this.skippedFrames += 1;
      return false;
    }
  }

  end() {
    if (this.disposed || !this.extension || !this.active) return false;
    const active = this.active;
    try {
      this.context.endQuery(this.extension.TIME_ELAPSED_EXT);
      this.pending.push(active);
      this.active = null;
      this.status = "pending";
      return true;
    } catch {
      this.deleteQuerySafely(active.query);
      this.active = null;
      this.skippedFrames += 1;
      return false;
    }
  }

  poll(): GpuFrameTimingSample[] {
    if (this.disposed || !this.extension) return [];
    let disjoint = false;
    try {
      disjoint = Boolean(
        this.context.getParameter(this.extension.GPU_DISJOINT_EXT),
      );
    } catch {
      disjoint = true;
    }
    if (disjoint) {
      this.disjointEvents += 1;
      this.clearPending();
      this.lastMilliseconds = null;
      this.status = "disjoint";
      return [];
    }

    const samples: GpuFrameTimingSample[] = [];
    const remaining: PendingQuery[] = [];
    for (const pending of this.pending) {
      let available = false;
      try {
        available = Boolean(
          this.context.getQueryParameter(
            pending.query,
            this.context.QUERY_RESULT_AVAILABLE,
          ),
        );
      } catch {
        available = false;
      }
      if (!available) {
        remaining.push(pending);
        continue;
      }
      try {
        const nanoseconds = Number(
          this.context.getQueryParameter(
            pending.query,
            this.context.QUERY_RESULT,
          ),
        );
        const milliseconds = nanoseconds / 1_000_000;
        if (Number.isFinite(milliseconds) && milliseconds >= 0) {
          samples.push({ frameToken: pending.frameToken, milliseconds });
          this.lastMilliseconds = milliseconds;
        } else {
          this.skippedFrames += 1;
        }
      } catch {
        this.skippedFrames += 1;
      }
      this.deleteQuerySafely(pending.query);
    }
    this.pending = remaining;
    this.status = this.pending.length > 0 ? "pending" : "ready";
    return samples;
  }

  handleContextRestored(context: WebGL2RenderingContext) {
    if (this.disposed) return;
    this.clearPending();
    this.context = context;
    this.active = null;
    this.lastMilliseconds = null;
    this.acquireExtension();
  }

  get diagnostics() {
    return {
      supported: this.extension !== null,
      status: this.status,
      pendingQueries: this.pending.length + Number(this.active !== null),
      disjointEvents: this.disjointEvents,
      skippedFrames: this.skippedFrames,
      lastMilliseconds: this.lastMilliseconds,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.active) {
      this.deleteQuerySafely(this.active.query);
      this.active = null;
    }
    this.clearPending();
    this.extension = null;
    this.status = "unsupported";
  }

  private acquireExtension() {
    try {
      this.extension = this.context.getExtension(
        "EXT_disjoint_timer_query_webgl2",
      ) as DisjointTimerQueryExtension | null;
    } catch {
      this.extension = null;
    }
    this.status = this.extension ? "ready" : "unsupported";
  }

  private clearPending() {
    for (const pending of this.pending) {
      this.deleteQuerySafely(pending.query);
    }
    this.pending = [];
  }

  private deleteQuerySafely(query: WebGLQuery) {
    try {
      this.context.deleteQuery(query);
    } catch {
      this.skippedFrames += 1;
    }
  }
}
