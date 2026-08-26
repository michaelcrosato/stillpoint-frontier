export interface MapViewportState {
  centerX: number;
  centerZ: number;
  zoom: number;
}

export interface MapViewportMetrics {
  width: number;
  height: number;
}

export interface MapScreenPoint {
  x: number;
  y: number;
}

export interface MapWorldPoint {
  x: number;
  z: number;
}

export interface MapWorldBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type MapDetailLevel = "atlas" | "regional" | "local";

export const MAP_MIN_ZOOM = 1;
export const MAP_MAX_ZOOM = 32;

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedMetrics(metrics: Readonly<MapViewportMetrics>) {
  const width = finiteOr(metrics.width, 0);
  const height = finiteOr(metrics.height, 0);
  if (width <= 0 || height <= 0) return null;
  return { width, height, stageSize: Math.min(width, height) };
}

function normalizedHalfExtent(worldHalfExtent: number) {
  return Number.isFinite(worldHalfExtent) && worldHalfExtent > 0
    ? worldHalfExtent
    : 1;
}

export function fitMapViewport(): MapViewportState {
  return { centerX: 0, centerZ: 0, zoom: MAP_MIN_ZOOM };
}

export function mapStageLayout(metrics: Readonly<MapViewportMetrics>) {
  const normalized = normalizedMetrics(metrics);
  if (!normalized) return { left: 0, top: 0, size: 0 };
  return {
    left: (normalized.width - normalized.stageSize) * 0.5,
    top: (normalized.height - normalized.stageSize) * 0.5,
    size: normalized.stageSize,
  };
}

export function clampMapViewport(
  viewport: Readonly<MapViewportState>,
  metrics: Readonly<MapViewportMetrics>,
  worldHalfExtent: number,
): MapViewportState {
  const extent = normalizedHalfExtent(worldHalfExtent);
  const zoom = clamp(
    finiteOr(viewport.zoom, MAP_MIN_ZOOM),
    MAP_MIN_ZOOM,
    MAP_MAX_ZOOM,
  );
  const normalized = normalizedMetrics(metrics);
  if (!normalized) {
    return {
      centerX: clamp(finiteOr(viewport.centerX, 0), -extent, extent),
      centerZ: clamp(finiteOr(viewport.centerZ, 0), -extent, extent),
      zoom,
    };
  }

  const worldUnitsPerPixel =
    (extent * 2) / (normalized.stageSize * zoom);
  const halfVisibleX = normalized.width * worldUnitsPerPixel * 0.5;
  const halfVisibleZ = normalized.height * worldUnitsPerPixel * 0.5;
  const centerX = halfVisibleX >= extent
    ? 0
    : clamp(
        finiteOr(viewport.centerX, 0),
        -extent + halfVisibleX,
        extent - halfVisibleX,
      );
  const centerZ = halfVisibleZ >= extent
    ? 0
    : clamp(
        finiteOr(viewport.centerZ, 0),
        -extent + halfVisibleZ,
        extent - halfVisibleZ,
      );
  return { centerX, centerZ, zoom };
}

export function mapViewportTransform(
  viewport: Readonly<MapViewportState>,
  worldHalfExtent: number,
) {
  const extent = normalizedHalfExtent(worldHalfExtent);
  const centerXPercent = 50 + (viewport.centerX / (extent * 2)) * 100;
  const centerZPercent = 50 + (viewport.centerZ / (extent * 2)) * 100;
  return {
    translateXPercent: 50 - centerXPercent * viewport.zoom,
    translateYPercent: 50 - centerZPercent * viewport.zoom,
    scale: viewport.zoom,
  };
}

export function worldToMapScreenPoint(
  point: Readonly<MapWorldPoint>,
  viewport: Readonly<MapViewportState>,
  metrics: Readonly<MapViewportMetrics>,
  worldHalfExtent: number,
): MapScreenPoint | null {
  const normalized = normalizedMetrics(metrics);
  if (!normalized) return null;
  const extent = normalizedHalfExtent(worldHalfExtent);
  const safe = clampMapViewport(viewport, metrics, extent);
  const pixelsPerWorldUnit =
    (normalized.stageSize * safe.zoom) / (extent * 2);
  return {
    x: normalized.width * 0.5 +
      (finiteOr(point.x, safe.centerX) - safe.centerX) * pixelsPerWorldUnit,
    y: normalized.height * 0.5 +
      (finiteOr(point.z, safe.centerZ) - safe.centerZ) * pixelsPerWorldUnit,
  };
}

export function mapScreenPointToWorld(
  point: Readonly<MapScreenPoint>,
  viewport: Readonly<MapViewportState>,
  metrics: Readonly<MapViewportMetrics>,
  worldHalfExtent: number,
): MapWorldPoint | null {
  const normalized = normalizedMetrics(metrics);
  if (!normalized || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return null;
  }
  if (
    point.x < 0 ||
    point.x > normalized.width ||
    point.y < 0 ||
    point.y > normalized.height
  ) {
    return null;
  }
  const extent = normalizedHalfExtent(worldHalfExtent);
  const safe = clampMapViewport(viewport, metrics, extent);
  const worldUnitsPerPixel =
    (extent * 2) / (normalized.stageSize * safe.zoom);
  const x = safe.centerX +
    (point.x - normalized.width * 0.5) * worldUnitsPerPixel;
  const z = safe.centerZ +
    (point.y - normalized.height * 0.5) * worldUnitsPerPixel;
  if (x < -extent || x > extent || z < -extent || z > extent) return null;
  return { x, z };
}

export function zoomMapViewportAtPoint(
  viewport: Readonly<MapViewportState>,
  requestedZoom: number,
  anchor: Readonly<MapScreenPoint>,
  metrics: Readonly<MapViewportMetrics>,
  worldHalfExtent: number,
): MapViewportState {
  const normalized = normalizedMetrics(metrics);
  const extent = normalizedHalfExtent(worldHalfExtent);
  const safe = clampMapViewport(viewport, metrics, extent);
  const zoom = clamp(
    finiteOr(requestedZoom, safe.zoom),
    MAP_MIN_ZOOM,
    MAP_MAX_ZOOM,
  );
  if (!normalized || zoom === safe.zoom) return { ...safe, zoom };

  const anchorX = clamp(finiteOr(anchor.x, normalized.width * 0.5), 0, normalized.width);
  const anchorY = clamp(finiteOr(anchor.y, normalized.height * 0.5), 0, normalized.height);
  const oldUnitsPerPixel =
    (extent * 2) / (normalized.stageSize * safe.zoom);
  const newUnitsPerPixel =
    (extent * 2) / (normalized.stageSize * zoom);
  const offsetX = anchorX - normalized.width * 0.5;
  const offsetY = anchorY - normalized.height * 0.5;
  const anchoredWorldX = safe.centerX + offsetX * oldUnitsPerPixel;
  const anchoredWorldZ = safe.centerZ + offsetY * oldUnitsPerPixel;
  return clampMapViewport({
    centerX: anchoredWorldX - offsetX * newUnitsPerPixel,
    centerZ: anchoredWorldZ - offsetY * newUnitsPerPixel,
    zoom,
  }, metrics, extent);
}

export function panMapViewport(
  viewport: Readonly<MapViewportState>,
  deltaPixels: Readonly<MapScreenPoint>,
  metrics: Readonly<MapViewportMetrics>,
  worldHalfExtent: number,
): MapViewportState {
  const normalized = normalizedMetrics(metrics);
  const extent = normalizedHalfExtent(worldHalfExtent);
  const safe = clampMapViewport(viewport, metrics, extent);
  if (!normalized) return safe;
  const worldUnitsPerPixel =
    (extent * 2) / (normalized.stageSize * safe.zoom);
  return clampMapViewport({
    centerX: safe.centerX - finiteOr(deltaPixels.x, 0) * worldUnitsPerPixel,
    centerZ: safe.centerZ - finiteOr(deltaPixels.y, 0) * worldUnitsPerPixel,
    zoom: safe.zoom,
  }, metrics, extent);
}

export function focusMapViewport(
  viewport: Readonly<MapViewportState>,
  point: Readonly<MapWorldPoint>,
  metrics: Readonly<MapViewportMetrics>,
  worldHalfExtent: number,
  minimumZoom = viewport.zoom,
): MapViewportState {
  return clampMapViewport({
    centerX: finiteOr(point.x, viewport.centerX),
    centerZ: finiteOr(point.z, viewport.centerZ),
    zoom: Math.max(finiteOr(viewport.zoom, MAP_MIN_ZOOM), finiteOr(minimumZoom, MAP_MIN_ZOOM)),
  }, metrics, worldHalfExtent);
}

export function visibleMapWorldBounds(
  viewport: Readonly<MapViewportState>,
  metrics: Readonly<MapViewportMetrics>,
  worldHalfExtent: number,
): MapWorldBounds {
  const extent = normalizedHalfExtent(worldHalfExtent);
  const normalized = normalizedMetrics(metrics);
  const safe = clampMapViewport(viewport, metrics, extent);
  if (!normalized) {
    return { minX: -extent, maxX: extent, minZ: -extent, maxZ: extent };
  }
  const worldUnitsPerPixel =
    (extent * 2) / (normalized.stageSize * safe.zoom);
  const halfVisibleX = normalized.width * worldUnitsPerPixel * 0.5;
  const halfVisibleZ = normalized.height * worldUnitsPerPixel * 0.5;
  return {
    minX: Math.max(-extent, safe.centerX - halfVisibleX),
    maxX: Math.min(extent, safe.centerX + halfVisibleX),
    minZ: Math.max(-extent, safe.centerZ - halfVisibleZ),
    maxZ: Math.min(extent, safe.centerZ + halfVisibleZ),
  };
}

export function mapDetailLevel(zoom: number): MapDetailLevel {
  const safe = finiteOr(zoom, MAP_MIN_ZOOM);
  if (safe >= 4) return "local";
  if (safe >= 2) return "regional";
  return "atlas";
}

export function sameMapViewport(
  left: Readonly<MapViewportState>,
  right: Readonly<MapViewportState>,
) {
  return (
    Math.abs(left.centerX - right.centerX) < 0.000_1 &&
    Math.abs(left.centerZ - right.centerZ) < 0.000_1 &&
    Math.abs(left.zoom - right.zoom) < 0.000_1
  );
}
