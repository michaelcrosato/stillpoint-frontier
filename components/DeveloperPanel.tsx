"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import type { WeatherId } from "../lib/game/environment/model";
import type { GameSnapshot } from "../lib/game/state";

interface DeveloperPanelProps {
  snapshot: GameSnapshot;
  onClose(): void;
  onSetEnabled(enabled: boolean): void;
  onSetTime(minutes: number): void;
  onAdvanceTime(minutes: number): void;
  onSetClockPaused(paused: boolean): void;
  onSetWeather(weatherId: WeatherId | null): void;
  onReset(): void;
}

const TIME_PRESETS = [
  { label: "DAWN", time: "06:00", minutes: 6 * 60 },
  { label: "NOON", time: "12:00", minutes: 12 * 60 },
  { label: "DUSK", time: "18:00", minutes: 18 * 60 },
  { label: "MIDNIGHT", time: "00:00", minutes: 0 },
] as const;

function formatClock(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export default function DeveloperPanel({
  snapshot,
  onClose,
  onSetEnabled,
  onSetTime,
  onAdvanceTime,
  onSetClockPaused,
  onSetWeather,
  onReset,
}: DeveloperPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const minuteOfDay = snapshot.environment.hour * 60 + snapshot.environment.minute;
  const activeWeather = snapshot.devTools.weatherOverride;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ) ?? [],
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
    <div className="dev-overlay" data-testid="developer-overlay">
      <button
        type="button"
        className="dev-click-shield"
        aria-label="Close developer tools"
        tabIndex={-1}
        onClick={onClose}
      />
      <section
        ref={panelRef}
        className={`dev-panel ${snapshot.devTools.enabled ? "is-enabled" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="developer-panel-title"
        data-testid="developer-panel"
        onKeyDown={handleKeyDown}
      >
        <header className="dev-panel-header">
          <div>
            <p className="eyebrow">PLAYTEST CONSOLE / DEV-01</p>
            <h2 id="developer-panel-title" ref={headingRef} tabIndex={-1}>
              Developer tools
            </h2>
          </div>
          <button type="button" className="dev-close" onClick={onClose}>
            CLOSE <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="dev-session-notice" role="note">
          <span aria-hidden="true">◇</span>
          <p>
            <strong>SESSION-ONLY SANDBOX</strong>
            Time and weather overrides never write to the survey save.
          </p>
        </div>

        <button
          type="button"
          className={`dev-master ${snapshot.devTools.enabled ? "is-active" : ""}`}
          aria-pressed={snapshot.devTools.enabled}
          data-testid="developer-mode-toggle"
          onClick={() => onSetEnabled(!snapshot.devTools.enabled)}
        >
          <span>
            <small>DEVELOPER MODE</small>
            <strong>{snapshot.devTools.enabled ? "ENABLED" : "DISABLED"}</strong>
          </span>
          <i aria-hidden="true"><b /></i>
        </button>

        <fieldset className="dev-environment" disabled={!snapshot.devTools.enabled}>
          <legend>ENVIRONMENT</legend>

          <div className="dev-control-heading">
            <label htmlFor="developer-time">TIME OF DAY</label>
            <output htmlFor="developer-time" data-testid="developer-time-output">
              {formatClock(snapshot.environment.hour, snapshot.environment.minute)}
            </output>
          </div>
          <input
            id="developer-time"
            data-testid="developer-time"
            className="dev-time-slider"
            type="range"
            min="0"
            max="1439"
            step="5"
            value={minuteOfDay}
            onChange={(event) => onSetTime(Number(event.currentTarget.value))}
          />
          <div className="dev-time-scale" aria-hidden="true">
            <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
          </div>

          <div className="dev-preset-grid">
            {TIME_PRESETS.map((preset) => (
              <button
                type="button"
                key={preset.label}
                onClick={() => onSetTime(preset.minutes)}
              >
                <span>{preset.label}</span>
                <small>{preset.time}</small>
              </button>
            ))}
          </div>

          <div className="dev-inline-controls">
            <button type="button" onClick={() => onAdvanceTime(-60)}>− 1 HOUR</button>
            <button
              type="button"
              className={snapshot.devTools.clockPaused ? "is-active" : ""}
              aria-pressed={snapshot.devTools.clockPaused}
              data-testid="developer-clock-toggle"
              onClick={() => onSetClockPaused(!snapshot.devTools.clockPaused)}
            >
              {snapshot.devTools.clockPaused ? "CLOCK FROZEN" : "CLOCK RUNNING"}
            </button>
            <button type="button" onClick={() => onAdvanceTime(60)}>+ 1 HOUR</button>
          </div>

          <div className="dev-weather-control">
            <div className="dev-control-heading">
              <label htmlFor="developer-weather">WEATHER / {snapshot.biome.name}</label>
              <span>{activeWeather ? "FORCED" : "AUTO"}</span>
            </div>
            <select
              id="developer-weather"
              data-testid="developer-weather"
              value={activeWeather ?? ""}
              onChange={(event) =>
                onSetWeather(
                  event.currentTarget.value
                    ? (event.currentTarget.value as WeatherId)
                    : null,
                )
              }
            >
              <option value="">AUTO / BIOME SYSTEM</option>
              {snapshot.devTools.weatherOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
            <p className="dev-weather-status" aria-live="polite">
              <strong>{snapshot.environment.weatherLabel}</strong>
              <span>
                {Math.round(snapshot.environment.temperatureC)}°C · {Math.round(snapshot.environment.windKph)} KM/H · {snapshot.environment.precipitation.toUpperCase()}
              </span>
            </p>
          </div>
        </fieldset>

        <footer className="dev-panel-footer">
          <button
            type="button"
            className="dev-reset"
            disabled={!snapshot.devTools.enabled}
            onClick={onReset}
          >
            RESET OVERRIDES
          </button>
          <button type="button" className="dev-resume" onClick={onClose}>
            CLOSE &amp; RESUME <span aria-hidden="true">↗</span>
          </button>
        </footer>
      </section>
    </div>
  );
}
