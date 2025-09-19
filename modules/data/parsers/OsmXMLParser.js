import { DOMParser } from '@xmldom/xmldom';


/**
 * OsmXMLParser
 * This class contains the code for parsing OSM XML content.
 * @see https://wiki.openstreetmap.org/wiki/OSM_XML
 * Note that OSM XML data can contain slightly different syntax and attributes.
 *
 * The job of this code is to convert the OSM XML into a JavaScript Object,
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
 *       id: 1,          // along with whatever other properties are present.
 *       lat: 40.6555,
 *       lon: -74.5415,
 *       …
 *     }, {
 *       type: 'way',
 *       id: 1,
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
export class OsmXMLParser {

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
    this._getTags = this._getTags.bind(this);
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
    options.skipSeen ??= true;

    if (!content)  {
      throw new Error('No content');
    }

    // Note: I'd like to try to find a way to avoid seenIDs, See note in EditSystem.merge()..
    const results = { osm: {}, data: [], seenIDs: new Set() };
    const xml = (typeof content === 'string' ? new DOMParser().parseFromString(content, 'application/xml') : content);

    if (!xml?.childNodes) {
      throw new Error('No XML');
    }

    const osmElement = Array.from(xml.childNodes).find(child => child.nodeName === 'osm');
    if (!osmElement?.childNodes) {
      throw new Error('No OSM Element');
    }

    // Collect metadata
    Object.assign(results.osm, getCleanAttributes(osmElement));

    // Collect children of the osm element
    const children = getChildNodes(osmElement);

    // Sometimes an error can be present alongside other elements - Rapid#501
    const errElement = children.find(child => child.nodeName === 'error');
    if (errElement) {
      const message = errElement.textContent || 'unknown error';
      throw new Error(`Partial Response: ${message}`);
    }

    for (const child of children) {
      let parser, id;

      if (child.nodeName === 'node') {
        id = 'n' + child.attributes.getNamedItem('id').value;
        results.seenIDs.add(id);
        parser = this._parseNode;

      } else if (child.nodeName === 'way') {
        id = 'w' + child.attributes.getNamedItem('id').value;
        results.seenIDs.add(id);
        parser = this._parseWay;

      } else if (child.nodeName === 'relation') {
        id = 'r' + child.attributes.getNamedItem('id').value;
        results.seenIDs.add(id);
        parser = this._parseRelation;

      } else if (child.nodeName === 'changeset') {
        id = 'c' + child.attributes.getNamedItem('id').value;
        results.seenIDs.add(id);
        parser = this._parseChangeset;

      } else if (child.nodeName === 'note') {
        id = 'note' + child.getElementsByTagName('id')[0].textContent;
        parser = this._parseNote;

      } else if (child.nodeName === 'user') {
        id = 'user' + child.attributes.getNamedItem('id').value;
        parser = this._parseUser;

      } else if (child.nodeName === 'preferences') {
        parser = this._parsePreferences;

      } else if (child.nodeName === 'api') {
        parser = this._parseApi;

      } else if (child.nodeName === 'policy') {
        parser = this._parsePolicy;

      } else if (child.nodeName === 'bounds') {
        parser = this._parseBounds;
      }

      if (!parser) continue;

      if (options.skipSeen && id !== undefined) {  // skip things we've seen before
        if (this._seen.has(id)) continue;
        this._seen.add(id);
      }

      const parsed = parser(child, id);
      if (parsed) {
        results.data.push(parsed);
      }
    }

    return results;
  }


  /**
   * _parseNode
   * Parse the given `<node>` element.
   * @param   {DOMNode}  xml - the DOM node
   * @param   {string}   id  - the OSM nodeID (e.g. 'n1')
   * @return  {Object}   Object of parsed properties
   */
  _parseNode(xml, id) {
    const attrs = getCleanAttributes(xml);
    const props = {
      type: 'node',
      id: id,
      visible: attrs.visible ?? true,
      tags: this._getTags(xml),
      loc: [ attrs.lon, attrs.lat ]
    };

    for (const [k, v] of Object.entries(attrs)) {  // grab everything else
      if (k === 'lon' || k === 'lat' || props.hasOwnProperty(k)) continue;
      props[k] = v;
    }
    return props;
  }


  /**
   * _parseWay
   * Parse the given `<way>` element.
   * @param   {DOMNode}  xml - the DOM node
   * @param   {string}   id  - the OSM wayID (e.g. 'w1')
   * @return  {Object}   Object of parsed properties
   */
  _parseWay(xml, id) {
    const attrs = getCleanAttributes(xml);
    const props = {
      type: 'way',
      id: id,
      visible: attrs.visible ?? true,
      tags: this._getTags(xml)
    };

    for (const [k, v] of Object.entries(attrs)) {  // grab everything else
      if (props.hasOwnProperty(k)) continue;
      props[k] = v;
    }

    // collect nodes
    const elems = Array.from(xml.getElementsByTagName('nd'));
    props.nodes = elems.map(elem => 'n' + elem.attributes.getNamedItem('ref').value);

    return props;
  }


  /**
   * _parseRelation
   * Parse the given `<relation>` element.
   * @param   {DOMNode}  xml - the DOM node
   * @param   {string}   id  - the OSM relationID (e.g. 'r1')
   * @return  {Object}   Object of parsed properties
   */
  _parseRelation(xml, id) {
    const attrs = getCleanAttributes(xml);
    const props = {
      type: 'relation',
      id: id,
      visible: attrs.visible ?? true,
      tags: this._getTags(xml)
    };

    for (const [k, v] of Object.entries(attrs)) {  // grab everything else
      if (props.hasOwnProperty(k)) continue;
      props[k] = v;
    }

    // collect members
    const elems = Array.from(xml.getElementsByTagName('member'));
    props.members = elems.map(elem => {
      const attrs = getRawAttributes(elem);
      return {
        id: attrs.type[0] + attrs.ref,
        type: attrs.type,
        role: attrs.role
      };
    });

    return props;
  }


  /**
   * _parseChangeset
   * Parse the given `<changeset>` element.
   * @param   {DOMNode}  xml - the DOM node
   * @param   {string}   id  - the OSM changesetID (e.g. 'c1')
   * @return  {Object}   Object of parsed properties
   */
  _parseChangeset(xml, id) {
    const attrs = getCleanAttributes(xml);
    const props = {
      type: 'changeset',
      id: id,
      tags: this._getTags(xml)
    };

    for (const [k, v] of Object.entries(attrs)) {  // grab everything else
      if (props.hasOwnProperty(k)) continue;
      props[k] = v;
    }

    // parse changeset discussion, if any
    const discussion = xml.getElementsByTagName('discussion')[0];
    if (discussion) {
      props.comments = this._parseComments(discussion);
    }

    return props;
  }


  /**
   * _parseNote
   * Parse the given `<note>` element.
   * @param   {DOMNode}  xml - the DOM node
   * @return  {Object}   Object of parsed properties
   */
  _parseNote(xml) {
    const attrs = getCleanAttributes(xml);
    const props = {
      type: 'note',
      loc: [ attrs.lon, attrs.lat ]
    };

    for (const [k, v] of Object.entries(attrs)) {  // grab everything else
      if (k === 'lon' || k === 'lat' || props.hasOwnProperty(k)) continue;
      props[k] = v;
    }

    // parse note contents
    const childNodes = getChildNodes(xml);
    for (const node of childNodes) {
      const nodeName = node.nodeName;
      if (nodeName === '#text') continue;

      if (nodeName === 'comments') {
        props.comments = this._parseComments(node);

      } else if (!props.hasOwnProperty(nodeName)) {  // 'id', 'date_created', 'status', etc.
        if (/date/.test(nodeName)) {
          props[nodeName] = unstringify(node.textContent);
        } else {
          props[nodeName] = node.textContent;
        }
      }
    }

    return props;
  }


  /**
   * _parseComments
   * This parses 2 kinds of comments:
   *  - `parseNote()`: comments in a `<comments>` element
   *  - `parseChangeset()`: comments in a `<discussion>` element
   * @param   {DOMNode}        xml - the DOM node
   * @return  {Array<Object>}  Array of parsed comments
   */
  _parseComments(xml) {
    let results = [];

    const comments = Array.from(xml.getElementsByTagName('comment'));
    for (const comment of comments) {
      // collect attributes
      const attrs = getCleanAttributes(comment);
      const props = {
        visible: attrs.visible ?? true
      };

      for (const [k, v] of Object.entries(attrs)) {
        // if (props.hasOwnProperty(k)) continue;  // can't happen, no props to overwrite
        props[k] = v;
      }

      // collect children
      for (const node of getChildNodes(comment)) {
        const nodeName = node.nodeName;
        if (nodeName === '#text') continue;

        if (/(date|uid)/.test(nodeName)) {
          props[nodeName] = unstringify(node.textContent);
        } else {
          props[nodeName] = node.textContent;
        }
      }

      if (Object.keys(props).length) {
        results.push(props);
      }
    }

    return results;
  }


  /**
   * _parseUser
   * Parse the given `<user>` element.
   * @param   {DOMNode}  xml - the DOM node
   * @return  {Object}   Object of parsed properties
   */
  _parseUser(xml) {
    const props = {
      type: 'user'
    };

    const attrs = getCleanAttributes(xml);
    for (const [k, v] of Object.entries(attrs)) {  // grab 'id', 'display_name', 'account_created'
      if (props.hasOwnProperty(k)) continue;
      props[k] = v;
    }

    const description = xml.getElementsByTagName('description')[0];
    if (description) {
      props.description = description.textContent;
    }

    const contributor_terms = xml.getElementsByTagName('contributor-terms')[0];  // note the '-'!
    if (contributor_terms) {
      props.contributor_terms = getCleanAttributes(contributor_terms);
    }

    const img = xml.getElementsByTagName('img')[0];
    if (img) {
      const href = img.getAttribute('href');
      if (href) {
        props.image_url = href;
      }
    }

    const roles = xml.getElementsByTagName('roles')[0];
    if (roles) {
      props.roles = getChildNodes(roles).map(child => {
        return (child.nodeName !== '#text') ? child.nodeName : null;
      }).filter(Boolean);
    } else {
      props.roles = [];
    }

    const changesets = xml.getElementsByTagName('changesets')[0];
    if (changesets) {
      props.changesets = getCleanAttributes(changesets);
    }

    const traces = xml.getElementsByTagName('traces')[0];
    if (traces) {
      props.traces = getCleanAttributes(traces);
    }

    const blocks = xml.getElementsByTagName('blocks')[0];
    if (blocks) {
      props.blocks = {};
      const received = blocks.getElementsByTagName('received')[0];
      if (received) {
        props.blocks.received = getCleanAttributes(received);
      }
    }

    const home = xml.getElementsByTagName('home')[0];
    if (home) {
      props.home = getCleanAttributes(home);
    }

    const languages = xml.getElementsByTagName('languages')[0];
    if (languages) {
      const langs = Array.from(languages.getElementsByTagName('lang'));
      props.languages = langs.map(lang => lang.textContent).filter(Boolean);
    }

    const messages = xml.getElementsByTagName('messages')[0];
    if (messages) {
      props.messages = {};
      const received = messages.getElementsByTagName('received')[0];
      if (received) {
        props.messages.received = getCleanAttributes(received);
      }
      const sent = messages.getElementsByTagName('sent')[0];
      if (sent) {
        props.messages.sent = getCleanAttributes(sent);
      }
    }

    return props;
  }


  /**
   * _parsePreferences
   * Parse the given `<preferences>` element.
   * @param   {DOMNode}  xml - the DOM node
   * @return  {Object}   Object of parsed properties
   */
  _parsePreferences(xml) {
    const props = {
      type: 'preferences',
      preferences: {}
    };

    // very similar to tags
    const elems = Array.from(xml.getElementsByTagName('preference'));
    for (const elem of elems) {
      const attrs = getRawAttributes(elem);
      const k = (attrs.k ?? '').trim();
      const v = (attrs.v ?? '').trim();
      if (k) {
        props.preferences[k] = v;
      }
    }

    return props;
  }


  /**
   * _parseApi
   * Parse the given `<api>` element.
   * @param   {DOMNode}  xml - the DOM element
   * @return  {Object}   Object of parsed properties
   */
  _parseApi(xml) {
    const props = { type: 'api' };

    for (const node of getChildNodes(xml)) {
      if (node.nodeName === '#text') continue;
      props[node.nodeName] = getCleanAttributes(node);
    }

    return props;
  }


  /**
   * _parsePolicy
   * Parse the given `<policy>` element.
   * @param   {DOMNode}  xml - the DOM element
   * @return  {Object}   Object of parsed properties
   */
  _parsePolicy(xml) {
    const props = { type: 'policy' };

    const imagery = xml.getElementsByTagName('imagery')[0];
    if (imagery) {
      props.imagery = { blacklist: [] };

      for (const element of Array.from(imagery.getElementsByTagName('blacklist'))) {
        const regexString = element.getAttribute('regex');  // needs unencode?
        if (regexString) {
          try {
            props.imagery.blacklist.push(new RegExp(regexString));
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
   * Parse the given `<bounds>` element.
   * @param   {DOMNode}  xml - the DOM element
   * @return  {Object}   Object of parsed properties
   */
  _parseBounds(xml) {
    return Object.assign({ type: 'bounds' }, getCleanAttributes(xml));
  }


  /**
   * _getTags
   * Several functions call this to gather tag data.
   * @param   {DOMNode}  xml - the containing DOM node
   * @return  {Object}   Object of tag k-v pairs
   */
  _getTags(xml) {
    const elems = Array.from(xml.getElementsByTagName('tag'));
    const tags = {};
    for (const elem of elems) {
      const attrs = getRawAttributes(elem);
      const k = (attrs.k ?? '').trim();
      const v = (attrs.v ?? '').trim();
      if (k) {
        tags[k] = v;
      }
    }

    return tags;
  }

}


// Helper functions.
// Can c8 ignore these.. Some of the codepaths in here
// are things we would never see in practice..
/* c8 ignore start */

/**
 * getCleanAttributes
 * Attributes are stored as a `NamedNodeMap` which is not iterable in a modern way.
 * This returns the attributes as a normal JavaScript Object.
 * "clean" means we will attempt to unstringify the attribute values.
 * @see     https://developer.mozilla.org/en-US/docs/Web/API/NamedNodeMap
 * @param   {DOMNamedNodeMap}  attributes - the attributes to convert
 * @return  {Object}           An Object containing the k-v attribute pairs
 */
function getCleanAttributes(node) {
  const result = {};
  if (!node?.attributes) return result;

  for (const attr of Array.from(node.attributes)) {
    result[attr.nodeName] = unstringify(attr.nodeValue);
  }
  return result;
}

/**
 * getRawAttributes
 * Attributes are stored as a `NamedNodeMap` which is not iterable in a modern way.
 * This returns the attributes as a normal JavaScript Object.
 * "raw" means we will NOT attempt to unstringify the attribute values.
 * @see     https://developer.mozilla.org/en-US/docs/Web/API/NamedNodeMap
 * @param   {DOMNamedNodeMap}  attributes - the attributes to convert
 * @return  {Object}           An Object containing the k-v attribute pairs
 */
function getRawAttributes(node) {
  const result = {};
  if (!node?.attributes) return result;

  for (const attr of Array.from(node.attributes)) {
    result[attr.nodeName] = attr.nodeValue;
  }
  return result;
}

/**
 * getChildNodes
 * ChildNodes are stored as a `NodeList` which is not iterable in a modern way.
 * This returns the childNodes as a normal JavaScript Array.
 * @see     https://developer.mozilla.org/en-US/docs/Web/API/NodeList
 * @param   {DOMNode}         node - the node to get childNodes for
 * @return  {Array<DOMNode>}  An Array of childnodes
 */
function getChildNodes(node) {
  if (!node?.childNodes) return [];
  return Array.from(node.childNodes);
}

/**
 * unstringify
 * All the source xml data arrives as strings.
 * This will attempt to clean it up and cast it to a better type if possible.
 * We aren't going to overthink this, just handle a few simple cases.
 * @param   {string}  s - the source string
 * @return  {*}       result value
 */
function unstringify(s) {
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
