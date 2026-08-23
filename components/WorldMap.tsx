"use client";

import type { KeyboardEvent, MouseEvent } from "react";
import { BEACONS, WORLD_SEED } from "../lib/game/config";
import {
  clamp,
  formatHeading,
  formatNavigationDistance,
  mapPointToWorld,
  worldToMapPercent,
} from "../lib/game/navigation/math";
import type { GameSnapshot } from "../lib/game/state";
import {
  ROAD_CORRIDORS,
  SETTLEMENTS,
  WORLD_AREA_KM2,
  WORLD_HALF_EXTENT,
  riverCenterX,
} from "../lib/game/world/macroWorld";

interface WorldMapProps {
  snapshot: GameSnapshot;
  onClose(): void;
  onSetWaypoint(x: number, z: number): void;
  onClearWaypoint(): void;
}

function mapPercent(value: number) {
  return worldToMapPercent(value, WORLD_HALF_EXTENT);
}

const RIVER_MAP_POINTS = Array.from({ length: 33 }, (_, index) => {
  const z = -WORLD_HALF_EXTENT + (index / 32) * WORLD_HALF_EXTENT * 2;
  return `${mapPercent(riverCenterX(z)).toFixed(2)},${mapPercent(z).toFixed(2)}`;
}).join(" ");

export default function WorldMap({
  snapshot,
  onClose,
  onSetWaypoint,
  onClearWaypoint,
}: WorldMapProps) {
  const navigation = snapshot.navigation;
  const canClear = navigation?.target.source.kind === "player";

  const handleMapClick = (event: MouseEvent<HTMLDivElement>) => {
    const position = mapPointToWorld(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
      WORLD_HALF_EXTENT,
    );
    if (position) onSetWaypoint(position.x, position.z);
  };

  const handleMapKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key === "Delete" || event.key === "Backspace") && canClear) {
      event.preventDefault();
      onClearWaypoint();
      return;
    }
    const step = event.shiftKey ? 5_000 : 1_000;
    const base = canClear && navigation ? navigation.target.position : snapshot.position;
    let x = base.x;
    let z = base.z;
    switch (event.key) {
      case "ArrowLeft":
        x -= step;
        break;
      case "ArrowRight":
        x += step;
        break;
      case "ArrowUp":
        z -= step;
        break;
      case "ArrowDown":
        z += step;
        break;
      case "Enter":
        break;
      default:
        return;
    }
    event.preventDefault();
    onSetWaypoint(
      clamp(x, -WORLD_HALF_EXTENT, WORLD_HALF_EXTENT),
      clamp(z, -WORLD_HALF_EXTENT, WORLD_HALF_EXTENT),
    );
  };

  return (
    <section className="map-panel" data-testid="map-panel">
      <header>
        <div>
          <p className="eyebrow">FIELD CARTOGRAPHY</p>
          <h2>GREYWATER TERRITORY / 96 × 96 KM</h2>
        </div>
        <div className="map-header-actions">
          {canClear && (
            <button type="button" data-testid="clear-waypoint" onClick={onClearWaypoint}>
              CLEAR MARK
            </button>
          )}
          <button type="button" onClick={onClose}>
            CLOSE <kbd>M</kbd>
          </button>
        </div>
      </header>
      <div className="map-body">
        <div
          className="map-plot"
          data-testid="map-plot"
          role="application"
          tabIndex={0}
          aria-label="Territory map. Click a location or use arrow keys to set and move your waypoint."
          onClick={handleMapClick}
          onKeyDown={handleMapKeyDown}
          onContextMenu={(event) => {
            if (!canClear) return;
            event.preventDefault();
            onClearWaypoint();
          }}
        >
          <svg className="map-geography" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polyline className="map-river" points={RIVER_MAP_POINTS} />
            {ROAD_CORRIDORS.map((corridor) => (
              <line
                key={corridor.id}
                className={`map-road is-${corridor.class}`}
                x1={mapPercent(corridor.from.x)}
                y1={mapPercent(corridor.from.z)}
                x2={mapPercent(corridor.to.x)}
                y2={mapPercent(corridor.to.z)}
              />
            ))}
            {navigation && (
              <line
                className="map-waypoint-line"
                x1={mapPercent(snapshot.position.x)}
                y1={mapPercent(snapshot.position.z)}
                x2={mapPercent(navigation.target.position.x)}
                y2={mapPercent(navigation.target.position.z)}
              />
            )}
          </svg>
          <span className="map-instruction">CLICK OR ARROWS TO SET / REPLACE WAYPOINT</span>
          <span
            className="map-player"
            style={{
              left: `${clamp(mapPercent(snapshot.position.x), 2, 98)}%`,
              top: `${clamp(mapPercent(snapshot.position.z), 2, 98)}%`,
            }}
          >
            YOU
          </span>
          {navigation && (
            <span
              className={`map-waypoint is-${navigation.target.source.kind} ${navigation.reached ? "is-reached" : ""}`}
              data-testid="map-waypoint"
              style={{
                left: `${mapPercent(navigation.target.position.x)}%`,
                top: `${mapPercent(navigation.target.position.z)}%`,
              }}
            >
              <i />
              <b>{navigation.reached ? "ARRIVED" : "WAYPOINT"}</b>
            </span>
          )}
          {BEACONS.map((beacon) => (
            <span
              key={beacon.id}
              className={`map-beacon ${snapshot.scanned.includes(beacon.id) ? "is-scanned" : ""}`}
              style={{ left: `${mapPercent(beacon.x)}%`, top: `${mapPercent(beacon.z)}%` }}
            >
              <i />
              {beacon.code}
            </span>
          ))}
          {SETTLEMENTS.map((settlement) => (
            <span
              key={settlement.id}
              className={`map-settlement is-${settlement.tier}`}
              style={{ left: `${mapPercent(settlement.x)}%`, top: `${mapPercent(settlement.z)}%` }}
              title={`${settlement.name}: ${settlement.economy}`}
            >
              <i />
              <b>{settlement.name}</b>
            </span>
          ))}
        </div>
        <aside>
          <p>{navigation ? "ACTIVE NAVIGATION" : "WORLD STATE"}</p>
          {navigation && (
            <div className="map-navigation" data-testid="map-navigation">
              <span>{navigation.target.source.kind.toUpperCase()} / DESTINATION</span>
              <strong>{navigation.target.label}</strong>
              <dl>
                <div><dt>DISTANCE</dt><dd>{formatNavigationDistance(navigation.distance)}</dd></div>
                <div><dt>BEARING</dt><dd>{formatHeading(navigation.bearing)}</dd></div>
                <div><dt>X</dt><dd>{navigation.target.position.x.toFixed(0)}</dd></div>
                <div><dt>Z</dt><dd>{navigation.target.position.z.toFixed(0)}</dd></div>
              </dl>
              {canClear && (
                <button type="button" onClick={onClearWaypoint}>REMOVE WAYPOINT</button>
              )}
            </div>
          )}
          <dl className="map-world-state">
            <div><dt>SEED</dt><dd>{WORLD_SEED}</dd></div>
            <div><dt>AUTHORED AREA</dt><dd>{WORLD_AREA_KM2.toLocaleString()} KM²</dd></div>
            <div><dt>SETTLEMENTS</dt><dd>{SETTLEMENTS.length}</dd></div>
            <div><dt>ACTIVE GRID</dt><dd>{snapshot.chunk.x}:{snapshot.chunk.z}</dd></div>
            <div><dt>RESIDENT</dt><dd>{snapshot.loadedChunks} CHUNKS</dd></div>
            <div><dt>AMBIENT CITIZENS</dt><dd>{snapshot.citizenCount.toLocaleString()} / {snapshot.crowdDensity}</dd></div>
            <div><dt>RECORDS</dt><dd>{snapshot.scanned.length} / {BEACONS.length}</dd></div>
            <div><dt>WORLD CHANGES</dt><dd>{snapshot.worldChanges}</dd></div>
          </dl>
          <small>
            {!navigation && (
              <>
                Click anywhere on the territory to place a persistent waypoint. The same
                navigation channel is available to future quests and scripted objectives.
                <br /><br />
              </>
            )}
            <strong>{snapshot.nearestSettlement.name}</strong> — {snapshot.nearestSettlement.reason}
            <br /><br />Its economy: {snapshot.nearestSettlement.economy}.
          </small>
        </aside>
      </div>
    </section>
  );
}
