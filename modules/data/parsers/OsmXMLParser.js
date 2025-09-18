import { DOMParser } from '@xmldom/xmldom';


// Some helper functions to deal with legacy DOM API types.

/**
 * getAttributes
 * Attributes are stored as a `NamedNodeMap` which is not iterable in a modern way.
 * This returns the attributes as a normal JavaScript Object.
 * @see     https://developer.mozilla.org/en-US/docs/Web/API/NamedNodeMap
 * @param   {DOMNamedNodeMap}  attributes - the attributes to convert
 * @return  {Object}           A JavaScript Object
 */
function getAttributes(node) {
  const result = {};
  if (!node || !node.attributes) return result;

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
  if (!node || !node.childNodes) return [];
  return Array.from(node.childNodes);
}


/**
 * OsmXMLParser
 * This class contains the code for parsing OSM XML content.
 * @see https://wiki.openstreetmap.org/wiki/OSM_XML
 * Note that OSM XML data can contain slightly different syntax and attributes.
 *
 * Calling code should call `parseAsync` with the content to parse.
 * `parseAsync` returns a Promise either rejected with an error or resolved with
 * whatever valid data was found in the content.
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

    this._parseBounds = this._parseBounds.bind(this);
    this._parseNode = this._parseNode.bind(this);
    this._parseWay = this._parseWay.bind(this);
    this._parseRelation = this._parseRelation.bind(this);
    this._parseNote = this._parseNote.bind(this);
    this._parseUser = this._parseUser.bind(this);
    this._parsePreferences = this._parsePreferences.bind(this);
  }


  /**
   * reset
   * Call reset to clear the caches.
   */
  reset() {
    this._seen.clear();
  }


  /**
   * parseAsync
   * Parse the given content and extract whatatever OSM data we find in it.
   * Note: This really doesn't need to be async, but I made it this way because
   *  the code is expected to send its result to older errback-style callbacks.
   * @param   {Object|string}  content - the content to parse
   * @param   {Object}         options - parsing options
   * @return  {Promise}  Promise resolved with results of parsed data, or rejected with error.
   */
  parseAsync(content, options = {}) {
    options.skipSeen ??= true;

    return new Promise((resolve, reject) => {
      if (!content)  {
        reject(new Error('No content'));
        return;
      }

      // Note: I'd like to try to find a way to avoid seenIDs, See note in EditSystem.merge()..
      const results = { osm: {}, data: [], seenIDs: new Set() };
      const xml = (typeof content === 'string' ? new DOMParser().parseFromString(content, 'application/xml') : content);

      if (!xml?.childNodes) {
        reject(new Error('No XML'));
        return;
      }

      const osmElement = Array.from(xml.childNodes).find(child => child.nodeName === 'osm');
      if (!osmElement?.childNodes) {
        reject(new Error('No OSM Element'));
        return;
      }

      // Collect metadata
      Object.assign(results.osm, getAttributes(osmElement));

      // Collect children of the osm element
      const children = getChildNodes(osmElement);

      // Sometimes an error can be present alongside other elements - Rapid#501
      const errElement = children.find(child => child.nodeName === 'error');
      if (errElement) {
        const message = errElement.textContent || 'unknown error';
        reject(new Error(`Partial Response: ${message}`));
        return;
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

        } else if (child.nodeName === 'note') {
          id = 'note' + child.getElementsByTagName('id')[0].textContent;
          parser = this._parseNote;

        } else if (child.nodeName === 'user') {
          id = 'user' + child.attributes.getNamedItem('id').value;
          parser = this._parseUser;

        } else if (child.nodeName === 'preferences') {
          parser = this._parsePreferences;

        } else if (child.nodeName === 'changeset') {
          parser = this._parseChangeset;

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

      resolve(results);
      return;
    });
  }


  /**
   * _parseBounds
   * Parse the given `<bounds>` element.
   * @param   {DOMNode}  xml - the DOM element
   * @return  {Object}   Object of parsed properties
   */
  _parseBounds(xml) {
    const attrs = getAttributes(xml);
    return {
      type: 'bounds',
      minlat: parseFloat(attrs.minlat),
      minlon: parseFloat(attrs.minlon),
      maxlat: parseFloat(attrs.maxlat),
      maxlon: parseFloat(attrs.maxlon)
    };
  }


  /**
   * _parseNode
   * Parse the given `<node>` element.
   * @param   {DOMNode}  xml - the DOM node
   * @param   {string}   id  - the OSM nodeID (e.g. 'n1')
   * @return  {Object}   Object of parsed properties
   */
  _parseNode(xml, id) {
    const attrs = getAttributes(xml);
    const props = {
      type: 'node',
      id: id,
      visible: (!attrs.visible || attrs.visible !== 'false'),
      tags: this._getTags(xml),
      loc: [ parseFloat(attrs.lon), parseFloat(attrs.lat) ]
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
    const attrs = getAttributes(xml);
    const props = {
      type: 'way',
      id: id,
      visible: (!attrs.visible || attrs.visible !== 'false'),
      tags: this._getTags(xml),
      nodes: this._getNodes(xml)
    };

    for (const [k, v] of Object.entries(attrs)) {  // grab everything else
      if (props.hasOwnProperty(k)) continue;
      props[k] = v;
    }
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
    const attrs = getAttributes(xml);
    const props = {
      type: 'relation',
      id: id,
      visible: (!attrs.visible || attrs.visible !== 'false'),
      tags: this._getTags(xml),
      members: this._getMembers(xml)
    };

    for (const [k, v] of Object.entries(attrs)) {  // grab everything else
      if (props.hasOwnProperty(k)) continue;
      props[k] = v;
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
    const attrs = getAttributes(xml);
    const childNodes = getChildNodes(xml);

    const props = {
      type: 'note',
      loc: [ parseFloat(attrs.lon), parseFloat(attrs.lat) ]
    };

    // parse note contents
    for (const node of childNodes) {
      const nodeName = node.nodeName;
      if (nodeName === '#text') continue;

      if (nodeName === 'comments') {
        props.comments = this._parseComments(node.childNodes);
      } else if (!props.hasOwnProperty(nodeName)) {
        props[nodeName] = node.textContent;  // 'id', 'date_created', 'status', etc.
      }
    }

    return props;
  }


  /**
   * _parseUser
   * Parse the given `<user>` element.
   * @param   {DOMNode}  xml - the DOM node
   * @return  {Object}   Object of parsed properties
   */
  _parseUser(xml) {
    const attrs = getAttributes(xml);

    const props = {
      type: 'user'
    };

    for (const [k, v] of Object.entries(attrs)) {  // grab 'id', 'display_name', 'account_created'
      if (props.hasOwnProperty(k)) continue;
      props[k] = v;
    }

    const description = xml.getElementsByTagName('description')[0];
    if (description) {
      props.description = description.textContent
    }

    const contributor_terms = xml.getElementsByTagName('contributor-terms')[0];  // note the '-'!
    if (contributor_terms) {
      props.contributor_terms = getAttributes(contributor_terms);
    }

    const img = xml.getElementsByTagName('img')[0];
    if (img) {
      props.image_url = img.getAttribute('href');
    }

    const changesets = xml.getElementsByTagName('changesets')[0];
    if (changesets) {
      props.changesets = getAttributes(changesets);
    }

    const traces = xml.getElementsByTagName('traces')[0];
    if (traces) {
      props.traces = getAttributes(traces);
    }

    const blocks = xml.getElementsByTagName('blocks')[0];
    if (blocks) {
      props.blocks = {};
      const received = blocks.getElementsByTagName('received')[0];
      if (received) {
        props.blocks.received = getAttributes(received);
      }
    }

    const languages = xml.getElementsByTagName('languages')[0];
    if (languages) {
      props.languages = getChildNodes(languages).map(child => {
        if (child.nodeName === 'lang') {
          return child.textContent;
        } else {
          return null;
        }
      }).filter(Boolean);
    }

    const messages = xml.getElementsByTagName('messages')[0];
    if (messages) {
      props.messages = {};
      const received = messages.getElementsByTagName('received')[0];
      if (received) {
        props.messages.received = getAttributes(received);
      }
      const sent = messages.getElementsByTagName('sent')[0];
      if (sent) {
        props.messages.sent = getAttributes(sent);
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
  _parsePreferences(xml, callback) {
    const preferences = {};
    const preferenceElems = xml.getElementsByTagName('preference');

    for (let i = 0; i < preferenceElems.length; i++) {
      const elem = preferenceElems[i];
      const key = elem.getAttribute('k');
      const value = elem.getAttribute('v');
      if (key && value) {
        preferences[key] = value;
      }
    }

    callback(null, { data: preferences });
  }


  _getNodes(xml) {
    const elems = Array.from(xml.getElementsByTagName('nd'));
    return elems.map(elem => 'n' + elem.attributes.getNamedItem('ref').value);
  }


  _getTags(xml) {
    const elems = Array.from(xml.getElementsByTagName('tag'));
    let tags = {};
    for (const elem of elems) {
      const attrs = elem.attributes;
      const k = (attrs.getNamedItem('k')?.value ?? '').trim();
      const v = (attrs.getNamedItem('v')?.value ?? '').trim();
      if (k) {
        tags[k] = v;
      }
    }
    return tags;
  }


  _getMembers(xml) {
    const elems = Array.from(xml.getElementsByTagName('member'));
    return elems.map(elem => {
      const attrs = elem.attributes;
      return {
        id: attrs.getNamedItem('type').value[0] + attrs.getNamedItem('ref').value,
        type: attrs.getNamedItem('type').value,
        role: attrs.getNamedItem('role').value
      };
    });
  }

  _parseComments(comments) {
    let parsedComments = [];

    for (const comment of Array.from(comments)) {
      if (comment.nodeName === 'comment') {
        let parsedComment = {};

        for (const node of Array.from(comment.childNodes)) {
          const nodeName = node.nodeName;
          if (nodeName === '#text') continue;
          parsedComment[nodeName] = node.textContent;

          if (nodeName === 'uid') {
            // const uid = node.textContent;
            // if (uid && !this._userCache.user[uid]) {
              // this._userCache.toLoad.add(uid);
            // }
          }
        }

        if (Object.keys(parsedComment).length) {
          parsedComments.push(parsedComment);
        }
      }
    }
    return parsedComments;
  }



  _parseCapabilities(xml) {
    // Update blocklists
    const regexes = [];
    for (const element of xml.getElementsByTagName('blacklist')) {
      const regexString = element.getAttribute('regex');  // needs unencode?
      if (regexString) {
        try {
          regexes.push(new RegExp(regexString));
        } catch (e) {
          /* noop */
        }
      }
    }
    if (regexes.length) {
      this._imageryBlocklists = regexes;
    }

    // Update max nodes per way
    const waynodes = xml.getElementsByTagName('waynodes');
    const maxWayNodes = waynodes.length && parseInt(waynodes[0].getAttribute('maximum'), 10);
    if (maxWayNodes && isFinite(maxWayNodes)) {
      this._maxWayNodes = maxWayNodes;
    }

    // Return status
    const apiStatus = xml.getElementsByTagName('status');
    return apiStatus[0].getAttribute('api');   // 'online', 'readonly', or 'offline'
  }


}
