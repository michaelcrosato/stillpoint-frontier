import { describe, expect, it, vi } from "vitest";
import { Engine } from "../../lib/game/Engine";
import { acceptContract, createContractJournal, progressContracts } from "../../lib/game/gameplay/contracts";
import { EMPTY_INVENTORY } from "../../lib/game/gameplay/items";
import { createFeatureProgress } from "../../lib/game/gameplay/progression";

const CONTRACT_ID = "contract:field-calibration:v1";
const CONTAINER_ID = "container:field-unit-01:locker-a";

function fixture(full = false) {
  const engine = Object.create(Engine.prototype) as Engine;
  let contractJournal = acceptContract(createContractJournal(), CONTRACT_ID, 450);
  if (!full) {
    contractJournal = progressContracts(contractJournal, {
      type: "object.inspected", targetId: "inspectable:field-unit-noticeboard",
    });
  }
  const inventory = { ...EMPTY_INVENTORY, wood: full ? 999 : 0, fiber: full ? 999 : 0 };
  const featureProgress = {
    ...createFeatureProgress(), contractJournal,
    containerStates: {
      [CONTAINER_ID]: { opened: true, looted: false, remaining: { wood: 1, fiber: 1 } },
    },
  };
  const hooks = { persist: vi.fn(), emitSnapshot: vi.fn(), syncContractNavigation: vi.fn() };
  const world = { setContainerStates: vi.fn() };
  const audio = { playCue: vi.fn() };
  Object.assign(engine, { inventory, featureProgress, world, audio, ...hooks });
  return { engine, inventory, featureProgress, hooks, world, audio };
}

function transfer(engine: Engine, method: "single" | "all") {
  return method === "single"
    ? engine.takeContainerItem(CONTAINER_ID, "fiber", 1)
    : engine.takeAllContainerItems(CONTAINER_ID);
}

describe("engine container progression", () => {
  it.each(["single", "all"] as const)("%s credits one transferred fiber once", (method) => {
    const { engine } = fixture();
    expect(transfer(engine, method)).toBe(true);
    expect(engine).toMatchObject({
      inventory: { fiber: 1, wood: method === "all" ? 1 : 0 },
      featureProgress: { contractJournal: { contracts: {
        [CONTRACT_ID]: { status: "active", objectiveProgress: { "inspect-orders": 1, "collect-fiber": 1 } },
      } } },
    });
  });

  it.each(["single", "all"] as const)("%s preserves a transfer with no capacity", (method) => {
    const { engine, inventory, featureProgress, hooks, world, audio } = fixture(true);
    const before = structuredClone({ inventory, featureProgress });
    expect(transfer(engine, method)).toBe(false);
    expect(engine).toMatchObject(before);
    expect(world.setContainerStates).not.toHaveBeenCalled();
    expect(hooks.persist).not.toHaveBeenCalled();
    expect(hooks.syncContractNavigation).not.toHaveBeenCalled();
    expect(audio.playCue).not.toHaveBeenCalled();
  });
});
