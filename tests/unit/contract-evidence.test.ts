import { describe, expect, it } from "vitest";
import {
  acceptContract,
  contractById,
  currentContractObjective,
  createContractJournal,
  progressContracts,
  type ContractJournalState,
} from "../../lib/game/gameplay/contracts";
import { reconcileContractEvidence } from "../../lib/game/gameplay/contractEvidence";
import { EMPTY_INVENTORY } from "../../lib/game/gameplay/items";
import { createFeatureProgress, normalizeFeatureProgress } from "../../lib/game/gameplay/progression";

const emptyFacts = {
  inventory: { ...EMPTY_INVENTORY },
  fieldGuideEntries: [] as string[],
  containerStates: {},
  placedEntities: [],
  lastRestAt: null,
};

function objectiveId(journal: ContractJournalState) {
  const activeId = journal.activeContractId;
  const definition = activeId ? contractById(activeId) : null;
  const progress = definition ? journal.contracts[definition.id] : null;
  return definition && progress
    ? currentContractObjective(definition, progress)?.id ?? null
    : null;
}

describe("persistent contract evidence", () => {
  it("counts actual rest minutes without inventing duration from a timestamp", () => {
    let journal = acceptContract(createContractJournal(), "contract:shelter-protocol:v1", 300);
    journal = progressContracts(journal, { type: "item.crafted", recipeId: "recipe:bedroll:v1", item: "bedroll", quantity: 1 });
    journal = progressContracts(journal, { type: "structure.placed", archetypeId: "bedroll" });
    expect(objectiveId(journal)).toBe("rest-field");
    const facts = { ...emptyFacts, lastRestAt: 420 };
    expect(reconcileContractEvidence(journal, facts)).toEqual(journal);
    journal = progressContracts(journal, { type: "rest.completed", siteId: "test", minutes: 1 });
    journal = reconcileContractEvidence(journal, facts);
    expect(journal.contracts["contract:shelter-protocol:v1"]?.objectiveProgress["rest-field"]).toBe(1);
    const restored = normalizeFeatureProgress(JSON.parse(JSON.stringify({ ...createFeatureProgress(), contractJournal: journal, lastRestAt: 420 })));
    journal = reconcileContractEvidence(restored.contractJournal, facts);
    expect(objectiveId(journal)).toBe("rest-field");
    journal = progressContracts(journal, { type: "rest.completed", siteId: "test", minutes: 59 });
    expect(objectiveId(journal)).toBe("return-mara");
  });
  it("reconciles gathering and a scan completed before their ordered steps", () => {
    const accepted = acceptContract(
      createContractJournal(),
      "contract:field-calibration:v1",
      500,
    );
    const inspected = progressContracts(accepted, {
      type: "object.inspected",
      targetId: "inspectable:field-unit-noticeboard",
    });
    const reconciled = reconcileContractEvidence(inspected, {
      ...emptyFacts,
      inventory: { ...EMPTY_INVENTORY, fiber: 2 },
      fieldGuideEntries: ["guide:landmark:field-unit-weather-mast:v1"],
    });
    expect(objectiveId(reconciled)).toBe("return-mara");
  });

  it("reconciles a one-time cache and fauna scan without duplicating loot", () => {
    const accepted = acceptContract(
      createContractJournal(),
      "contract:meridian-stores:v1",
      900,
    );
    const inspected = progressContracts(accepted, {
      type: "object.inspected",
      targetId: "inspectable:meridian-tower-directory",
    });
    const reconciled = reconcileContractEvidence(inspected, {
      ...emptyFacts,
      fieldGuideEntries: ["guide:animal:meadow_hare:v1"],
      containerStates: {
        "container:meridian-tower:service-a": {
          opened: true,
          looted: true,
          remaining: {},
        },
      },
    });
    expect(objectiveId(reconciled)).toBe("return-mara");
    expect(reconciled.contracts["contract:meridian-stores:v1"]?.objectiveProgress)
      .toMatchObject({ "loot-service-cache": 1, "scan-fauna": 1 });
  });
});
