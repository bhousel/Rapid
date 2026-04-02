import { coreListeners } from './core/index.worker.ts';
import { serviceListeners } from './services/index.worker.ts';

/**
 * Rapid Web Worker entry point.
 *
 * This script runs inside a Web Worker spawned by WorkerSystem.
 * It accepts structured messages, dispatches them to registered listener functions,
 * and posts the result (or error) back to the main thread.
 *
 * Protocol:
 *   Main → Worker:  { id: number, listenerID: string, data: unknown }   (task dispatch)
 *   Main → Worker:  { id: number, type: 'cancel' }                      (abort a running task)
 *   Worker → Main:  { id: number, result?: unknown, error?: string }    (task result)
 *
 * Listener functions are registered via `registerListener(listenerID, fn)`.
 * Each listener receives `(data: unknown, signal: AbortSignal)`.
 * Listeners may be synchronous or return a Promise.
 *
 * Listener functions live in companion `*.worker.ts` files next to
 * their main-thread counterparts.  Each folder provides an `index.worker.ts`
 * barrel file that this entry point imports from.
 */

/** Map of listenerID → Listener function */
const listeners = new Map<ListenerID, Listener>();

/** Active AbortControllers for in-progress tasks, keyed by request ID */
const activeControllers = new Map<number, AbortController>();


/**
 * registerListener
 * Registers a named listener that the worker can execute.
 *
 * @param listenerID - Unique string identifying the listener
 * @param listener - Function that processes the task data and returns a result.
 *                  Receives an AbortSignal that fires if the main thread cancels the task.
 */
function registerListener(listenerID: ListenerID, listener: Listener): void {
  listeners.set(listenerID, listener);
}


// -------------------------------------------------------
// Built-in listeners
// -------------------------------------------------------
/** Ping — health check, echoes the input data */
registerListener('ping', (data: unknown) => data);


// -------------------------------------------------------
// Imported listeners (from *.worker.ts companion files)
// -------------------------------------------------------
const available = { ...coreListeners, ...serviceListeners };
for (const [listenerID, listener] of Object.entries(available)) {
  registerListener(listenerID, listener);
}


// -------------------------------------------------------
// Message handling
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
  const { id, listenerID, data } = msg;
  const controller = new AbortController();
  activeControllers.set(id, controller);

  const listener = listeners.get(listenerID);
  if (!listener) {
    activeControllers.delete(id);
    self.postMessage({ id, error: `Unknown listener: '${listenerID}'` });
    return;
  }

  try {
    const result = await listener(data, controller.signal);
    self.postMessage({ id, result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    self.postMessage({ id, error: message });
  } finally {
    activeControllers.delete(id);
  }
};
