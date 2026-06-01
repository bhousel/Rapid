import { DOMParser } from '@xmldom/xmldom';

import type { Document as XmlDocument } from '@xmldom/xmldom';
import type {
  ParserDataType,
  ParserOptions,
  ParserResult,
  ParsedApi,
  ParsedBounds,
  ParsedChangeset,
  ParsedComment,
  ParsedNode,
  ParsedPolicy,
  ParsedPreferences,
  ParsedRelation,
  ParsedNote,
  ParsedUser,
  ParsedUserBlock,
  ParsedWay,
} from './types.ts';
import type { OsmTags } from '../types.ts';


/**
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
export class OsmXMLParser {
  /** Unique identifiers already seen by this parser instance (avoids duplicates) */
  protected _seen: Set<string>;
  /** Accumulates the types of parsed data elements encountered (e.g. 'node', 'way', 'relation') */
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
    this._getTags = this._getTags.bind(this);

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
  public parse(content: XmlDocument | string, options: Partial<ParserOptions> = {}): ParserResult {
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

    // Note: I'd like to try to find a way to avoid seenIDs, See note in EditSystem.merge()..
    const results: ParserResult = { osm: {}, data: [], seenIDs: new Set() };
    const xml: XmlDocument = (typeof content === 'string' ? new DOMParser().parseFromString(content.trimStart(), 'application/xml') : content);

    if (!xml?.childNodes) {
      throw new Error('No XML');
    }

    const osmElement = Array.from(xml.childNodes).find(child => child.nodeName === 'osm') as Element | undefined;
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
      let parser: ((xml: Element, id: string) => any) | undefined;
      let id: string | undefined;

      if (child.nodeName === 'node' && filter.has('node')) {
        id = 'n' + (child as Element).getAttribute('id');
        results.seenIDs.add(id);
        parser = this._parseNode;

      } else if (child.nodeName === 'way' && filter.has('way')) {
        id = 'w' + (child as Element).getAttribute('id');
        results.seenIDs.add(id);
        parser = this._parseWay;

      } else if (child.nodeName === 'relation' && filter.has('relation')) {
        id = 'r' + (child as Element).getAttribute('id');
        results.seenIDs.add(id);
        parser = this._parseRelation;

      } else if (child.nodeName === 'changeset' && filter.has('changeset')) {
        id = 'c' + (child as Element).getAttribute('id');
        results.seenIDs.add(id);
        parser = this._parseChangeset;

      } else if (child.nodeName === 'note' && filter.has('note')) {
        id = 'note' + (child as Element).getElementsByTagName('id')[0]?.textContent;
        parser = this._parseNote;

      } else if (child.nodeName === 'user' && filter.has('user')) {
        id = 'user' + (child as Element).getAttribute('id');
        parser = this._parseUser;

      } else if (child.nodeName === 'user_block' && filter.has('user_block')) {
        parser = this._parseUserBlock;

      } else if (child.nodeName === 'preferences' && filter.has('preferences')) {
        parser = this._parsePreferences;

      } else if (child.nodeName === 'api' && filter.has('api')) {
        parser = this._parseApi;

      } else if (child.nodeName === 'policy' && filter.has('policy')) {
        parser = this._parsePolicy;

      } else if (child.nodeName === 'bounds' && filter.has('bounds')) {
        parser = this._parseBounds;
      }

      if (!parser) continue;

      if (skipSeen && id !== undefined) {  // skip things we've seen before
        if (this._seen.has(id)) continue;
        this._seen.add(id);
      }

      const parsed = parser(child as Element, id ?? '');
      if (parsed) {
        results.data.push(parsed);
      }
    }

    return results;
  }


  /**
   * Parse the given `<node>` element.
   * @param   xml - the DOM element
   * @param   id  - the OSM nodeID (e.g. 'n1')
   * @return  Object of parsed properties
   */
  protected _parseNode(xml: Element, id: string): ParsedNode {
    const attrs = getCleanAttributes(xml);
    const props: any = {
      type: 'node',
      id: id,
      visible: attrs.visible ?? true,
      tags: this._getTags(xml),
      loc: [ attrs.lon, attrs.lat ]
    };

    for (const [k, v] of Object.entries(attrs)) {  // grab everything else
      if (k === 'lon' || k === 'lat' || Object.hasOwn(props, k)) continue;
      props[k] = v;
    }
    return props as ParsedNode;
  }


  /**
   * Parse the given `<way>` element.
   * @param   xml - the DOM element
   * @param   id  - the OSM wayID (e.g. 'w1')
   * @return  Object of parsed properties
   */
  protected _parseWay(xml: Element, id: string): ParsedWay {
    const attrs = getCleanAttributes(xml);
    const props: any = {
      type: 'way',
      id: id,
      visible: attrs.visible ?? true,
      tags: this._getTags(xml)
    };

    for (const [k, v] of Object.entries(attrs)) {  // grab everything else
      if (Object.hasOwn(props, k)) continue;
      props[k] = v;
    }

    // collect nodes
    const elems = Array.from(xml.getElementsByTagName('nd'));
    props.nodes = elems.map(elem => 'n' + elem.getAttribute('ref'));

    return props as ParsedWay;
  }


  /**
   * Parse the given `<relation>` element.
   * @param   xml - the DOM element
   * @param   id  - the OSM relationID (e.g. 'r1')
   * @return  Object of parsed properties
   */
  protected _parseRelation(xml: Element, id: string): ParsedRelation {
    const attrs = getCleanAttributes(xml);
    const props: any = {
      type: 'relation',
      id: id,
      visible: attrs.visible ?? true,
      tags: this._getTags(xml)
    };

    for (const [k, v] of Object.entries(attrs)) {  // grab everything else
      if (Object.hasOwn(props, k)) continue;
      props[k] = v;
    }

    // collect members
    const elems = Array.from(xml.getElementsByTagName('member'));
    props.members = elems.map(elem => {
      const memberType = elem.getAttribute('type') || '';
      const memberRef = elem.getAttribute('ref') || '';
      const memberRole = elem.getAttribute('role') || '';
      return {
        id: memberType[0] + memberRef,
        type: memberType,
        role: memberRole
      };
    });

    return props as ParsedRelation;
  }


  /**
   * Parse the given `<changeset>` element.
   * @param   xml - the DOM element
   * @param   id  - the OSM changesetID (e.g. 'c1')
   * @return  Object of parsed properties
   */
  protected _parseChangeset(xml: Element, id: string): ParsedChangeset {
    const attrs = getCleanAttributes(xml);
    const props: any = {
      type: 'changeset',
      id: id,
      tags: this._getTags(xml)
    };

    for (const [k, v] of Object.entries(attrs)) {  // grab everything else
      if (Object.hasOwn(props, k)) continue;
      props[k] = v;
    }

    // parse changeset discussion, if any
    const discussion = xml.getElementsByTagName('discussion')[0];
    if (discussion) {
      props.comments = this._parseComments(discussion);
    }

    return props as ParsedChangeset;
  }


  /**
   * Parse the given `<note>` element.
   * @param   xml - the DOM element
   * @return  Object of parsed properties
   */
  protected _parseNote(xml: Element): ParsedNote {
    const attrs = getCleanAttributes(xml);
    const props: any = {
      type: 'note',
      loc: [ attrs.lon, attrs.lat ]
    };

    for (const [k, v] of Object.entries(attrs)) {  // grab everything else
      if (k === 'lon' || k === 'lat' || Object.hasOwn(props, k)) continue;
      props[k] = v;
    }

    // parse note contents
    const childNodes = getChildNodes(xml);
    for (const node of childNodes) {
      const nodeName = node.nodeName;
      if (nodeName === '#text') continue;

      if (nodeName === 'comments') {
        props.comments = this._parseComments(node as Element);

      } else if (!Object.hasOwn(props, nodeName)) {  // 'id', 'date_created', 'status', etc.
        if (/date/.test(nodeName)) {
          props[nodeName] = unstringify(node.textContent || '');
        } else {
          props[nodeName] = node.textContent;
        }
      }
    }

    return props as ParsedNote;
  }


  /**
   * This parses 2 kinds of comments:
   *  - `parseNote()`: comments in a `<comments>` element
   *  - `parseChangeset()`: comments in a `<discussion>` element
   * @param   xml - the DOM element
   * @return  Array of parsed comments
   */
  protected _parseComments(xml: Element): ParsedComment[] {
    const results: ParsedComment[] = [];

    const comments = Array.from(xml.getElementsByTagName('comment'));
    for (const comment of comments) {
      // collect attributes
      const attrs = getCleanAttributes(comment);
      const props: any = {
        visible: attrs.visible ?? true
      };

      for (const [k, v] of Object.entries(attrs)) {
        // if (Object.hasOwn(props, k)) continue;  // can't happen, no props to overwrite
        props[k] = v;
      }

      // collect children
      for (const node of getChildNodes(comment)) {
        const nodeName = node.nodeName;
        if (nodeName === '#text') continue;

        if (/date/.test(nodeName)) {
          props[nodeName] = unstringify(node.textContent || '');
        } else {
          props[nodeName] = node.textContent;
        }
      }

      if (Object.keys(props).length) {
        results.push(props as ParsedComment);
      }
    }

    return results;
  }


  /**
   * Parse the given `<user>` element.
   * @param   xml - the DOM element
   * @return  Object of parsed properties
   */
  protected _parseUser(xml: Element): ParsedUser {
    const props: any = { type: 'user' };

    const attrs = getCleanAttributes(xml);
    for (const [k, v] of Object.entries(attrs)) {  // grab 'id', 'display_name', 'account_created'
      if (Object.hasOwn(props, k)) continue;
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
      props.img = getCleanAttributes(img);
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

    return props as ParsedUser;
  }


  /**
   * Parse the given `<user_block>` element.
   * @param   xml - the DOM element
   * @return  Object of parsed properties
   */
  protected _parseUserBlock(xml: Element): ParsedUserBlock {
    const props: any = { type: 'user_block' };

    const attrs = getCleanAttributes(xml);
    for (const [k, v] of Object.entries(attrs)) {  // grab 'id', 'created_at', 'updated_at', etc.
      // if (Object.hasOwn(props, k)) continue;  // can't happen, no props to overwrite
      props[k] = v;
    }

    const user = xml.getElementsByTagName('user')[0];
    if (user) {
      props.user = getCleanAttributes(user);
    }

    const creator = xml.getElementsByTagName('creator')[0];
    if (creator) {
      props.creator = getCleanAttributes(creator);
    }

    const revoker = xml.getElementsByTagName('revoker')[0];
    if (revoker) {
      props.revoker = getCleanAttributes(revoker);
    }

    const reason = xml.getElementsByTagName('reason')[0];
    if (reason) {
      props.reason = reason.textContent;
    } else {
      props.reason = '';
    }

    return props as ParsedUserBlock;
  }


  /**
   * Parse the given `<preferences>` element.
   * @param   xml - the DOM element
   * @return  Object of parsed properties
   */
  protected _parsePreferences(xml: Element): ParsedPreferences {
    const props: ParsedPreferences = {
      type: 'preferences',
      preferences: {}
    };

    // very similar to tags
    const elems = Array.from(xml.getElementsByTagName('preference'));
    for (const elem of elems) {
      const k = (elem.getAttribute('k') ?? '').trim();
      const v = (elem.getAttribute('v') ?? '').trim();
      if (k) {
        props.preferences[k] = v;
      }
    }

    return props;
  }


  /**
   * Parse the given `<api>` element.
   * @param   xml - the DOM element
   * @return  Object of parsed properties
   */
  protected _parseApi(xml: Element): ParsedApi {
    const props: any = { type: 'api' };

    for (const node of getChildNodes(xml)) {
      if (node.nodeName === '#text') continue;
      props[node.nodeName] = getCleanAttributes(node as Element);
    }

    return props as ParsedApi;
  }


  /**
   * Parse the given `<policy>` element.
   * @param   xml - the DOM element
   * @return  Object of parsed properties
   */
  protected _parsePolicy(xml: Element): ParsedPolicy {
    const props: ParsedPolicy = { type: 'policy' };

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
   * Parse the given `<bounds>` element.
   * @param   xml - the DOM element
   * @return  Object of parsed properties
   */
  protected _parseBounds(xml: Element): ParsedBounds {
    return Object.assign({ type: 'bounds' } as ParsedBounds, getCleanAttributes(xml));
  }


  /**
   * Several functions call this to gather tag data.
   * @param   xml - the containing DOM element
   * @return  Object of tag k-v pairs
   */
  protected _getTags(xml: Element): OsmTags {
    const elems = Array.from(xml.getElementsByTagName('tag'));
    const tags: OsmTags = {};
    for (const elem of elems) {
      const k = (elem.getAttribute('k') ?? '').trim();
      const v = (elem.getAttribute('v') ?? '').trim();
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
 * Attributes are stored as a `NamedNodeMap` which is not iterable in a modern way.
 * This returns the attributes as a normal JavaScript Object.
 * "clean" means we will attempt to unstringify the attribute values.
 * @see     https://developer.mozilla.org/en-US/docs/Web/API/NamedNodeMap
 * @param   node - the DOM element
 * @return  An Object containing the k-v attribute pairs
 */
function getCleanAttributes(node: Element): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!node?.attributes) return result;

  for (const attr of Array.from(node.attributes)) {
    const k = attr.nodeName;
    if (k === 'id' || k === 'uid') {  // ids should remain strings
      result[attr.nodeName] = attr.nodeValue;
    } else {
      result[attr.nodeName] = unstringify(attr.nodeValue || '');
    }
  }
  return result;
}


/**
 * ChildNodes are stored as a `NodeList` which is not iterable in a modern way.
 * This returns the childNodes as a normal JavaScript Array.
 * @see     https://developer.mozilla.org/en-US/docs/Web/API/NodeList
 * @param   node - the node to get childNodes for
 * @return  An Array of childnodes
 */
function getChildNodes(node: Node): Node[] {
  if (!node?.childNodes) return [];
  return Array.from(node.childNodes);
}

/**
 * All the source xml data arrives as strings.
 * This will attempt to clean it up and cast it to a better type if possible.
 * We aren't going to overthink this, just handle a few simple cases.
 * @param   s - the source string
 * @return  result value
 */
function unstringify(s: string): unknown {
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
    if (isFinite(d.getTime())) {
      return d;
    }
  }

  return s;
}
/* c8 ignore end */
