import { describe, expect, it, vi } from "vitest";
import { Engine } from "../../lib/game/Engine";

type Pose = "runtime" | "on" | "off";

function engineWithStubs({ beamOn = false } = {}) {
  let pose: Pose = "runtime";
  const posesSeenByCompile: Pose[] = [];
  const programs: unknown[] = Array.from({ length: 10 }, () => ({}));
  const renderPipeline = {
    render: vi.fn(),
    compile: vi.fn(async () => {
      posesSeenByCompile.push(pose);
    }),
  };
  const flashlight = {
    isEnabled: beamOn,
    prepareForCompile: vi.fn((next: "on" | "off" = "on") => {
      pose = next;
    }),
    finishCompile: vi.fn(() => {
      pose = "runtime";
    }),
  };
  const engine = Object.create(Engine.prototype) as Engine;
  Object.assign(engine, {
    ready: true,
    disposed: false,
    renderer: { info: { programs } },
    renderPipeline,
    flashlight,
    flashlightWarmPrograms: programs.length,
    graphicsBenchmark: { isMeasuringGpu: false },
  });
  const keepWarm = () =>
    (engine as unknown as { keepFlashlightVariantsWarm(): void }).keepFlashlightVariantsWarm();
  return { engine, keepWarm, programs, renderPipeline, flashlight, posesSeenByCompile, pose: () => pose };
}

describe("flashlight shader warm-up", () => {
  it("compiles the beam-on pose once after a frame compiled new programs, without rendering", () => {
    const { keepWarm, programs, renderPipeline, posesSeenByCompile, pose } = engineWithStubs();
    programs.push({}, {});
    keepWarm();
    expect(renderPipeline.compile).toHaveBeenCalledTimes(1);
    expect(posesSeenByCompile).toEqual(["on"]);
    expect(renderPipeline.render).not.toHaveBeenCalled();
    expect(pose()).toBe("runtime");
  });

  it("does nothing while no new program has been compiled", () => {
    const { keepWarm, renderPipeline } = engineWithStubs();
    keepWarm();
    expect(renderPipeline.compile).not.toHaveBeenCalled();
  });

  it("compiles the beam-off pose while the beam is on", () => {
    const { keepWarm, programs, posesSeenByCompile } = engineWithStubs({ beamOn: true });
    programs.push({});
    keepWarm();
    expect(posesSeenByCompile).toEqual(["off"]);
  });

  it("does not warm again for the programs its own warm-up compiled", () => {
    const { keepWarm, programs, renderPipeline } = engineWithStubs();
    renderPipeline.compile.mockImplementationOnce(async () => {
      programs.push({}, {}, {});
    });
    programs.push({});
    keepWarm();
    keepWarm();
    expect(renderPipeline.compile).toHaveBeenCalledTimes(1);
  });

  it("follows released programs down without warming, then warms on new growth", () => {
    const { keepWarm, programs, renderPipeline } = engineWithStubs();
    programs.splice(0, 3);
    keepWarm();
    expect(renderPipeline.compile).not.toHaveBeenCalled();
    programs.push({});
    keepWarm();
    expect(renderPipeline.compile).toHaveBeenCalledTimes(1);
  });

  it("restores the beam and carries on when the warm-up fails", async () => {
    const { keepWarm, programs, renderPipeline, pose } = engineWithStubs();
    renderPipeline.compile.mockImplementationOnce(() => {
      throw new Error("compile failed");
    });
    programs.push({});
    expect(() => keepWarm()).not.toThrow();
    expect(pose()).toBe("runtime");
    renderPipeline.compile.mockImplementationOnce(() => Promise.reject(new Error("compile failed later")));
    programs.push({});
    expect(() => keepWarm()).not.toThrow();
    expect(pose()).toBe("runtime");
    // A rejected compile must not surface as an unhandled rejection.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("waits while the graphics benchmark measures the GPU", () => {
    const { engine, keepWarm, programs, renderPipeline } = engineWithStubs();
    Object.assign(engine, { graphicsBenchmark: { isMeasuringGpu: true } });
    programs.push({});
    keepWarm();
    expect(renderPipeline.compile).not.toHaveBeenCalled();
    Object.assign(engine, { graphicsBenchmark: { isMeasuringGpu: false } });
    keepWarm();
    expect(renderPipeline.compile).toHaveBeenCalledTimes(1);
  });
});
