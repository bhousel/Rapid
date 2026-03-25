/**
 * Validations module - Rules that check map data for errors, warnings, and suggestions.
 *
 * Each validation is a factory function that accepts a `Context` and returns a
 * `ValidatorFunction`. Validations are run by the `ValidationSystem` and results
 * are displayed in the issues panel.
 *
 * @module
 */

// Types
export type { ValidatorFactory, ValidatorFunction, ValidatorResult } from './types.ts';

// Validators
// export { validationAlmostJunction } from './almost_junction.ts';  // TODO FIX Tree.waySegments
export { validationAmbiguousCrossingTags } from './ambiguous_crossing_tags.ts';
// export { validationCrossingWays } from './crossing_ways.ts';   // TODO FIX Tree.waySegments
export { validationCloseNodes } from './close_nodes.ts';
export { validationCurbNodes } from './curb_nodes.ts';
export { validationDisconnectedWay } from './disconnected_way.ts';
export { validationDuplicateWaySegments } from './duplicate_way_segments.ts';
export { validationFormatting } from './invalid_format.ts';
export { validationHelpRequest } from './help_request.ts';
export { validationImpossibleOneway } from './impossible_oneway.ts';
export { validationIncompatibleSource } from './incompatible_source.ts';
export { validationMismatchedGeometry } from './mismatched_geometry.ts';
export { validationMissingRole } from './missing_role.ts';
export { validationMissingTag } from './missing_tag.ts';
export { validationOutdatedTags } from './outdated_tags.ts';
export { validationPrivateData } from './private_data.ts';
// export { validationShortRoad } from './short_road.ts';
export { validationSuspiciousName } from './suspicious_name.ts';
export { validationUnsquareWay } from './unsquare_way.ts';
export { validationYShapedConnection } from './y_shaped_connection.ts';
