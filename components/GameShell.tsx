"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CompassTape, WaypointGuide } from "./NavigationDisplay";
import WorldMap from "./WorldMap";
import {
  BEACONS,
  GAME_TITLE,
  WORLD_RESIDENT_CHUNKS,
  WORLD_SEED,
  type BeaconId,
} from "../lib/game/config";
import { Engine } from "../lib/game/Engine";
import { ITEM_DEFINITIONS, type ItemId } from "../lib/game/gameplay/items";
import { clamp } from "../lib/game/navigation/math";
import { GamePresentationStore } from "../lib/game/navigation/presentation";
import { INITIAL_SNAPSHOT, nextUnscannedBeacon, type GameSnapshot } from "../lib/game/state";

function beaconById(id: BeaconId | null) {
  return BEACONS.find((beacon) => beacon.id === id) ?? null;
}

function formatDistance(meters: number) {
  return meters >= 1_000 ? `${(meters / 1_000).toFixed(1)} KM` : `${Math.round(meters)} M`;
}

export default function GameShell() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [presentationStore] = useState(() => new GamePresentationStore());
  const [snapshot, setSnapshot] = useState<GameSnapshot>(INITIAL_SNAPSHOT);
  const [visualFixture, setVisualFixture] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let active = true;
    const parameters = new URLSearchParams(window.location.search);
    const fixture = parameters.get("visual");
    if (fixture) {
      queueMicrotask(() => {
        if (!active) return;
        const navigation = {
          target: {
            id: "player:map",
            label: "Sablewood crossing",
            position: { x: 8_300, z: -7_200 },
            source: { kind: "player" as const },
            arrivalRadius: 12,
            clearOnArrival: false,
          },
          distance: 6_500,
          bearing: 58,
          relativeBearing: 16,
          reached: false,
        };
        setVisualFixture(true);
        setSnapshot({
          ...INITIAL_SNAPSHOT,
          ready: true,
          started: fixture !== "entry",
          mapOpen: fixture === "map",
          position: { x: 4_240, y: 8.4, z: -3_180 },
          heading: 42,
          navigation,
          fps: 60,
          chunk: { x: 44, z: -33 },
          loadedChunks: WORLD_RESIDENT_CHUNKS,
          citizenCount: 486,
          crowdDensity: "ACTIVE",
          triangles: 48_620,
          geometries: 138,
          textures: 4,
          scanned: ["amber-relay"],
          inventory: { stone: 3, wood: 4, fiber: 2, ore: 1, relic: 0 },
          worldChanges: 4,
          stamina: 0.72,
          biome: { id: "pine_forest", name: "Sable Pine Forest", region: "Sablewood" },
          environment: {
            totalMinutes: 1_015,
            day: 1,
            hour: 16,
            minute: 55,
            phase: "day",
            weatherId: "rain",
            weatherLabel: "Canopy drizzle",
            precipitation: "rain",
            temperatureC: 11,
            windKph: 18,
            windDirection: 238,
            visibilityMeters: 410,
          },
          nearestSettlement: {
            id: "timberfall",
            name: "Timberfall",
            tier: "town",
            distance: 1_240,
            economy: "timber · resin · paper · carpentry",
            reason: "A managed-forest town where two logging valleys meet the highland road.",
          },
          nearbyTarget: {
            id: "resource:tree:v1:44:-33:0",
            kind: "resource",
            action: "harvest",
            name: "Workable pine",
            item: "wood",
            hits: 1,
            hitsRequired: 3,
            beaconId: null,
          },
          nearbyDistance: 4.2,
        });
        presentationStore.publish({
          heading: 42,
          unwrappedHeading: 42,
          navigation,
          waypointScreen: { visible: true, xPercent: 64, yPercent: 41 },
        });
      });
      return () => {
        active = false;
      };
    }
    const testMode = parameters.get("test") === "1";
    const storageEnabled =
      !testMode || parameters.get("storage") === "1";

    try {
      const engine = new Engine({
        canvas,
        testMode,
        storageEnabled,
        onSnapshot: (nextSnapshot) => {
          if (active) setSnapshot(nextSnapshot);
        },
        onPresentation: (presentation) => {
          if (active) presentationStore.publish(presentation);
        },
      });
      engineRef.current = engine;
      void engine.initialize().catch((error: unknown) => {
        engine.dispose();
        if (engineRef.current === engine) engineRef.current = null;
        if (!active) return;
        const message = error instanceof Error ? error.message : "Unknown renderer error";
        setEngineError(message);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "WebGL could not start";
      queueMicrotask(() => {
        if (active) setEngineError(message);
      });
    }

    return () => {
      active = false;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, [presentationStore]);

  const nextBeacon = useMemo(
    () => nextUnscannedBeacon(snapshot.scanned),
    [snapshot.scanned],
  );
  const nearbyBeacon = beaconById(snapshot.nearbyBeacon);
  const discoveredBeacon = beaconById(snapshot.lastDiscovery);
  const nearbyTarget = snapshot.nearbyTarget;
  const lastGatherItem = snapshot.lastGather
    ? ITEM_DEFINITIONS[snapshot.lastGather.item]
    : null;
  const surveyComplete = snapshot.scanned.length === BEACONS.length;
  return (
    <main className="game-shell" data-testid="game-shell">
      <canvas
        ref={canvasRef}
        className="game-canvas"
        data-testid="game-canvas"
        aria-label="Stillpoint Frontier three-dimensional game world"
        onClick={() => {
          if (snapshot.started && snapshot.paused) engineRef.current?.resume();
        }}
      />

      {visualFixture && (
        <>
          <div className="visual-world-fixture" aria-hidden="true"><i /><span /><b /></div>
          <small className="visual-fixture-label">UI TEST FIXTURE / WEBGL BYPASSED</small>
        </>
      )}

      <div className="optical-grain" aria-hidden="true" />
      <div className="frame-corners" aria-hidden="true" />

      {!snapshot.ready && !engineError && (
        <section className="boot-screen" data-testid="boot-screen" aria-live="polite">
          <div className="boot-mark" aria-hidden="true">
            <span />
            <span />
          </div>
          <p>ESTABLISHING WORLD GRID</p>
          <small>SEED {WORLD_SEED}</small>
        </section>
      )}

      {engineError && (
        <section className="error-screen" role="alert" data-testid="engine-error">
          <p className="eyebrow">RENDERER INTERRUPT</p>
          <h1>Unable to establish the frontier.</h1>
          <p>{engineError}</p>
          <p className="error-hint">A WebGL2-capable browser and hardware acceleration are required.</p>
        </section>
      )}

      {snapshot.ready && !snapshot.started && !engineError && (
        <section className="entry-screen" data-testid="entry-screen">
          <header className="entry-header">
            <div className="wordmark">
              <span className="wordmark-glyph" aria-hidden="true">S</span>
              <span>{GAME_TITLE}</span>
            </div>
            <div className="entry-status">
              <span className="status-dot" />
              WORLD GRID ONLINE
            </div>
          </header>

          <div className="entry-main">
            <p className="eyebrow">FIELD DIRECTIVE 01 / GREYWATER TERRITORY</p>
            <h1>
              Read the land.<br />
              <em>Wake the signal.</em>
            </h1>
            <p className="entry-deck">
              A 96-kilometre territory unfolds around the Greywater: forest, highland,
              steppe, badland, coast, and the megacity that binds their economies together.
            </p>
            <button
              type="button"
              className="enter-button"
              data-testid="enter-frontier"
              onClick={() => engineRef.current?.beginSession()}
            >
              <span>ENTER FRONTIER</span>
              <span aria-hidden="true">↗</span>
            </button>
            <p className="entry-note">
              Click to capture the mouse · Headphones recommended
            </p>
          </div>

          <footer className="entry-footer">
            <div>
              <span>MODE</span>
              <strong>OPEN SURVEY</strong>
            </div>
            <div>
              <span>MOTION PROFILE</span>
              <strong>RIG-FREE CROWDS</strong>
            </div>
            <div>
              <span>RENDER TARGET</span>
              <strong>RTX 30 / 1440P</strong>
            </div>
            <p>No combat. No cutscenes. A low-animation world shaped by distance and work.</p>
          </footer>
        </section>
      )}

      {snapshot.started && !engineError && (
        <div className="hud" data-testid="game-hud">
          <header className="hud-topbar">
            <div className="hud-brand">
              <span className="hud-glyph">S</span>
              <div>
                <strong>STILLPOINT</strong>
                <small>FIELD UNIT / {WORLD_SEED}</small>
              </div>
            </div>

            <CompassTape store={presentationStore} />

            <div className="system-readout">
              <div>
                <span>FRAME</span>
                <strong>{snapshot.fps}</strong>
              </div>
              <div>
                <span>CHUNKS</span>
                <strong>{String(snapshot.loadedChunks).padStart(2, "0")}</strong>
              </div>
              <div>
                <span>CITIZENS</span>
                <strong>{snapshot.citizenCount.toLocaleString()}</strong>
              </div>
              <div>
                <span>PROFILE</span>
                <strong>{snapshot.quality === "cinematic" ? "CINE" : "PERF"}</strong>
              </div>
            </div>
          </header>

          <aside className="mission-card" data-testid="mission-card">
            <p className="eyebrow">ACTIVE DIRECTIVE</p>
            <div className="mission-count">
              <strong>{String(snapshot.scanned.length).padStart(2, "0")}</strong>
              <span>/ {String(BEACONS.length).padStart(2, "0")}</span>
            </div>
            <h2>{surveyComplete ? "Survey complete" : "Recover relay records"}</h2>
            <p>
              {surveyComplete
                ? "All basin signals are coherent. The frontier now holds your survey state."
                : nextBeacon
                  ? `Next indexed signal: ${nextBeacon.code} / ${nextBeacon.name}.`
                  : "No remaining signal indexed."}
            </p>
            <div className="relay-list">
              {BEACONS.map((beacon) => (
                <div key={beacon.id} className={snapshot.scanned.includes(beacon.id) ? "is-scanned" : ""}>
                  <i aria-hidden="true" />
                  <span>{beacon.code}</span>
                  <strong>{snapshot.scanned.includes(beacon.id) ? "RECOVERED" : "SILENT"}</strong>
                </div>
              ))}
            </div>
          </aside>

          <aside className="radar-card" aria-label="Local signal radar">
            <div className="radar-heading">
              <span>LOCAL ARRAY</span>
              <strong>480M</strong>
            </div>
            <div className="radar-grid">
              <span className="radar-player" aria-label="Player position" />
              {BEACONS.map((beacon) => {
                const left = 50 + clamp((beacon.x - snapshot.position.x) / 4.8, -42, 42);
                const top = 50 + clamp((beacon.z - snapshot.position.z) / 4.8, -42, 42);
                return (
                  <span
                    key={beacon.id}
                    className={`radar-signal ${snapshot.scanned.includes(beacon.id) ? "is-scanned" : ""}`}
                    style={{ left: `${left}%`, top: `${top}%` }}
                    title={beacon.name}
                  />
                );
              })}
            </div>
          </aside>

          <aside className="region-card" data-testid="region-card">
            <p>{snapshot.biome.region}</p>
            <h2>{snapshot.biome.name}</h2>
            <div className="environment-readout" data-testid="environment-readout">
              <span>DAY {snapshot.environment.day} · {snapshot.environment.phase.toUpperCase()}</span>
              <strong>
                {String(snapshot.environment.hour).padStart(2, "0")}:{String(snapshot.environment.minute).padStart(2, "0")} · {snapshot.environment.weatherLabel}
              </strong>
              <small>
                {Math.round(snapshot.environment.temperatureC)}°C · WIND {Math.round(snapshot.environment.windKph)} KM/H · VIS {formatDistance(snapshot.environment.visibilityMeters)}
              </small>
            </div>
            <div>
              <span>NEAREST {snapshot.nearestSettlement.tier.toUpperCase()}</span>
              <strong>{snapshot.nearestSettlement.name}</strong>
              <small>{formatDistance(snapshot.nearestSettlement.distance)} · {snapshot.nearestSettlement.economy}</small>
            </div>
            <div className="crowd-readout" data-testid="crowd-readout">
              <span>AMBIENT / NON-INTERACTIVE</span>
              <strong>{snapshot.crowdDensity} · {snapshot.citizenCount.toLocaleString()} VISIBLE</strong>
              <small>INSTANCED ROUTES · NO DIALOGUE STATE</small>
            </div>
          </aside>

          <div className="crosshair" aria-hidden="true">
            <span />
            <i />
          </div>

          <WaypointGuide store={presentationStore} />

          {nearbyTarget &&
            !(nearbyTarget.beaconId && snapshot.scanned.includes(nearbyTarget.beaconId)) && (
            <div className="interaction-prompt" data-testid="interaction-prompt">
              <kbd>{nearbyTarget.action === "harvest" ? "F" : "E"}</kbd>
              <div>
                <span>
                  {nearbyTarget.action === "harvest"
                    ? "HARVEST RESOURCE"
                    : nearbyTarget.action === "collect"
                      ? "COLLECT"
                      : "RECOVER RECORD"}
                </span>
                <strong>
                  {nearbyTarget.beaconId && nearbyBeacon?.code ? `${nearbyBeacon.code} / ` : ""}
                  {nearbyTarget.name}
                </strong>
              </div>
              <small>
                {nearbyTarget.action === "harvest"
                  ? `${Math.max(1, nearbyTarget.hitsRequired - nearbyTarget.hits)} HITS · `
                  : ""}
                {snapshot.nearbyDistance?.toFixed(1)}M
              </small>
            </div>
          )}

          {nearbyTarget?.beaconId && snapshot.scanned.includes(nearbyTarget.beaconId) && (
            <div className="interaction-prompt is-complete">
              <span className="prompt-check">✓</span>
              <div>
                <span>RECORD SECURED</span>
                <strong>{nearbyBeacon?.code} / {nearbyBeacon?.name}</strong>
              </div>
            </div>
          )}

          <div className="survival-readout" data-testid="movement-readout">
            <div className="stamina-line">
              <span>
                {snapshot.crouching ? "CROUCHED" : snapshot.sprinting ? "SPRINTING" : snapshot.grounded ? "READY" : "AIRBORNE"}
              </span>
              <i><b style={{ width: `${snapshot.stamina * 100}%` }} /></i>
              <strong>{Math.round(snapshot.stamina * 100)}</strong>
            </div>
            <div className="inventory-belt" data-testid="inventory-belt">
              {(Object.keys(ITEM_DEFINITIONS) as ItemId[]).map((item) => (
                <span key={item} className={snapshot.inventory[item] > 0 ? "has-item" : ""}>
                  <small>{ITEM_DEFINITIONS[item].shortName}</small>
                  <strong>{String(snapshot.inventory[item]).padStart(2, "0")}</strong>
                </span>
              ))}
            </div>
          </div>

          <footer className="hud-footer">
            <div className="controls-strip">
              <span><kbd>WASD</kbd> MOVE</span>
              <span><kbd>SHIFT</kbd> SPRINT</span>
              <span><kbd>SPACE</kbd> JUMP</span>
              <span><kbd>CTRL/C</kbd> CROUCH</span>
              <span><kbd>E</kbd> USE</span>
              <span><kbd>F/CLICK</kbd> HARVEST</span>
              <button type="button" onClick={() => engineRef.current?.setMapOpen(true)}>
                <kbd>M</kbd> MAP
              </button>
              <span><kbd>Q</kbd> QUALITY</span>
            </div>
            <div className="coordinates" data-testid="coordinates">
              <span>X {snapshot.position.x.toFixed(1)}</span>
              <span>Z {snapshot.position.z.toFixed(1)}</span>
              <strong>GRID {snapshot.chunk.x}:{snapshot.chunk.z}</strong>
            </div>
          </footer>
        </div>
      )}

      {snapshot.started && snapshot.paused && !snapshot.mapOpen && snapshot.contextStatus === "ready" && (
        <section className="pause-panel" data-testid="pause-panel">
          <p className="eyebrow">FIELD LINK SUSPENDED</p>
          <h2>The frontier is holding.</h2>
          <p>Resume to recapture the mouse and continue the survey.</p>
          <button type="button" onClick={() => engineRef.current?.resume()}>
            RESUME SURVEY <span>↗</span>
          </button>
        </section>
      )}

      {snapshot.started && snapshot.mapOpen && (
        <WorldMap
          snapshot={snapshot}
          onClose={() => engineRef.current?.setMapOpen(false)}
          onSetWaypoint={(x, z) => engineRef.current?.setManualWaypoint(x, z)}
          onClearWaypoint={() => engineRef.current?.clearManualWaypoint()}
          onFastTravel={(locationId) => engineRef.current?.fastTravel(locationId)}
        />
      )}

      {snapshot.contextStatus === "lost" && (
        <section className="context-panel" role="alert">
          <p className="eyebrow">GRAPHICS CONTEXT LOST</p>
          <h2>Holding simulation state.</h2>
          <p>The renderer will resume if the browser restores GPU access.</p>
        </section>
      )}

      {discoveredBeacon && (
        <aside className="discovery-card" data-testid="discovery-card" aria-live="polite">
          <button
            type="button"
            aria-label="Dismiss discovery"
            onClick={() => engineRef.current?.clearDiscoveryNotice()}
          >
            ×
          </button>
          <p>RECORD RECOVERED / {discoveredBeacon.code}</p>
          <h2>{discoveredBeacon.name}</h2>
          <blockquote>{discoveredBeacon.note}</blockquote>
          <small>{snapshot.scanned.length} OF {BEACONS.length} SIGNALS COHERENT</small>
        </aside>
      )}

      {snapshot.lastGather && lastGatherItem && (
        <aside className="gather-card" data-testid="gather-card" aria-live="polite">
          <button type="button" aria-label="Dismiss gathering result" onClick={() => engineRef.current?.clearGatherNotice()}>×</button>
          <p>{snapshot.lastGather.result === "hit" ? "RESOURCE WORKED" : "MATERIAL SECURED"}</p>
          <h2>{snapshot.lastGather.targetName}</h2>
          <strong>
            {snapshot.lastGather.quantity > 0
              ? `+${snapshot.lastGather.quantity} ${lastGatherItem.shortName}`
              : `${snapshot.lastGather.remainingHits} HITS REMAIN`}
          </strong>
          <small>STATE SAVED TO THE WORLD DELTA</small>
        </aside>
      )}
    </main>
  );
}
