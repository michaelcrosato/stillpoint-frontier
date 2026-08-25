import type { GameSnapshot } from "../lib/game/state";

interface BenchmarkHudProps {
  snapshot: GameSnapshot;
}

function metric(value: number | null | undefined, suffix = " MS") {
  return value === null || value === undefined ? "—" : `${value.toFixed(2)}${suffix}`;
}

export default function BenchmarkHud({ snapshot }: BenchmarkHudProps) {
  const benchmark = snapshot.graphicsBenchmark;
  const running =
    benchmark.phase === "warming" ||
    benchmark.phase === "sampling" ||
    benchmark.phase === "finalizing";
  if (!snapshot.devTools.enabled || (!snapshot.forestStress.active && !running)) {
    return null;
  }
  return (
    <aside className={`benchmark-hud ${running ? "is-capturing" : ""}`} data-testid="benchmark-hud">
      <header>
        <div>
          <span>{snapshot.forestStress.active ? `CANOPY LOAD LAB / ${snapshot.forestStress.levelLabel}` : "WORLD PERFORMANCE CAPTURE"}</span>
          <strong>{snapshot.forestStress.active ? `${snapshot.forestStress.authoredInstances.toLocaleString()} AUTHORED INSTANCES` : `${snapshot.quality.toUpperCase()} / LIVE SCENE`}</strong>
        </div>
        <b>
          {running
            ? benchmark.phase.toUpperCase()
            : `${benchmark.grade} / ${benchmark.delivery}`}
        </b>
      </header>
      {running && (
        <div
          className="benchmark-progress"
          role="progressbar"
          aria-label="Performance capture progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(benchmark.progress * 100)}
        >
          <b style={{ width: `${benchmark.progress * 100}%` }} />
        </div>
      )}
      <div>
        <span>TARGET <strong>{benchmark.targetFps} / {benchmark.budgetMs.toFixed(2)} MS</strong></span>
        <span>CPU P95 <strong>{metric(benchmark.cpuWork?.p95)}</strong></span>
        <span>GPU P95 <strong>{benchmark.gpu ? metric(benchmark.gpu.p95) : running && benchmark.gpuSupported ? "PENDING" : "N/A"}</strong></span>
        <span>HEADROOM <strong>{benchmark.headroomPercent === null ? "—" : `${benchmark.headroomPercent.toFixed(1)}%`}</strong></span>
        <span>OBSERVED <strong>{benchmark.observedFps === null ? "—" : `${benchmark.observedFps.toFixed(1)} HZ`}</strong></span>
        <span>1% LOW <strong>{benchmark.onePercentLowFps?.toFixed(1) ?? "—"}</strong></span>
        <span>LIVE LOAD <strong>{snapshot.drawCalls.toLocaleString()} CALLS / {snapshot.triangles.toLocaleString()} TRIS</strong></span>
      </div>
      <footer>
        <span>{snapshot.forestStress.active ? `${snapshot.forestStress.nearTiles}/${snapshot.forestStress.midTiles}/${snapshot.forestStress.farTiles} NEAR/MID/FAR TILES` : `${snapshot.loadedChunks} FULL-DETAIL CHUNKS`}</span>
        <strong>{running ? benchmark.phase.toUpperCase() : `${benchmark.grade} ENGINE / ${benchmark.delivery} DELIVERY`}</strong>
      </footer>
    </aside>
  );
}
