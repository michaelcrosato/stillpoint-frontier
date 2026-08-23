"use client";

import { useSyncExternalStore } from "react";
import {
  buildCompassMarks,
  cardinalForHeading,
  clamp,
  formatHeading,
  formatNavigationDistance,
} from "../lib/game/navigation/math";
import type { NavigationTargetSource } from "../lib/game/navigation/NavigationService";
import type { GamePresentationStore } from "../lib/game/navigation/presentation";

const COMPASS_SPAN = 60;

function sourceLabel(source: NavigationTargetSource) {
  switch (source.kind) {
    case "player":
      return "PLAYER MARK";
    case "quest":
      return "QUEST OBJECTIVE";
    case "script":
      return "SCRIPTED ROUTE";
    case "system":
      return "SYSTEM TARGET";
  }
}

export function CompassTape({ store }: { store: GamePresentationStore }) {
  const presentation = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const marks = buildCompassMarks(presentation.unwrappedHeading, COMPASS_SPAN, 5);
  const navigation = presentation.navigation;
  const waypointOffset = navigation
    ? clamp(navigation.relativeBearing, -COMPASS_SPAN + 2, COMPASS_SPAN - 2)
    : 0;
  const waypointOffscreen = navigation
    ? Math.abs(navigation.relativeBearing) >= COMPASS_SPAN - 2
    : false;

  return (
    <div
      className="compass"
      data-testid="compass"
      aria-label={`Heading ${formatHeading(presentation.heading)}, ${cardinalForHeading(presentation.heading)}`}
    >
      <div className="compass-heading">
        <span>HEADING</span>
        <strong>{formatHeading(presentation.heading)}</strong>
        <em>{cardinalForHeading(presentation.heading)}</em>
      </div>
      <div className="compass-window" data-testid="compass-tape" aria-hidden="true">
        {marks.map((mark) => (
          <i
            key={mark.absoluteHeading}
            className={`compass-mark is-${mark.kind}`}
            style={{ left: `${50 + (mark.offset / (COMPASS_SPAN * 2)) * 100}%` }}
          >
            {mark.label && <b>{mark.label}</b>}
          </i>
        ))}
        {navigation && (
          <span
            className={`compass-waypoint ${waypointOffscreen ? "is-offscreen" : ""}`}
            data-testid="waypoint-compass-marker"
            data-direction={navigation.relativeBearing < 0 ? "left" : "right"}
            style={{ left: `${50 + (waypointOffset / (COMPASS_SPAN * 2)) * 100}%` }}
          >
            {waypointOffscreen ? (navigation.relativeBearing < 0 ? "‹" : "›") : ""}
          </span>
        )}
        <span className="compass-center" />
      </div>
    </div>
  );
}

export function WaypointGuide({ store }: { store: GamePresentationStore }) {
  const presentation = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const navigation = presentation.navigation;
  if (!navigation) return null;
  const direction =
    Math.abs(navigation.relativeBearing) < 4
      ? "↑"
      : navigation.relativeBearing < 0
        ? "←"
        : "→";

  return (
    <>
      <div
        className={`waypoint-guide ${navigation.reached ? "is-reached" : ""}`}
        data-testid="waypoint-guide"
        aria-label={`${navigation.target.label}, ${formatNavigationDistance(navigation.distance)}`}
      >
        <i aria-hidden="true">{navigation.reached ? "✓" : direction}</i>
        <div>
          <span>{sourceLabel(navigation.target.source)}</span>
          <strong>{navigation.target.label}</strong>
        </div>
        <p>
          <strong>{navigation.reached ? "ARRIVED" : formatNavigationDistance(navigation.distance)}</strong>
          <span>{formatHeading(navigation.bearing)}</span>
        </p>
      </div>
      {presentation.waypointScreen?.visible && (
        <div
          className={`world-waypoint ${navigation.reached ? "is-reached" : ""}`}
          data-testid="world-waypoint"
          style={{
            left: `${presentation.waypointScreen.xPercent}%`,
            top: `${presentation.waypointScreen.yPercent}%`,
          }}
          aria-hidden="true"
        >
          <i />
          <span>{formatNavigationDistance(navigation.distance)}</span>
        </div>
      )}
    </>
  );
}
