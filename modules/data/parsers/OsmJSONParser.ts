import type {
  ParserDataType,
  ParserOptions,
  ParserResult,
  ParsedApi,
  ParsedBounds,
  ParsedChangeset,
  ParsedComment,
  ParsedElement,
  ParsedNode,
  ParsedPolicy,
  ParsedPreferences,
  ParsedRelation,
  ParsedNote,
  ParsedUser,
  ParsedUserBlock,
  ParsedWay,
} from './types.ts';


/**
 * This class contains the code for parsing an OSM JSON content.
 * @see https://wiki.openstreetmap.org/wiki/OSM_JSON
 * Note that OSM JSON data can contain slightly different syntax and attributes.
 * History:  The XML-based formats came first, but now the OSM API supports JSON
 *  for many of its methods.  Using JSON can be much more efficient because it
 *  avoids the overhead of parsing and creating a Document and DOM objects.
 *
 * The job of this code is to convert the OSM JSON into a JavaScript Object,
 * allowing code elsewhere in Rapid to work with the data in a consistent way.
 * The JavaScript Object will look a lot like the OSM JSON file format, but
 * with a consistent structure, as the OSM JSON has its own inconsistencies.
 *
 * Parsed results will be returned in an JavaScript Object like this:
 * @example
 * {
 *   osm: {            // Any optional metadata attributes found in the root osm element.
 *     version: … ,    // 'version', 'generator', 'copyright', 'attribution' are typical.
 *     generator: …
 *     …
 *   },
 *   data: [         // Array of Objects parsed from the file..
 *     {
 *       type: 'node',   // Each object WILL have a 'type' property,
 *       id: 'n1',       // along with whatever other properties are present.
 *       lat: 40.6555,
 *       lon: -74.5415,
 *       …
 *     }, {
 *       type: 'way',
 *       id: 'w1',
 *       nodes: [1, 2],
 *       …
 *     },
 *     …
 *   ]
 * }
 *
 * The supported "types" include:
 *  'node', 'way', 'relation',    (sometimes called "elements")
 *  'changeset',
 *  'note',
 *  'user',
 *  'user_block',
 *  'preferences',
 *  'api', 'policy'  (returned from the `/capabilities` API call)
 *  'bounds'         (returned with the `/map` API call)
 */
export class OsmJSONParser {
  protected _seen: Set<string>;
  public types: Set<ParserDataType>;

  /**
   * @constructor
   */
  public constructor() {
    this._seen = new Set();   // Set<string>  (unique identifers)

    this._parseNode = this._parseNode.bind(this);
    this._parseWay = this._parseWay.bind(this);
    this._parseRelation = this._parseRelation.bind(this);
    this._parseChangeset = this._parseChangeset.bind(this);
    this._parseNote = this._parseNote.bind(this);
    this._parseComments = this._parseComments.bind(this);
    this._parseUser = this._parseUser.bind(this);
    this._parseUserBlock = this._parseUserBlock.bind(this);
    this._parsePreferences = this._parsePreferences.bind(this);
    this._parseApi = this._parseApi.bind(this);
    this._parsePolicy = this._parsePolicy.bind(this);
    this._parseBounds = this._parseBounds.bind(this);

    this.types = new Set<ParserDataType>([
      'node', 'way', 'relation', 'changeset', 'note', 'user', 'user_block', 'preferences', 'api', 'policy', 'bounds'
    ]);
  }


  /**
   * Call reset to clear the caches.
   */
  public reset(): void {
    this._seen.clear();
  }


  /**
   * Parse the given content and extract whatatever OSM data we find in it.
   * @param   content - the content to parse
   * @param   options - parsing options
   * @return  Result object containing the information parsed
   * @throws  Will throw if nothing could be parsed, or errors found
   */
  public parse(content: Record<string, unknown> | string, options: Partial<ParserOptions> = {}): ParserResult {
    if (!content)  {
      throw new Error('No content');
    }

    // exclude results that we have seen before
    const skipSeen = options.skipSeen ?? true;

    // include only these in the results (e.g. ['node','way','relation'])
    let filter: Set<string>;
    if (options.filter instanceof Set) {
      filter = options.filter;
    } else if (Array.isArray(options.filter)) {
      filter = new Set(options.filter);
    } else {
      filter = this.types;
    }

    const results: ParserResult = { osm: {}, data: [], seenIDs: new Set() };
    const json: Record<string, any> = (typeof content === 'string' ? JSON.parse(content) : content);

    if (!isObject(json)) {
      throw new Error('No JSON');
    }

    // 'notes'
    // We're going to handle these first because they are the exception.
    // OSM Notes data will look like GeoJSON.
    let notes: any[] | undefined;
    if (json.type === 'Feature') {  // a single note
      notes = [json];
    } else if (json.type === 'FeatureCollection' && Array.isArray(json.features)) {
      notes = json.features;
    }
    if (notes) {
      if (filter.has('note')) {
        for (const note of notes) {
          const parsed = this._parseNote(note);
          if (parsed) {
            results.data.push(parsed);
          }
        }
      }
      return results;  // exit early
    }

    // For everything else, check the properties where we expect to find data.

    // Collect metadata
    for (const prop of ['version', 'generator', 'copyright', 'attribution', 'license']) {
      if (Object.hasOwn(json, prop)) {
        results.osm[prop] = unstringify(json[prop]);
      }
    }

    // 'api'
    if (isObject(json.api) && filter.has('api')) {
      const parsed = this._parseApi(json.api);
      if (parsed) {
        results.data.push(parsed);
      }
    }

    // 'policy'
    if (isObject(json.policy) && filter.has('policy')) {
      const parsed = this._parsePolicy(json.policy);
      if (parsed) {
        results.data.push(parsed);
      }
    }

    // 'bounds'
    if (isObject(json.bounds) && filter.has('bounds')) {
      const parsed = this._parseBounds(json.bounds);
      if (parsed) {
        results.data.push(parsed);
      }
    }

    // Elements ('node', 'way', 'relation')
    const elements = (json.elements || []) as any[];
    if (elements.length) {
      // Sometimes an error can be present alongside other elements - Rapid#501
      const errElement = elements.find(obj => obj.type === 'error');
      if (errElement) {
        const message = errElement.message || 'unknown error';
        throw new Error(`Partial Response: ${message}`);
      }

      for (const obj of elements) {
        let parser: ((obj: any, id: string) => ParsedElement) | undefined;
        let id: string | undefined;

        if (obj.type === 'node' && filter.has('node')) {
          id = 'n' + obj.id;
          results.seenIDs.add(id);
          parser = this._parseNode;

        } else if (obj.type === 'way' && filter.has('way')) {
          id = 'w' + obj.id;
          results.seenIDs.add(id);
          parser = this._parseWay;

        } else if (obj.type === 'relation' && filter.has('relation')) {
          id = 'r' + obj.id;
          results.seenIDs.add(id);
          parser = this._parseRelation;
        }

        if (!parser || !id) continue;

        if (skipSeen) {  // skip things we've seen before
          if (this._seen.has(id)) continue;
          this._seen.add(id);
        }

        const parsed = parser(obj, id);
        if (parsed) {
          results.data.push(parsed);
        }
      }
    }

    // 'changesets'
    const changesets = ((json.changeset ? [json.changeset] : json.changesets) || []) as any[];
    if (changesets.length && filter.has('changeset')) {
      for (const obj of changesets) {
        const id = 'c' + obj.id;

        if (skipSeen) {  // skip things we've seen before
          if (this._seen.has(id)) continue;
          this._seen.add(id);
        }

        const parsed = this._parseChangeset(obj, id);
        if (parsed) {
          results.data.push(parsed);
        }
      }
    }

    // 'users'
    const users = ((json.user ? [json.user] : json.users) || []) as any[];
    if (users.length && filter.has('user')) {
      for (const obj of users) {
        const id = 'user' + obj.id;

        if (skipSeen) {  // skip things we've seen before
          if (this._seen.has(id)) continue;
          this._seen.add(id);
        }

        const parsed = this._parseUser(obj, id);
        if (parsed) {
          results.data.push(parsed);
        }
      }
    }

    // 'user_blocks'
    const user_blocks = ((json.user_block ? [json.user_block] : json.user_blocks) || []) as any[];
    if (user_blocks.length && filter.has('user_block')) {
      for (const obj of user_blocks) {
        const parsed = this._parseUserBlock(obj);
        if (parsed) {
          results.data.push(parsed);
        }
      }
    }

    // 'preferences'
    if (isObject(json.preferences) && filter.has('preferences')) {
      const parsed = this._parsePreferences(json.preferences);
      if (parsed) {
        results.data.push(parsed);
      }
    }

    return results;
  }


  /**
   * Parse the given `node` object.
   * @param   obj - the source object
   * @param   id  - the OSM nodeID (e.g. 'n1')
   * @return  Object of parsed properties
   */
  protected _parseNode(obj: any, id: string): ParsedNode {
    const props: any = {
      type: 'node',
      id: id,
      visible: obj.visible ?? true,
      tags: obj.tags || {},
      loc: [ obj.lon, obj.lat ]
    };

    copyProps(props, obj);  // grab everything else
    delete props.lon;  // except these
    delete props.lat;

    return props as ParsedNode;
  }


  /**
   * Parse the given `way` object.
   * @param   obj - the source object
   * @param   id  - the OSM wayID (e.g. 'w1')
   * @return  Object of parsed properties
   */
  protected _parseWay(obj: any, id: string): ParsedWay {
    const props: any = {
      type: 'way',
      id: id,
      visible: obj.visible ?? true,
      tags: obj.tags || {},
      nodes: (obj.nodes || []).map((nodeId: number) => `n${nodeId}`)
    };

    copyProps(props, obj);  // grab everything else
    return props as ParsedWay;
  }


  /**
   * Parse the given `relation` object.
   * @param   obj - the source object
   * @param   id  - the OSM relationID (e.g. 'r1')
   * @return  Object of parsed properties
   */
  protected _parseRelation(obj: any, id: string): ParsedRelation {
    const props: any = {
      type: 'relation',
      id: id,
      visible: obj.visible ?? true,
      tags: obj.tags || {},
      members: (obj.members || []).map((member: any) => {
        return {
          id: member.type[0] + member.ref,
          type: member.type,
          role: member.role
        };
      })
    };

    copyProps(props, obj);  // grab everything else
    return props as ParsedRelation;
  }


  /**
   * Parse the given `changeset` object.
   * @param   obj - the source object
   * @param   id  - the OSM changesetID (e.g. 'c1')
   * @return  Object of parsed properties
   */
  protected _parseChangeset(obj: any, id: string): ParsedChangeset {
    const props: any = {
      type: 'changeset',
      id: id,
      tags: obj.tags || {}
    };

    // parse changeset comments, if any
    if (Array.isArray(obj.comments)) {
      props.comments = this._parseComments(obj.comments);
    }

    copyProps(props, obj);  // grab everything else
    return props as ParsedChangeset;
  }


  /**
   * Parse the given `note` object.
   * @param   obj - the source object
   * @return  Object of parsed properties
   */
  protected _parseNote(obj: any): ParsedNote {
    const props: any = {
      type: 'note',
      loc: obj.geometry.coordinates
    };

    // parse note comments, if any
    if (Array.isArray(obj.properties.comments)) {
      props.comments = this._parseComments(obj.properties.comments);
    }

    copyProps(props, obj.properties);  // grab everything else
    return props as ParsedNote;
  }


  /**
   * This parses comments found in notes and changesets under the `comments` Array property.
   * @param   comments - Array of source comments
   * @return  Array of parsed comments
   */
  protected _parseComments(comments: any[]): ParsedComment[] {
    return comments.map(obj => {
      const props: any = {
        visible: obj.visible ?? true
      };
      copyProps(props, obj);
      return props as ParsedComment;
    });
  }


  /**
   * Parse the given `user` object.
   * @param   obj - the source object
   * @param   id  - the user ID (e.g. 'user1')
   * @return  Object of parsed properties
   */
  protected _parseUser(obj: any, id: string): ParsedUser {
    const props: any = { type: 'user' };
    copyProps(props, obj);

    if (!props.roles) {  // make sure this property always exists
      props.roles = [];
    }

    return props as ParsedUser;
  }


  /**
   * Parse the given `user_block` object.
   * @param   obj - the source object
   * @return  Object of parsed properties
   */
  protected _parseUserBlock(obj: any): ParsedUserBlock {
    const props: any = { type: 'user_block' };
    copyProps(props, obj);

    if (!props.reason) {  // make sure this property always exists
      props.reason = '';
    }

    return props as ParsedUserBlock;
  }


  /**
   * Parse the given `preferences` object.
   * @param   obj - the source object
   * @return  Object of parsed properties
   */
  protected _parsePreferences(obj: any): ParsedPreferences {
    const props: ParsedPreferences = {
      type: 'preferences',
      preferences: obj
    };

    return props;
  }


  /**
   * Parse the given `api` object.
   * @param   obj - the source object
   * @return  Object of parsed properties
   */
  protected _parseApi(obj: any): ParsedApi {
    const props: any = { type: 'api' };
    copyProps(props, obj);
    return props as ParsedApi;
  }


  /**
   * Parse the given `policy` object.
   * @param   obj - the source object
   * @return  Object of parsed properties
   */
  protected _parsePolicy(obj: any): ParsedPolicy {
    const props: ParsedPolicy = { type: 'policy' };

    const blacklist = obj?.imagery?.blacklist;
    if (Array.isArray(blacklist)) {
      props.imagery = { blacklist: [] };

      for (const item of blacklist) {
        const regex = item.regex;  // needs unencode?
        if (typeof regex === 'string') {
          try {
            props.imagery.blacklist.push(new RegExp(regex));
          } catch (e) {
            /* noop */
          }
        }
      }
    }

    return props;
  }


  /**
   * Parse the given `bounds` object.
   * @param   obj - the source object
   * @return  Object of parsed properties
   */
  protected _parseBounds(obj: any): ParsedBounds {
    return Object.assign({ type: 'bounds' } as ParsedBounds, obj);
  }

}


// Helper functions.
// Can c8 ignore these.. Some of the codepaths in here
// are things we would never see in practice..
/* c8 ignore start */

/**
 * Is the given thing an Object?
 *
 * This is better than `typeof val === 'object'` because it returns
 * correct result for Arrays and `null`.  It doesn't catch protoless Objects
 * created with `Object.create(null)` but we don't care about that.
 * @param   val - the thing to test
 * @return  `true` if it's an Object, `false` if not
 */
function isObject(val: unknown): val is Record<string, unknown> {
  return (val as any)?.constructor?.name === 'Object';
}


/**
 * Copies the properties from source to destination.
 * While doing so, try to stringify `id` properties and unstringify other properties.
 * @param   dst - the destination Object
 * @param   src - the source Object
 * @return  the destination Object
 */
function copyProps(dst: Record<string, any>, src: Record<string, any>): Record<string, any> {
  for (const [k, v] of Object.entries(src)) {
    if (Object.hasOwn(dst, k)) continue;  // don't overwrite an existing property
    if (k === 'id' || k === 'uid') {   // ids should remain strings
      dst[k] = v.toString();
    } else {
      dst[k] = unstringify(v);
    }
  }
  return dst;
}


/**
 * This will attempt to clean up and cast strings to a better type if possible.
 * We aren't going to overthink this, just handle a few simple cases.
 * @param   val - the source value
 * @return  result value
 */
function unstringify(val: unknown): unknown {
  if (isObject(val)) {    // if we were passed an object, unstringify whatever is in it.
    for (const [k, v] of Object.entries(val)) {
      if (k === 'id' || k === 'uid') {  // ids should remain strings
        val[k] = (v as any).toString();
      } else {
        val[k] = unstringify(v);
      }
    }
  }
  if (typeof val !== 'string') {
    return val;
  }

  const s = val.trim();
  if (/^[+-]?\d+$/.test(s)) {   // integers
    return parseInt(s, 10);
  } else if (/^[+-]?\d*\.\d*([Ee][+-]?\d+)?$/.test(s) && s !== '.') {   // floats
    return parseFloat(s);
  } else if (/^true$/i.test(s)) {   // true
    return true;
  } else if (/^false$/i.test(s)) {   // false
    return false;
  } else if (/^null$/i.test(s)) {   // null
    return null;
  } else if (/^undefined$/i.test(s)) {   // undefined
    return undefined;
  } else if (/^\d{4}/.test(s)) {   // starts with 4 digits
    const d = new Date(s);         // could it be a Date?
    if (isFinite(d.getTime())) {
      return d;
    }
  }

  return s;
}
/* c8 ignore end */
