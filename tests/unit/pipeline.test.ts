import { describe, expect, it, vi } from "vitest";
import { FeatureRegistry } from "../../lib/game/core/FeatureRegistry";
import { SystemPipeline, type GameSystem } from "../../lib/game/core/SystemPipeline";

interface Context {
  calls: string[];
}

function system(id: string, order: number): GameSystem<Context> {
  return {
    id,
    order,
    update: (context) => context.calls.push(id),
    dispose: vi.fn(),
  };
}

describe("system pipeline", () => {
  it("executes systems in declared order, independent of registration order", () => {
    const pipeline = new SystemPipeline<Context>();
    pipeline.register(system("render-state", 30));
    pipeline.register(system("input", 10));
    pipeline.register(system("simulation", 20));
    const context = { calls: [] as string[] };
    pipeline.update(context, 1 / 60);
    expect(context.calls).toEqual(["input", "simulation", "render-state"]);
    expect(pipeline.ids()).toEqual(["input", "simulation", "render-state"]);
  });

  it("rejects duplicate system identifiers", () => {
    const pipeline = new SystemPipeline<Context>();
    pipeline.register(system("input", 10));
    expect(() => pipeline.register(system("input", 20))).toThrow("System already registered");
  });

  it("disposes systems in reverse lifecycle order", () => {
    const disposed: string[] = [];
    const pipeline = new SystemPipeline<Context>();
    pipeline.register({ id: "first", order: 1, update() {}, dispose: () => disposed.push("first") });
    pipeline.register({ id: "last", order: 2, update() {}, dispose: () => disposed.push("last") });
    pipeline.dispose();
    expect(disposed).toEqual(["last", "first"]);
    expect(pipeline.ids()).toEqual([]);
  });
});

describe("feature registry", () => {
  it("lets gameplay modules contribute ordered systems", () => {
    const pipeline = new SystemPipeline<Context>();
    const registry = new FeatureRegistry(pipeline);
    registry.use({
      id: "surveying",
      install: (target) => target.system(system("interactions", 30)).system(system("movement", 10)),
    });
    expect(registry.ids()).toEqual(["surveying"]);
    expect(pipeline.ids()).toEqual(["movement", "interactions"]);
  });

  it("rejects installing the same feature twice", () => {
    const registry = new FeatureRegistry(new SystemPipeline<Context>());
    const feature = { id: "surveying", install() {} };
    registry.use(feature);
    expect(() => registry.use(feature)).toThrow("Feature already installed");
  });
});
