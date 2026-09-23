import { describe, expect, it, vi } from "vitest";
import { Engine } from "../../lib/game/Engine";
import { DEFAULT_GAME_SETTINGS } from "../../lib/game/settings";

function engineWithStubs(ready: boolean) {
  let flashlightPose: "runtime" | "compile" = "runtime";
  const posesSeenByCompile: string[] = [];
  const quality = () => ({ setQuality: vi.fn() });
  const renderPipeline = {
    setQuality: vi.fn(),
    compile: vi.fn(async () => {
      posesSeenByCompile.push(flashlightPose);
    }),
  };
  const flashlight = {
    setQuality: vi.fn(),
    prepareForCompile: vi.fn(() => {
      flashlightPose = "compile";
    }),
    finishCompile: vi.fn(() => {
      flashlightPose = "runtime";
    }),
  };
  const engine = Object.create(Engine.prototype) as Engine;
  Object.assign(engine, {
    ready,
    disposed: false,
    quality: "performance",
    settings: { ...DEFAULT_GAME_SETTINGS, quality: "performance" },
    runtime: {},
    graphicsBenchmark: { invalidate: vi.fn() },
    renderPipeline,
    environment: quality(),
    materialLibrary: quality(),
    world: quality(),
    forestStress: quality(),
    citizens: quality(),
    animals: quality(),
    playerAvatar: quality(),
    flashlight,
    resize: vi.fn(),
    persistPreferences: vi.fn(),
    emitSnapshot: vi.fn(),
  });
  return { engine, renderPipeline, flashlight, posesSeenByCompile, pose: () => flashlightPose };
}

describe("quality change shader warm-up", () => {
  it("recompiles with the flashlight's shadowed beam in its compile pose", () => {
    const { engine, renderPipeline, flashlight, posesSeenByCompile, pose } = engineWithStubs(true);
    expect(engine.setQuality("cinematic")).toBe(true);
    expect(renderPipeline.compile).toHaveBeenCalledTimes(1);
    expect(posesSeenByCompile).toEqual(["compile"]);
    expect(flashlight.setQuality.mock.invocationCallOrder[0]).toBeLessThan(
      flashlight.prepareForCompile.mock.invocationCallOrder[0] ?? 0,
    );
    expect(pose()).toBe("runtime");
  });

  it("leaves the first warm-up to boot when the engine is not ready yet", () => {
    const { engine, renderPipeline, flashlight } = engineWithStubs(false);
    expect(engine.setQuality("cinematic")).toBe(true);
    expect(renderPipeline.compile).not.toHaveBeenCalled();
    expect(flashlight.prepareForCompile).not.toHaveBeenCalled();
  });

  it("keeps the quality change when the warm-up fails", async () => {
    const { engine, renderPipeline, pose } = engineWithStubs(true);
    renderPipeline.compile.mockImplementationOnce(async () => {
      throw new Error("compile failed");
    });
    expect(engine.setQuality("cinematic")).toBe(true);
    await Promise.resolve();
    expect(pose()).toBe("runtime");
    expect((engine as unknown as { quality: string }).quality).toBe("cinematic");
  });
});
