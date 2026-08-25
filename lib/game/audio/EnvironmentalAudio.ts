import {
  AUDIO_CUE_RECIPES,
  type AmbientMix,
  type AudioCue,
  type FootstepSurface,
} from "./model";
import type {
  AudioEmitter,
  AudioDiagnostics,
  AudioLevels,
  AudioListenerPose,
  AudioPort,
} from "./port";

type AudioContextConstructor = typeof AudioContext;

function audioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const candidate = window as typeof window & { webkitAudioContext?: AudioContextConstructor };
  return window.AudioContext ?? candidate.webkitAudioContext ?? null;
}

function safeVolume(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

type CompatibleAudioListener = AudioListener & {
  positionX?: AudioParam;
  positionY?: AudioParam;
  positionZ?: AudioParam;
  forwardX?: AudioParam;
  forwardY?: AudioParam;
  forwardZ?: AudioParam;
  upX?: AudioParam;
  upY?: AudioParam;
  upZ?: AudioParam;
  setPosition?: (x: number, y: number, z: number) => void;
  setOrientation?: (
    forwardX: number,
    forwardY: number,
    forwardZ: number,
    upX: number,
    upY: number,
    upZ: number,
  ) => void;
};

type CompatiblePannerNode = PannerNode & {
  positionX?: AudioParam;
  positionY?: AudioParam;
  positionZ?: AudioParam;
  setPosition?: (x: number, y: number, z: number) => void;
};

const finiteCoordinate = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback;

function scheduleCoordinates(
  parameters: readonly (AudioParam | undefined)[],
  values: readonly number[],
  now: number,
) {
  if (parameters.some((parameter) => !parameter)) return false;
  parameters.forEach((parameter, index) => {
    parameter!.setValueAtTime(values[index], now);
  });
  return true;
}

/** Applies a listener transform across modern and legacy Web Audio APIs. */
export function applyListenerPose(
  listener: AudioListener,
  pose: Readonly<AudioListenerPose>,
  now: number,
) {
  const compatible = listener as CompatibleAudioListener;
  const position = [
    finiteCoordinate(pose.position.x, 0),
    finiteCoordinate(pose.position.y, 0),
    finiteCoordinate(pose.position.z, 0),
  ] as const;
  const forward = [
    finiteCoordinate(pose.forward.x, 0),
    finiteCoordinate(pose.forward.y, 0),
    finiteCoordinate(pose.forward.z, -1),
  ] as const;
  const up = [
    finiteCoordinate(pose.up.x, 0),
    finiteCoordinate(pose.up.y, 1),
    finiteCoordinate(pose.up.z, 0),
  ] as const;

  if (!scheduleCoordinates(
    [compatible.positionX, compatible.positionY, compatible.positionZ],
    position,
    now,
  )) {
    compatible.setPosition?.(...position);
  }
  if (!scheduleCoordinates(
    [
      compatible.forwardX,
      compatible.forwardY,
      compatible.forwardZ,
      compatible.upX,
      compatible.upY,
      compatible.upZ,
    ],
    [...forward, ...up],
    now,
  )) {
    compatible.setOrientation?.(...forward, ...up);
  }
}

/** Applies a world emitter position across modern and legacy Web Audio APIs. */
export function applyPannerPosition(
  panner: PannerNode,
  position: Readonly<AudioEmitter["position"]>,
  now: number,
) {
  const compatible = panner as CompatiblePannerNode;
  const coordinates = [
    finiteCoordinate(position.x, 0),
    finiteCoordinate(position.y, 0),
    finiteCoordinate(position.z, 0),
  ] as const;
  if (!scheduleCoordinates(
    [compatible.positionX, compatible.positionY, compatible.positionZ],
    coordinates,
    now,
  )) {
    compatible.setPosition?.(...coordinates);
  }
}

export class EnvironmentalAudio implements AudioPort<AudioCue> {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambient: GainNode | null = null;
  private effects: GainNode | null = null;
  private windGain: GainNode | null = null;
  private weatherGain: GainNode | null = null;
  private wildlifeGain: GainNode | null = null;
  private settlementGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private weatherFilter: BiquadFilterNode | null = null;
  private wildlifeFilter: BiquadFilterNode | null = null;
  private settlementFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private levels: AudioLevels;
  private unlocked = false;
  private disposed = false;
  private cueCount = 0;
  private spatialCueCount = 0;
  private listenerUpdates = 0;
  private lastCue: AudioCue | "footstep" | null = null;

  constructor(levels: Readonly<AudioLevels>, private readonly disabled = false) {
    this.levels = { ...levels };
  }

  async unlock() {
    if (this.disabled || this.disposed) return false;
    if (!this.context) this.createGraph();
    if (!this.context) return false;
    try {
      await this.context.resume();
      this.unlocked = this.context.state === "running";
    } catch {
      this.unlocked = false;
    }
    return this.unlocked;
  }

  setLevels(levels: Readonly<AudioLevels>) {
    this.levels = { ...levels };
    if (!this.context || !this.master || !this.ambient || !this.effects) return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(safeVolume(levels.master), now, 0.04);
    this.ambient.gain.setTargetAtTime(safeVolume(levels.ambient), now, 0.08);
    this.effects.gain.setTargetAtTime(safeVolume(levels.effects), now, 0.04);
  }

  setListenerPose(pose: Readonly<AudioListenerPose>) {
    if (!this.context || !this.unlocked) return;
    applyListenerPose(this.context.listener, pose, this.context.currentTime);
    this.listenerUpdates += 1;
  }

  updateMix(mix: Readonly<AmbientMix>) {
    if (
      !this.context
      || !this.windGain
      || !this.weatherGain
      || !this.wildlifeGain
      || !this.settlementGain
      || !this.windFilter
    ) return;
    const now = this.context.currentTime;
    this.windGain.gain.setTargetAtTime(safeVolume(mix.wind) * 0.18, now, 0.45);
    this.weatherGain.gain.setTargetAtTime(safeVolume(mix.weather) * 0.24, now, 0.35);
    // Broad, decorrelated filtered-noise beds suggest distant life without
    // introducing looping samples or conspicuous synthetic tones.
    this.wildlifeGain.gain.setTargetAtTime(safeVolume(mix.wildlife) * 0.022, now, 0.9);
    this.settlementGain.gain.setTargetAtTime(safeVolume(mix.settlement) * 0.036, now, 0.75);
    this.windFilter.frequency.setTargetAtTime(
      Math.min(6_000, Math.max(200, mix.lowpassHz)),
      now,
      0.35,
    );
  }

  playFootstep(
    surface: FootstepSurface,
    intensity = 1,
    emitter?: Readonly<AudioEmitter>,
  ) {
    if (!this.context || !this.effects || !this.noiseBuffer || !this.unlocked) return;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const profile = {
      grass: { frequency: 780, volume: 0.055 },
      soil: { frequency: 520, volume: 0.06 },
      sand: { frequency: 1_050, volume: 0.045 },
      stone: { frequency: 1_650, volume: 0.07 },
      interior: { frequency: 1_250, volume: 0.062 },
    }[surface];
    source.buffer = this.noiseBuffer;
    filter.type = "bandpass";
    filter.frequency.value = profile.frequency;
    filter.Q.value = 0.8;
    const now = this.context.currentTime;
    gain.gain.setValueAtTime(profile.volume * safeVolume(intensity), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.105);
    source.connect(filter).connect(gain);
    this.connectEffect(gain, emitter);
    source.start(now, 0, 0.11);
    source.stop(now + 0.12);
    this.cueCount += 1;
    this.lastCue = "footstep";
  }

  playCue(cue: AudioCue, emitter?: Readonly<AudioEmitter>) {
    if (!this.context || !this.effects || !this.unlocked) return;
    const recipe = AUDIO_CUE_RECIPES[cue];
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    oscillator.type = recipe.waveform;
    oscillator.frequency.setValueAtTime(recipe.startFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      recipe.endFrequency,
      now + recipe.duration * 0.7,
    );
    gain.gain.setValueAtTime(recipe.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + recipe.duration * 0.94);
    oscillator.connect(gain);
    this.connectEffect(gain, emitter);
    oscillator.start(now);
    oscillator.stop(now + recipe.duration);
    this.cueCount += 1;
    this.lastCue = cue;
  }

  get diagnostics(): AudioDiagnostics {
    return {
      available: !this.disabled && audioContextConstructor() !== null,
      unlocked: this.unlocked,
      state: this.context?.state ?? "uninitialized",
      cueCount: this.cueCount,
      spatialCueCount: this.spatialCueCount,
      listenerUpdates: this.listenerUpdates,
      lastCue: this.lastCue,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unlocked = false;
    const context = this.context;
    this.context = null;
    this.master = null;
    this.ambient = null;
    this.effects = null;
    this.windGain = null;
    this.weatherGain = null;
    this.wildlifeGain = null;
    this.settlementGain = null;
    this.windFilter = null;
    this.weatherFilter = null;
    this.wildlifeFilter = null;
    this.settlementFilter = null;
    this.noiseBuffer = null;
    void context?.close().catch(() => undefined);
  }

  private createGraph() {
    const Constructor = audioContextConstructor();
    if (!Constructor) return;
    const context = new Constructor();
    const master = context.createGain();
    const ambient = context.createGain();
    const effects = context.createGain();
    const windGain = context.createGain();
    const weatherGain = context.createGain();
    const wildlifeGain = context.createGain();
    const settlementGain = context.createGain();
    const windFilter = context.createBiquadFilter();
    const weatherFilter = context.createBiquadFilter();
    const wildlifeFilter = context.createBiquadFilter();
    const settlementFilter = context.createBiquadFilter();
    const buffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < data.length; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.965 + white * 0.035;
      data[index] = previous;
    }
    const createLoop = (filter: BiquadFilterNode, gain: GainNode) => {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(filter).connect(gain).connect(ambient);
      source.start(context.currentTime, Math.random() * buffer.duration);
    };
    windFilter.type = "lowpass";
    windFilter.frequency.value = 1_800;
    weatherFilter.type = "highpass";
    weatherFilter.frequency.value = 1_200;
    wildlifeFilter.type = "bandpass";
    wildlifeFilter.frequency.value = 2_000;
    wildlifeFilter.Q.value = 0.75;
    settlementFilter.type = "bandpass";
    settlementFilter.frequency.value = 280;
    settlementFilter.Q.value = 0.5;
    windGain.gain.value = 0;
    weatherGain.gain.value = 0;
    wildlifeGain.gain.value = 0;
    settlementGain.gain.value = 0;
    ambient.connect(master);
    effects.connect(master);
    master.connect(context.destination);
    createLoop(windFilter, windGain);
    createLoop(weatherFilter, weatherGain);
    createLoop(wildlifeFilter, wildlifeGain);
    createLoop(settlementFilter, settlementGain);
    this.context = context;
    this.master = master;
    this.ambient = ambient;
    this.effects = effects;
    this.windGain = windGain;
    this.weatherGain = weatherGain;
    this.wildlifeGain = wildlifeGain;
    this.settlementGain = settlementGain;
    this.windFilter = windFilter;
    this.weatherFilter = weatherFilter;
    this.wildlifeFilter = wildlifeFilter;
    this.settlementFilter = settlementFilter;
    this.noiseBuffer = buffer;
    this.setLevels(this.levels);
  }

  private connectEffect(
    source: AudioNode,
    emitter: Readonly<AudioEmitter> | undefined,
  ) {
    if (!this.context || !this.effects) return;
    if (!emitter) {
      source.connect(this.effects);
      return;
    }
    const panner = this.context.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = Math.max(
      0.25,
      Number.isFinite(emitter.referenceDistance)
        ? emitter.referenceDistance!
        : 2.5,
    );
    panner.maxDistance = Math.max(
      panner.refDistance,
      Number.isFinite(emitter.maxDistance) ? emitter.maxDistance! : 48,
    );
    panner.rolloffFactor = 1;
    const now = this.context.currentTime;
    applyPannerPosition(panner, emitter.position, now);
    const emitterGain = this.context.createGain();
    emitterGain.gain.value = safeVolume(emitter.gain ?? 1);
    source.connect(emitterGain).connect(panner).connect(this.effects);
    this.spatialCueCount += 1;
  }
}

export type { AudioCue } from "./model";
