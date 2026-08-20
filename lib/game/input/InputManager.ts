const GAME_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyE",
  "KeyM",
  "KeyQ",
  "ShiftLeft",
  "ShiftRight",
  "Space",
]);

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

  dispose() {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleBlur);
    document.removeEventListener("mousemove", this.handleMouseMove);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
    document.removeEventListener("pointerlockerror", this.handlePointerLockError);
    this.held.clear();
    this.pressed.clear();
  }

  private handleKeyDown = (event: KeyboardEvent) => {
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

  private handlePointerLockChange = () => {
    this.onPointerLockChange?.(this.isLocked());
  };

  private handlePointerLockError = () => {
    this.onPointerLockChange?.(false);
  };
}
