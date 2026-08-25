import type { GameSettings } from "../settings";
import type { AmbientMix, FootstepSurface } from "./model";

export type AudioCue =
  | "collect"
  | "harvest"
  | "door-open"
  | "door-close"
  | "scan"
  | "inspect"
  | "discover"
  | "damage"
  | "recover"
  | "save";

type AudioContextConstructor = typeof AudioContext;

function audioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const candidate = window as typeof window & { webkitAudioContext?: AudioContextConstructor };
  return window.AudioContext ?? candidate.webkitAudioContext ?? null;
}

function safeVolume(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export class EnvironmentalAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambient: GainNode | null = null;
  private effects: GainNode | null = null;
  private windGain: GainNode | null = null;
  private weatherGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private weatherFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private settings: GameSettings;
  private unlocked = false;
  private disposed = false;
  private cueCount = 0;
  private lastCue: AudioCue | "footstep" | null = null;

  constructor(settings: Readonly<GameSettings>, private readonly disabled = false) {
    this.settings = { ...settings, keyBindings: { ...settings.keyBindings } };
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

  setSettings(settings: Readonly<GameSettings>) {
    this.settings = { ...settings, keyBindings: { ...settings.keyBindings } };
    if (!this.context || !this.master || !this.ambient || !this.effects) return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(safeVolume(settings.masterVolume), now, 0.04);
    this.ambient.gain.setTargetAtTime(safeVolume(settings.ambientVolume), now, 0.08);
    this.effects.gain.setTargetAtTime(safeVolume(settings.effectsVolume), now, 0.04);
  }

  updateMix(mix: Readonly<AmbientMix>) {
    if (!this.context || !this.windGain || !this.weatherGain || !this.windFilter) return;
    const now = this.context.currentTime;
    this.windGain.gain.setTargetAtTime(safeVolume(mix.wind) * 0.18, now, 0.45);
    this.weatherGain.gain.setTargetAtTime(safeVolume(mix.weather) * 0.24, now, 0.35);
    this.windFilter.frequency.setTargetAtTime(
      Math.min(6_000, Math.max(200, mix.lowpassHz)),
      now,
      0.35,
    );
  }

  playFootstep(surface: FootstepSurface, intensity = 1) {
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
    source.connect(filter).connect(gain).connect(this.effects);
    source.start(now, 0, 0.11);
    source.stop(now + 0.12);
    this.cueCount += 1;
    this.lastCue = "footstep";
  }

  playCue(cue: AudioCue) {
    if (!this.context || !this.effects || !this.unlocked) return;
    const frequencies: Record<AudioCue, [number, number]> = {
      collect: [520, 760],
      harvest: [135, 92],
      "door-open": [180, 230],
      "door-close": [210, 120],
      scan: [410, 920],
      inspect: [360, 470],
      discover: [330, 660],
      damage: [95, 58],
      recover: [260, 520],
      save: [620, 780],
    };
    const [startFrequency, endFrequency] = frequencies[cue];
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    oscillator.type = cue === "damage" || cue === "harvest" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(startFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + 0.12);
    gain.gain.setValueAtTime(cue === "damage" ? 0.13 : 0.075, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    oscillator.connect(gain).connect(this.effects);
    oscillator.start(now);
    oscillator.stop(now + 0.17);
    this.cueCount += 1;
    this.lastCue = cue;
  }

  get diagnostics() {
    return {
      available: !this.disabled && audioContextConstructor() !== null,
      unlocked: this.unlocked,
      state: this.context?.state ?? "uninitialized",
      cueCount: this.cueCount,
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
    this.windFilter = null;
    this.weatherFilter = null;
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
    const windFilter = context.createBiquadFilter();
    const weatherFilter = context.createBiquadFilter();
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
      source.start();
    };
    windFilter.type = "lowpass";
    windFilter.frequency.value = 1_800;
    weatherFilter.type = "highpass";
    weatherFilter.frequency.value = 1_200;
    windGain.gain.value = 0;
    weatherGain.gain.value = 0;
    ambient.connect(master);
    effects.connect(master);
    master.connect(context.destination);
    createLoop(windFilter, windGain);
    createLoop(weatherFilter, weatherGain);
    this.context = context;
    this.master = master;
    this.ambient = ambient;
    this.effects = effects;
    this.windGain = windGain;
    this.weatherGain = weatherGain;
    this.windFilter = windFilter;
    this.weatherFilter = weatherFilter;
    this.noiseBuffer = buffer;
    this.setSettings(this.settings);
  }
}
