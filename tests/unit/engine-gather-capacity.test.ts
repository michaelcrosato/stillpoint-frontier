import { describe, expect, it, vi } from "vitest";
import { Engine } from "../../lib/game/Engine";
import { EMPTY_INVENTORY } from "../../lib/game/gameplay/items";

describe("engine full-stack gather routing", () => {
  it("shows feedback without mutation, save, sound, or false contract credit", () => {
    const engine = Object.create(Engine.prototype) as Engine;
    const hooks = { persist: vi.fn(), applyGameplayEvent: vi.fn(), emitSnapshot: vi.fn() };
    const world = { applyEntityDiff: vi.fn() };
    const audio = { playCue: vi.fn() };
    Object.assign(engine, { inventory: { ...EMPTY_INVENTORY, stone: 999 }, worldDiffs: {}, world, audio, ...hooks });
    const target = { id: "resource:rock:test", name: "Rock", action: "harvest", item: "stone", yieldAmount: 3, hitsRequired: 1 } as Parameters<Engine["performInteraction"]>[0];
    engine.performInteraction(target);
    expect(world.applyEntityDiff).not.toHaveBeenCalled();
    expect(audio.playCue).not.toHaveBeenCalled();
    expect(hooks.persist).not.toHaveBeenCalled();
    expect(hooks.applyGameplayEvent).not.toHaveBeenCalled();
    expect(hooks.emitSnapshot).toHaveBeenCalledWith(true);
    expect(engine).toMatchObject({ lastFeatureNotice: { title: "Not enough stack space" } });
  });
});
