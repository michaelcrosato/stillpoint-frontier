"use client";

import { useEffect, useRef } from "react";
import type { InspectionRecord } from "../lib/game/world/inspectables";
import { trapDialogTab } from "../lib/game/ui/dialogFocus";

interface InspectionPanelProps {
  inspection: InspectionRecord;
  onClose(): void;
}

export default function InspectionPanel({ inspection, onClose }: InspectionPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="field-overlay" data-testid="inspection-overlay">
      <button className="field-click-shield" type="button" aria-label="Close inspection" onClick={onClose} />
      <article
        ref={panelRef}
        onKeyDown={(event) => trapDialogTab(event, panelRef.current)}
        className="field-panel inspection-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inspection-title"
      >
        <header className="inspection-header">
          <p className="eyebrow">{inspection.kicker}</p>
          <span>ARCHIVE / {inspection.id.toUpperCase()}</span>
        </header>
        <h2 id="inspection-title">{inspection.title}</h2>
        <blockquote>{inspection.body}</blockquote>
        <footer>
          <span>SOURCE</span>
          <strong>{inspection.source}</strong>
          <button ref={closeRef} type="button" onClick={onClose}>RETURN TO FIELD <span>↗</span></button>
        </footer>
      </article>
    </div>
  );
}
