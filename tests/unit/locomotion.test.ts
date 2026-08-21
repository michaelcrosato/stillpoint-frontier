import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { JUMP_SPEED } from "../../lib/game/config";
import { stepStamina, stepVertical } from "../../lib/game/systems/locomotion";

describe("locomotion math", () => {
  it("raises an airborne player, then lands exactly on terrain", () => {
    const rising = stepVertical(10, JUMP_SPEED, 10, 1 / 60);
    expect(rising.grounded).toBe(false);
    expect(rising.y).toBeGreaterThan(10);

    let state = rising;
    for (let index = 0; index < 180 && !state.grounded; index += 1) {
      state = stepVertical(state.y, state.velocity, 10, 1 / 60);
    }
    expect(state).toEqual({ y: 10, velocity: 0, grounded: true });
  });

  it("drains only while sprinting and regenerates after a delay", () => {
    const drained = stepStamina(1, 0, true, 1);
    expect(drained.stamina).toBeLessThan(1);
    expect(drained.recoveryDelay).toBeGreaterThan(0);
    const delayed = stepStamina(drained.stamina, drained.recoveryDelay, false, 0.1);
    expect(delayed.stamina).toBe(drained.stamina);
    const recovered = stepStamina(delayed.stamina, delayed.recoveryDelay, false, 4);
    expect(recovered.stamina).toBeGreaterThan(delayed.stamina);
  });

  it("always keeps stamina in the normalized range", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -3, max: 3, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 20, noNaN: true, noDefaultInfinity: true }),
        fc.boolean(),
        (stamina, delta, sprinting) => {
          const result = stepStamina(stamina, 0, sprinting, delta);
          expect(result.stamina).toBeGreaterThanOrEqual(0);
          expect(result.stamina).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});
