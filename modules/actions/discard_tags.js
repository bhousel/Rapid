
export function actionDiscardTags(difference, discardTags = {}) {
  return graph => {
    difference.modified().forEach(checkTags);
    difference.created().forEach(checkTags);
    return graph.commit();


    function checkTags(entity) {
      const keys = Object.keys(entity.tags);
      let didDiscard = false;
      let tags = {};

      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (discardTags[k] || !entity.tags[k]) {
          didDiscard = true;
        } else {
          tags[k] = entity.tags[k];
        }
      }
      if (didDiscard) {
        graph.replace(entity.update({ tags: tags }));
      }
    }

  };
}
