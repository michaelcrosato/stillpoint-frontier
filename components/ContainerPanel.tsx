"use client";

import { ITEM_DEFINITIONS, type ItemId } from "../lib/game/gameplay/items";
import { containerItemCount } from "../lib/game/gameplay/loot";
import type { GameSnapshot } from "../lib/game/state";
import FeatureDialog from "./FeatureDialog";

interface ContainerPanelProps {
  snapshot: GameSnapshot;
  containerId: string;
  onClose(): void;
  onTakeItem(containerId: string, item: ItemId, quantity: number): void;
  onTakeAll(containerId: string): void;
}

function containerName(containerId: string) {
  if (containerId.includes("meridian-tower")) return "Meridian service cache";
  if (containerId.includes("survey-house")) return "Survey archive crate";
  if (containerId.includes("field-unit")) return "Field supply locker";
  return "Field container";
}

export default function ContainerPanel({
  snapshot,
  containerId,
  onClose,
  onTakeItem,
  onTakeAll,
}: ContainerPanelProps) {
  const state = snapshot.containerStates[containerId];
  const items = (Object.keys(ITEM_DEFINITIONS) as ItemId[]).filter(
    (item) => (state?.remaining[item] ?? 0) > 0,
  );
  const itemCount = containerItemCount(state);
  const canTakeAnything = items.some(
    (item) => snapshot.inventory[item] < ITEM_DEFINITIONS[item].stackLimit,
  );

  return (
    <FeatureDialog
      title={containerName(containerId)}
      titleId="container-title"
      kicker="MATERIAL TRANSFER / LOCAL STORAGE"
      testId="container-overlay"
      className="container-panel"
      onClose={onClose}
      headerMeta={<span className="feature-header-meta">{itemCount} ITEMS</span>}
      footer={(
        <>
          <span>CONTENTS PERSIST AFTER PARTIAL TRANSFER</span>
          <button
            type="button"
            className="text-action"
            disabled={itemCount === 0 || !canTakeAnything}
            onClick={() => onTakeAll(containerId)}
          >
            TAKE ALL →
          </button>
        </>
      )}
    >
      <div className="container-ledger">
        {items.length === 0 ? (
          <div className="empty-feature-state">
            <span>00</span>
            <h3>Container empty</h3>
            <p>No transferable materials remain in this cache.</p>
          </div>
        ) : items.map((item) => {
          const definition = ITEM_DEFINITIONS[item];
          const quantity = state?.remaining[item] ?? 0;
          const atCapacity = snapshot.inventory[item] >= definition.stackLimit;
          return (
            <article key={item}>
              <div className="inventory-index">{definition.shortName.slice(0, 2)}</div>
              <div>
                <small>{definition.category}</small>
                <h3>{definition.name}</h3>
                <p>{definition.description}</p>
              </div>
              <strong>{String(quantity).padStart(2, "0")}</strong>
              <button
                type="button"
                disabled={atCapacity}
                onClick={() => onTakeItem(containerId, item, 1)}
              >
                {atCapacity ? "STACK FULL" : "TAKE ONE"}
              </button>
            </article>
          );
        })}
      </div>
    </FeatureDialog>
  );
}
