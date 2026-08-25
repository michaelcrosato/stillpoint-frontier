import { describe, expect, it } from "vitest";
import { GpuFrameTimer } from "../../lib/game/rendering/GpuFrameTimer";

function fakeContext(options: {
  supported?: boolean;
  disjoint?: boolean;
  throwResult?: boolean;
  throwDelete?: boolean;
} = {}) {
  const queries: object[] = [];
  const deleted: object[] = [];
  let resultAvailable = false;
  const extension = options.supported === false
    ? null
    : { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };
  const context = {
    QUERY_RESULT_AVAILABLE: 0x8867,
    QUERY_RESULT: 0x8866,
    getExtension: () => extension,
    createQuery: () => {
      const query = {};
      queries.push(query);
      return query;
    },
    beginQuery: () => undefined,
    endQuery: () => undefined,
    deleteQuery: (query: object) => {
      if (options.throwDelete) throw new Error("context lost");
      deleted.push(query);
    },
    getParameter: () => options.disjoint ?? false,
    getQueryParameter: (_query: object, key: number) => {
      if (key !== 0x8867 && options.throwResult) throw new Error("query invalid");
      return key === 0x8867 ? resultAvailable : 4_250_000;
    },
  } as unknown as WebGL2RenderingContext;
  return {
    context,
    queries,
    deleted,
    makeAvailable: () => {
      resultAvailable = true;
    },
  };
}

describe("non-blocking GPU frame timer", () => {
  it("reports unsupported contexts without creating queries", () => {
    const fake = fakeContext({ supported: false });
    const timer = new GpuFrameTimer(fake.context);
    expect(timer.diagnostics).toMatchObject({
      supported: false,
      status: "unsupported",
      pendingQueries: 0,
    });
    expect(timer.begin(1)).toBe(false);
    expect(timer.poll()).toEqual([]);
    timer.dispose();
  });

  it("polls later without blocking and converts nanoseconds to milliseconds", () => {
    const fake = fakeContext();
    const timer = new GpuFrameTimer(fake.context);
    expect(timer.begin(7)).toBe(true);
    expect(timer.end()).toBe(true);
    expect(timer.poll()).toEqual([]);
    expect(timer.diagnostics.pendingQueries).toBe(1);
    fake.makeAvailable();
    expect(timer.poll()).toEqual([{ frameToken: 7, milliseconds: 4.25 }]);
    expect(timer.diagnostics).toMatchObject({
      status: "ready",
      pendingQueries: 0,
      lastMilliseconds: 4.25,
    });
    expect(fake.deleted).toHaveLength(1);
    timer.dispose();
    timer.dispose();
  });

  it("discards invalid query epochs and reacquires after restoration", () => {
    const disjoint = fakeContext({ disjoint: true });
    const timer = new GpuFrameTimer(disjoint.context);
    timer.begin(3);
    timer.end();
    expect(timer.poll()).toEqual([]);
    expect(timer.diagnostics).toMatchObject({
      status: "disjoint",
      disjointEvents: 1,
      pendingQueries: 0,
    });
    const restored = fakeContext();
    timer.handleContextRestored(restored.context);
    expect(timer.diagnostics).toMatchObject({ supported: true, status: "ready" });
    timer.dispose();
  });

  it("retires invalidated results without throwing out of the render loop", () => {
    const fake = fakeContext({ throwResult: true, throwDelete: true });
    const timer = new GpuFrameTimer(fake.context);
    expect(timer.begin(11)).toBe(true);
    expect(timer.end()).toBe(true);
    fake.makeAvailable();
    expect(() => timer.poll()).not.toThrow();
    expect(timer.poll()).toEqual([]);
    expect(timer.diagnostics).toMatchObject({
      pendingQueries: 0,
      status: "ready",
    });
    expect(timer.diagnostics.skippedFrames).toBeGreaterThan(0);
    expect(() => timer.dispose()).not.toThrow();
  });
});
