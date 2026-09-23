import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_FC_SEED, fastCheckSeed } from "./setup/fastCheckSeed";

describe("fast-check seed", () => {
  it("runs every property test from the configured seed", () => {
    expect(fc.readConfigureGlobal().seed).toBe(fastCheckSeed(process.env));
  });

  it("uses the default seed unless FC_SEED names another integer", () => {
    expect(fastCheckSeed({})).toBe(DEFAULT_FC_SEED);
    expect(fastCheckSeed({ FC_SEED: " " })).toBe(DEFAULT_FC_SEED);
    expect(fastCheckSeed({ FC_SEED: "1186013471" })).toBe(1_186_013_471);
    expect(fastCheckSeed({ FC_SEED: "-7" })).toBe(-7);
    expect(() => fastCheckSeed({ FC_SEED: "soon" })).toThrow(/FC_SEED/);
    expect(() => fastCheckSeed({ FC_SEED: "1.5" })).toThrow(/FC_SEED/);
  });
});
