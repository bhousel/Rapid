import type { OsmTags, Vec2 } from '../types.ts';


/** Supported types that can be parsed from OSM data */
export type ParserDataType =
  | 'node' | 'way' | 'relation'
  | 'changeset' | 'note' | 'user' | 'user_block'
  | 'preferences' | 'api' | 'policy' | 'bounds';


/** Options for parsing OSM content */
export interface ParserOptions {
  /** Whether to skip results that have been seen before (default: true) */
  skipSeen: boolean;
  /** Filter to include only these types in the results */
  filter: Set<string> | string[];
}


/** Result of parsing OSM content */
export interface ParserResult {
  /** Metadata attributes found in the root osm element */
  osm: Record<string, unknown>;
  /** Array of parsed data objects */
  data: ParsedData[];
  /** Set of entity IDs seen during parsing */
  seenIDs: Set<string>;
}


/** Parsed node data */
export interface ParsedNode {
  type: 'node';
  id: string;
  visible: boolean;
  tags: OsmTags;
  loc: Vec2;
  [key: string]: unknown;
}

/** Parsed way data */
export interface ParsedWay {
  type: 'way';
  id: string;
  visible: boolean;
  tags: OsmTags;
  nodes: string[];
  [key: string]: unknown;
}

/** Parsed relation member */
export interface ParsedRelationMember {
  id: string;
  type: string;
  role: string;
}

/** Parsed relation data */
export interface ParsedRelation {
  type: 'relation';
  id: string;
  visible: boolean;
  tags: OsmTags;
  members: ParsedRelationMember[];
  [key: string]: unknown;
}

/** Parsed changeset data */
export interface ParsedChangeset {
  type: 'changeset';
  id: string;
  tags: OsmTags;
  comments?: ParsedComment[];
  [key: string]: unknown;
}

/** Parsed note data */
export interface ParsedNote {
  type: 'note';
  loc: Vec2;
  comments?: ParsedComment[];
  [key: string]: unknown;
}

/** Parsed comment (used in notes and changesets) */
export interface ParsedComment {
  visible: boolean;
  [key: string]: unknown;
}

/** Parsed user data */
export interface ParsedUser {
  type: 'user';
  roles: string[];
  [key: string]: unknown;
}

/** Parsed user block data */
export interface ParsedUserBlock {
  type: 'user_block';
  reason: string;
  [key: string]: unknown;
}

/** Parsed preferences data */
export interface ParsedPreferences {
  type: 'preferences';
  preferences: Record<string, unknown>;
  [key: string]: unknown;
}

/** Parsed API capabilities data */
export interface ParsedApi {
  type: 'api';
  [key: string]: unknown;
}

/** Parsed policy data */
export interface ParsedPolicy {
  type: 'policy';
  imagery?: {
    blacklist: RegExp[];
  };
  [key: string]: unknown;
}

/** Parsed bounds data */
export interface ParsedBounds {
  type: 'bounds';
  minlon?: number;
  minlat?: number;
  maxlon?: number;
  maxlat?: number;
  [key: string]: unknown;
}

/** Union of all parsed data types */
export type ParsedData =
  | ParsedElement
  | ParsedChangeset | ParsedNote | ParsedUser | ParsedUserBlock
  | ParsedPreferences | ParsedApi | ParsedPolicy | ParsedBounds;

export type ParsedElement =
  | ParsedNode | ParsedWay | ParsedRelation;
