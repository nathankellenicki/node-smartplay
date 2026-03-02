export type DebugLogger = (...args: unknown[]) => void;

type DebugFactory = (namespace: string) => DebugLogger;

const noop: DebugLogger = () => {};

export function createDebug(namespace: string): DebugLogger {
  const requireFn = typeof require === "function" ? require : null;
  if (!requireFn) {
    return noop;
  }
  try {
    const mod = requireFn("debug") as { default?: DebugFactory } | DebugFactory;
    const factory = (mod as { default?: DebugFactory }).default ?? (mod as DebugFactory);
    if (typeof factory === "function") {
      return factory(namespace);
    }
  } catch (error) {
    return noop;
  }
  return noop;
}
