"use client";

/**
 * Route-level boundary. GameShell reports renderer and engine-launch failures
 * through its own `engineError` state, but React state cannot catch a throw
 * raised during render — a fault inside WorldMap, SettingsPanel or any other
 * panel would otherwise unmount the tree to a blank page with no way back.
 */
export default function SurveyError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="error-screen" role="alert" data-testid="route-error">
      <p className="eyebrow">SURVEY INTERRUPT</p>
      <h1>The frontier stopped responding.</h1>
      <p>{error.message || "An unexpected fault ended this session."}</p>
      <button type="button" className="enter-button" onClick={reset}>
        <span>RESUME SURVEY</span>
        <span aria-hidden="true">↵</span>
      </button>
      <p className="error-hint">
        Your survey is saved in this browser and is not affected by this fault.
      </p>
    </section>
  );
}
