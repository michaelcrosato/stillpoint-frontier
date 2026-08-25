import {
  CONTRACT_DEFINITIONS,
  currentContractObjective,
  progressContracts,
  type ContractJournalState,
} from "./contracts";
import type { GameplayEvent } from "./events";
import { fieldGuideEntry } from "./fieldGuide";
import type { InventoryState } from "./items";
import type { ContainerStates } from "./loot";
import { recipeById } from "./crafting";
import type { PlacedEntity } from "../world/deployments";

export interface PersistentContractEvidence {
  inventory: Readonly<InventoryState>;
  fieldGuideEntries: readonly string[];
  containerStates: Readonly<ContainerStates>;
  placedEntities: readonly PlacedEntity[];
  lastRestAt: number | null;
}

/**
 * Advances ordered objectives from facts that remain provable after their
 * original gameplay event. The bounded replay prevents one-time world actions
 * from becoming contract soft locks while keeping the journal deterministic.
 */
export function reconcileContractEvidence(
  journal: Readonly<ContractJournalState>,
  facts: Readonly<PersistentContractEvidence>,
): ContractJournalState {
  let next: ContractJournalState = structuredClone(journal);
  for (let pass = 0; pass < 64; pass += 1) {
    let evidence: GameplayEvent | null = null;
    for (const definition of CONTRACT_DEFINITIONS) {
      const progress = next.contracts[definition.id];
      if (!progress || progress.status !== "active") continue;
      const objective = currentContractObjective(definition, progress);
      if (!objective) continue;
      const matcher = objective.matcher;
      const recorded = progress.objectiveProgress[objective.id] ?? 0;
      if (matcher.type === "scan") {
        const entryId = matcher.entryId ?? facts.fieldGuideEntries.find(
          (candidate) => fieldGuideEntry(candidate)?.category === matcher.category,
        );
        if (entryId && facts.fieldGuideEntries.includes(entryId)) {
          evidence = { type: "subject.scanned", entryId };
        }
      } else if (matcher.type === "loot") {
        if (facts.containerStates[matcher.containerId]?.looted) {
          evidence = {
            type: "container.looted",
            containerId: matcher.containerId,
            quantity: 1,
          };
        }
      } else if (matcher.type === "collect") {
        const provenQuantity = Math.max(0, facts.inventory[matcher.item] - recorded);
        if (provenQuantity > 0) {
          evidence = {
            type: "item.collected",
            item: matcher.item,
            quantity: provenQuantity,
          };
        }
      } else if (matcher.type === "craft") {
        const recipe = recipeById(matcher.recipeId);
        const outputPresent = recipe && facts.inventory[recipe.output.item] > 0;
        const outputDeployed = matcher.recipeId === "recipe:bedroll:v1" &&
          facts.placedEntities.some((record) => record.archetypeId === "bedroll");
        if (recipe && (outputPresent || outputDeployed)) {
          evidence = {
            type: "item.crafted",
            recipeId: recipe.id,
            item: recipe.output.item,
            quantity: 1,
          };
        }
      } else if (matcher.type === "place") {
        if (facts.placedEntities.some(
          (record) => record.archetypeId === matcher.archetypeId,
        )) {
          evidence = { type: "structure.placed", archetypeId: matcher.archetypeId };
        }
      } else if (matcher.type === "rest") {
        if (facts.lastRestAt !== null && facts.lastRestAt >= progress.acceptedAt) {
          evidence = {
            type: "rest.completed",
            siteId: "persistent-rest-evidence",
            minutes: Math.max(0, objective.amount - recorded),
          };
        }
      }
      if (evidence) break;
    }
    if (!evidence) break;
    const advanced = progressContracts(next, evidence);
    if (JSON.stringify(advanced) === JSON.stringify(next)) break;
    next = advanced;
  }
  return next;
}
