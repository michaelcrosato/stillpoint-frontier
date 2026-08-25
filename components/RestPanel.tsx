"use client";

import { REST_OPTIONS, type RestOptionId, type RestSiteDefinition } from "../lib/game/gameplay/resting";
import type { GameSnapshot } from "../lib/game/state";
import FeatureDialog from "./FeatureDialog";

interface RestPanelProps {
  snapshot: GameSnapshot;
  site: RestSiteDefinition;
  onClose(): void;
  onRest(optionId: RestOptionId): void;
}

function optionMinutes(optionId: RestOptionId, totalMinutes: number) {
  if (optionId === "wait_1h") return 60;
  if (optionId === "rest_4h") return 240;
  const minuteOfDay = ((totalMinutes % 1_440) + 1_440) % 1_440;
  const until = 420 - minuteOfDay;
  return until > 0 ? until : until + 1_440;
}

function wakeLabel(totalMinutes: number, delta: number) {
  const target = totalMinutes + delta;
  const day = Math.floor(target / 1_440) + 1;
  const minuteOfDay = ((target % 1_440) + 1_440) % 1_440;
  const hour = Math.floor(minuteOfDay / 60);
  const minute = Math.floor(minuteOfDay % 60);
  return `DAY ${String(day).padStart(3, "0")} / ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export default function RestPanel({ snapshot, site, onClose, onRest }: RestPanelProps) {
  const quality = Math.round(
    (site.safe ? 40 : 12) +
    (site.sheltered ? 35 : 8) +
    Math.min(1, Math.max(0, site.warmth)) * 25,
  );
  return (
    <FeatureDialog
      title={site.label}
      titleId="rest-title"
      kicker="FIELD RECOVERY / TIME ADVANCE"
      testId="rest-overlay"
      className="rest-panel"
      onClose={onClose}
      headerMeta={<span className="feature-header-meta">SITE {quality}%</span>}
      footer={(
        <>
          <span>REST ADVANCES THE PERSISTENT WORLD CLOCK</span>
          <p>Weather and population will resynchronize on waking.</p>
        </>
      )}
    >
      <div className="rest-layout">
        <aside className="rest-site-readout">
          <div className="rest-quality-ring" style={{ "--rest-quality": `${quality}%` } as React.CSSProperties}>
            <strong>{quality}</strong><span>SITE</span>
          </div>
          <div>
            <span className={site.safe ? "is-positive" : ""}>SAFETY <strong>{site.safe ? "SECURE" : "EXPOSED"}</strong></span>
            <span className={site.sheltered ? "is-positive" : ""}>SHELTER <strong>{site.sheltered ? "COVERED" : "OPEN"}</strong></span>
            <span className={site.warmth > 0 ? "is-positive" : ""}>WARMTH <strong>{Math.round(site.warmth * 100)}%</strong></span>
          </div>
          <small>VITALS {Math.ceil(snapshot.health)} · WET {Math.round(snapshot.wetness * 100)}% · COLD {Math.round(snapshot.coldStress * 100)}%</small>
        </aside>
        <div className="rest-options">
          {REST_OPTIONS.map((option) => {
            const minutes = optionMinutes(option.id, snapshot.environment.totalMinutes);
            return (
              <button
                key={option.id}
                type="button"
                disabled={snapshot.health <= 0}
                onClick={() => onRest(option.id)}
              >
                <span>{option.label}</span>
                <p>{option.description}</p>
                <strong>{wakeLabel(snapshot.environment.totalMinutes, minutes)}</strong>
                <small>{Math.round(minutes / 60 * 10) / 10} H WORLD TIME</small>
              </button>
            );
          })}
        </div>
      </div>
    </FeatureDialog>
  );
}
