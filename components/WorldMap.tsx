"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type SetStateAction,
  type WheelEvent,
} from "react";
import { BEACONS, WORLD_SEED } from "../lib/game/config";
import {
  clamp,
  formatHeading,
  formatNavigationDistance,
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
import {
  MOUNTAIN_LANDMARK,
  MOUNTAIN_TRAIL_POINTS,
} from "../lib/game/world/mountainLandmark";
import {
  CANYON_LANDMARK,
  CANYON_RIM_TRAIL_POINTS,
  CANYON_RIVER_POINTS,
} from "../lib/game/world/canyonLandmark";
import { AUTHORED_LANDMARK_NAVIGATION_SYSTEM_ID } from "../lib/game/world/authoredLandmarks";
import {
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  clampMapViewport,
  fitMapViewport,
  focusMapViewport,
  mapDetailLevel,
  mapScreenPointToWorld,
  mapStageLayout,
  mapViewportTransform,
  panMapViewport,
  sameMapViewport,
  visibleMapWorldBounds,
  zoomMapViewportAtPoint,
  type MapViewportMetrics,
  type MapViewportState,
} from "../lib/game/cartography/viewport";

interface WorldMapProps {
  snapshot: GameSnapshot;
  viewport: MapViewportState;
  onViewportChange: Dispatch<SetStateAction<MapViewportState>>;
  onClose(): void;
  onSetWaypoint(x: number, z: number): void;
  onClearWaypoint(): void;
  onActivateNavigationTarget(id: string): void;
  onFastTravel(locationId: string): void;
}

interface MapDragState {
  pointerId: number;
  startX: number;
  startY: number;
  viewport: MapViewportState;
  moved: boolean;
}

function mapPercent(value: number) {
  return worldToMapPercent(value, WORLD_HALF_EXTENT);
}

const RIVER_MAP_POINTS = Array.from({ length: 33 }, (_, index) => {
  const z = -WORLD_HALF_EXTENT + (index / 32) * WORLD_HALF_EXTENT * 2;
  return `${mapPercent(riverCenterX(z)).toFixed(2)},${mapPercent(z).toFixed(2)}`;
}).join(" ");

const MOUNTAIN_TRAIL_MAP_POINTS = MOUNTAIN_TRAIL_POINTS.map(
  (point) => `${mapPercent(point.x).toFixed(2)},${mapPercent(point.z).toFixed(2)}`,
).join(" ");
const MOUNTAIN_MAP_RADIUS =
  (MOUNTAIN_LANDMARK.footprintRadius / (WORLD_HALF_EXTENT * 2)) * 100;
const CANYON_RIVER_MAP_POINTS = CANYON_RIVER_POINTS.map(
  (point) => `${mapPercent(point.x).toFixed(2)},${mapPercent(point.z).toFixed(2)}`,
).join(" ");
const CANYON_RIM_TRAIL_MAP_POINTS = CANYON_RIM_TRAIL_POINTS.map(
  (point) => `${mapPercent(point.x).toFixed(2)},${mapPercent(point.z).toFixed(2)}`,
).join(" ");
const CANYON_MAP_HALF_LENGTH =
  (CANYON_LANDMARK.halfLength / (WORLD_HALF_EXTENT * 2)) * 100;
const CANYON_MAP_HALF_WIDTH =
  (CANYON_LANDMARK.footprintHalfWidth / (WORLD_HALF_EXTENT * 2)) * 100;
const CANYON_MAP_ROTATION =
  (Math.atan2(CANYON_LANDMARK.axis.z, CANYON_LANDMARK.axis.x) * 180) /
  Math.PI;

function niceScaleDistance(pixelsPerMeter: number, targetPixels = 110) {
  if (!Number.isFinite(pixelsPerMeter) || pixelsPerMeter <= 0) return 1_000;
  const targetMeters = targetPixels / pixelsPerMeter;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, targetMeters)));
  const normalized = targetMeters / magnitude;
  const step = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
  return step * magnitude;
}

export default function WorldMap({
  snapshot,
  viewport,
  onViewportChange,
  onClose,
  onSetWaypoint,
  onClearWaypoint,
  onActivateNavigationTarget,
  onFastTravel,
}: WorldMapProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<MapDragState | null>(null);
  const suppressClickRef = useRef(false);
  const [localViewport, setLocalViewport] = useState(() => viewport);
  const viewportRef = useRef(viewport);
  const [isPanning, setIsPanning] = useState(false);
  const [metrics, setMetrics] = useState<MapViewportMetrics>({ width: 0, height: 0 });
  const navigation = snapshot.navigation;
  const canClear = navigation?.target.source.kind === "player";
  const surveyMarkers = snapshot.navigationTargets.filter(
    (target) => target.source.kind === "system" && target.source.systemId === "survey-markers",
  );
  const landmarkMarkers = snapshot.navigationTargets.filter(
    (target) =>
      target.source.kind === "system" &&
      target.source.systemId === AUTHORED_LANDMARK_NAVIGATION_SYSTEM_ID,
  );

  const changeViewport = useCallback((update: SetStateAction<MapViewportState>) => {
    setLocalViewport((current) => {
      const candidate = typeof update === "function"
        ? update(current)
        : update;
      const next = sameMapViewport(current, candidate) ? current : candidate;
      viewportRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => () => {
    onViewportChange(viewportRef.current);
  }, [onViewportChange]);

  useLayoutEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    const measure = () => {
      const rect = plot.getBoundingClientRect();
      const nextMetrics = { width: rect.width, height: rect.height };
      setMetrics(nextMetrics);
      changeViewport((current) => {
        const next = clampMapViewport(current, nextMetrics, WORLD_HALF_EXTENT);
        return sameMapViewport(current, next) ? current : next;
      });
    };
    measure();
    plot.focus({ preventScroll: true });
    const observer = new ResizeObserver(measure);
    observer.observe(plot);
    return () => observer.disconnect();
  }, [changeViewport]);

  const safeViewport = clampMapViewport(localViewport, metrics, WORLD_HALF_EXTENT);
  const stage = mapStageLayout(metrics);
  const transform = mapViewportTransform(safeViewport, WORLD_HALF_EXTENT);
  const bounds = visibleMapWorldBounds(safeViewport, metrics, WORLD_HALF_EXTENT);
  const markerPadding = Math.max(
    250,
    Math.min(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) * 0.08,
  );
  const markerIsVisible = (point: { x: number; z: number }) => (
    point.x >= bounds.minX - markerPadding &&
    point.x <= bounds.maxX + markerPadding &&
    point.z >= bounds.minZ - markerPadding &&
    point.z <= bounds.maxZ + markerPadding
  );
  const detailLevel = mapDetailLevel(safeViewport.zoom);
  const pixelsPerMeter = stage.size > 0
    ? (stage.size * safeViewport.zoom) / (WORLD_HALF_EXTENT * 2)
    : 0;
  const scaleDistance = niceScaleDistance(pixelsPerMeter);
  const worldStyle = {
    left: `${stage.left}px`,
    top: `${stage.top}px`,
    width: `${stage.size}px`,
    height: `${stage.size}px`,
    transform: `translate(${transform.translateXPercent}%, ${transform.translateYPercent}%) scale(${transform.scale})`,
    "--map-marker-scale": String(1 / safeViewport.zoom),
    "--map-line-width": `${1 / safeViewport.zoom}px`,
  } as CSSProperties;

  const updateViewport = (next: MapViewportState) => {
    changeViewport((current) => sameMapViewport(current, next) ? current : next);
  };

  const zoomAtCenter = (requestedZoom: number) => {
    changeViewport((current) => zoomMapViewportAtPoint(
      current,
      requestedZoom,
      { x: metrics.width * 0.5, y: metrics.height * 0.5 },
      metrics,
      WORLD_HALF_EXTENT,
    ));
  };

  const focusPosition = (position: { x: number; z: number }, minimumZoom = 4) => {
    changeViewport((current) => focusMapViewport(
      current,
      position,
      metrics,
      WORLD_HALF_EXTENT,
      minimumZoom,
    ));
  };

  const handleMapClick = (event: MouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const position = mapScreenPointToWorld(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      safeViewport,
      { width: rect.width, height: rect.height },
      WORLD_HALF_EXTENT,
    );
    if (position) onSetWaypoint(position.x, position.z);
  };

  const handleMapKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if ((event.key === "Delete" || event.key === "Backspace") && canClear) {
      event.preventDefault();
      onClearWaypoint();
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomAtCenter(safeViewport.zoom * 1.5);
      return;
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomAtCenter(safeViewport.zoom / 1.5);
      return;
    }
    if (event.key === "0" || event.key === "Home") {
      event.preventDefault();
      updateViewport(fitMapViewport());
      return;
    }
    if (event.key.toLowerCase() === "p") {
      event.preventDefault();
      focusPosition(snapshot.position);
      return;
    }
    if (event.key.toLowerCase() === "n" && navigation) {
      event.preventDefault();
      focusPosition(navigation.target.position);
      return;
    }
    if (event.altKey && event.key.startsWith("Arrow")) {
      const panPixels = 72;
      const delta = event.key === "ArrowLeft"
        ? { x: panPixels, y: 0 }
        : event.key === "ArrowRight"
          ? { x: -panPixels, y: 0 }
          : event.key === "ArrowUp"
            ? { x: 0, y: panPixels }
            : { x: 0, y: -panPixels };
      event.preventDefault();
      updateViewport(panMapViewport(
        safeViewport,
        delta,
        metrics,
        WORLD_HALF_EXTENT,
      ));
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
    const location = FAST_TRAVEL_LOCATIONS.find((candidate) => candidate.id === locationId);
    if (location) focusPosition(location, Math.max(4, safeViewport.zoom));
  };

  const handleNavigationTarget = (event: MouseEvent<HTMLElement>, targetId: string) => {
    event.preventDefault();
    event.stopPropagation();
    onActivateNavigationTarget(targetId);
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const factor = Math.exp(-event.deltaY * 0.0015);
    changeViewport((current) => zoomMapViewportAtPoint(
      current,
      current.zoom * factor,
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      { width: rect.width, height: rect.height },
      WORLD_HALF_EXTENT,
    ));
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, [data-map-control]")) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      viewport: safeViewport,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = {
      x: event.clientX - drag.startX,
      y: event.clientY - drag.startY,
    };
    if (!drag.moved && Math.hypot(delta.x, delta.y) < 4) return;
    drag.moved = true;
    setIsPanning(true);
    updateViewport(panMapViewport(
      drag.viewport,
      delta,
      metrics,
      WORLD_HALF_EXTENT,
    ));
  };

  const finishPointerGesture = (
    event: PointerEvent<HTMLDivElement>,
    cancelled = false,
  ) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved && !cancelled) suppressClickRef.current = true;
    dragRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const clearPointerGesture = () => {
    dragRef.current = null;
    setIsPanning(false);
  };

  return (
    <section
      className="map-panel"
      data-testid="map-panel"
      data-map-detail={detailLevel}
      data-map-zoom={safeViewport.zoom.toFixed(2)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="territory-map-title"
    >
      <header>
        <div>
          <p className="eyebrow">FIELD CARTOGRAPHY</p>
          <h2 id="territory-map-title">GREYWATER TERRITORY / 96 × 96 KM</h2>
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
          ref={plotRef}
          className={`map-plot ${isPanning ? "is-panning" : ""}`}
          data-testid="map-plot"
          role="application"
          tabIndex={0}
          aria-label="Territory map. Scroll or use plus and minus to zoom, drag to pan, click ground to set a waypoint, or use arrow keys to move it."
          onClick={handleMapClick}
          onKeyDown={handleMapKeyDown}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointerGesture}
          onPointerCancel={(event) => finishPointerGesture(event, true)}
          onLostPointerCapture={clearPointerGesture}
          onContextMenu={(event) => {
            if ((event.target as HTMLElement).closest("[data-map-control], button, input")) return;
            if (!canClear) return;
            event.preventDefault();
            onClearWaypoint();
          }}
        >
          <div className="map-world" style={worldStyle} aria-hidden={stage.size <= 0}>
          <svg className="map-geography" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polyline className="map-river" points={RIVER_MAP_POINTS} />
            <circle
              className="map-mountain-contour is-outer"
              cx={mapPercent(MOUNTAIN_LANDMARK.center.x)}
              cy={mapPercent(MOUNTAIN_LANDMARK.center.z)}
              r={MOUNTAIN_MAP_RADIUS}
            />
            <circle
              className="map-mountain-contour is-inner"
              cx={mapPercent(MOUNTAIN_LANDMARK.center.x)}
              cy={mapPercent(MOUNTAIN_LANDMARK.center.z)}
              r={MOUNTAIN_MAP_RADIUS * 0.48}
            />
            <polyline
              className="map-mountain-trail"
              points={MOUNTAIN_TRAIL_MAP_POINTS}
            />
            <ellipse
              className="map-canyon-contour is-outer"
              cx={mapPercent(CANYON_LANDMARK.center.x)}
              cy={mapPercent(CANYON_LANDMARK.center.z)}
              rx={CANYON_MAP_HALF_LENGTH}
              ry={CANYON_MAP_HALF_WIDTH}
              transform={`rotate(${CANYON_MAP_ROTATION} ${mapPercent(CANYON_LANDMARK.center.x)} ${mapPercent(CANYON_LANDMARK.center.z)})`}
            />
            <ellipse
              className="map-canyon-contour is-inner"
              cx={mapPercent(CANYON_LANDMARK.center.x)}
              cy={mapPercent(CANYON_LANDMARK.center.z)}
              rx={CANYON_MAP_HALF_LENGTH * 0.78}
              ry={(CANYON_LANDMARK.carvedHalfWidth / (WORLD_HALF_EXTENT * 2)) * 100 * 0.62}
              transform={`rotate(${CANYON_MAP_ROTATION} ${mapPercent(CANYON_LANDMARK.center.x)} ${mapPercent(CANYON_LANDMARK.center.z)})`}
            />
            <polyline
              className="map-canyon-river"
              points={CANYON_RIVER_MAP_POINTS}
            />
            <polyline
              className="map-canyon-trail"
              points={CANYON_RIM_TRAIL_MAP_POINTS}
            />
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
          <span
            className="map-player"
            style={{
              left: `${mapPercent(snapshot.position.x)}%`,
              top: `${mapPercent(snapshot.position.z)}%`,
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
          {surveyMarkers.filter((marker) => markerIsVisible(marker.position)).map((marker) => {
            const serial = marker.id.split(":").at(-1) ?? "?";
            return (
              <button
                type="button"
                key={marker.id}
                className={`map-survey-marker map-selectable-marker ${navigation?.target.id === marker.id ? "is-current" : ""}`}
                style={{
                  left: `${mapPercent(marker.position.x)}%`,
                  top: `${mapPercent(marker.position.z)}%`,
                }}
                data-testid={`survey-marker-${marker.id}`}
                aria-label={`Navigate to ${marker.label}`}
                title={marker.label}
                onClick={(event) => handleNavigationTarget(event, marker.id)}
              >
                <i />
                <b>M{serial}</b>
              </button>
            );
          })}
          {landmarkMarkers.filter((marker) => markerIsVisible(marker.position)).map((marker) => (
            <button
              type="button"
              key={marker.id}
              className={`map-landmark-marker map-selectable-marker ${navigation?.target.id === marker.id ? "is-current" : ""}`}
              style={{
                left: `${mapPercent(marker.position.x)}%`,
                top: `${mapPercent(marker.position.z)}%`,
              }}
              data-testid={`landmark-marker-${marker.id}`}
              aria-label={`Navigate to ${marker.label}`}
              title={`Navigate to ${marker.label}`}
              onClick={(event) => handleNavigationTarget(event, marker.id)}
            >
              <i />
              <b>{marker.label}</b>
            </button>
          ))}
          {BEACONS.filter(markerIsVisible).map((beacon) => (
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
          {SETTLEMENTS.filter(markerIsVisible).map((settlement) => (
            <button
              type="button"
              key={settlement.id}
              className={`map-settlement map-fast-travel-marker is-${settlement.tier} ${settlement.landmarkGatewayId ? "is-landmark-gateway" : ""} ${snapshot.discoveredLocationIds.includes(`settlement:${settlement.id}`) ? "is-discovered" : ""} ${snapshot.lastFastTravel?.id === `settlement:${settlement.id}` ? "is-current" : ""}`}
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

          <div
            className="map-viewport-controls"
            data-map-control
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
            <div className="map-zoom-buttons" role="group" aria-label="Map zoom">
              <button
                type="button"
                data-testid="map-zoom-out"
                aria-label="Zoom map out"
                disabled={safeViewport.zoom <= MAP_MIN_ZOOM}
                onClick={() => zoomAtCenter(safeViewport.zoom / 1.5)}
              >
                −
              </button>
              <output data-testid="map-zoom-output" aria-live="polite">
                {Math.round(safeViewport.zoom * 100)}%
              </output>
              <button
                type="button"
                data-testid="map-zoom-in"
                aria-label="Zoom map in"
                disabled={safeViewport.zoom >= MAP_MAX_ZOOM}
                onClick={() => zoomAtCenter(safeViewport.zoom * 1.5)}
              >
                +
              </button>
            </div>
            <input
              type="range"
              data-testid="map-zoom-slider"
              aria-label="Map zoom level"
              aria-valuetext={`${Math.round(safeViewport.zoom * 100)} percent`}
              min={MAP_MIN_ZOOM}
              max={MAP_MAX_ZOOM}
              step="any"
              value={safeViewport.zoom}
              onChange={(event) => zoomAtCenter(Number(event.currentTarget.value))}
            />
            <div className="map-focus-buttons" role="group" aria-label="Map focus">
              <button
                type="button"
                data-testid="map-focus-player"
                onClick={() => focusPosition(snapshot.position)}
              >
                PLAYER <kbd>P</kbd>
              </button>
              {navigation && (
                <button
                  type="button"
                  data-testid="map-focus-target"
                  onClick={() => focusPosition(navigation.target.position)}
                >
                  TARGET <kbd>N</kbd>
                </button>
              )}
              <button
                type="button"
                data-testid="map-fit"
                onClick={() => updateViewport(fitMapViewport())}
              >
                FIT <kbd>0</kbd>
              </button>
            </div>
          </div>

          <div
            className="map-scale-readout"
            data-testid="map-viewport-status"
            data-map-control
          >
            <span>
              VIEW {((bounds.maxX - bounds.minX) / 1_000).toFixed(1)} × {((bounds.maxZ - bounds.minZ) / 1_000).toFixed(1)} KM
            </span>
            <i style={{ width: `${Math.max(34, Math.min(150, scaleDistance * pixelsPerMeter))}px` }} />
            <strong>{formatNavigationDistance(scaleDistance)}</strong>
          </div>
          <span className="map-instruction">
            SCROLL / + −: ZOOM · DRAG / ALT+ARROWS: PAN · CLICK: WAYPOINT
          </span>
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
            <div><dt>FAR HLOD</dt><dd>{snapshot.horizonTiles} TILES / {snapshot.horizonSettlementInstances} PROXIES / {snapshot.horizonSettlementLightInstances} LIGHTS</dd></div>
            <div><dt>LOCAL TIME</dt><dd>{String(snapshot.environment.hour).padStart(2, "0")}:{String(snapshot.environment.minute).padStart(2, "0")}</dd></div>
            <div><dt>WEATHER</dt><dd>{snapshot.environment.weatherLabel.toUpperCase()}</dd></div>
            <div><dt>AMBIENT CITIZENS</dt><dd>{snapshot.citizenCount.toLocaleString()} / {snapshot.crowdDensity}</dd></div>
            <div><dt>LOCAL WILDLIFE</dt><dd>{snapshot.animalCount} / {snapshot.animalSpecies} SPECIES</dd></div>
            <div><dt>RECORDS</dt><dd>{snapshot.scanned.length} / {BEACONS.length}</dd></div>
            <div><dt>LOCATIONS LOGGED</dt><dd>{snapshot.discoveredLocationIds.length}</dd></div>
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
