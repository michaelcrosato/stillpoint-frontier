"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import {
  HORIZON_PRESETS,
  type HorizonMode,
} from "../lib/game/config";
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
  onSetHorizonMode(mode: HorizonMode): void;
  onSetHealth(health: number): void;
  onApplyFall(speed: number): void;
  onRecover(): void;
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

function formatDistance(meters: number) {
  return meters >= 1_000
    ? `${(meters / 1_000).toFixed(meters >= 10_000 ? 0 : 1)} KM`
    : `${Math.round(meters)} M`;
}

const HORIZON_DESCRIPTIONS: Readonly<Record<HorizonMode, string>> = {
  standard: "LOCAL HLOD / WEATHER-AUTHENTIC",
  extended: "REGIONAL HLOD / RECOMMENDED",
  unlimited: "FINITE ATLAS / MAXIMUM HORIZON",
};

export default function DeveloperPanel({
  snapshot,
  onClose,
  onSetEnabled,
  onSetTime,
  onAdvanceTime,
  onSetClockPaused,
  onSetWeather,
  onSetHorizonMode,
  onSetHealth,
  onApplyFall,
  onRecover,
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
            Time and weather overrides are session-only. Rendering preferences are saved locally.
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

        <fieldset className="dev-rendering">
          <legend>RENDERING / SAVED LOCALLY</legend>
          <div className="dev-horizon-heading">
            <span>WORLD HORIZON</span>
            <strong>{HORIZON_PRESETS[snapshot.horizonMode].label}</strong>
          </div>
          <div className="dev-horizon-grid" role="radiogroup" aria-label="World horizon distance">
            {(Object.keys(HORIZON_PRESETS) as HorizonMode[]).map((mode) => (
              <button
                type="button"
                key={mode}
                className={snapshot.horizonMode === mode ? "is-active" : ""}
                aria-pressed={snapshot.horizonMode === mode}
                data-testid={`horizon-mode-${mode}`}
                onClick={() => onSetHorizonMode(mode)}
              >
                <span>{HORIZON_PRESETS[mode].label}</span>
                <strong>{formatDistance(HORIZON_PRESETS[mode].drawDistanceMeters)}</strong>
                <small>{HORIZON_DESCRIPTIONS[mode]}</small>
              </button>
            ))}
          </div>
          <p className="dev-horizon-status" data-testid="developer-horizon-status">
            <span>FULL DETAIL {snapshot.loadedChunks}</span>
            <span>HLOD {snapshot.horizonTiles}</span>
            <span>FAR TRIS {Math.round(snapshot.horizonTriangles).toLocaleString()}</span>
            <span>PROXIES {snapshot.horizonSettlementInstances}</span>
            <strong>OPTICAL {formatDistance(snapshot.environment.visibilityMeters)}</strong>
          </p>
          <p className="dev-horizon-note">
            Weather remains the final visibility limit. Distant terrain and settlement silhouettes
            carry no interiors, objects, collision, citizens, or shadows.
          </p>
        </fieldset>

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

        <fieldset className="dev-vitals" disabled={!snapshot.devTools.enabled}>
          <legend>PLAYER / VITALS</legend>
          <div className="dev-control-heading">
            <label htmlFor="developer-health">HEALTH</label>
            <output htmlFor="developer-health">{Math.ceil(snapshot.health)} / {snapshot.maxHealth}</output>
          </div>
          <input
            id="developer-health"
            data-testid="developer-health"
            className="dev-time-slider"
            type="range"
            min="0"
            max={snapshot.maxHealth}
            step="1"
            value={snapshot.health}
            onChange={(event) => onSetHealth(Number(event.currentTarget.value))}
          />
          <div className="dev-vitals-status">
            <span>{snapshot.sheltered ? "SHELTERED" : "EXPOSED"}</span>
            <span>WET {Math.round(snapshot.wetness * 100)}%</span>
            <span>COLD {Math.round(snapshot.coldStress * 100)}%</span>
            <span>FEELS {Math.round(snapshot.apparentTemperatureC)}°C</span>
          </div>
          <div className="dev-inline-controls">
            <button type="button" onClick={() => onSetHealth(Math.max(0, snapshot.health - 25))}>DAMAGE 25</button>
            <button type="button" onClick={() => onApplyFall(34)}>FATAL FALL</button>
            <button type="button" onClick={onRecover}>RECOVER PLAYER</button>
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
