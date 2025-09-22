
/**
 * OsmJSONParser
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
 *  'note',
 *  'user',
 *  'preferences',
 *  'changeset',
 *  'api', 'policy'  (returned from the `/capabilities` API call)
 *  'bounds'         (returned with the `/map` API call)
 */
export class OsmJSONParser {

  /**
   * @constructor
   */
  constructor() {
    this._seen = new Set();   // Set<string>  (unique identifers)

    this._parseNode = this._parseNode.bind(this);
    this._parseWay = this._parseWay.bind(this);
    this._parseRelation = this._parseRelation.bind(this);
    this._parseNote = this._parseNote.bind(this);
    this._parseComments = this._parseComments.bind(this);
    this._parseUser = this._parseUser.bind(this);
    this._parsePreferences = this._parsePreferences.bind(this);
    this._parseChangeset = this._parseChangeset.bind(this);
    this._parseApi = this._parseApi.bind(this);
    this._parsePolicy = this._parsePolicy.bind(this);
    this._parseBounds = this._parseBounds.bind(this);
  }


  /**
   * reset
   * Call reset to clear the caches.
   */
  reset() {
    this._seen.clear();
  }


  /**
   * parse
   * Parse the given content and extract whatatever OSM data we find in it.
   * @param   {Object|string}  content - the content to parse
   * @param   {Object}         options - parsing options
   * @return  {Object}   Result object containing the information parsed
   * @throws  Will throw if nothing could be parsed, or errors found
   */
  parse(content, options = {}) {
    options.skipSeen ??= true;       // exclude results that we have seen before
    options.onlyElements ??= false;  // include only elements in the results

    if (!content)  {
      throw new Error('No content');
    }

    const results = { osm: {}, data: [], seenIDs: new Set() };
    const json = (typeof content === 'string' ? JSON.parse(content) : content);

    if (!isObject(json)) {
      throw new Error('No JSON');
    }

    // 'notes'
    // We're going to handle these first because they are the exception.
    // OSM Notes data will look like GeoJSON.
    let notes;
    if (json.type === 'Feature') {  // a single note
      notes = [json];
    } else if (json.type === 'FeatureCollection' && Array.isArray(json.features)) {
      notes = json.features;
    }
    if (notes) {
      if (!options.onlyElements) {
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
      if (json.hasOwnProperty(prop)) {
        results.osm[prop] = unstringify(json[prop]);
      }
    }

    // 'api'
    if (!options.onlyElements && isObject(json.api)) {
      const parsed = this._parseApi(json.api);
      if (parsed) {
        results.data.push(parsed);
      }
    }

    // 'policy'
    if (!options.onlyElements && isObject(json.policy)) {
      const parsed = this._parsePolicy(json.policy);
      if (parsed) {
        results.data.push(parsed);
      }
    }

    // 'bounds'
    if (!options.onlyElements && isObject(json.bounds)) {
      const parsed = this._parseBounds(json.bounds);
      if (parsed) {
        results.data.push(parsed);
      }
    }

    // Elements ('node', 'way', 'relation')
    const elements = json.elements || [];
    if (elements.length) {
      // Sometimes an error can be present alongside other elements - Rapid#501
      const errElement = elements.find(obj => obj.type === 'error');
      if (errElement) {
        const message = errElement.message || 'unknown error';
        throw new Error(`Partial Response: ${message}`);
      }

      for (const obj of elements) {
        let parser, id;

        if (obj.type === 'node') {
          id = 'n' + obj.id;
          results.seenIDs.add(id);
          parser = this._parseNode;

        } else if (obj.type === 'way') {
          id = 'w' + obj.id;
          results.seenIDs.add(id);
          parser = this._parseWay;

        } else if (obj.type === 'relation') {
          id = 'r' + obj.id;
          results.seenIDs.add(id);
          parser = this._parseRelation;
        }

        if (!parser) continue;

        if (options.skipSeen) {  // skip things we've seen before
          if (this._seen.has(id)) continue;
          this._seen.add(id);
        }

        const parsed = parser(obj, id);
        if (parsed) {
          results.data.push(parsed);
        }
      }
    }

    // 'users'
    const users = (json.user ? [json.user] : json.users) || [];
    if (!options.onlyElements && users.length) {
      for (const obj of users) {
        const id = 'user' + obj.id;

        if (options.skipSeen) {  // skip things we've seen before
          if (this._seen.has(id)) continue;
          this._seen.add(id);
        }

        const parsed = this._parseUser(obj, id);
        if (parsed) {
          results.data.push(parsed);
        }
      }
    }

    // 'changesets'
    const changesets = (json.changeset ? [json.changeset] : json.changesets) || [];
    if (!options.onlyElements && changesets.length) {
      for (const obj of changesets) {
        const id = 'c' + obj.id;

        if (options.skipSeen) {  // skip things we've seen before
          if (this._seen.has(id)) continue;
          this._seen.add(id);
        }

        const parsed = this._parseChangeset(obj, id);
        if (parsed) {
          results.data.push(parsed);
        }
      }
    }

    // 'preferences'
    if (!options.onlyElements && isObject(json.preferences)) {
      const parsed = this._parsePreferences(json.preferences);
      if (parsed) {
        results.data.push(parsed);
      }
    }

    return results;
  }


  /**
   * _parseNode
   * Parse the given `node` object.
   * @param   {Object}  obj - the source object
   * @param   {string}  id  - the OSM nodeID (e.g. 'n1')
   * @return  {Object}  Object of parsed properties
   */
  _parseNode(obj, id) {
    const props = {
      type: 'node',
      id: id,
      visible: obj.visible ?? true,
      tags: obj.tags || {},
      loc: [ obj.lon, obj.lat ]
    };

    copyProps(props, obj);  // grab everything else
    delete props.lon;  // except these
    delete props.lat;

    return props;
  }


  /**
   * _parseWay
   * Parse the given `way` object.
   * @param   {Object}  obj - the source object
   * @param   {string}  id  - the OSM wayID (e.g. 'w1')
   * @return  {Object}  Object of parsed properties
   */
  _parseWay(obj, id) {
    const props = {
      type: 'way',
      id: id,
      visible: obj.visible ?? true,
      tags: obj.tags || {},
      nodes: (obj.nodes || []).map(id => `n${id}`)
    };

    copyProps(props, obj);  // grab everything else
    return props;
  }


  /**
   * _parseRelation
   * Parse the given `relation` object.
   * @param   {Object}  obj - the source object
   * @param   {string}  id  - the OSM relationID (e.g. 'r1')
   * @return  {Object}  Object of parsed properties
   */
  _parseRelation(obj, id) {
    const props = {
      type: 'relation',
      id: id,
      visible: obj.visible ?? true,
      tags: obj.tags || {},
      members: (obj.members || []).map(member => {
        return {
          id: member.type[0] + member.ref,
          type: member.type,
          role: member.role
        };
      })
    };

    copyProps(props, obj);  // grab everything else
    return props;
  }


  /**
   * _parseChangeset
   * Parse the given `changeset` object.
   * @param   {Object}  obj - the source object
   * @param   {string}  id  - the OSM changesetID (e.g. 'c1')
   * @return  {Object}  Object of parsed properties
   */
  _parseChangeset(obj, id) {
    const props = {
      type: 'changeset',
      id: id,
      tags: obj.tags || {}
    };

    // parse changeset comments, if any
    if (Array.isArray(obj.comments)) {
      props.comments = this._parseComments(obj.comments);
    }

    copyProps(props, obj);  // grab everything else
    return props;
  }


  /**
   * _parseNote
   * Parse the given `note` object.
   * @param   {Object}  obj - the source object
   * @return  {Object}  Object of parsed properties
   */
  _parseNote(obj) {
    const props = {
      type: 'note',
      loc: obj.geometry.coordinates
    };

    // parse note comments, if any
    if (Array.isArray(obj.properties.comments)) {
      props.comments = this._parseComments(obj.properties.comments);
    }

    copyProps(props, obj.properties);  // grab everything else
    return props;
  }


  /**
   * _parseComments
   * This parses comments found in notes and changesets under the `comments` Array property.
   * @param   {Array<Object>}  comments - Array of source comments
   * @return  {Array<Object>}  Array of parsed comments
   */
  _parseComments(comments) {
    return comments.map(obj => {
      const props = {
        visible: obj.visible ?? true
      };
      copyProps(props, obj);
      return props;
    });
  }


  /**
   * _parseUser
   * Parse the given `user` object.
   * @param   {Object}  obj - the source object
   * @return  {Object}  Object of parsed properties
   */
  _parseUser(obj) {
    const props = { type: 'user' };
    copyProps(props, obj);

    if (!props.roles) {  // make sure this property always exists
      props.roles = [];
    }

    return props;
  }


  /**
   * _parsePreferences
   * Parse the given `preferences` object.
   * @param   {Object}  obj - the source object
   * @return  {Object}  Object of parsed properties
   */
  _parsePreferences(obj) {
    const props = {
      type: 'preferences',
      preferences: obj
    };

    return props;
  }


  /**
   * _parseApi
   * Parse the given `api` object.
   * @param   {Object}  obj - the source object
   * @return  {Object}  Object of parsed properties
   */
  _parseApi(obj) {
    const props = { type: 'api' };
    copyProps(props, obj);
    return props;
  }


  /**
   * _parsePolicy
   * Parse the given `policy` object.
   * @param   {Object}  obj - the source object
   * @return  {Object}  Object of parsed properties
   */
  _parsePolicy(obj) {
    const props = { type: 'policy' };

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
   * _parseBounds
   * Parse the given `bounds` object.
   * @param   {Object}  obj - the source object
   * @return  {Object}  Object of parsed properties
   */
  _parseBounds(obj) {
    return Object.assign({ type: 'bounds' }, obj);
  }

}


// Helper functions.
// Can c8 ignore these.. Some of the codepaths in here
// are things we would never see in practice..
/* c8 ignore start */

/**
 * isObject
 * Is the given thing an Object?
 *
 * This is better than `typeof val === 'object'` because it returns
 * correct result for Arrays and `null`.  It doesn't catch protoless Objects
 * created with `Object.create(null)` but we don't care about that.
 * @param   {*}        val - the thing to test
 * @return  {boolean}  `true` if it's an Object, `false` if not
 */
function isObject(val) {
  return val?.constructor?.name === 'Object';
}


/**
 * copyProps
 * Copies the properties from source to destination.
 * While doing so, try to stringify `id` properties and unstringify other properties.
 * @param   {Object}  dst - the destination Object
 * @param   {Object}  src - the source Object
 * @return  {Object}  the destination Object
 */
function copyProps(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (dst.hasOwnProperty(k)) continue;  // don't overwrite an existing property
    if (k === 'id' || k === 'uid') {   // ids should remain strings
      dst[k] = v.toString();
    } else {
      dst[k] = unstringify(v);
    }
  }
  return dst;
}


/**
 * unstringify
 * This will attempt to clean up and cast strings to a better type if possible.
 * We aren't going to overthink this, just handle a few simple cases.
 * @param   {string}  s - the source string
 * @return  {*}       result value
 */
function unstringify(s) {
  if (isObject(s)) {    // if we were passed an object, unstringify whatever is in it.
    for (const [k, v] of Object.entries(s)) {
      if (k === 'id' || k === 'uid') {  // ids should remain strings
        s[k] = v.toString();
      } else {
        s[k] = unstringify(v);
      }
    }
  }
  if (typeof s !== 'string') {
    return s;
  }

  s = s.trim();
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
    if (isFinite(d)) {
      return d;
    }
  }

  return s;
}
/* c8 ignore end */
