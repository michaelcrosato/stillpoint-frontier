import { describe, expect, it, vi } from "vitest";
import { Engine } from "../../lib/game/Engine";

type Pose = "runtime" | "on" | "off";

function engineWithStubs({ beamOn = false } = {}) {
  let pose: Pose = "runtime";
  const posesSeenByRender: Pose[] = [];
  const programs: unknown[] = Array.from({ length: 10 }, () => ({}));
  const renderPipeline = {
    render: vi.fn(() => {
      posesSeenByRender.push(pose);
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
  return { engine, keepWarm, programs, renderPipeline, flashlight, posesSeenByRender, pose: () => pose };
}

describe("flashlight shader warm-up", () => {
  it("renders the beam-on pose once after a frame compiled new programs", () => {
    const { keepWarm, programs, renderPipeline, posesSeenByRender, pose } = engineWithStubs();
    programs.push({}, {});
    keepWarm();
    expect(renderPipeline.render).toHaveBeenCalledTimes(1);
    expect(posesSeenByRender).toEqual(["on"]);
    expect(pose()).toBe("runtime");
  });

  it("does nothing while no new program has been compiled", () => {
    const { keepWarm, renderPipeline } = engineWithStubs();
    keepWarm();
    expect(renderPipeline.render).not.toHaveBeenCalled();
  });

  it("renders the beam-off pose while the beam is on", () => {
    const { keepWarm, programs, posesSeenByRender } = engineWithStubs({ beamOn: true });
    programs.push({});
    keepWarm();
    expect(posesSeenByRender).toEqual(["off"]);
  });

  it("does not warm again for the programs its own warm-up compiled", () => {
    const { keepWarm, programs, renderPipeline } = engineWithStubs();
    renderPipeline.render.mockImplementationOnce(() => {
      programs.push({}, {}, {});
    });
    programs.push({});
    keepWarm();
    keepWarm();
    expect(renderPipeline.render).toHaveBeenCalledTimes(1);
  });

  it("follows released programs down without warming, then warms on new growth", () => {
    const { keepWarm, programs, renderPipeline } = engineWithStubs();
    programs.splice(0, 3);
    keepWarm();
    expect(renderPipeline.render).not.toHaveBeenCalled();
    programs.push({});
    keepWarm();
    expect(renderPipeline.render).toHaveBeenCalledTimes(1);
  });

  it("restores the beam and carries on when the warm-up fails", () => {
    const { keepWarm, programs, renderPipeline, pose } = engineWithStubs();
    renderPipeline.render.mockImplementationOnce(() => {
      throw new Error("render failed");
    });
    programs.push({});
    expect(() => keepWarm()).not.toThrow();
    expect(pose()).toBe("runtime");
  });

  it("waits while the graphics benchmark measures the GPU", () => {
    const { engine, keepWarm, programs, renderPipeline } = engineWithStubs();
    Object.assign(engine, { graphicsBenchmark: { isMeasuringGpu: true } });
    programs.push({});
    keepWarm();
    expect(renderPipeline.render).not.toHaveBeenCalled();
    Object.assign(engine, { graphicsBenchmark: { isMeasuringGpu: false } });
    keepWarm();
    expect(renderPipeline.render).toHaveBeenCalledTimes(1);
  });
});
