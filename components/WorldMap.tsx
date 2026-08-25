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
import { FAST_TRAVEL_LOCATIONS } from "../lib/game/world/fastTravel";

interface WorldMapProps {
  snapshot: GameSnapshot;
  onClose(): void;
  onSetWaypoint(x: number, z: number): void;
  onClearWaypoint(): void;
  onFastTravel(locationId: string): void;
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
  onFastTravel,
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

  const handleFastTravel = (event: MouseEvent<HTMLElement>, locationId: string) => {
    event.preventDefault();
    event.stopPropagation();
    onFastTravel(locationId);
  };

  return (
    <section className="map-panel" data-testid="map-panel">
      <header>
        <div>
          <p className="eyebrow">FIELD CARTOGRAPHY</p>
          <h2>GREYWATER TERRITORY / 96 × 96 KM</h2>
        </div>
        <div className="map-header-actions">
          <span className="map-playtest-badge">PLAYTEST / ALL DESTINATIONS OPEN</span>
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
          <span className="map-instruction">
            CLICK GROUND: WAYPOINT · SELECT LOCATION: FAST TRAVEL
          </span>
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
            <button
              type="button"
              key={beacon.id}
              className={`map-beacon map-fast-travel-marker ${snapshot.scanned.includes(beacon.id) ? "is-scanned" : ""} ${snapshot.lastFastTravel?.id === `relay:${beacon.id}` ? "is-current" : ""}`}
              style={{ left: `${mapPercent(beacon.x)}%`, top: `${mapPercent(beacon.z)}%` }}
              data-testid={`fast-travel-marker-relay:${beacon.id}`}
              aria-label={`Fast travel to ${beacon.name}`}
              onClick={(event) => handleFastTravel(event, `relay:${beacon.id}`)}
            >
              <i />
              {beacon.code}
            </button>
          ))}
          {SETTLEMENTS.map((settlement) => (
            <button
              type="button"
              key={settlement.id}
              className={`map-settlement map-fast-travel-marker is-${settlement.tier} ${snapshot.lastFastTravel?.id === `settlement:${settlement.id}` ? "is-current" : ""}`}
              style={{ left: `${mapPercent(settlement.x)}%`, top: `${mapPercent(settlement.z)}%` }}
              title={`${settlement.name}: ${settlement.economy}`}
              data-testid={`fast-travel-marker-settlement:${settlement.id}`}
              aria-label={`Fast travel to ${settlement.name}`}
              onClick={(event) => handleFastTravel(event, `settlement:${settlement.id}`)}
            >
              <i />
              <b>{settlement.name}</b>
            </button>
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
          <section className="fast-travel-index" aria-label="Playtest fast travel destinations">
            <div className="fast-travel-heading">
              <div>
                <strong>FAST TRAVEL</strong>
                <span>TEMPORARY PLAYTEST TOOL</span>
              </div>
              <b>{FAST_TRAVEL_LOCATIONS.length}</b>
            </div>
            {snapshot.lastFastTravel && (
              <output className="fast-travel-status" aria-live="polite">
                ARRIVAL READY / {snapshot.lastFastTravel.name}
              </output>
            )}
            <div className="fast-travel-list">
              {FAST_TRAVEL_LOCATIONS.map((location) => {
                const distance = Math.hypot(
                  location.x - snapshot.position.x,
                  location.z - snapshot.position.z,
                );
                const current = snapshot.lastFastTravel?.id === location.id;
                return (
                  <button
                    type="button"
                    key={location.id}
                    className={current ? "is-current" : ""}
                    data-testid={`fast-travel-list-${location.id}`}
                    onClick={(event) => handleFastTravel(event, location.id)}
                  >
                    <span>
                      <strong>{location.name}</strong>
                      <small>{location.kind.toUpperCase()} · {location.detail}</small>
                    </span>
                    <b>{current ? "HERE" : formatNavigationDistance(distance)}</b>
                  </button>
                );
              })}
            </div>
          </section>
          <dl className="map-world-state">
            <div><dt>SEED</dt><dd>{WORLD_SEED}</dd></div>
            <div><dt>AUTHORED AREA</dt><dd>{WORLD_AREA_KM2.toLocaleString()} KM²</dd></div>
            <div><dt>SETTLEMENTS</dt><dd>{SETTLEMENTS.length}</dd></div>
            <div><dt>ACTIVE GRID</dt><dd>{snapshot.chunk.x}:{snapshot.chunk.z}</dd></div>
            <div><dt>RESIDENT</dt><dd>{snapshot.loadedChunks} CHUNKS</dd></div>
            <div><dt>DRAW HORIZON / {snapshot.horizonMode.toUpperCase()}</dt><dd>{(snapshot.drawDistanceMeters / 1_000).toFixed(snapshot.drawDistanceMeters >= 10_000 ? 0 : 2)} KM</dd></div>
            <div><dt>OPTICAL VISIBILITY</dt><dd>{formatNavigationDistance(snapshot.environment.visibilityMeters)}</dd></div>
            <div><dt>FAR HLOD</dt><dd>{snapshot.horizonTiles} TILES / {snapshot.horizonSettlementInstances} PROXIES</dd></div>
            <div><dt>LOCAL TIME</dt><dd>{String(snapshot.environment.hour).padStart(2, "0")}:{String(snapshot.environment.minute).padStart(2, "0")}</dd></div>
            <div><dt>WEATHER</dt><dd>{snapshot.environment.weatherLabel.toUpperCase()}</dd></div>
            <div><dt>AMBIENT CITIZENS</dt><dd>{snapshot.citizenCount.toLocaleString()} / {snapshot.crowdDensity}</dd></div>
            <div><dt>LOCAL WILDLIFE</dt><dd>{snapshot.animalCount} / {snapshot.animalSpecies} SPECIES</dd></div>
            <div><dt>RECORDS</dt><dd>{snapshot.scanned.length} / {BEACONS.length}</dd></div>
            <div><dt>WORLD CHANGES</dt><dd>{snapshot.worldChanges}</dd></div>
          </dl>
          <small>
            All authored settlements and relays are unlocked for fast travel during
            playtesting. This temporary access layer is isolated from future discovery
            and quest unlock rules.
            <br /><br />
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
