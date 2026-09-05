"use client";
import { trapDialogTab } from "../lib/game/ui/dialogFocus";

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
  INTERFACE_SCALES,
  INTERFACE_SCALE_DEFINITIONS,
  actionLabel,
  keyLabel,
  type GameAction,
  type InterfaceScale,
} from "../lib/game/settings";
import {
  WORLD_DETAIL_PRESETS,
  type WorldDetailLevel,
} from "../lib/game/world/WorldLodPolicy";
import type { GameSnapshot } from "../lib/game/state";
import {
  CAMERA_ISOMETRIC_ANGLE_MAX,
  CAMERA_ISOMETRIC_ANGLE_MIN,
  CAMERA_MAX_DISTANCE,
  CAMERA_VIEW_MODES,
  CAMERA_VIEW_PRESETS,
  type CameraViewMode,
} from "../lib/game/camera/CameraRig";

interface SettingsPanelProps {
  snapshot: GameSnapshot;
  onClose(): void;
  onSetFov(value: number): void;
  onSetCameraDistance(value: number): void;
  onSetCameraView(mode: CameraViewMode): void;
  onSetIsometricAngle(value: number): void;
  onSetSensitivity(value: number): void;
  onSetInvertY(value: boolean): void;
  onSetVolume(channel: "masterVolume" | "ambientVolume" | "effectsVolume", value: number): void;
  onSetQuality(quality: QualityLevel): void;
  onSetHorizon(mode: HorizonMode): void;
  onSetWorldDetail(level: WorldDetailLevel): void;
  onSetInterfaceScale(scale: InterfaceScale): void;
  onRebind(action: GameAction, code: string): void;
  onReset(): void;
}

export default function SettingsPanel({
  snapshot,
  onClose,
  onSetFov,
  onSetCameraDistance,
  onSetCameraView,
  onSetIsometricAngle,
  onSetSensitivity,
  onSetInvertY,
  onSetVolume,
  onSetQuality,
  onSetHorizon,
  onSetWorldDetail,
  onSetInterfaceScale,
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
    trapDialogTab(event, panelRef.current);
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
            <h3>ACCESSIBILITY / INTERFACE</h3>
            <div
              className="settings-button-grid interface-scale-grid"
              role="group"
              aria-label="Interface text size"
            >
              {INTERFACE_SCALES.map((scale) => {
                const definition = INTERFACE_SCALE_DEFINITIONS[scale];
                const active = snapshot.settings.interfaceScale === scale;
                return (
                  <button
                    key={scale}
                    type="button"
                    className={active ? "is-active" : ""}
                    aria-pressed={active}
                    data-testid={`interface-scale-${scale}`}
                    onClick={() => onSetInterfaceScale(scale)}
                  >
                    <span>{definition.label}</span>
                    <small>{definition.percentage}% · {definition.description}</small>
                  </button>
                );
              })}
            </div>

            <h3>VIEW / CONTROL</h3>
            <div
              className="settings-button-grid camera-view-grid"
              role="group"
              aria-label="Camera view preset"
            >
              {CAMERA_VIEW_MODES.map((mode) => {
                const preset = CAMERA_VIEW_PRESETS[mode];
                const active = snapshot.camera.mode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    className={active ? "is-active" : ""}
                    aria-pressed={active}
                    data-testid={`camera-view-${mode}`}
                    onClick={() => onSetCameraView(mode)}
                  >
                    <span>{preset.label}</span>
                    <small>{preset.description}</small>
                  </button>
                );
              })}
            </div>
            <label className="settings-range" htmlFor="camera-distance-slider">
              <span>
                CAMERA ZOOM
                <output htmlFor="camera-distance-slider">
                  {snapshot.camera.targetDistance <= 0.0001
                    ? "FIRST PERSON"
                    : `${snapshot.camera.targetDistance.toFixed(1)} M`}
                </output>
              </span>
              <input
                id="camera-distance-slider"
                data-testid="camera-distance-slider"
                type="range"
                min="0"
                max={CAMERA_MAX_DISTANCE}
                step="0.5"
                value={snapshot.settings.cameraDistance}
                aria-valuetext={`${CAMERA_VIEW_PRESETS[snapshot.camera.mode].label}, ${snapshot.camera.targetDistance.toFixed(1)} metres requested`}
                onChange={(event) => onSetCameraDistance(Number(event.currentTarget.value))}
              />
            </label>
            <label className="settings-range" htmlFor="isometric-angle-slider">
              <span>
                ISOMETRIC ANGLE
                <output htmlFor="isometric-angle-slider">
                  {Math.round(snapshot.settings.isometricAngle)}°
                </output>
              </span>
              <input
                id="isometric-angle-slider"
                data-testid="isometric-angle-slider"
                type="range"
                min={CAMERA_ISOMETRIC_ANGLE_MIN}
                max={CAMERA_ISOMETRIC_ANGLE_MAX}
                step="1"
                value={snapshot.settings.isometricAngle}
                onChange={(event) => onSetIsometricAngle(Number(event.currentTarget.value))}
              />
            </label>
            <p className="settings-audio-state">
              WHEEL: CONTINUOUS ZOOM · {keyLabel(snapshot.settings.keyBindings.cameraView)}: CYCLE PRESETS · COLLISION-AWARE BOOM
              {snapshot.camera.collisionLimited
                ? ` · RETRACTED TO ${snapshot.camera.distance.toFixed(1)} M`
                : ""}
            </p>
            <label className="settings-range">
              <span>BASE FIELD OF VIEW <output>{Math.round(snapshot.settings.fov)}°</output></span>
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
                <button key={quality} type="button" className={snapshot.quality === quality ? "is-active" : ""} aria-pressed={snapshot.quality === quality} onClick={() => onSetQuality(quality)}>
                  <span>{QUALITY_PRESETS[quality].label}</span>
                  <small>{quality === "ultra" ? "4K SHADOWS / 2× DPR" : quality === "cinematic" ? "SHADOWS / HIGH DPR" : "LEAN GPU PROFILE"}</small>
                </button>
              ))}
            </div>
            <label className="settings-range" htmlFor="world-detail-slider">
              <span>
                MID-FIELD LOD
                <output htmlFor="world-detail-slider">
                  {WORLD_DETAIL_PRESETS[snapshot.settings.worldDetail].label} · {WORLD_DETAIL_PRESETS[snapshot.settings.worldDetail].description.replace(" DETAIL", "")}
                </output>
              </span>
              <input
                id="world-detail-slider"
                type="range"
                min="0"
                max="4"
                step="1"
                value={snapshot.settings.worldDetail}
                aria-describedby="world-detail-help"
                aria-valuetext={`${WORLD_DETAIL_PRESETS[snapshot.settings.worldDetail].label}, ${WORLD_DETAIL_PRESETS[snapshot.settings.worldDetail].description.toLowerCase()}`}
                onChange={(event) => onSetWorldDetail(Number(event.currentTarget.value) as WorldDetailLevel)}
              />
            </label>
            <p className="settings-audio-state" id="world-detail-help">
              Refines render-only terrain and scenery between the loaded world and horizon. Simulation stays fixed.
            </p>
            <div className="settings-button-grid horizon-grid">
              {(Object.keys(HORIZON_PRESETS) as HorizonMode[]).map((mode) => (
                <button key={mode} type="button" className={snapshot.horizonMode === mode ? "is-active" : ""} aria-pressed={snapshot.horizonMode === mode} onClick={() => onSetHorizon(mode)}>
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
