/**
 * Actions module - Pure functions that transform a Graph.
 *
 * Actions are the building blocks of all edits in Rapid. They are pure functions
 * that take a Graph and return a modified Graph. Actions should call `graph.commit()`
 * at the end to finalize changes.
 *
 * Some actions support transitions (smooth animations) via an optional `t` parameter.
 * Some actions can be disabled, reporting a reason string via a `disabled()` method.
 *
 * @module
 */

// Types
export type { Action } from './types.ts';
export type { CopyEntitiesAction } from './copy_entities.ts';
export type { DisconnectAction, DisconnectConnection } from './disconnect.ts';
export type { ExtractAction } from './extract.ts';
export type { InsertPair } from './add_member.ts';
export type { Midpoint } from './add_midpoint.ts';
export type { ReflectAction } from './reflect.ts';
export type { SplitAction } from './split.ts';

// Actions
export { actionAddEntity } from './add_entity.ts';
export { actionAddMember } from './add_member.ts';
export { actionAddMidpoint } from './add_midpoint.ts';
export { actionAddVertex } from './add_vertex.ts';
export { actionChangeMember } from './change_member.ts';
export { actionChangePreset } from './change_preset.ts';
export { actionChangeTags } from './change_tags.ts';
export { actionCircularize } from './circularize.ts';
export { actionConnect } from './connect.ts';
export { actionCopyEntities } from './copy_entities.ts';
export { actionDeleteMember } from './delete_member.ts';
export { actionDeleteMembers } from './delete_members.ts';
export { actionDeleteMultiple } from './delete_multiple.ts';
export { actionDeleteNode } from './delete_node.ts';
export { actionDeleteRelation } from './delete_relation.ts';
export { actionDeleteWay } from './delete_way.ts';
export { actionDiscardTags } from './discard_tags.ts';
export { actionDisconnect } from './disconnect.ts';
export { actionExtract } from './extract.ts';
export { actionJoin } from './join.ts';
export { actionMerge } from './merge.ts';
export { actionMergeNodes } from './merge_nodes.ts';
export { actionMergePolygon } from './merge_polygon.ts';
export { actionMergeRemoteChanges } from './merge_remote_changes.ts';
export { actionMove } from './move.ts';
export { actionMoveMember } from './move_member.ts';
export { actionMoveNode } from './move_node.ts';
export { actionNoop } from './noop.ts';
export { actionOrthogonalize } from './orthogonalize.ts';
export { actionRapidAcceptFeature } from './rapid_accept_feature.ts';
export { actionReflect } from './reflect.ts';
export { actionRestrictTurn } from './restrict_turn.ts';
export { actionReverse } from './reverse.ts';
export { actionRevert } from './revert.ts';
export { actionRotate } from './rotate.ts';
export { actionScale } from './scale.ts';
export { actionSplit } from './split.ts';
export { actionStraightenNodes } from './straighten_nodes.ts';
export { actionStraightenWay } from './straighten_way.ts';
export { actionSyncCrossingTags } from './sync_crossing_tags.ts';
export { actionUnrestrictTurn } from './unrestrict_turn.ts';
export { actionUpgradeTags } from './upgrade_tags.ts';
