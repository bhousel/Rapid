import { networkListeners } from './NetworkSystem.worker.ts';

/** Listeners provided by this file */
export const coreListeners: ListenerRegistry = {
  ...networkListeners
};
