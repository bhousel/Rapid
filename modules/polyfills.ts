// Define missing types for the requestIdleCallback API
interface IdleDeadline {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

interface IdleOptions {
  timeout?: number;
}

type IdleCallback = (deadline: IdleDeadline) => void;

// Polyfill implementation (for Safari, Node, Bun, etc.)
// (options.timeout is ignored)
if (!globalThis.requestIdleCallback) {
  globalThis.requestIdleCallback = (callback: IdleCallback, options?: IdleOptions): number => {
    const start = Date.now();
    // const timeout = options?.timeout || 0;

    return Number(setTimeout(() => {
      callback({
        didTimeout: false,
        timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
      });
    }, 1));
  };

  globalThis.cancelIdleCallback = (handle: number): void => {
    clearTimeout(handle);
  };
}
