const GAME_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyE",
  "KeyF",
  "KeyC",
  "KeyM",
  "KeyQ",
  "ShiftLeft",
  "ShiftRight",
  "Space",
  "ControlLeft",
  "ControlRight",
  "Backquote",
  "Escape",
]);

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.matches("input, select, textarea, button, [role='button']")
  );
}

export class InputManager {
  private held = new Set<string>();
  private pressed = new Set<string>();
  private lookDelta = { x: 0, y: 0 };
  private onPointerLockChange?: (locked: boolean) => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    onPointerLockChange?: (locked: boolean) => void,
  ) {
    this.onPointerLockChange = onPointerLockChange;
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleBlur);
    window.addEventListener("mouseup", this.handleMouseUp);
    this.canvas.addEventListener("mousedown", this.handleMouseDown);
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

  consumePressed(code: string) {
    const wasPressed = this.pressed.has(code);
    this.pressed.delete(code);
    return wasPressed;
  }

  consumeLookDelta() {
    const delta = { ...this.lookDelta };
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
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
    document.removeEventListener("mousemove", this.handleMouseMove);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
    document.removeEventListener("pointerlockerror", this.handlePointerLockError);
    this.held.clear();
    this.pressed.clear();
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    if (isEditableTarget(event.target) && event.code !== "Escape") return;
    if (GAME_KEYS.has(event.code)) event.preventDefault();
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

  private handlePointerLockChange = () => {
    const locked = this.isLocked();
    if (!locked) this.handleBlur();
    this.onPointerLockChange?.(locked);
  };

  private handlePointerLockError = () => {
    this.onPointerLockChange?.(false);
  };
}
