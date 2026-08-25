import type { AmbientMix, AudioCue, FootstepSurface } from "./model";

export interface AudioLevels {
  master: number;
  ambient: number;
  effects: number;
}

export interface AudioPoint {
  x: number;
  y: number;
  z: number;
}

export interface AudioListenerPose {
  position: AudioPoint;
  forward: AudioPoint;
  up: AudioPoint;
}

export interface AudioEmitter {
  position: AudioPoint;
  gain?: number;
  referenceDistance?: number;
  maxDistance?: number;
}

export interface AudioDiagnostics {
  available: boolean;
  unlocked: boolean;
  state: "closed" | "running" | "suspended" | "interrupted" | "uninitialized";
  cueCount: number;
  spatialCueCount: number;
  listenerUpdates: number;
  lastCue: AudioCue | "footstep" | null;
}

export interface AudioPort<CueId extends string = AudioCue> {
  unlock(): Promise<boolean>;
  setLevels(levels: Readonly<AudioLevels>): void;
  setListenerPose(pose: Readonly<AudioListenerPose>): void;
  updateMix(mix: Readonly<AmbientMix>): void;
  playFootstep(
    surface: FootstepSurface,
    intensity?: number,
    emitter?: Readonly<AudioEmitter>,
  ): void;
  playCue(cue: CueId, emitter?: Readonly<AudioEmitter>): void;
  readonly diagnostics: AudioDiagnostics;
  dispose(): void;
}
