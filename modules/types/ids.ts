/**
 * String ID types - used as identifiers throughout the application
 * These are validated at runtime, not compile time
 *
 * These types are:
 * - Exported for external consumers: `import type { ModeID } from '@rapideditor/rapid';`
 * - Available globally within Rapid (no import needed)
 * @module
 */

/** Asset ID (e.g. 'rapid_schema') */
export type AssetID = string;
/** Atlas ID (e.g. 'symbol', 'text', 'tile') */
export type AtlasID = 'symbol' | 'text' | 'tile';
/** Behavior ID (e.g. 'drag', 'draw', 'hover', 'select') */
export type BehaviorID = string;
/** Category ID - identifier for a preset category */
export type CategoryID = string;
/** Checkpoint ID - identifier for an edit checkpoint */
export type CheckpointID = string;
/** Class ID - identifier for a styling class (e.g. 'hovered', 'selected', 'drawing') */
export type ClassID = string;
/** Data ID - identifier for any AbstractData subclass */
export type DataID = string;
/** Dataset ID (e.g. 'fbRoads', 'msBuildings') */
export type DatasetID = string;
/** Detection ID - identifier for a photo detection (e.g. mapillary signs) */
export type DetectionID = string;
/** Entity ID (e.g. 'n123', 'w456', 'r789' for nodes, ways, relations) */
export type EntityID = string;
/** Feature ID - identifier for a rendered feature */
export type FeatureID = string;
/** Field ID - identifier for a preset field */
export type FieldID = string;
/** Filter ID - identifier for a filter (e.g. 'points', 'traffic_roads') */
export type FilterID = string;
/** Graph ID - identifier for a Graph instance (e.g. 'g-123') */
export type GraphID = string;
/** Group ID - identifier for a scene render group (e.g. 'points', 'vertices', 'lines') */
export type GroupID = string;
/** Imagery Source ID - identifier for an imagery source (e.g. 'Bing', 'EsriWorldImagery') */
export type ImagerySourceID = string;
/** Issue ID - identifier for a validation issue */
export type IssueID = string;
/** Label ID - identifier for a label on the label layer */
export type LabelID = string;
/** Language Code - ISO 639 language code (e.g. 'en', 'de', 'zh') */
export type LanguageCode = string;
/** Layer ID - identifier for a render layer (e.g. 'streetside', 'mapillary', 'osm') */
export type LayerID = string;
/** Listener ID - identifier for a listener, function eligible to run on a worker thread (e.g. 'mapwithai:fetchAndParse') */
export type ListenerID = string;
/** Locale Code - BCP 47 language tag (e.g. 'en', 'en-US', 'de') */
export type LocaleCode = string;
/** LocationSet ID - identifier for a location set (e.g. '+[Q2]', '+[US,CA]') */
export type LocationSetID = string;
/** Mode ID (e.g. 'browse', 'select', 'draw-area') */
export type ModeID = string;
/** Operation ID (e.g. 'delete', 'merge', 'split') */
export type OperationID = string;
/** Photo ID - identifier for a photo */
export type PhotoID = string;
/** Photo Layer ID (e.g. 'streetside', 'mapillary', 'kartaview') */
export type PhotoLayerID = string;
/** Photo type (e.g. 'flat', 'panoramic') */
export type PhotoType = string;
/** Preset ID - identifier for a preset (e.g. 'highway/residential') */
export type PresetID = string;
/** Request ID - identifier for network request (e.g. 'keepright-tile-8647,8192,14') */
export type RequestID = string;
/** Ruleset ID - identifier for a tagging ruleset (e.g. 'surface_paved', 'connected_highway') */
export type RulesetID = string;
/** Scope ID - identifier for a style/schema scope (e.g. 'osm') */
export type ScopeID = string;
/** Script Code - ISO 15924 script code (e.g. 'Latn', 'Cyrl', 'Hans') */
export type ScriptCode = string;
/** Sequence ID - identifier for a sequence counter (e.g. 'node', 'way', 'relation') */
export type SequenceID = string;
/** Service ID (e.g. 'osm', 'mapillary', 'streetside') */
export type ServiceID = string;
/** String ID - identifier for a localized string (e.g. 'toolbar.undo', 'modes.add_area') */
export type StringID = string;
/** Style ID - identifier for a style */
export type StyleID = string;
/** Style Selector ID - identifier for a style selector */
export type StyleSelectorID = string;
/** System ID (e.g. 'editor', 'gfx', 'map') */
export type SystemID = string;
/** Tile ID - identifier for a map tile (e.g. 'x,y,z', '8647,8192,14' */
export type TileID = string;
/** Texture ID - identifier for a texture (e.g. 'boldPin', 'viewfield') */
export type TextureID = string;
/** Validator ID - identifier for a validator (e.g. 'crossing_ways') */
export type ValidatorID = string;
/** Variable ID - identifier for a named variable (e.g. 'lifecycle_prefixes') */
export type VariableID = string;
/** Work ID - identifier for scheduled work (e.g. 'validation-run', 'sidebar-debounce') */
export type WorkID = string;


// Make these types available globally (no import needed within Rapid)
declare global {
  type AssetID = string;
  type AtlasID = 'symbol' | 'text' | 'tile';
  type BehaviorID = string;
  type CategoryID = string;
  type CheckpointID = string;
  type ClassID = string;
  type DataID = string;
  type DatasetID = string;
  type DetectionID = string;
  type EntityID = string;
  type FeatureID = string;
  type FieldID = string;
  type FilterID = string;
  type GraphID = string;
  type GroupID = string;
  type ListenerID = string;
  type ImagerySourceID = string;
  type IssueID = string;
  type LabelID = string;
  type LanguageCode = string;
  type LayerID = string;
  type LocaleCode = string;
  type LocationSetID = string;
  type ModeID = string;
  type OperationID = string;
  type PhotoID = string;
  type PhotoLayerID = string;
  type PhotoType = string;
  type PresetID = string;
  type RequestID = string;
  type RulesetID = string;
  type ScopeID = string;
  type ScriptCode = string;
  type SequenceID = string;
  type ServiceID = string;
  type StringID = string;
  type StyleID = string;
  type StyleSelectorID = string;
  type SystemID = string;
  type TileID = string;
  type TextureID = string;
  type ValidatorID = string;
  type VariableID = string;
  type WorkID = string;
}
