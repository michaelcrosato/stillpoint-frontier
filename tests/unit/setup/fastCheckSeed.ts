import fc from "fast-check";

/** Every property test runs from this seed unless FC_SEED names another. */
export const DEFAULT_FC_SEED = 20_260_922;

/**
 * The seed for this run. A fixed default keeps CI reproducible; set FC_SEED to
 * replay a reported failure or to explore other inputs.
 */
export function fastCheckSeed(environment: Readonly<Record<string, string | undefined>>) {
  const raw = environment.FC_SEED?.trim();
  if (!raw) return DEFAULT_FC_SEED;
  const seed = Number(raw);
  if (!Number.isSafeInteger(seed)) {
    throw new Error(`FC_SEED must be an integer, not "${raw}"`);
  }
  return seed;
}

fc.configureGlobal({ ...fc.readConfigureGlobal(), seed: fastCheckSeed(process.env) });
