export interface GameSystem<Context> {
  readonly id: string;
  readonly order: number;
  update(context: Context, deltaSeconds: number): void;
  dispose?(): void;
}

export class SystemPipeline<Context> {
  private systems: GameSystem<Context>[] = [];

  register(system: GameSystem<Context>) {
    if (this.systems.some((candidate) => candidate.id === system.id)) {
      throw new Error(`System already registered: ${system.id}`);
    }
    this.systems.push(system);
    this.systems.sort((left, right) => left.order - right.order);
    return this;
  }

  update(context: Context, deltaSeconds: number) {
    for (const system of this.systems) system.update(context, deltaSeconds);
  }

  dispose() {
    for (const system of [...this.systems].reverse()) system.dispose?.();
    this.systems = [];
  }

  ids() {
    return this.systems.map((system) => system.id);
  }
}
