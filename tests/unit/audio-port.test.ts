import { describe, expect, it, vi } from "vitest";
import {
  applyListenerPose,
  applyPannerPosition,
  EnvironmentalAudio,
} from "../../lib/game/audio/EnvironmentalAudio";
import type { AudioPort } from "../../lib/game/audio/port";

class FakeAudioParam {
  value = 0;
  readonly targets: number[] = [];

  setTargetAtTime(value: number) {
    this.value = value;
    this.targets.push(value);
  }

  setValueAtTime(value: number) {
    this.value = value;
  }

  exponentialRampToValueAtTime(value: number) {
    this.value = value;
  }
}

class FakeAudioNode {
  readonly connections: FakeAudioNode[] = [];

  connect(destination: FakeAudioNode) {
    this.connections.push(destination);
    return destination;
  }
}

class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam();
}

class FakeFilterNode extends FakeAudioNode {
  readonly frequency = new FakeAudioParam();
  readonly Q = new FakeAudioParam();
  type = "lowpass";
}

class FakeScheduledSource extends FakeAudioNode {
  buffer: { duration: number } | null = null;
  loop = false;
  starts = 0;
  stops = 0;

  start() {
    this.starts += 1;
  }

  stop() {
    this.stops += 1;
  }
}

class FakeOscillator extends FakeScheduledSource {
  readonly frequency = new FakeAudioParam();
  type = "sine";
}

class FakePannerNode extends FakeAudioNode {
  readonly positionX = new FakeAudioParam();
  readonly positionY = new FakeAudioParam();
  readonly positionZ = new FakeAudioParam();
  panningModel = "equalpower";
  distanceModel = "inverse";
  refDistance = 1;
  maxDistance = 10_000;
  rolloffFactor = 1;
}

class FakeAudioContext {
  static latest: FakeAudioContext | null = null;

  state: "suspended" | "running" | "closed" = "suspended";
  readonly currentTime = 4;
  readonly sampleRate = 10;
  readonly destination = new FakeAudioNode();
  readonly gains: FakeGainNode[] = [];
  readonly sources: FakeScheduledSource[] = [];
  readonly oscillators: FakeOscillator[] = [];
  readonly panners: FakePannerNode[] = [];
  readonly listener = Object.fromEntries(
    [
      "positionX", "positionY", "positionZ",
      "forwardX", "forwardY", "forwardZ",
      "upX", "upY", "upZ",
    ].map((key) => [key, new FakeAudioParam()]),
  );
  closeCalls = 0;

  constructor() {
    FakeAudioContext.latest = this;
  }

  async resume() {
    this.state = "running";
  }

  async close() {
    this.closeCalls += 1;
    this.state = "closed";
  }

  createGain() {
    const node = new FakeGainNode();
    this.gains.push(node);
    return node;
  }

  createBiquadFilter() {
    return new FakeFilterNode();
  }

  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return {
      duration: length / this.sampleRate,
      getChannelData: () => data,
    };
  }

  createBufferSource() {
    const node = new FakeScheduledSource();
    this.sources.push(node);
    return node;
  }

  createOscillator() {
    const node = new FakeOscillator();
    this.oscillators.push(node);
    return node;
  }

  createPanner() {
    const node = new FakePannerNode();
    this.panners.push(node);
    return node;
  }
}

function exercisePort(audio: AudioPort) {
  audio.setLevels({ master: 0.8, ambient: 0.6, effects: 0.7 });
  audio.setListenerPose({
    position: { x: 0, y: 1.7, z: 0 },
    forward: { x: 0, y: 0, z: -1 },
    up: { x: 0, y: 1, z: 0 },
  });
  audio.updateMix({
    wind: 0.2,
    weather: 0,
    wildlife: 0.1,
    settlement: 0.2,
    lowpassHz: 2_000,
  });
  audio.playCue("door-open", { position: { x: 2, y: 1, z: 3 } });
  audio.playFootstep("stone", 0.8, { position: { x: 0, y: 0, z: 0 } });
}

describe("audio port", () => {
  it("supports a disabled browser-free implementation", async () => {
    const audio: AudioPort = new EnvironmentalAudio(
      { master: 1, ambient: 1, effects: 1 },
      true,
    );
    exercisePort(audio);
    expect(await audio.unlock()).toBe(false);
    expect(audio.diagnostics).toMatchObject({
      available: false,
      unlocked: false,
      cueCount: 0,
      spatialCueCount: 0,
      listenerUpdates: 0,
    });
    audio.dispose();
    audio.dispose();
  });

  it("uses modern Web Audio position parameters when available", () => {
    const values: Array<[number, number]> = [];
    const parameter = () => ({
      setValueAtTime: (value: number, time: number) => values.push([value, time]),
    });
    const listener = {
      positionX: parameter(),
      positionY: parameter(),
      positionZ: parameter(),
      forwardX: parameter(),
      forwardY: parameter(),
      forwardZ: parameter(),
      upX: parameter(),
      upY: parameter(),
      upZ: parameter(),
    } as unknown as AudioListener;

    applyListenerPose(listener, {
      position: { x: 2, y: Number.NaN, z: 4 },
      forward: { x: 0, y: 0, z: -1 },
      up: { x: 0, y: 1, z: 0 },
    }, 3);

    expect(values).toEqual([
      [2, 3], [0, 3], [4, 3],
      [0, 3], [0, 3], [-1, 3],
      [0, 3], [1, 3], [0, 3],
    ]);
  });

  it("falls back to legacy listener and panner positioning", () => {
    const listenerCalls: number[][] = [];
    const pannerCalls: number[][] = [];
    const listener = {
      setPosition: (...values: number[]) => listenerCalls.push(values),
      setOrientation: (...values: number[]) => listenerCalls.push(values),
    } as unknown as AudioListener;
    const panner = {
      setPosition: (...values: number[]) => pannerCalls.push(values),
    } as unknown as PannerNode;

    applyListenerPose(listener, {
      position: { x: 1, y: 2, z: 3 },
      forward: { x: 0, y: 0, z: -1 },
      up: { x: 0, y: 1, z: 0 },
    }, 0);
    applyPannerPosition(panner, { x: 6, y: 7, z: 8 }, 0);

    expect(listenerCalls).toEqual([
      [1, 2, 3],
      [0, 0, -1, 0, 1, 0],
    ]);
    expect(pannerCalls).toEqual([[6, 7, 8]]);
  });

  it("builds, drives, and disposes the active spatial audio graph", async () => {
    vi.stubGlobal("window", {
      AudioContext: FakeAudioContext as unknown as typeof AudioContext,
    });
    try {
      const audio = new EnvironmentalAudio({
        master: 0.8,
        ambient: 0.6,
        effects: 0.7,
      });
      expect(await audio.unlock()).toBe(true);
      const context = FakeAudioContext.latest!;

      audio.setLevels({ master: 0.45, ambient: 0.35, effects: 0.25 });
      audio.setListenerPose({
        position: { x: 1, y: 2, z: 3 },
        forward: { x: 0, y: 0, z: -1 },
        up: { x: 0, y: 1, z: 0 },
      });
      audio.playCue("scan", { position: { x: 4, y: 5, z: 6 } });
      audio.playFootstep(
        "stone",
        0.8,
        { position: { x: 7, y: 8, z: 9 } },
      );

      expect(context.gains.slice(0, 3).map((node) => node.gain.targets.at(-1)))
        .toEqual([0.45, 0.35, 0.25]);
      expect(context.panners).toHaveLength(2);
      expect(context.panners.every((panner) => panner.panningModel === "HRTF"))
        .toBe(true);
      expect(context.oscillators[0]).toMatchObject({ starts: 1, stops: 1 });
      expect(context.sources.at(-1)).toMatchObject({ starts: 1, stops: 1 });
      expect(audio.diagnostics).toMatchObject({
        available: true,
        unlocked: true,
        state: "running",
        cueCount: 2,
        spatialCueCount: 2,
        listenerUpdates: 1,
        lastCue: "footstep",
      });

      audio.dispose();
      audio.dispose();
      expect(context.closeCalls).toBe(1);
    } finally {
      vi.unstubAllGlobals();
      FakeAudioContext.latest = null;
    }
  });
});
