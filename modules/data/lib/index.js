export { Difference } from './Difference.js';
export { Geometry } from './Geometry.js';
export { GeometryPart } from './GeometryPart.js';
export { Graph } from './Graph.js';
export { Tree } from './Tree.js';

export {
  osmIntersection,
  osmTurn,
  osmInferRestriction
} from './intersection.js';

export {
  osmLanes
} from './lanes.js';

export {
  osmOldMultipolygonOuterMemberOfRelation,
  osmIsOldMultipolygonOuterMember,
  osmOldMultipolygonOuterMember,
  osmJoinWays
} from './multipolygon.js';

export {
  osmAreaKeys,
  osmSetAreaKeys,
  osmTagSuggestingArea,
  osmPointTags,
  osmSetPointTags,
  osmVertexTags,
  osmSetVertexTags,
  osmDeprecatedTags,
  osmSetDeprecatedTags,
  getDeprecatedTags,
  deprecatedTagValuesByKey,
  osmNodeGeometriesForTags,
  osmOneWayTags,
  osmPavedTags,
  osmIsInterestingTag,
  osmLifecyclePrefixes,
  osmRemoveLifecyclePrefix,
  osmRoutableHighwayTagValues,
  osmFlowingWaterwayTagValues,
  osmRailwayTrackTagValues
} from './tags.js';
