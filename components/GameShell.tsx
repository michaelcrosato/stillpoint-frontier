"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BEACONS, GAME_TITLE, WORLD_SEED, type BeaconId } from "../lib/game/config";
import { Engine } from "../lib/game/Engine";
import { INITIAL_SNAPSHOT, nextUnscannedBeacon, type GameSnapshot } from "../lib/game/state";

const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function cardinalForHeading(heading: number) {
  return CARDINALS[Math.round(heading / 45) % CARDINALS.length];
}

function beaconById(id: BeaconId | null) {
  return BEACONS.find((beacon) => beacon.id === id) ?? null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function GameShell() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot>(INITIAL_SNAPSHOT);
  const [engineError, setEngineError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let active = true;
    const testMode = new URLSearchParams(window.location.search).get("test") === "1";

    try {
      const engine = new Engine({
        canvas,
        testMode,
        onSnapshot: (nextSnapshot) => {
          if (active) setSnapshot(nextSnapshot);
        },
      });
      engineRef.current = engine;
      void engine.initialize().catch((error: unknown) => {
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
  }, []);

  const nextBeacon = useMemo(
    () => nextUnscannedBeacon(snapshot.scanned),
    [snapshot.scanned],
  );
  const nearbyBeacon = beaconById(snapshot.nearbyBeacon);
  const discoveredBeacon = beaconById(snapshot.lastDiscovery);
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
            <p className="eyebrow">FIELD DIRECTIVE 01 / RED BASIN</p>
            <h1>
              Read the land.<br />
              <em>Wake the signal.</em>
            </h1>
            <p className="entry-deck">
              Three silent relays remain in an unbounded procedural frontier.
              Traverse the basin, recover their records, and leave the world changed.
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
              <strong>STATIC WORLD</strong>
            </div>
            <div>
              <span>RENDER TARGET</span>
              <strong>RTX 30 / 1440P</strong>
            </div>
            <p>No combat. No cutscenes. Just place, signal, and distance.</p>
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

            <div className="compass" data-testid="compass">
              <span>{cardinalForHeading(snapshot.heading)}</span>
              <strong>{String(Math.round(snapshot.heading)).padStart(3, "0")}°</strong>
              <div className="compass-rule" aria-hidden="true">
                <i />
              </div>
            </div>

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

          <div className="crosshair" aria-hidden="true">
            <span />
            <i />
          </div>

          {nearbyBeacon && !snapshot.scanned.includes(nearbyBeacon.id) && (
            <div className="interaction-prompt" data-testid="interaction-prompt">
              <kbd>E</kbd>
              <div>
                <span>RECOVER RECORD</span>
                <strong>{nearbyBeacon.code} / {nearbyBeacon.name}</strong>
              </div>
              <small>{snapshot.nearbyDistance?.toFixed(1)}M</small>
            </div>
          )}

          {nearbyBeacon && snapshot.scanned.includes(nearbyBeacon.id) && (
            <div className="interaction-prompt is-complete">
              <span className="prompt-check">✓</span>
              <div>
                <span>RECORD SECURED</span>
                <strong>{nearbyBeacon.code} / {nearbyBeacon.name}</strong>
              </div>
            </div>
          )}

          <footer className="hud-footer">
            <div className="controls-strip">
              <span><kbd>WASD</kbd> MOVE</span>
              <span><kbd>SHIFT</kbd> TRAVERSE</span>
              <span><kbd>E</kbd> SCAN</span>
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
        <section className="map-panel" data-testid="map-panel">
          <header>
            <div>
              <p className="eyebrow">FIELD CARTOGRAPHY</p>
              <h2>RED BASIN / SURVEY GRID</h2>
            </div>
            <button type="button" onClick={() => engineRef.current?.setMapOpen(false)}>
              CLOSE <kbd>M</kbd>
            </button>
          </header>
          <div className="map-body">
            <div className="map-plot">
              <span
                className="map-player"
                style={{
                  left: `${50 + clamp(snapshot.position.x / 4.4, -46, 46)}%`,
                  top: `${50 + clamp(snapshot.position.z / 4.4, -46, 46)}%`,
                }}
              >
                YOU
              </span>
              {BEACONS.map((beacon) => (
                <span
                  key={beacon.id}
                  className={`map-beacon ${snapshot.scanned.includes(beacon.id) ? "is-scanned" : ""}`}
                  style={{
                    left: `${50 + beacon.x / 4.4}%`,
                    top: `${50 + beacon.z / 4.4}%`,
                  }}
                >
                  <i />
                  {beacon.code}
                </span>
              ))}
            </div>
            <aside>
              <p>WORLD STATE</p>
              <dl>
                <div><dt>SEED</dt><dd>{WORLD_SEED}</dd></div>
                <div><dt>ACTIVE GRID</dt><dd>{snapshot.chunk.x}:{snapshot.chunk.z}</dd></div>
                <div><dt>RESIDENT</dt><dd>{snapshot.loadedChunks} CHUNKS</dd></div>
                <div><dt>RECORDS</dt><dd>{snapshot.scanned.length} / {BEACONS.length}</dd></div>
              </dl>
              <small>The map indexes relay coordinates. Terrain continues beyond this survey plate.</small>
            </aside>
          </div>
        </section>
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
    </main>
  );
}
