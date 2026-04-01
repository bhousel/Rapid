/**
 * Worker barrel for the services folder.
 *
 * Sits alongside `index.ts` (the main-thread barrel) and collects
 * listener function exports from `*.worker.ts` companion files.
 *
 * Convention: each companion file exports `workerListeners: Record<ListenerID, WorkerListener>`.
 * ListenerIDs are namespaced: `'servicename:operationname'`.
 */
export { workerListeners as mapWithAIListeners } from './MapWithAIService.worker.ts';
