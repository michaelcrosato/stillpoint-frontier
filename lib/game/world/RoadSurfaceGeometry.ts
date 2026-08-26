import * as THREE from "three";
import { hashString } from "../core/random";
import {
  WATER_LEVEL,
  riverCenterX,
  riverWidth,
} from "./macroWorld";
import type { WorldPathSegment } from "./roads";
import {
  proceduralSurfaceColor,
  terrainSurfaceColor,
} from "./surfaceVariation";
import { sampleTerrainHeight } from "./terrain";

export const ROAD_SURFACE_STEP_METERS = 4;
export const ROAD_SURFACE_CROSS_SECTION_VERTICES = 5;

const ROAD_SURFACE_LIFT = 0.052;
const ROAD_CROWN_HEIGHT = 0.048;
const TRAIL_CROWN_HEIGHT = 0.012;
const BRIDGE_APPROACH_METERS = 14;
const BRIDGE_DECK_HEIGHT = WATER_LEVEL + 0.37;

const ROAD_BASE_COLORS = {
  trunk: 0x45423c,
  regional: 0x4f473b,
  local: 0x594c38,
  street: 0x393a36,
  trail: 0x665139,
} as const;

export interface RoadSurfaceGeometryStats {
  segments: number;
  junctionPads: number;
  rows: number;
  vertices: number;
  triangles: number;
  maxStepMeters: number;
}

interface JunctionPad {
  x: number;
  z: number;
  segment: WorldPathSegment;
}

function roadBaseColor(segment: WorldPathSegment) {
  if (segment.kind === "street") return ROAD_BASE_COLORS.street;
  if (segment.kind === "trail") return ROAD_BASE_COLORS.trail;
  return ROAD_BASE_COLORS[segment.roadClass ?? "local"];
}

export function roadShoulderWidth(segment: WorldPathSegment) {
  if (segment.kind === "street") return 0.5;
  if (segment.kind === "trail") return 0.65;
  if (segment.roadClass === "trunk") return 1.15;
  if (segment.roadClass === "regional") return 0.9;
  return 0.7;
}

export function roadBridgeInfluence(
  segment: WorldPathSegment,
  x: number,
  z: number,
) {
  if (segment.kind !== "road") return 0;
  const bankDistance =
    Math.abs(x - riverCenterX(z)) - (riverWidth(z) + segment.width * 0.55);
  return 1 - THREE.MathUtils.smoothstep(
    bankDistance,
    0,
    BRIDGE_APPROACH_METERS,
  );
}

/**
 * Render-only road height. It follows the same analytic terrain as the player,
 * then eases trade roads onto one shallow bridge deck at the authored river.
 */
export function roadSurfaceHeight(
  segment: WorldPathSegment,
  x: number,
  z: number,
) {
  const terrainHeight = sampleTerrainHeight(x, z);
  const bridge = roadBridgeInfluence(segment, x, z);
  if (bridge <= 0) return terrainHeight;
  return THREE.MathUtils.lerp(
    terrainHeight,
    Math.max(terrainHeight, BRIDGE_DECK_HEIGHT),
    bridge,
  );
}

function roadSurfaceNormal(
  target: THREE.Vector3,
  segment: WorldPathSegment,
  x: number,
  z: number,
) {
  const interval = 0.75;
  const left = roadSurfaceHeight(segment, x - interval, z);
  const right = roadSurfaceHeight(segment, x + interval, z);
  const back = roadSurfaceHeight(segment, x, z - interval);
  const front = roadSurfaceHeight(segment, x, z + interval);
  return target.set(
    left - right,
    interval * 2,
    back - front,
  ).normalize();
}

function segmentLayerOffset(segment: WorldPathSegment) {
  const stableLayer = hashString(`${segment.kind}:${segment.id}`) % 3;
  if (segment.kind === "road") return 0.008 + stableLayer * 0.0005;
  if (segment.kind === "trail") return 0.006 + stableLayer * 0.0005;
  const axisLayer = segment.id.includes(":z:") ? 0.0045 : 0.0015;
  return axisLayer + stableLayer * 0.0005;
}

function vertexColor(
  target: THREE.Color,
  road: THREE.Color,
  ground: THREE.Color,
  segment: WorldPathSegment,
  x: number,
  z: number,
  lateralOffset: number,
) {
  const halfWidth = segment.width * 0.5;
  const shoulder = roadShoulderWidth(segment);
  const terrainHeight = sampleTerrainHeight(x, z);
  proceduralSurfaceColor(
    road,
    roadBaseColor(segment),
    "road",
    x,
    z,
  );
  terrainSurfaceColor(
    ground,
    x,
    z,
    terrainHeight,
  );
  const distance = Math.abs(lateralOffset);
  const roadAmount = distance <= halfWidth
    ? THREE.MathUtils.lerp(1, 0.82, distance / Math.max(0.001, halfWidth))
    : THREE.MathUtils.lerp(
        0.82,
        0.2,
        (distance - halfWidth) / Math.max(0.001, shoulder),
      );
  const bridgeAmount = roadBridgeInfluence(segment, x, z);
  return target.copy(ground).lerp(
    road,
    Math.max(roadAmount, bridgeAmount * 0.82),
  );
}

/**
 * Builds one indexed, world-space ribbon for all roads in a streamed chunk.
 * Absolute sampling makes color, height, and lighting continuous across chunk
 * boundaries without coupling the geometry to chunk load order.
 */
export function createRoadSurfaceGeometry(
  segments: readonly WorldPathSegment[],
) {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const normal = new THREE.Vector3();
  const color = new THREE.Color();
  const roadColor = new THREE.Color();
  const groundColor = new THREE.Color();
  let totalRows = 0;
  let renderedSegments = 0;
  let maxStepMeters = 0;
  const junctionPads = new Map<string, JunctionPad>();

  for (const segment of segments) {
    const dx = segment.end.x - segment.start.x;
    const dz = segment.end.z - segment.start.z;
    const length = Math.hypot(dx, dz);
    if (!Number.isFinite(length) || length < 0.5) continue;
    const rowCount = Math.max(
      2,
      Math.ceil(length / ROAD_SURFACE_STEP_METERS) + 1,
    );
    const step = length / (rowCount - 1);
    maxStepMeters = Math.max(maxStepMeters, step);
    const directionX = dx / length;
    const directionZ = dz / length;
    const perpendicularX = -directionZ;
    const perpendicularZ = directionX;
    const halfWidth = segment.width * 0.5;
    const shoulder = roadShoulderWidth(segment);
    const offsets = [
      -halfWidth - shoulder,
      -halfWidth,
      0,
      halfWidth,
      halfWidth + shoulder,
    ];
    const vertexStart = positions.length / 3;
    const layerOffset = segmentLayerOffset(segment);

    for (let row = 0; row < rowCount; row += 1) {
      const amount = row / (rowCount - 1);
      const centerX = segment.start.x + dx * amount;
      const centerZ = segment.start.z + dz * amount;
      for (const offset of offsets) {
        const x = centerX + perpendicularX * offset;
        const z = centerZ + perpendicularZ * offset;
        const shoulderAmount = Math.max(
          0,
          (Math.abs(offset) - halfWidth) / Math.max(0.001, shoulder),
        );
        const crown = Math.max(
          0,
          1 - Math.abs(offset) / Math.max(0.001, halfWidth),
        ) * (segment.kind === "trail" ? TRAIL_CROWN_HEIGHT : ROAD_CROWN_HEIGHT);
        const y = roadSurfaceHeight(segment, x, z) +
          ROAD_SURFACE_LIFT + crown - shoulderAmount * 0.022 + layerOffset;
        positions.push(x, y, z);
        roadSurfaceNormal(normal, segment, x, z).toArray(normals, normals.length);
        vertexColor(
          color,
          roadColor,
          groundColor,
          segment,
          x,
          z,
          offset,
        ).toArray(colors, colors.length);
      }
    }

    for (let row = 0; row < rowCount - 1; row += 1) {
      const current = vertexStart + row * ROAD_SURFACE_CROSS_SECTION_VERTICES;
      const next = current + ROAD_SURFACE_CROSS_SECTION_VERTICES;
      for (
        let strip = 0;
        strip < ROAD_SURFACE_CROSS_SECTION_VERTICES - 1;
        strip += 1
      ) {
        const lower = current + strip;
        const upper = lower + 1;
        const nextLower = next + strip;
        const nextUpper = nextLower + 1;
        indices.push(
          lower,
          upper,
          nextUpper,
          lower,
          nextUpper,
          nextLower,
        );
      }
    }
    totalRows += rowCount;
    renderedSegments += 1;

    for (const point of [
      segment.capStart ? segment.start : null,
      segment.capEnd ? segment.end : null,
    ]) {
      if (!point) continue;
      const padKey = `${Math.round(point.x * 100)}:${Math.round(point.z * 100)}`;
      const existing = junctionPads.get(padKey);
      const existingRadius = existing
        ? existing.segment.width * 0.5 + roadShoulderWidth(existing.segment)
        : 0;
      const radius = segment.width * 0.5 + roadShoulderWidth(segment);
      if (!existing || radius > existingRadius) {
        junctionPads.set(padKey, { x: point.x, z: point.z, segment });
      }
    }
  }

  const padSegments = 12;
  for (const pad of junctionPads.values()) {
    const { segment } = pad;
    const halfWidth = segment.width * 0.5;
    const shoulder = roadShoulderWidth(segment);
    const vertexStart = positions.length / 3;
    const layerOffset = segmentLayerOffset(segment) + 0.014;

    const appendPadVertex = (
      x: number,
      z: number,
      lateralOffset: number,
      lift: number,
    ) => {
      positions.push(
        x,
        roadSurfaceHeight(segment, x, z) + lift + layerOffset,
        z,
      );
      roadSurfaceNormal(normal, segment, x, z).toArray(normals, normals.length);
      vertexColor(
        color,
        roadColor,
        groundColor,
        segment,
        x,
        z,
        lateralOffset,
      ).toArray(colors, colors.length);
    };

    appendPadVertex(
      pad.x,
      pad.z,
      0,
      ROAD_SURFACE_LIFT +
        (segment.kind === "trail" ? TRAIL_CROWN_HEIGHT : ROAD_CROWN_HEIGHT),
    );
    for (let ring = 0; ring < 2; ring += 1) {
      const radius = ring === 0 ? halfWidth : halfWidth + shoulder;
      const lift = ring === 0 ? ROAD_SURFACE_LIFT : ROAD_SURFACE_LIFT - 0.022;
      for (let index = 0; index < padSegments; index += 1) {
        const angle = index / padSegments * Math.PI * 2;
        appendPadVertex(
          pad.x + Math.cos(angle) * radius,
          pad.z + Math.sin(angle) * radius,
          radius,
          lift,
        );
      }
    }

    const innerStart = vertexStart + 1;
    const outerStart = innerStart + padSegments;
    for (let index = 0; index < padSegments; index += 1) {
      const next = (index + 1) % padSegments;
      const inner = innerStart + index;
      const nextInner = innerStart + next;
      const outer = outerStart + index;
      const nextOuter = outerStart + next;
      indices.push(
        vertexStart,
        nextInner,
        inner,
        inner,
        nextOuter,
        outer,
        inner,
        nextInner,
        nextOuter,
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(normals, 3),
  );
  geometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(colors, 3),
  );
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.roadSurface = {
    segments: renderedSegments,
    junctionPads: junctionPads.size,
    rows: totalRows,
    vertices: positions.length / 3,
    triangles: indices.length / 3,
    maxStepMeters,
  } satisfies RoadSurfaceGeometryStats;
  return geometry;
}
