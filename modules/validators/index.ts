/**
 * Validators module - Rules that check map data for errors, warnings, and suggestions.
 *
 * Each validator is a factory function that accepts a `Context` and returns a
 * `ValidatorFunction`. Validators are run by the `ValidationSystem` and results
 * are displayed in the issues panel.
 *
 * @module
 */

// Types
export type { ValidatorFactory, ValidatorFunction, ValidatorResult } from './types.ts';

// Validators
// export { validateAlmostJunction } from './almost_junction.ts';  // TODO FIX Tree.waySegments
export { validateAmbiguousCrossingTags } from './ambiguous_crossing_tags.ts';
// export { validateCrossingWays } from './crossing_ways.ts';   // TODO FIX Tree.waySegments
export { validateCloseNodes } from './close_nodes.ts';
export { validateCurbNodes } from './curb_nodes.ts';
export { validateDisconnectedWay } from './disconnected_way.ts';
export { validateDuplicateSegments } from './duplicate_segments.ts';
export { validateInvalidFormat } from './invalid_format.ts';
export { validateHelpRequest } from './help_request.ts';
export { validateImpossibleOneway } from './impossible_oneway.ts';
export { validateIncompatibleSource } from './incompatible_source.ts';
export { validateMismatchedGeometry } from './mismatched_geometry.ts';
export { validateMissingRole } from './missing_role.ts';
export { validateMissingTag } from './missing_tag.ts';
export { validateOutdatedTags } from './outdated_tags.ts';
export { validatePrivateData } from './private_data.ts';
// export { validateShortRoad } from './short_road.ts';
export { validateSuspiciousName } from './suspicious_name.ts';
export { validateUnsquareWay } from './unsquare_way.ts';
export { validateYShapedConnection } from './y_shaped_connection.ts';
