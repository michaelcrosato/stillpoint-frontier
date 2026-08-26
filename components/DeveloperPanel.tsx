"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  HORIZON_PRESETS,
  type HorizonMode,
} from "../lib/game/config";
import type { WeatherId } from "../lib/game/environment/model";
import type { GameSnapshot } from "../lib/game/state";
import { WORLD_DETAIL_PRESETS } from "../lib/game/world/WorldLodPolicy";
import {
  GRAPHICS_BENCHMARK_TARGETS,
} from "../lib/game/developer/GraphicsBenchmark";
import { CANOPY_BENCHMARK_LEVELS } from "../lib/game/world/benchmarkZone";
import {
  GRAPHICS_FEATURE_DEFINITIONS,
  type GraphicsFeatureId,
} from "../lib/game/rendering/GraphicsFeatures";

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
  onTravelToForestStressTest(): void;
  onSetForestStressLevel(level: number): void;
  onSetGraphicsBenchmarkTarget(target: number): void;
  onStartGraphicsBenchmark(): void;
  onCancelGraphicsBenchmark(): void;
  onSetGraphicsFeature(id: GraphicsFeatureId, enabled: boolean): void;
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
  onTravelToForestStressTest,
  onSetForestStressLevel,
  onSetGraphicsBenchmarkTarget,
  onStartGraphicsBenchmark,
  onCancelGraphicsBenchmark,
  onSetGraphicsFeature,
  onReset,
}: DeveloperPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const setForestStressLevelRef = useRef(onSetForestStressLevel);
  const minuteOfDay = snapshot.environment.hour * 60 + snapshot.environment.minute;
  const activeWeather = snapshot.devTools.weatherOverride;
  const benchmark = snapshot.graphicsBenchmark;
  const captureRunning =
    benchmark.phase === "warming" ||
    benchmark.phase === "sampling" ||
    benchmark.phase === "finalizing";
  const [forestLevelDraft, setForestLevelDraft] = useState<number>(
    snapshot.forestStress.level,
  );
  const [copyStatus, setCopyStatus] = useState("");
  const draftDefinition =
    CANOPY_BENCHMARK_LEVELS[forestLevelDraft] ?? CANOPY_BENCHMARK_LEVELS[0];

  useEffect(() => {
    setForestStressLevelRef.current = onSetForestStressLevel;
  }, [onSetForestStressLevel]);

  useEffect(() => {
    if (
      captureRunning ||
      forestLevelDraft === snapshot.forestStress.level
    ) {
      return;
    }
    const timeout = window.setTimeout(
      () => setForestStressLevelRef.current(forestLevelDraft),
      220,
    );
    return () => window.clearTimeout(timeout);
  }, [
    captureRunning,
    forestLevelDraft,
    snapshot.forestStress.level,
  ]);

  const copyPerformanceReport = async () => {
    if (!benchmark.context || benchmark.phase !== "complete") return;
    const report = {
      capturedAt: benchmark.context.capturedAt,
      captureContext: benchmark.context,
      graphicsBenchmark: benchmark,
    };
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopyStatus("REPORT COPIED");
    } catch {
      setCopyStatus("COPY FAILED");
    }
  };

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
            Time, weather, load-lab, and capture state are session-only. Rendering preferences are saved locally.
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
            <span>LOD {WORLD_DETAIL_PRESETS[snapshot.settings.worldDetail].label} / {snapshot.horizonNearCellSize} M</span>
            <span>SCENERY {snapshot.horizonSceneryInstances}</span>
            <span>SETTLEMENTS {snapshot.horizonSettlementInstances}</span>
            <span>CITY LIGHTS {snapshot.horizonSettlementLightInstances}</span>
            <strong>OPTICAL {formatDistance(snapshot.environment.visibilityMeters)}</strong>
          </p>
          <p className="dev-horizon-note">
            Weather remains the final visibility limit. Distant terrain and settlement silhouettes
            carry no interiors, objects, collision, citizens, or shadows.
          </p>
        </fieldset>

        <fieldset
          className="dev-graphics-features"
          disabled={!snapshot.devTools.enabled}
        >
          <legend>GRAPHICS MODULES / SESSION A-B</legend>
          <p className="dev-horizon-note">
            Toggle one module at a time, close the panel, and compare the same
            viewpoint. Captures record the active module state.
          </p>
          <p className="dev-horizon-status" data-testid="graphics-pipeline-status">
            <span>PIPELINE {snapshot.graphicsPipeline.postProcessing ? "COMPOSITOR" : "DIRECT"}</span>
            <span>BLOOM {snapshot.graphicsPipeline.bloom ? "ACTIVE" : "OFF"}</span>
            <span>GTAO {snapshot.graphicsPipeline.gtao ? "ACTIVE" : "OFF"}</span>
            <span>GRADE {snapshot.graphicsPipeline.grading ? "ACTIVE" : "OFF"}</span>
            <span>PMREM {snapshot.graphicsPipeline.environmentReflections ? "ACTIVE" : "OFF"}</span>
            <strong>{snapshot.graphicsPipeline.fallback ? "SAFE FALLBACK" : "NOMINAL"}</strong>
          </p>
          <div className="dev-feature-grid">
            {GRAPHICS_FEATURE_DEFINITIONS.map((feature) => {
              const enabled = snapshot.devTools.graphicsFeatures[feature.id];
              return (
                <button
                  type="button"
                  key={feature.id}
                  className={enabled ? "is-active" : ""}
                  aria-pressed={enabled}
                  data-testid={`graphics-feature-${feature.id}`}
                  onClick={() => onSetGraphicsFeature(feature.id, !enabled)}
                >
                  <span>{feature.label}</span>
                  <strong>{enabled ? "ON" : "OFF"}</strong>
                  <small>{feature.description}</small>
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="dev-performance" disabled={!snapshot.devTools.enabled}>
          <legend>PERFORMANCE LAB / DEVELOPER OPT-IN</legend>
          <div className="dev-lab-heading">
            <div>
              <span>CANOPY LOAD LAB</span>
              <strong>DENSE FOREST + SHALLOW LAKE</strong>
            </div>
            <b className={snapshot.forestStress.active ? "is-active" : ""}>
              {snapshot.forestStress.active ? "ACTIVE" : "STANDBY"}
            </b>
          </div>
          <p className="dev-horizon-note">
            Render-only instancing and three tree LODs. No extra AI, targets,
            harvest state, collision, or discovery records.
          </p>
          <button
            type="button"
            className="dev-lab-travel"
            data-testid="forest-stress-travel"
            onClick={onTravelToForestStressTest}
          >
            TRAVEL TO TEST SITE <span>GRID 64:-60 ↗</span>
          </button>

          <div className="dev-control-heading">
            <label htmlFor="forest-stress-level">FOREST LOAD</label>
            <output htmlFor="forest-stress-level">
              {draftDefinition.label}
              {forestLevelDraft !== snapshot.forestStress.level ? " / QUEUED" : ""}
            </output>
          </div>
          <input
            id="forest-stress-level"
            data-testid="forest-stress-level"
            className="dev-time-slider"
            type="range"
            min="0"
            max={CANOPY_BENCHMARK_LEVELS.length - 1}
            step="1"
            value={forestLevelDraft}
            disabled={captureRunning}
            aria-valuetext={`${draftDefinition.label}: ${draftDefinition.trees.toLocaleString()} trees and ${draftDefinition.groundcover.toLocaleString()} understory instances`}
            onChange={(event) => {
              setForestLevelDraft(Number(event.currentTarget.value));
              setCopyStatus("");
            }}
            onPointerUp={(event) =>
              onSetForestStressLevel(Number(event.currentTarget.value))
            }
            onBlur={(event) =>
              onSetForestStressLevel(Number(event.currentTarget.value))
            }
          />
          <div className="dev-load-scale" aria-hidden="true">
            {CANOPY_BENCHMARK_LEVELS.map((level) => (
              <span key={level.id}>{level.label}</span>
            ))}
          </div>
          <div className="dev-lab-counts" data-testid="forest-stress-counts">
            <span>TREES <strong>{snapshot.forestStress.trees.toLocaleString()}</strong></span>
            <span>UNDERSTORY <strong>{snapshot.forestStress.groundcover.toLocaleString()}</strong></span>
            <span>ROCKS <strong>{snapshot.forestStress.rocks.toLocaleString()}</strong></span>
            <span>REEDS <strong>{snapshot.forestStress.reeds.toLocaleString()}</strong></span>
          </div>

          <div className="dev-control-heading dev-benchmark-target-heading">
            <label htmlFor="graphics-benchmark-target">CAPTURE TARGET</label>
            <output htmlFor="graphics-benchmark-target">
              {benchmark.targetFps} HZ / {benchmark.budgetMs.toFixed(2)} MS
            </output>
          </div>
          <select
            id="graphics-benchmark-target"
            data-testid="graphics-benchmark-target"
            value={benchmark.targetFps}
            disabled={captureRunning}
            onChange={(event) =>
              onSetGraphicsBenchmarkTarget(Number(event.currentTarget.value))
            }
          >
            {GRAPHICS_BENCHMARK_TARGETS.map((target) => (
              <option key={target} value={target}>{target} HZ</option>
            ))}
          </select>
          <div className="dev-benchmark-actions">
            <button
              type="button"
              data-testid="graphics-benchmark-start"
              disabled={captureRunning}
              onClick={onStartGraphicsBenchmark}
            >
              RUN 10 SEC CAPTURE
            </button>
            <button
              type="button"
              disabled={!captureRunning}
              onClick={onCancelGraphicsBenchmark}
            >
              CANCEL
            </button>
            <button
              type="button"
              disabled={benchmark.phase !== "complete"}
              onClick={() => void copyPerformanceReport()}
            >
              {copyStatus || "COPY REPORT"}
            </button>
          </div>
          <span className="sr-only" role="status" aria-live="polite">
            {copyStatus}
          </span>
          <div className="dev-benchmark-results" data-testid="graphics-benchmark-results">
            <span>STATUS <strong>{benchmark.phase.toUpperCase()}</strong></span>
            <span>CPU P95 <strong>{benchmark.cpuWork ? `${benchmark.cpuWork.p95.toFixed(2)} MS` : "—"}</strong></span>
            <span>GPU P95 <strong>{benchmark.gpu ? `${benchmark.gpu.p95.toFixed(2)} MS` : captureRunning && benchmark.gpuSupported ? "PENDING" : "N/A"}</strong></span>
            <span>OBSERVED <strong>{benchmark.observedFps === null ? "—" : `${benchmark.observedFps.toFixed(1)} HZ`}</strong></span>
            <span>1% LOW <strong>{benchmark.onePercentLowFps?.toFixed(1) ?? "—"}</strong></span>
            <span>HEADROOM <strong>{benchmark.headroomPercent === null ? "—" : `${benchmark.headroomPercent.toFixed(1)}%`}</strong></span>
            <span>MISSED <strong>{benchmark.missedRefreshPercent === null ? "—" : `${benchmark.missedRefreshPercent.toFixed(1)}%`}</strong></span>
            <span>ENGINE <strong>{benchmark.grade}</strong></span>
            <span>DELIVERY <strong>{benchmark.delivery}</strong></span>
            <span>GPU COVERAGE <strong>{benchmark.gpuCoveragePercent === null ? benchmark.gpuMeasurement : `${benchmark.gpuCoveragePercent.toFixed(1)}%`}</strong></span>
            <span>CALLS P95 <strong>{benchmark.drawCalls?.p95.toLocaleString() ?? snapshot.drawCalls.toLocaleString()}</strong></span>
            <span>TRIS P95 <strong>{benchmark.triangles?.p95.toLocaleString() ?? snapshot.triangles.toLocaleString()}</strong></span>
          </div>
          {benchmark.context && benchmark.phase === "complete" && (
            <p className="dev-benchmark-context">
              CAPTURED {benchmark.context.forest.label} · {benchmark.context.quality.toUpperCase()} · {benchmark.context.resolution.width}×{benchmark.context.resolution.height} · {benchmark.context.environment.weatherLabel.toUpperCase()}
            </p>
          )}
          <p className="dev-benchmark-footnote">
            {snapshot.gpuTimerSupported
              ? "GPU timer online · coverage is validated before grading. Use the fixed arrival viewpoint and stand still for directly comparable runs."
              : "GPU timer unavailable · result is a CPU-only estimate. Use the fixed arrival viewpoint and stand still for directly comparable runs."}
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
            onClick={() => {
              setForestLevelDraft(2);
              onReset();
            }}
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
