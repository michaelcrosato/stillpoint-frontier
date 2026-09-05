import {
  DEFAULT_KEY_BINDINGS,
  GAME_ACTIONS,
  type GameAction,
  type KeyBindings,
} from "../settings";

const CORE_GAME_KEYS = new Set(["Backquote", "Escape", "KeyC", "ShiftRight", "ControlRight"]);
const ACTION_ALTERNATES: Partial<Record<GameAction, readonly string[]>> = {
  sprint: ["ShiftRight"],
  crouch: ["ControlRight", "KeyC"],
  harvest: ["Mouse0"],
};

/** Explicit user bindings own a key; optional shortcuts yield to them. */
export function resolveActionKeys(bindings: Readonly<KeyBindings>) {
  const assigned = new Set(Object.values(bindings));
  const resolved = {} as Record<GameAction, readonly string[]>;
  for (const action of GAME_ACTIONS) {
    resolved[action] = [bindings[action], ...(ACTION_ALTERNATES[action] ?? [])
      .filter((code) => !assigned.has(code))];
  }
  return resolved;
}

function isEditableTarget(target: EventTarget | null, pointerLocked: boolean) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.matches("input, select, textarea") ||
    (!pointerLocked && target.matches("button, [role='button']"))
  );
}

export function normalizeCameraWheelDelta(
  deltaY: number,
  deltaMode: number,
  modified = false,
) {
  if (modified || !Number.isFinite(deltaY)) return 0;
  const modeScale = deltaMode === 1 ? 18 : deltaMode === 2 ? 180 : 1;
  return Math.max(-240, Math.min(240, deltaY * modeScale));
}

export function accumulateCameraWheelDelta(current: number, next: number) {
  const safeCurrent = Number.isFinite(current) ? current : 0;
  const safeNext = Number.isFinite(next) ? next : 0;
  return Math.max(-480, Math.min(480, safeCurrent + safeNext));
}

export class InputManager {
  private held = new Set<string>();
  private pressed = new Set<string>();
  private lookDelta = { x: 0, y: 0 };
  private cameraZoomDelta = 0;
  private onPointerLockChange?: (locked: boolean) => void;
  private actionKeys: Record<GameAction, readonly string[]>;
  private capturedKeys: Set<string>;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    onPointerLockChange?: (locked: boolean) => void,
    bindings: Readonly<KeyBindings> = DEFAULT_KEY_BINDINGS,
  ) {
    this.onPointerLockChange = onPointerLockChange;
    this.actionKeys = resolveActionKeys(bindings);
    this.capturedKeys = new Set([...CORE_GAME_KEYS, ...Object.values(bindings)]);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleBlur);
    window.addEventListener("mouseup", this.handleMouseUp);
    this.canvas.addEventListener("mousedown", this.handleMouseDown);
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
    document.addEventListener("mousemove", this.handleMouseMove);
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
    document.addEventListener("pointerlockerror", this.handlePointerLockError);
  }

  requestPointerLock() {
    if (document.pointerLockElement === this.canvas) return;
    try {
      const request = this.canvas.requestPointerLock?.();
      void Promise.resolve(request).catch(this.handlePointerLockError);
    } catch {
      this.handlePointerLockError();
    }
  }

  isLocked() {
    return document.pointerLockElement === this.canvas;
  }

  isDown(code: string) {
    return this.held.has(code);
  }

  isActionDown(action: GameAction) {
    return this.actionKeys[action].some((code) => this.held.has(code));
  }

  consumePressed(code: string) {
    const wasPressed = this.pressed.has(code);
    this.pressed.delete(code);
    return wasPressed;
  }

  consumeActionPressed(action: GameAction) {
    const codes = this.actionKeys[action];
    const wasPressed = codes.some((code) => this.pressed.has(code));
    for (const code of codes) this.pressed.delete(code);
    return wasPressed;
  }

  setBindings(bindings: Readonly<KeyBindings>) {
    this.actionKeys = resolveActionKeys(bindings);
    this.capturedKeys = new Set([...CORE_GAME_KEYS, ...Object.values(bindings)]);
    this.reset();
  }

  consumeLookDelta() {
    const delta = { ...this.lookDelta };
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    return delta;
  }

  consumeCameraZoomDelta() {
    const delta = this.cameraZoomDelta;
    this.cameraZoomDelta = 0;
    return delta;
  }

  reset() {
    this.handleBlur();
  }

  dispose() {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleBlur);
    window.removeEventListener("mouseup", this.handleMouseUp);
    this.canvas.removeEventListener("mousedown", this.handleMouseDown);
    this.canvas.removeEventListener("wheel", this.handleWheel);
    document.removeEventListener("mousemove", this.handleMouseMove);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
    document.removeEventListener("pointerlockerror", this.handlePointerLockError);
    this.held.clear();
    this.pressed.clear();
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    this.cameraZoomDelta = 0;
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (!this.isLocked() && (event.ctrlKey || event.metaKey || event.altKey)) return;
    if (isEditableTarget(event.target, this.isLocked()) && event.code !== "Escape") return;
    if (this.capturedKeys.has(event.code)) {
      event.preventDefault();
    }
    if (!event.repeat) this.pressed.add(event.code);
    this.held.add(event.code);
  };

  private handleKeyUp = (event: KeyboardEvent) => {
    this.held.delete(event.code);
  };

  private handleBlur = () => {
    this.held.clear();
    this.pressed.clear();
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    this.cameraZoomDelta = 0;
  };

  private handleMouseMove = (event: MouseEvent) => {
    if (!this.isLocked()) return;
    this.lookDelta.x += event.movementX;
    this.lookDelta.y += event.movementY;
  };

  private handleMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return;
    this.pressed.add("Mouse0");
    this.held.add("Mouse0");
  };

  private handleMouseUp = (event: MouseEvent) => {
    if (event.button === 0) this.held.delete("Mouse0");
  };

  private handleWheel = (event: WheelEvent) => {
    if (!this.isLocked() || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const normalized = normalizeCameraWheelDelta(
      event.deltaY,
      event.deltaMode,
      event.ctrlKey || event.metaKey,
    );
    this.cameraZoomDelta = accumulateCameraWheelDelta(
      this.cameraZoomDelta,
      normalized,
    );
  };

  private handlePointerLockChange = () => {
    const locked = this.isLocked();
    if (!locked) this.handleBlur();
    this.onPointerLockChange?.(locked);
  };

  private handlePointerLockError = () => {
    this.onPointerLockChange?.(false);
  };
}
