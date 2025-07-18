import { actionDeleteMultiple } from './delete_multiple.js';


export function actionRevert(id) {
  return graph => {
    const head = graph.hasEntity(id);
    const base = graph.base.entities.get(id);

    if (head && !base && head.type === 'node') {   // Entity didn't exist in base, delete it..
      return actionDeleteMultiple([id])(graph);
    } else {
      return graph.revert(id).commit();
    }
  };
}
