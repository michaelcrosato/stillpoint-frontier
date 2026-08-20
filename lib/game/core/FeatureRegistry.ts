import type { GameSystem, SystemPipeline } from "./SystemPipeline";

export interface GameFeature<Context> {
  readonly id: string;
  install(registry: FeatureRegistry<Context>): void;
}

/** Public extension seam: a feature can contribute ordered systems without touching Engine. */
export class FeatureRegistry<Context> {
  private installed = new Set<string>();

  constructor(private readonly pipeline: SystemPipeline<Context>) {}

  use(feature: GameFeature<Context>) {
    if (this.installed.has(feature.id)) {
      throw new Error(`Feature already installed: ${feature.id}`);
    }
    this.installed.add(feature.id);
    feature.install(this);
    return this;
  }

  system(system: GameSystem<Context>) {
    this.pipeline.register(system);
    return this;
  }

  ids() {
    return [...this.installed];
  }
}
