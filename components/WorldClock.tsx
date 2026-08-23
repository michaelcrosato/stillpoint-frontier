"use client";

import type { EnvironmentSnapshot } from "../lib/game/state";

interface WorldClockProps {
  environment: EnvironmentSnapshot;
}

const CLOCK_STATE_LABEL: Record<EnvironmentSnapshot["clockState"], string> = {
  running: "RUNNING",
  paused: "PAUSED",
  frozen: "DEV FROZEN",
  test_hold: "TEST HOLD",
};

export default function WorldClock({ environment }: WorldClockProps) {
  const clock = `${String(environment.hour).padStart(2, "0")}:${String(environment.minute).padStart(2, "0")}`;
  const realMinutesPerDay = Math.round(
    1_440 / Math.max(0.001, environment.gameMinutesPerRealSecond) / 60,
  );

  return (
    <section className="world-clock" data-testid="world-clock" aria-label="World time">
      <span className="world-clock-label">WORLD CLOCK / CYCLE</span>
      <div className="world-clock-primary">
        <span>DAY {String(environment.day).padStart(3, "0")}</span>
        <time dateTime={clock}>{clock}</time>
        <strong>{environment.phase.toUpperCase()}</strong>
      </div>
      <div className={`world-clock-state is-${environment.clockState}`} data-testid="world-clock-state">
        <i aria-hidden="true" />
        <strong>{CLOCK_STATE_LABEL[environment.clockState]}</strong>
        <span>
          {environment.gameMinutesPerRealSecond} GAME MIN / REAL SEC · {realMinutesPerDay} REAL MIN / DAY
        </span>
      </div>
    </section>
  );
}
