
// Polyfill requestAnimationFrame/cancelAnimationFrame for environments
// that don't provide it (e.g. happy-dom in the Bun test runner).
if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    return Number(setTimeout(() => callback(performance.now()), 16));
  };

  globalThis.cancelAnimationFrame = (handle: number): void => {
    clearTimeout(handle);
  };
}
