"use client";

import "./globals.css";

/**
 * Replaces the root layout when the layout itself fails, so it must supply its
 * own document shell and stylesheet.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <section className="error-screen" role="alert" data-testid="global-error">
          <p className="eyebrow">SURVEY INTERRUPT</p>
          <h1>The frontier stopped responding.</h1>
          <p>{error.message || "An unexpected fault ended this session."}</p>
          <button type="button" className="enter-button" onClick={reset}>
            <span>RELOAD</span>
            <span aria-hidden="true">↵</span>
          </button>
          <p className="error-hint">
            Your survey is saved in this browser and is not affected by this fault.
          </p>
        </section>
      </body>
    </html>
  );
}
