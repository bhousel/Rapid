import { osmServiceListeners } from './OsmService.worker.ts';

/** Listeners provided by this file */
export const serviceListeners: ListenerRegistry = {
  ...osmServiceListeners,
};
