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
/** Category ID - unique identifier for preset categories */
export type CategoryID = string;
/** Checkpoint ID - identifier for edit checkpoints */
export type CheckpointID = string;
/** Class ID for styling classes (e.g. 'hovered', 'selected', 'drawing') */
export type ClassID = string;
/** Data ID - unique identifier for any AbstractData subclass */
export type DataID = string;
/** Dataset ID (e.g. 'fbRoads', 'msBuildings') */
export type DatasetID = string;
/** Detection ID - identifier for photo detections (e.g. mapillary signs) */
export type DetectionID = string;
/** Entity ID (e.g. 'n123', 'w456', 'r789' for nodes, ways, relations) */
export type EntityID = string;
/** Feature ID - unique identifier for rendered features */
export type FeatureID = string;
/** Field ID - unique identifier for editor fields */
export type FieldID = string;
/** Filter ID - identifier for map filters (e.g. 'points', 'traffic_roads') */
export type FilterID = string;
/** Graph ID - unique identifier for a Graph instance (e.g. 'g-123') */
export type GraphID = string;
/** Group ID for scene groupings (e.g. 'points', 'vertices', 'lines') */
export type GroupID = string;
/** Imagery Source ID - unique identifier for imagery sources (e.g. 'Bing', 'EsriWorldImagery') */
export type ImagerySourceID = string;
/** Issue ID - unique identifier for validation issues */
export type IssueID = string;
/** Label ID - unique identifier for labels in the label layer */
export type LabelID = string;
/** Language Code - ISO 639 language code (e.g. 'en', 'de', 'zh') */
export type LanguageCode = string;
/** Layer ID for both photo and rendering layers (e.g. 'streetside', 'mapillary', 'osm') */
export type LayerID = string;
/** Locale Code - BCP 47 language tag (e.g. 'en', 'en-US', 'de') */
export type LocaleCode = string;
/** Location Set ID - identifier for validated location sets (e.g. '+[Q2]', '+[US,CA]') */
export type LocationSetID = string;
/** Mode ID (e.g. 'browse', 'select', 'draw-area') */
export type ModeID = string;
/** Operation ID (e.g. 'delete', 'merge', 'split') */
export type OperationID = string;
/** Photo ID - unique identifier for a photo */
export type PhotoID = string;
/** Photo layer ID (e.g. 'streetside', 'mapillary', 'kartaview') */
export type PhotoLayerID = string;
/** Photo type (e.g. 'flat', 'panoramic') */
export type PhotoType = string;
/** Preset ID - unique identifier for presets (e.g. 'highway/residential') */
export type PresetID = string;
/** Ruleset ID - identifier for tag rulesets (e.g. 'surface_paved', 'connected_highway') */
export type RulesetID = string;
/** Scope ID - identifier for style/schema scopes (e.g. 'osm') */
export type ScopeID = string;
/** Script Code - ISO 15924 script code (e.g. 'Latn', 'Cyrl', 'Hans') */
export type ScriptCode = string;
/** Sequence ID - identifier for sequence counters (e.g. 'node', 'way', 'relation') */
export type SequenceID = string;
/** Service ID (e.g. 'osm', 'mapillary', 'streetside') */
export type ServiceID = string;
/** String ID - identifier for localized strings (e.g. 'toolbar.undo', 'modes.add_area') */
export type StringID = string;
/** Style ID - unique identifier for styles */
export type StyleID = string;
/** Style Selector ID - unique identifier for style selectors */
export type StyleSelectorID = string;
/** System ID (e.g. 'editor', 'gfx', 'map') */
export type SystemID = string;
/** Tile ID - unique identifier for map tiles */
export type TileID = string;
/** Texture ID - unique identifier for textures (e.g. 'boldPin', 'viewfield') */
export type TextureID = string;
/** Validator ID - identifier for validation rule types */
export type ValidatorID = string;


// Make these types available globally (no import needed within Rapid)
declare global {
  type AtlasID = string;
  type BehaviorID = string;
  type AssetID = string;
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
  type RulesetID = string;
  type ServiceID = string;
  type SequenceID = string;
  type ScopeID = string;
  type ScriptCode = string;
  type StringID = string;
  type StyleID = string;
  type StyleSelectorID = string;
  type SystemID = string;
  type TileID = string;
  type TextureID = string;
  type ValidatorID = string;
}
