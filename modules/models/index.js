import { AbstractFeature } from './AbstractFeature.js';
import { Geometry } from './Geometry.js';
import { OsmChangeset } from './OsmChangeset.js';
import { OsmEntity } from './OsmEntity.js';
import { OsmNode } from './OsmNode.js';
import { OsmRelation } from './OsmRelation.js';
import { OsmWay } from './OsmWay.js';
import { QAItem } from './qa_item.js';

export {
  AbstractFeature,
  Geometry,
  OsmChangeset,
  OsmEntity,
  OsmNode,
  OsmRelation,
  OsmWay,
  QAItem
};

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


/**
 * createOsmFeature
 * Features may be constructed by copying another feature, or by passing a context and properties.
 * If passed context and properties, this function will determine what type of Entity to create
 *  based on its `id` or `type` properties.
 * @param  {AbstractFeature|Context}  otherOrContext - copy another Feature, or pass application context
 * @param  {Object}                   props   - Properties to assign to the Feature
 */
export function createOsmFeature(otherOrContext, props = {}) {
  if (otherOrContext instanceof AbstractFeature) {  // copy other
    const Type = otherOrContext.constructor;
    return new Type(otherOrContext, props);

  } else {
    const context = otherOrContext;

    // Determine what type to create
    let type = props.type;
    if (!type) {
      const id = props.id;
      if (id) {
        type = OsmEntity.type(id);
      }
    }

    if (type === 'node') {
      return new OsmNode(context, props);
    } else if (type === 'way') {
      return new OsmWay(context, props);
    } else if (type === 'relation') {
      return new OsmRelation(context, props);
    } else if (type === 'changeset') {
      return new OsmChangeset(context, props);
    } else {
      return new OsmEntity(context, props);  // an untyped OsmEntity - avoid doing this.
    }
  }
}
