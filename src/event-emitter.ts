type Listener = (...args: any[]) => void;

type ListenerEntry = {
  listener: Listener;
  once: boolean;
};

export class EventEmitter {
  private readonly listeners = new Map<string | symbol, ListenerEntry[]>();

  on(event: string | symbol, listener: Listener): this {
    const entries = this.listeners.get(event) ?? [];
    entries.push({ listener, once: false });
    this.listeners.set(event, entries);
    return this;
  }

  addListener(event: string | symbol, listener: Listener): this {
    return this.on(event, listener);
  }

  once(event: string | symbol, listener: Listener): this {
    const entries = this.listeners.get(event) ?? [];
    entries.push({ listener, once: true });
    this.listeners.set(event, entries);
    return this;
  }

  off(event: string | symbol, listener: Listener): this {
    const entries = this.listeners.get(event);
    if (!entries) {
      return this;
    }
    const next = entries.filter((entry) => entry.listener !== listener);
    if (next.length === 0) {
      this.listeners.delete(event);
    } else {
      this.listeners.set(event, next);
    }
    return this;
  }

  removeListener(event: string | symbol, listener: Listener): this {
    return this.off(event, listener);
  }

  removeAllListeners(event?: string | symbol): this {
    if (event === undefined) {
      this.listeners.clear();
    } else {
      this.listeners.delete(event);
    }
    return this;
  }

  emit(event: string | symbol, ...args: unknown[]): boolean {
    const entries = this.listeners.get(event);
    if (!entries || entries.length === 0) {
      return false;
    }
    const remaining: ListenerEntry[] = [];
    for (const entry of entries) {
      entry.listener(...args);
      if (!entry.once) {
        remaining.push(entry);
      }
    }
    if (remaining.length === 0) {
      this.listeners.delete(event);
    } else {
      this.listeners.set(event, remaining);
    }
    return true;
  }
}
