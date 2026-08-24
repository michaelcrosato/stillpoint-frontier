import {
  GRAVITY,
  STAMINA_DRAIN_RATE,
  STAMINA_REGEN_DELAY,
  STAMINA_REGEN_RATE,
} from "../config";

export interface StaminaStep {
  stamina: number;
  recoveryDelay: number;
}

export function stepStamina(
  stamina: number,
  recoveryDelay: number,
  sprinting: boolean,
  deltaSeconds: number,
): StaminaStep {
  const normalizedStamina = Math.min(1, Math.max(0, stamina));
  if (sprinting) {
    return {
      stamina: Math.max(0, normalizedStamina - STAMINA_DRAIN_RATE * deltaSeconds),
      recoveryDelay: STAMINA_REGEN_DELAY,
    };
  }
  const nextDelay = Math.max(0, recoveryDelay - deltaSeconds);
  return {
    stamina:
      nextDelay === 0
        ? Math.min(1, normalizedStamina + STAMINA_REGEN_RATE * deltaSeconds)
        : normalizedStamina,
    recoveryDelay: nextDelay,
  };
}

export function stepVertical(
  y: number,
  velocity: number,
  groundY: number,
  deltaSeconds: number,
  wasGrounded = false,
  maxStepDown = 0,
) {
  const stepDown = Math.max(0, Number.isFinite(maxStepDown) ? maxStepDown : 0);
  if (
    wasGrounded &&
    velocity <= 0 &&
    y >= groundY &&
    y - groundY <= stepDown + 1e-6
  ) {
    return { y: groundY, velocity: 0, grounded: true };
  }
  const nextVelocity = velocity - GRAVITY * deltaSeconds;
  const nextY = y + nextVelocity * deltaSeconds;
  if (nextY <= groundY) return { y: groundY, velocity: 0, grounded: true };
  return { y: nextY, velocity: nextVelocity, grounded: false };
}
