export function actionChangeMember(relationID, member, index) {
  return graph => {
    return graph.replace(graph.entity(relationID).updateMember(member, index)).commit();
  };
}
