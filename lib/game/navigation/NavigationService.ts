import { EventBus } from "../core/events";
import {
  bearingDegrees,
  planarDistance,
  signedHeadingDelta,
  type FlatPosition,
} from "./math";

export const MANUAL_WAYPOINT_ID = "player:map";
export const DEFAULT_ARRIVAL_RADIUS = 12;

const MAX_TARGETS = 128;
const TARGET_ID = /^[a-z0-9][a-z0-9:._-]{0,119}$/i;

export type NavigationTargetSource =
  | { kind: "player" }
  | { kind: "quest"; questId: string; objectiveId: string }
  | { kind: "script"; scriptId: string }
  | { kind: "system"; systemId: string };

export interface NavigationTargetInput {
  id: string;
  label: string;
  position: FlatPosition;
  source: NavigationTargetSource;
  arrivalRadius?: number;
  clearOnArrival?: boolean;
}

export interface NavigationTarget {
  id: string;
  label: string;
  position: FlatPosition;
  source: NavigationTargetSource;
  arrivalRadius: number;
  clearOnArrival: boolean;
}

export interface NavigationGuidance {
  target: NavigationTarget;
  distance: number;
  bearing: number;
  relativeBearing: number;
  reached: boolean;
}

export interface NavigationEventMap {
  activeChanged: { target: NavigationTarget | null };
  arrived: { target: NavigationTarget; distance: number };
}

function copySource(source: NavigationTargetSource): NavigationTargetSource {
  return { ...source };
}

function copyTarget(target: NavigationTarget): NavigationTarget {
  return {
    ...target,
    position: { ...target.position },
    source: copySource(target.source),
  };
}

function normalizeTarget(input: NavigationTargetInput): NavigationTarget | null {
  const id = input.id.trim();
  const label = input.label.trim().slice(0, 80);
  const { x, z } = input.position;
  if (!TARGET_ID.test(id) || !label || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  const requestedRadius = input.arrivalRadius ?? DEFAULT_ARRIVAL_RADIUS;
  const arrivalRadius = Number.isFinite(requestedRadius)
    ? Math.min(1_000, Math.max(0.5, requestedRadius))
    : DEFAULT_ARRIVAL_RADIUS;
  return {
    id,
    label,
    position: { x, z },
    source: copySource(input.source),
    arrivalRadius,
    clearOnArrival: input.clearOnArrival ?? false,
  };
}

/**
 * Engine-level destination registry shared by player pins, quests, and scripts.
 * Targets may remain registered while a different destination is active.
 */
export class NavigationService {
  private readonly targets = new Map<string, NavigationTarget>();
  private readonly reached = new Set<string>();
  private readonly events = new EventBus<NavigationEventMap>();
  private activeId: string | null = null;

  setTarget(input: NavigationTargetInput, activate = true) {
    const target = normalizeTarget(input);
    if (!target) return null;
    if (!this.targets.has(target.id) && this.targets.size >= MAX_TARGETS) {
      const removable = [...this.targets.keys()].find((id) => id !== this.activeId);
      if (!removable) return null;
      this.targets.delete(removable);
      this.reached.delete(removable);
    }
    this.targets.set(target.id, target);
    this.reached.delete(target.id);
    if (activate) this.activateTarget(target.id);
    return copyTarget(target);
  }

  setManualWaypoint(position: FlatPosition) {
    return this.setTarget({
      id: MANUAL_WAYPOINT_ID,
      label: "Map waypoint",
      position,
      source: { kind: "player" },
      arrivalRadius: DEFAULT_ARRIVAL_RADIUS,
      clearOnArrival: false,
    });
  }

  activateTarget(id: string) {
    const target = this.targets.get(id);
    if (!target) return false;
    this.activeId = id;
    this.reached.delete(id);
    this.events.emit("activeChanged", { target: copyTarget(target) });
    return true;
  }

  clearActive(expectedId?: string) {
    if (!this.activeId || (expectedId && this.activeId !== expectedId)) return false;
    this.activeId = null;
    this.events.emit("activeChanged", { target: null });
    return true;
  }

  removeTarget(id: string) {
    if (!this.targets.delete(id)) return false;
    this.reached.delete(id);
    if (this.activeId === id) {
      this.activeId = null;
      this.events.emit("activeChanged", { target: null });
    }
    return true;
  }

  getTarget(id: string) {
    const target = this.targets.get(id);
    return target ? copyTarget(target) : null;
  }

  getActiveTarget() {
    if (!this.activeId) return null;
    const target = this.targets.get(this.activeId);
    return target ? copyTarget(target) : null;
  }

  targetsSnapshot() {
    return [...this.targets.values()].map(copyTarget);
  }

  getGuidance(position: FlatPosition, heading: number): NavigationGuidance | null {
    if (!this.activeId) return null;
    const target = this.targets.get(this.activeId);
    if (!target) return null;
    const distance = planarDistance(position, target.position);
    const bearing = bearingDegrees(position, target.position);
    return {
      target: copyTarget(target),
      distance,
      bearing,
      relativeBearing: signedHeadingDelta(bearing, heading),
      reached: this.reached.has(target.id),
    };
  }

  update(position: FlatPosition) {
    const guidance = this.getGuidance(position, 0);
    if (!guidance || guidance.distance > guidance.target.arrivalRadius) return;
    if (this.reached.has(guidance.target.id)) return;
    this.reached.add(guidance.target.id);
    this.events.emit("arrived", {
      target: copyTarget(guidance.target),
      distance: guidance.distance,
    });
    if (guidance.target.clearOnArrival) this.removeTarget(guidance.target.id);
  }

  on<Key extends keyof NavigationEventMap>(
    event: Key,
    listener: (payload: NavigationEventMap[Key]) => void,
  ) {
    return this.events.on(event, listener);
  }

  dispose() {
    this.targets.clear();
    this.reached.clear();
    this.activeId = null;
    this.events.clear();
  }
}
