type Listener<T> = (payload: T) => void;

export class EventBus<EventMap extends object> {
  private listeners = new Map<keyof EventMap, Set<Listener<never>>>();

  on<Key extends keyof EventMap>(event: Key, listener: Listener<EventMap[Key]>) {
    const listeners = this.listeners.get(event) ?? new Set<Listener<never>>();
    listeners.add(listener as Listener<never>);
    this.listeners.set(event, listeners);
    return () => listeners.delete(listener as Listener<never>);
  }

  emit<Key extends keyof EventMap>(event: Key, payload: EventMap[Key]) {
    this.listeners.get(event)?.forEach((listener) => listener(payload as never));
  }

  clear() {
    this.listeners.clear();
  }
}
