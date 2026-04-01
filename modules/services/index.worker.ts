/**
 * Worker barrel for the services folder.
 *
 * Sits alongside `index.ts` (the main-thread barrel) and collects
 * listener function exports from `*.worker.ts` companion files.
 *
 * Convention: each companion file exports `workerListeners: Record<ListenerID, WorkerListener>`.
 * ListenerIDs are namespaced: `'servicename:taskname'`.
 */
export { workerListeners as mapWithAITasks } from './MapWithAIService.worker.ts';
