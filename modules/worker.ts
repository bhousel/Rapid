import { utilFetchResponse } from './util/fetch_response.ts';

/**
 * Rapid Web Worker entry point.
 *
 * This script runs inside a Web Worker spawned by SchedulerSystem.
 * It accepts structured messages, dispatches them to registered task
 * handlers, and posts the result (or error) back to the main thread.
 *
 * Protocol:
 *   Main → Worker:  { id: number, taskType: string, data: unknown }   (task dispatch)
 *   Main → Worker:  { type: 'cancel', id: number }                    (abort a running task)
 *   Worker → Main:  { id: number, result?: unknown, error?: string }  (task result)
 *
 * Task handlers are registered via `registerTaskHandler(type, fn)`.
 * Each handler receives `(data: unknown, signal: AbortSignal)`.
 * Handlers may be synchronous or return a Promise.
 */

/** Map of task type → handler function */
const handlers = new Map<string, (data: unknown, signal: AbortSignal) => unknown>();

/** Active AbortControllers for in-progress tasks, keyed by request ID */
const activeControllers = new Map<number, AbortController>();


/**
 * registerTaskHandler
 * Registers a named task handler that the worker can execute.
 *
 * @param taskType - Unique string identifying the task
 * @param handler - Function that processes the task data and returns a result.
 *                  Receives an AbortSignal that fires if the main thread cancels the task.
 */
function registerTaskHandler(taskType: string, handler: (data: unknown, signal: AbortSignal) => unknown): void {
  handlers.set(taskType, handler);
}


// -------------------------------------------------------
// Built-in task handlers
// -------------------------------------------------------

/** Ping — health check, echoes the input data */
registerTaskHandler('ping', (data: unknown) => data);

/**
 * fetchAndParse — fetches a URL and parses the response via utilFetchResponse.
 * Supports abort via the provided signal.
 */
registerTaskHandler('fetchAndParse', async (data: unknown, signal: AbortSignal) => {
  const { url, init } = data as { url: string; init?: RequestInit };
  const response = await fetch(url, { ...init, signal });
  return utilFetchResponse(response);
});


// -------------------------------------------------------
// Message handler
// -------------------------------------------------------

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data;

  // Handle cancel messages
  if (msg.type === 'cancel') {
    const controller = activeControllers.get(msg.id);
    if (controller) controller.abort();
    activeControllers.delete(msg.id);
    return;
  }

  // Normal task dispatch
  const { id, taskType, data } = msg;
  const controller = new AbortController();
  activeControllers.set(id, controller);

  const handler = handlers.get(taskType);
  if (!handler) {
    activeControllers.delete(id);
    self.postMessage({ id, error: `Unknown task type: '${taskType}'` });
    return;
  }

  try {
    const result = await handler(data, controller.signal);
    self.postMessage({ id, result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    self.postMessage({ id, error: message });
  } finally {
    activeControllers.delete(id);
  }
};
