import { describe, expect, it } from "vitest";
import {
  CONTRACT_DEFINITIONS,
  acceptContract,
  contractById,
  createContractJournal,
  currentContractObjective,
  normalizeContractJournal,
  progressContracts,
  turnInContract,
} from "../../lib/game/gameplay/contracts";
import { MAX_WORLD_MINUTES } from "../../lib/game/environment/model";

const CALIBRATION_ID = "contract:field-calibration:v1";
const SHELTER_ID = "contract:shelter-protocol:v1";

describe("field contract progression", () => {
  it("uses stable unique contract and objective identifiers", () => {
    expect(new Set(CONTRACT_DEFINITIONS.map((contract) => contract.id)).size)
      .toBe(CONTRACT_DEFINITIONS.length);
    for (const contract of CONTRACT_DEFINITIONS) {
      expect(contract.code).not.toBe("");
      expect(contract.objectives.length).toBeGreaterThan(0);
      expect(new Set(contract.objectives.map((objective) => objective.id)).size)
        .toBe(contract.objectives.length);
      expect(contract.objectives.every((objective) => objective.amount > 0)).toBe(true);
    }
    expect(contractById("contract:invented")).toBeNull();
  });

  it("accepts a known contract once and ignores out-of-order events", () => {
    const initial = createContractJournal();
    const accepted = acceptContract(initial, CALIBRATION_ID, -40);
    expect(accepted.activeContractId).toBe(CALIBRATION_ID);
    expect(accepted.contracts[CALIBRATION_ID]).toMatchObject({
      status: "active",
      acceptedAt: 0,
      objectiveProgress: {},
    });

    const duplicate = acceptContract(accepted, CALIBRATION_ID, 900);
    expect(duplicate).toEqual(accepted);
    expect(acceptContract(initial, "contract:invented", 900)).toEqual(initial);
    expect(
      acceptContract(initial, CALIBRATION_ID, MAX_WORLD_MINUTES * 2)
        .contracts[CALIBRATION_ID]?.acceptedAt,
    ).toBe(MAX_WORLD_MINUTES);

    const outOfOrder = progressContracts(accepted, {
      type: "item.collected",
      item: "fiber",
      quantity: 99,
    });
    expect(outOfOrder).toEqual(accepted);
  });

  it("enforces one outstanding contract until the current assignment is filed", () => {
    let journal = acceptContract(createContractJournal(), CALIBRATION_ID, 450);
    expect(acceptContract(journal, SHELTER_ID, 451)).toEqual(journal);
    expect(journal.contracts[SHELTER_ID]).toBeUndefined();

    journal = progressContracts(journal, {
      type: "object.inspected",
      targetId: "inspectable:field-unit-noticeboard",
    });
    journal = progressContracts(journal, {
      type: "item.collected",
      item: "fiber",
      quantity: 2,
    });
    journal = progressContracts(journal, {
      type: "subject.scanned",
      entryId: "guide:landmark:field-unit-weather-mast:v1",
    });
    journal = progressContracts(journal, {
      type: "npc.talked",
      npcId: "npc:mara-venn:v1",
    });
    expect(journal.contracts[CALIBRATION_ID]?.status).toBe("ready");
    expect(acceptContract(journal, SHELTER_ID, 500)).toEqual(journal);

    const filed = turnInContract(journal, CALIBRATION_ID, 510).state;
    const next = acceptContract(filed, SHELTER_ID, 511);
    expect(next.contracts[CALIBRATION_ID]?.status).toBe("completed");
    expect(next.contracts[SHELTER_ID]).toMatchObject({
      status: "active",
      acceptedAt: 511,
    });
    expect(next.activeContractId).toBe(SHELTER_ID);
  });

  it("advances only the current objective, clamps counts, and grants rewards once", () => {
    let journal = acceptContract(createContractJournal(), CALIBRATION_ID, 450);
    const definition = contractById(CALIBRATION_ID)!;
    expect(currentContractObjective(definition, journal.contracts[CALIBRATION_ID]! )?.id)
      .toBe("inspect-orders");

    journal = progressContracts(journal, {
      type: "object.inspected",
      targetId: "inspectable:field-unit-noticeboard",
    });
    journal = progressContracts(journal, {
      type: "item.collected",
      item: "fiber",
      quantity: 50,
    });
    expect(journal.contracts[CALIBRATION_ID]?.objectiveProgress).toMatchObject({
      "inspect-orders": 1,
      "collect-fiber": 2,
    });

    journal = progressContracts(journal, {
      type: "subject.scanned",
      entryId: "guide:landmark:field-unit-weather-mast:v1",
    });
    journal = progressContracts(journal, {
      type: "npc.talked",
      npcId: "npc:mara-venn:v1",
    });
    expect(journal.contracts[CALIBRATION_ID]?.status).toBe("ready");

    const completed = turnInContract(journal, CALIBRATION_ID, 525);
    expect(completed.state.contracts[CALIBRATION_ID]).toMatchObject({
      status: "completed",
      completedAt: 525,
    });
    expect(completed.rewards).toEqual({ first_aid_kit: 1 });
    expect(turnInContract(completed.state, CALIBRATION_ID, 600).rewards).toBeNull();
  });

  it("supports minute-valued rest objectives without skipping their ordered prerequisites", () => {
    let journal = acceptContract(createContractJournal(), SHELTER_ID, 600);
    journal = progressContracts(journal, {
      type: "rest.completed",
      siteId: "placed:bedroll:1:rest",
      minutes: 240,
    });
    expect(journal.contracts[SHELTER_ID]?.objectiveProgress).toEqual({});

    journal = progressContracts(journal, {
      type: "item.crafted",
      recipeId: "recipe:bedroll:v1",
      item: "bedroll",
      quantity: 1,
    });
    journal = progressContracts(journal, {
      type: "structure.placed",
      archetypeId: "bedroll",
    });
    journal = progressContracts(journal, {
      type: "rest.completed",
      siteId: "placed:bedroll:1:rest",
      minutes: 240,
    });
    expect(journal.contracts[SHELTER_ID]?.objectiveProgress["rest-field"]).toBe(60);
  });

  it("sanitizes unknown contracts, objective IDs, counts, and contradictory completion", () => {
    const normalized = normalizeContractJournal({
      activeContractId: "contract:invented",
      contracts: {
        [CALIBRATION_ID]: {
          status: "completed",
          acceptedAt: -30,
          completedAt: -20,
          objectiveProgress: {
            "inspect-orders": 8,
            "collect-fiber": Number.POSITIVE_INFINITY,
            invented: 99,
          },
        },
        "contract:invented": {
          status: "completed",
          objectiveProgress: { anything: 1 },
        },
      },
    });
    expect(Object.keys(normalized.contracts)).toEqual([CALIBRATION_ID]);
    expect(normalized.contracts[CALIBRATION_ID]).toEqual({
      status: "active",
      acceptedAt: 0,
      completedAt: null,
      objectiveProgress: { "inspect-orders": 1 },
    });
    expect(normalized.activeContractId).toBe(CALIBRATION_ID);
  });
});
