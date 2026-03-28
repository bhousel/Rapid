/**
 * Rapid Web Worker entry point.
 *
 * This script runs inside a Web Worker spawned by SchedulerSystem.
 * It accepts structured messages, dispatches them to registered task
 * handlers, and posts the result (or error) back to the main thread.
 *
 * Protocol:
 *   Main → Worker:  { id: number, taskType: string, data: unknown }
 *   Worker → Main:  { id: number, result?: unknown, error?: string }
 *
 * Task handlers are registered via `registerTaskHandler(type, fn)`.
 * Each handler is a pure function: `(data: unknown) => unknown`.
 * Handlers may be synchronous or return a Promise.
 */

/** Map of task type → handler function */
const handlers = new Map<string, (data: unknown) => unknown>();


/**
 * registerTaskHandler
 * Registers a named task handler that the worker can execute.
 *
 * @param taskType - Unique string identifying the task
 * @param handler - Pure function that processes the task data and returns a result
 */
function registerTaskHandler(taskType: string, handler: (data: unknown) => unknown): void {
  handlers.set(taskType, handler);
}


// -------------------------------------------------------
// Built-in task handlers
// -------------------------------------------------------

/** Ping — health check, echoes the input data */
registerTaskHandler('ping', (data: unknown) => data);


// -------------------------------------------------------
// Message handler
// -------------------------------------------------------

self.onmessage = async (event: MessageEvent) => {
  const { id, taskType, data } = event.data;

  const handler = handlers.get(taskType);
  if (!handler) {
    self.postMessage({ id, error: `Unknown task type: '${taskType}'` });
    return;
  }

  try {
    const result = await handler(data);
    self.postMessage({ id, result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    self.postMessage({ id, error: message });
  }
};
