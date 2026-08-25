"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import {
  ITEM_DEFINITIONS,
  itemUseKind,
  type ItemId,
  type ItemUseKind,
} from "../lib/game/gameplay/items";
import { ENCUMBERED_WEIGHT } from "../lib/game/gameplay/playerCondition";
import type { GameSnapshot } from "../lib/game/state";

interface InventoryPanelProps {
  snapshot: GameSnapshot;
  onClose(): void;
  onUseItem(item: ItemId): void;
}

const USE_LABELS: Readonly<Record<ItemUseKind, string>> = {
  heal: "APPLY",
  deploy_bedroll: "DEPLOY",
  deploy_campfire: "DEPLOY",
  deploy_marker: "PLACE",
  deploy_shelter: "DEPLOY",
  deploy_torch: "PLACE",
};

export default function InventoryPanel({ snapshot, onClose, onUseItem }: InventoryPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [tabindex='0']") ?? [],
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="field-overlay" data-testid="inventory-overlay">
      <button className="field-click-shield" type="button" aria-label="Close inventory" onClick={onClose} />
      <section
        ref={panelRef}
        className="field-panel inventory-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inventory-title"
        onKeyDown={handleKeyDown}
      >
        <header className="field-panel-header">
          <div>
            <p className="eyebrow">FIELD KIT / MATERIAL LEDGER</p>
            <h2 id="inventory-title" ref={headingRef} tabIndex={-1}>Inventory</h2>
          </div>
          <button type="button" onClick={onClose}>CLOSE <span aria-hidden="true">×</span></button>
        </header>

        <div className="inventory-summary">
          <div><span>ITEMS</span><strong>{snapshot.inventoryItemCount}</strong></div>
          <div><span>LOAD</span><strong>{snapshot.inventoryWeight.toFixed(1)} KG</strong></div>
          <div className={snapshot.inventoryWeight >= ENCUMBERED_WEIGHT ? "is-warning" : ""}>
            <span>MOBILITY</span>
            <strong>{snapshot.inventoryWeight >= ENCUMBERED_WEIGHT ? "ENCUMBERED" : "NOMINAL"}</strong>
          </div>
        </div>

        <div className="inventory-list">
          {(Object.keys(ITEM_DEFINITIONS) as ItemId[]).map((item) => {
            const definition = ITEM_DEFINITIONS[item];
            const quantity = snapshot.inventory[item];
            const useKind = itemUseKind(item);
            const unusable = quantity <= 0 || (useKind === "heal" && snapshot.health >= snapshot.maxHealth);
            return (
              <article key={item} className={quantity > 0 ? "has-item" : ""}>
                <div className="inventory-index">{definition.shortName.slice(0, 2)}</div>
                <div>
                  <small>{definition.category}</small>
                  <h3>{definition.name}</h3>
                  <p>{definition.description}</p>
                </div>
                <div className="inventory-quantity">
                  <strong>{String(quantity).padStart(2, "0")}</strong>
                  <span>{(quantity * definition.unitWeight).toFixed(1)} KG</span>
                  {useKind && (
                    <button
                      type="button"
                      disabled={unusable}
                      onClick={() => onUseItem(item)}
                    >
                      {useKind === "heal" && snapshot.health >= snapshot.maxHealth
                        ? "VITALS FULL"
                        : USE_LABELS[useKind]}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <footer className="field-panel-footer">
          <span>FIELD INVENTORY / LIVE LOAD</span>
          <p>Usable gear deploys ahead of the player on clear ground.</p>
        </footer>
      </section>
    </div>
  );
}
