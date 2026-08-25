"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  HORIZON_PRESETS,
  QUALITY_LEVELS,
  QUALITY_PRESETS,
  type HorizonMode,
  type QualityLevel,
} from "../lib/game/config";
import {
  GAME_ACTIONS,
  actionLabel,
  keyLabel,
  type GameAction,
} from "../lib/game/settings";
import type { GameSnapshot } from "../lib/game/state";

interface SettingsPanelProps {
  snapshot: GameSnapshot;
  onClose(): void;
  onSetFov(value: number): void;
  onSetSensitivity(value: number): void;
  onSetInvertY(value: boolean): void;
  onSetVolume(channel: "masterVolume" | "ambientVolume" | "effectsVolume", value: number): void;
  onSetQuality(quality: QualityLevel): void;
  onSetHorizon(mode: HorizonMode): void;
  onRebind(action: GameAction, code: string): void;
  onReset(): void;
}

export default function SettingsPanel({
  snapshot,
  onClose,
  onSetFov,
  onSetSensitivity,
  onSetInvertY,
  onSetVolume,
  onSetQuality,
  onSetHorizon,
  onRebind,
  onReset,
}: SettingsPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [listeningAction, setListeningAction] = useState<GameAction | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    if (!listeningAction) return;
    const capture = (event: globalThis.KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "Escape") {
        setListeningAction(null);
        return;
      }
      onRebind(listeningAction, event.code);
      setListeningAction(null);
    };
    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [listeningAction, onRebind]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (listeningAction) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), [tabindex='0']",
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

  const volumeControls = [
    ["masterVolume", "MASTER"],
    ["ambientVolume", "AMBIENCE"],
    ["effectsVolume", "EFFECTS"],
  ] as const;

  return (
    <div className="field-overlay settings-overlay" data-testid="settings-overlay">
      <button className="field-click-shield" type="button" aria-label="Close settings" onClick={onClose} />
      <section
        ref={panelRef}
        className="field-panel settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onKeyDown={handleKeyDown}
      >
        <header className="field-panel-header">
          <div>
            <p className="eyebrow">FIELD UNIT / LOCAL PREFERENCES</p>
            <h2 id="settings-title" ref={headingRef} tabIndex={-1}>Settings</h2>
          </div>
          <button type="button" onClick={onClose}>CLOSE <span aria-hidden="true">×</span></button>
        </header>

        <div className="settings-columns">
          <div className="settings-section">
            <h3>VIEW / CONTROL</h3>
            <label className="settings-range">
              <span>FIELD OF VIEW <output>{Math.round(snapshot.settings.fov)}°</output></span>
              <input type="range" min="55" max="95" step="1" value={snapshot.settings.fov} onChange={(event) => onSetFov(Number(event.currentTarget.value))} />
            </label>
            <label className="settings-range">
              <span>LOOK SENSITIVITY <output>{snapshot.settings.lookSensitivity.toFixed(2)}×</output></span>
              <input type="range" min="0.25" max="2.5" step="0.05" value={snapshot.settings.lookSensitivity} onChange={(event) => onSetSensitivity(Number(event.currentTarget.value))} />
            </label>
            <label className="settings-toggle">
              <span>INVERT VERTICAL LOOK</span>
              <input type="checkbox" checked={snapshot.settings.invertY} onChange={(event) => onSetInvertY(event.currentTarget.checked)} />
              <i aria-hidden="true"><b /></i>
            </label>

            <h3>RENDERING</h3>
            <div className="settings-button-grid quality-grid">
              {QUALITY_LEVELS.map((quality) => (
                <button key={quality} type="button" className={snapshot.quality === quality ? "is-active" : ""} onClick={() => onSetQuality(quality)}>
                  <span>{QUALITY_PRESETS[quality].label}</span>
                  <small>{quality === "ultra" ? "4K SHADOWS / 2× DPR" : quality === "cinematic" ? "SHADOWS / HIGH DPR" : "LEAN GPU PROFILE"}</small>
                </button>
              ))}
            </div>
            <div className="settings-button-grid horizon-grid">
              {(Object.keys(HORIZON_PRESETS) as HorizonMode[]).map((mode) => (
                <button key={mode} type="button" className={snapshot.horizonMode === mode ? "is-active" : ""} onClick={() => onSetHorizon(mode)}>
                  <span>{HORIZON_PRESETS[mode].label}</span>
                  <small>{Math.round(HORIZON_PRESETS[mode].drawDistanceMeters / 1_000)} KM</small>
                </button>
              ))}
            </div>

            <h3>AUDIO</h3>
            {volumeControls.map(([channel, label]) => (
              <label className="settings-range" key={channel}>
                <span>{label} <output>{Math.round(snapshot.settings[channel] * 100)}</output></span>
                <input type="range" min="0" max="1" step="0.01" value={snapshot.settings[channel]} onChange={(event) => onSetVolume(channel, Number(event.currentTarget.value))} />
              </label>
            ))}
            <p className="settings-audio-state">
              PROCEDURAL AUDIO · {snapshot.audio.available ? snapshot.audio.unlocked ? "ACTIVE" : "AWAITING INPUT" : "UNAVAILABLE"}
            </p>
          </div>

          <div className="settings-section controls-settings">
            <h3>KEY BINDINGS</h3>
            <p>Choose a control, then press a key. Conflicting controls swap automatically.</p>
            <div className="binding-list">
              {GAME_ACTIONS.map((action) => (
                <button
                  key={action}
                  type="button"
                  className={listeningAction === action ? "is-listening" : ""}
                  aria-label={`Rebind ${actionLabel(action)}`}
                  onClick={() => setListeningAction(action)}
                >
                  <span>{actionLabel(action)}</span>
                  <kbd>{listeningAction === action ? "PRESS KEY" : keyLabel(snapshot.settings.keyBindings[action])}</kbd>
                </button>
              ))}
            </div>
          </div>
        </div>

        <footer className="field-panel-footer settings-footer">
          <p>Preferences save on this device. World progress remains in the field save.</p>
          <button type="button" onClick={onReset}>RESET DEFAULTS</button>
        </footer>
      </section>
    </div>
  );
}
