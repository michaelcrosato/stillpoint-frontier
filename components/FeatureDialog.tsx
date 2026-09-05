"use client";
import { trapDialogTab } from "../lib/game/ui/dialogFocus";

import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";

interface FeatureDialogProps {
  title: string;
  titleId: string;
  kicker: string;
  testId: string;
  className?: string;
  headerMeta?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  onClose(): void;
}

/** Shared modal shell for gameplay features, including focus restoration and trapping. */
export default function FeatureDialog({
  title,
  titleId,
  kicker,
  testId,
  className = "",
  headerMeta,
  footer,
  children,
  onClose,
}: FeatureDialogProps) {
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeRef.current();
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
      previous?.focus?.();
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    trapDialogTab(event, panelRef.current);
  };

  return (
    <div className="field-overlay feature-overlay" data-testid={testId}>
      <button
        className="field-click-shield"
        type="button"
        aria-label={`Close ${title}`}
        onClick={onClose}
      />
      <section
        ref={panelRef}
        className={`field-panel feature-panel ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
      >
        <header className="field-panel-header feature-panel-header">
          <div>
            <p className="eyebrow">{kicker}</p>
            <h2 id={titleId} ref={headingRef} tabIndex={-1}>{title}</h2>
          </div>
          <div className="feature-header-actions">
            {headerMeta}
            <button type="button" onClick={onClose}>
              CLOSE <span aria-hidden="true">×</span>
            </button>
          </div>
        </header>
        {children}
        {footer ? <footer className="field-panel-footer">{footer}</footer> : null}
      </section>
    </div>
  );
}
