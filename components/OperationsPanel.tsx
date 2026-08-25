"use client";

import { useMemo, useState } from "react";
import {
  CONTRACT_DEFINITIONS,
  currentContractObjective,
  hasOutstandingContract,
} from "../lib/game/gameplay/contracts";
import {
  RECIPE_DEFINITIONS,
  canUseStation,
  recipeMissingItems,
  type CraftingStationKind,
} from "../lib/game/gameplay/crafting";
import {
  FIELD_GUIDE_ENTRIES,
  type FieldGuideCategory,
} from "../lib/game/gameplay/fieldGuide";
import { ITEM_DEFINITIONS, type ItemId } from "../lib/game/gameplay/items";
import type { GameSnapshot, OperationsTab } from "../lib/game/state";
import FeatureDialog from "./FeatureDialog";

const OPERATION_TABS: ReadonlyArray<{ id: OperationsTab; label: string }> = [
  { id: "contracts", label: "CONTRACTS" },
  { id: "crafting", label: "FABRICATION" },
  { id: "fieldGuide", label: "FIELD GUIDE" },
];

const GUIDE_CATEGORIES: ReadonlyArray<{ id: FieldGuideCategory; label: string }> = [
  { id: "fauna", label: "FAUNA" },
  { id: "flora", label: "FLORA" },
  { id: "resource", label: "RESOURCES" },
  { id: "landmark", label: "LANDMARKS" },
];

interface OperationsPanelProps {
  snapshot: GameSnapshot;
  initialTab: OperationsTab;
  station: CraftingStationKind;
  onClose(): void;
  onAcceptContract(contractId: string): void;
  onTurnInContract(contractId: string): void;
  onCraft(recipeId: string, station: CraftingStationKind): void;
}

function ContractsView({
  snapshot,
  onAccept,
  onTurnIn,
}: {
  snapshot: GameSnapshot;
  onAccept(contractId: string): void;
  onTurnIn(contractId: string): void;
}) {
  const journal = snapshot.contractJournal;
  const hasOutstanding = hasOutstandingContract(journal);

  return (
    <div className="operations-card-list" data-testid="contract-list">
      {CONTRACT_DEFINITIONS.map((definition) => {
        const progress = journal.contracts[definition.id];
        const status = progress?.status ?? "available";
        const currentObjective = progress && progress.status === "active"
          ? currentContractObjective(definition, progress)
          : null;
        return (
          <article
            key={definition.id}
            className={`operation-card contract-card status-${status} ${journal.activeContractId === definition.id ? "is-active" : ""}`}
          >
            <header>
              <span>{definition.code}</span>
              <strong>{status.replace("_", " ").toUpperCase()}</strong>
            </header>
            <h3>{definition.title}</h3>
            <p>{definition.summary}</p>
            <ol className="contract-objectives">
              {definition.objectives.map((objective) => {
                const amount = progress?.objectiveProgress[objective.id] ?? 0;
                const complete = amount >= objective.amount;
                const current = currentObjective?.id === objective.id;
                return (
                  <li
                    key={objective.id}
                    className={complete ? "is-complete" : current ? "is-current" : ""}
                  >
                    <i aria-hidden="true">{complete ? "✓" : current ? "→" : "·"}</i>
                    <span>{objective.label}</span>
                    <strong>{Math.min(amount, objective.amount)} / {objective.amount}</strong>
                  </li>
                );
              })}
            </ol>
            <div className="contract-reward">
              <span>REWARD</span>
              <p>
                {(Object.entries(definition.rewards) as Array<[ItemId, number]>).map(
                  ([item, quantity]) => `${quantity}× ${ITEM_DEFINITIONS[item].shortName}`,
                ).join(" · ")}
              </p>
            </div>
            {!progress ? (
              <button
                type="button"
                disabled={hasOutstanding}
                onClick={() => onAccept(definition.id)}
              >
                {hasOutstanding ? "COMPLETE ACTIVE CONTRACT FIRST" : "ACCEPT CONTRACT"}
              </button>
            ) : progress.status === "ready" ? (
              <button type="button" className="is-primary" onClick={() => onTurnIn(definition.id)}>
                FILE COMPLETED CONTRACT
              </button>
            ) : (
              <div className="operation-card-state">
                {progress.status === "completed"
                  ? `COMPLETED / DAY ${Math.floor((progress.completedAt ?? 0) / 1_440) + 1}`
                  : currentObjective?.label ?? "OBJECTIVES COMPLETE — REPORT TO MARA"}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function CraftingView({
  snapshot,
  station,
  onCraft,
}: {
  snapshot: GameSnapshot;
  station: CraftingStationKind;
  onCraft(recipeId: string, station: CraftingStationKind): void;
}) {
  return (
    <div className="operations-card-list crafting-list" data-testid="crafting-list">
      {Object.values(RECIPE_DEFINITIONS).map((recipe) => {
        const unlocked = snapshot.unlockedRecipeIds.includes(recipe.id);
        const stationAvailable = canUseStation(recipe.station, station);
        const missing = recipeMissingItems(snapshot.inventory, recipe.id);
        const canCraft = unlocked && stationAvailable && missing.length === 0;
        const output = ITEM_DEFINITIONS[recipe.output.item as ItemId];
        return (
          <article key={recipe.id} className={`operation-card recipe-card ${canCraft ? "is-ready" : ""}`}>
            <header>
              <span>{recipe.station.toUpperCase()} RECIPE</span>
              <strong>{unlocked ? "UNLOCKED" : "LOCKED"}</strong>
            </header>
            <div className="recipe-heading">
              <div className="inventory-index">{output.shortName.slice(0, 2)}</div>
              <div>
                <h3>{recipe.label}</h3>
                <p>{recipe.description}</p>
              </div>
            </div>
            <div className="ingredient-list" aria-label="Required ingredients">
              {(Object.entries(recipe.ingredients) as Array<[ItemId, number]>).map(([item, quantity]) => {
                const available = snapshot.inventory[item];
                return (
                  <span key={item} className={available < quantity ? "is-missing" : ""}>
                    {ITEM_DEFINITIONS[item].shortName} <strong>{available}/{quantity}</strong>
                  </span>
                );
              })}
            </div>
            <button
              type="button"
              disabled={!canCraft}
              onClick={() => onCraft(recipe.id, station)}
            >
              {!unlocked
                ? "RECIPE LOCKED"
                : !stationAvailable
                  ? "WORKBENCH REQUIRED"
                  : missing.length > 0
                    ? `MISSING ${missing.map((entry) => ITEM_DEFINITIONS[entry.item].shortName).join(" / ")}`
                    : `FABRICATE ${recipe.output.quantity}× ${output.shortName}`}
            </button>
          </article>
        );
      })}
    </div>
  );
}

function FieldGuideView({ snapshot }: { snapshot: GameSnapshot }) {
  const [category, setCategory] = useState<FieldGuideCategory>("fauna");
  const discovered = useMemo(
    () => new Set(snapshot.fieldGuideEntryIds),
    [snapshot.fieldGuideEntryIds],
  );
  const entries = FIELD_GUIDE_ENTRIES.filter((entry) => entry.category === category);
  return (
    <div className="field-guide-layout" data-testid="field-guide-list">
      <nav className="guide-category-tabs" aria-label="Field guide categories">
        {GUIDE_CATEGORIES.map((candidate) => {
          const known = FIELD_GUIDE_ENTRIES.filter(
            (entry) => entry.category === candidate.id && discovered.has(entry.id),
          ).length;
          const total = FIELD_GUIDE_ENTRIES.filter((entry) => entry.category === candidate.id).length;
          return (
            <button
              key={candidate.id}
              type="button"
              className={category === candidate.id ? "is-active" : ""}
              aria-pressed={category === candidate.id}
              onClick={() => setCategory(candidate.id)}
            >
              <span>{candidate.label}</span>
              <strong>{known}/{total}</strong>
            </button>
          );
        })}
      </nav>
      <div className="guide-entry-grid">
        {entries.map((entry, index) => {
          const known = discovered.has(entry.id);
          return (
            <article key={entry.id} className={known ? "is-recorded" : "is-unknown"}>
              <span>{String(index + 1).padStart(2, "0")} / {category.toUpperCase()}</span>
              <h3>{known ? entry.title : "UNRECORDED SUBJECT"}</h3>
              <p>{known ? entry.summary : "Hold the field scanner on a matching subject to resolve this record."}</p>
              <small>{known ? "CATALOG ENTRY VERIFIED" : "SIGNATURE UNKNOWN"}</small>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export default function OperationsPanel({
  snapshot,
  initialTab,
  station,
  onClose,
  onAcceptContract,
  onTurnInContract,
  onCraft,
}: OperationsPanelProps) {
  const [tab, setTab] = useState<OperationsTab>(initialTab);
  const completeGuideEntries = snapshot.fieldGuideEntryIds.length;

  return (
    <FeatureDialog
      title="Field operations"
      titleId="operations-title"
      kicker="FIELD LINK / OPERATIONS CONSOLE"
      testId="operations-overlay"
      className="operations-panel"
      onClose={onClose}
      headerMeta={<span className="feature-header-meta">{station.toUpperCase()} ACCESS</span>}
      footer={(
        <>
          <span>PROGRESSION SAVES WITH EACH MATERIAL ACTION</span>
          <p>{completeGuideEntries} / {FIELD_GUIDE_ENTRIES.length} field records resolved</p>
        </>
      )}
    >
      <nav className="operations-tabs" aria-label="Field operations sections">
        {OPERATION_TABS.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className={tab === candidate.id ? "is-active" : ""}
            aria-selected={tab === candidate.id}
            role="tab"
            onClick={() => setTab(candidate.id)}
          >
            {candidate.label}
          </button>
        ))}
      </nav>
      <div className="operations-content" role="tabpanel">
        {tab === "contracts" ? (
          <ContractsView snapshot={snapshot} onAccept={onAcceptContract} onTurnIn={onTurnInContract} />
        ) : tab === "crafting" ? (
          <CraftingView snapshot={snapshot} station={station} onCraft={onCraft} />
        ) : (
          <FieldGuideView snapshot={snapshot} />
        )}
      </div>
    </FeatureDialog>
  );
}
