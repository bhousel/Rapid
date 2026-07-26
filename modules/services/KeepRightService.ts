import { AbstractSystem } from '../core/AbstractSystem.ts';
import { MarkerData } from '../data/MarkerData.ts';
import { utilEscapeHTML } from '../util/sanitize.ts';
import { Tiler } from '@rapid-sdk/math';
import { utilQsString } from '@rapid-sdk/util';

import type { Context } from '../Context.ts';
import type { MarkerProps } from '../data/MarkerData.ts';
import type { Tile } from '@rapid-sdk/math';


/** Properties for KeepRight issue markers */
export interface KeepRightIssueProps extends MarkerProps {
  /** KeepRight item type code */
  itemType: string;
  /** Comment on the issue */
  comment: string;
  /** Human-readable description of the issue */
  description: string;
  /** Which type (e.g. 'node', 'way') */
  whichType: string;
  /** Parent issue type key */
  parentIssueType: string;
  /** Severity: 'error' or 'warning' */
  severity: string;
  /** OSM object ID */
  objectId: string;
  /** OSM object type */
  objectType: string;
  /** KeepRight schema identifier */
  schema: number;
  /** Human-readable title */
  title: string;
  /** Token replacements for description templating */
  replacements: Record<string, string>;
  /** New status to set (e.g. 'ignore', 'ignore_t') */
  newStatus?: string;
  /** New comment to add */
  newComment?: string;
  /** New state (used internally) */
  newState?: string;
}

/** A KeepRight issue MarkerData with typed props */
export type KeepRightIssue = MarkerData<KeepRightIssueProps>;


/** Base URL for the KeepRight API */
const KEEPRIGHT_API = 'https://www.keepright.at';
/** Zoom level used for tiling KeepRight data requests */
const TILEZOOM = 14;

const KR_RULES = [
  // no 20 - multiple node on same spot - these are mostly boundaries overlapping roads
  30, 40, 50, 60, 70, 90, 100, 110, 120, 130, 150, 160, 170, 180,
  190, 191, 192, 193, 194, 195, 196, 197, 198,
  200, 201, 202, 203, 204, 205, 206, 207, 208, 210, 220,
  230, 231, 232, 270, 280, 281, 282, 283, 284, 285,
  290, 291, 292, 293, 294, 295, 296, 297, 298, 300, 310, 311, 312, 313,
  320, 350, 360, 370, 380, 390, 400, 401, 402, 410, 411, 412, 413
];

/** Map of KeepRight item numbers to their display colors */
const KR_COLORS = new Map<string, number>();
['20', '40', '210', '270', '310', '320', '350'].forEach(key => KR_COLORS.set(key, 0xffff99));
['60', '70', '90', '100', '110', '150', '220', '380'].forEach(key => KR_COLORS.set(key, 0x55dd00));
['360', '370', '410'].forEach(key => KR_COLORS.set(key, 0xff99bb));
KR_COLORS.set('50',  0xffff99);
KR_COLORS.set('120', 0xcc3355);
KR_COLORS.set('130', 0xffaa33);
KR_COLORS.set('160', 0xbb6600);
KR_COLORS.set('170', 0xffff00);
KR_COLORS.set('180', 0xaaccee);
KR_COLORS.set('190', 0xff3333);
KR_COLORS.set('200', 0xfdbf6f);
KR_COLORS.set('230', 0xbb6600);
KR_COLORS.set('280', 0x5f47a0);
KR_COLORS.set('290', 0xaaccee);
KR_COLORS.set('300', 0x009900);
KR_COLORS.set('390', 0x009900);
KR_COLORS.set('400', 0xcc3355);


/** Error type template from QA data */
interface KRErrorType {
  /** Severity level (e.g. 'error', 'warning') */
  severity?: string;
  /** Regex pattern for matching and parsing error descriptions */
  regex?: string;
  /** Ordered list of ID type codes for captured groups in the regex */
  IDs?: string[];
}

/** Persistent KeepRight data loaded at startup */
interface KRData {
  /** Map of error type codes to their template definitions */
  errorTypes: Record<string, KRErrorType>;
  /** Map of lowercase strings to their localization keys */
  localizeStrings: Record<string, string>;
}


/**
 * `KeepRightService` connects to the KeepRight API to fetch detected QA issues.
 * @see https://wiki.openstreetmap.org/wiki/Keep_Right
 * @see https://keepright.at/interfacing.php
 */
export class KeepRightService extends AbstractSystem {

  /** Persistent KeepRight QA data (error templates and localization strings) loaded at startup */
  protected _krData: KRData;
  /** Tiler instance used to compute tile coverage for the current viewport */
  protected _tiler: Tiler;
  /** Map of issues marked as closed, keyed by entity ID */
  protected _closed: Set<string>;
  /** Last viewport version number used for change detection */
  protected _lastv: number | null;


  /**
   * @constructor
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'keepright';
    this.requiredDependencies = new Set<SystemID>(['assets', 'l10n', 'network', 'spatial']);
    this.optionalDependencies = new Set<SystemID>(['gfx']);
    this.autoStart = false;

    // persistent data - loaded at init
    this._krData = { errorTypes: {}, localizeStrings: {} };

    this._tiler = (new Tiler().zoomRange(TILEZOOM) as Tiler).skipNullIsland(true) as Tiler;
    this._closed = new Set<string>();
    this._lastv = null;
  }


  /**
   * Called after all core objects have been constructed.
   * @return Promise resolved when this component has completed initialization
   */
  public initAsync(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    return this._initPromise = super.initAsync()
      .then(() => this.resetAsync());
  }


  /**
   * Called after all core objects have been initialized.
   * @return Promise resolved when this component has completed startup
   */
  public startAsync(): Promise<void> {
    if (this._startPromise) return this._startPromise;

    const assets = this.context.systems.assets!;
    return this._startPromise = assets.loadAssetAsync('qa_data')
      .then((data: any) => {
        this._krData = data.keepRight;
        this._started = true;
      });
  }


  /**
   * Called after completing an edit session to reset any internal state
   * @return Promise resolved when this component has completed resetting
   */
  public resetAsync(): Promise<void> {
    const context = this.context;
    const network = context.systems.network!;
    const spatial = context.systems.spatial!;

    network.clearMatching(id => id.startsWith('keepright-'));
    spatial.clearMatching(id => id.startsWith('keepright-'));

    this._closed.clear();
    this._lastv = null;

    return Promise.resolve();
  }


  /**
   * Get already loaded data that appears in the current map view
   * @return Array of data
   */
  public getData(): MarkerData[] {
    const spatial = this.context.systems.spatial!;
    return spatial.getVisibleItems('keepright-data').map(hit => hit.contents) as MarkerData[];
  }


  /**
   * Schedule any data requests needed to cover the current map view.
   * KeepRight API:  http://osm.mueschelsoft.de/keepright/interfacing.php
   */
  public loadTiles(): void {
    const context = this.context;
    const network = context.systems.network!;
    const viewport = context.viewport;

    if (this._lastv === viewport.v) return;  // exit early if the view is unchanged
    this._lastv = viewport.v;

    // Determine the tiles needed to cover the view..
    const tiles = this._tiler.getTiles(viewport).tiles;

    // Abort inflight requests that are no longer needed..
    const neededIDs = new Set<RequestID>(tiles.map(tile => `keepright-tile-${tile.id}`));
    network.abortMatching(id => id.startsWith('keepright-tile') && !neededIDs.has(id));

    // Issue new requests..
    for (const tile of tiles) {
      this._loadTile(tile);
    }
  }


  /**
   * Load a single tile of data.
   * @param tile - Tile to load
   */
  protected _loadTile(tile: Tile): void {
    const context = this.context;
    const network = context.systems.network!;

    const requestID = `keepright-tile-${tile.id}`;
    if (network.isCompleted(requestID) || network.isInflight(requestID)) return;

    const options = { format: 'geojson', ch: KR_RULES };
    const [ left, top, right, bottom ] = tile.wgs84Extent.rectangle();
    const params = Object.assign({}, options, { left, bottom, right, top });
    const url = `${KEEPRIGHT_API}/export.php?` + utilQsString(params, false);

    network.fetch<any>(url, { requestID })
      .then(response => this._gotTile(response))
      .catch(err => {
        if (err.name === 'AbortError') return;   // ok
        console.error(err);  // eslint-disable-line
      });
  }


  /**
   * Parse the response from the tile fetch.
   * @param response - Response data
   */
  protected _gotTile(response: any): void {
    const context = this.context;
    const gfx = context.systems.gfx;
    const spatial = context.systems.spatial!;
    const spatialID = 'keepright-data';

    if (!Array.isArray(response?.features)) {
      throw new Error('Invalid response');
    }

    for (const feature of response.features) {
      const {
        properties: {
          error_type: itemType,
          error_id: id,
          comment = null,
          object_id: objectId,
          object_type: objectType,
          schema,
          title
        }
      } = feature;
      let {
        geometry: { coordinates: loc },
        properties: { description = '' }
      } = feature;

      // if there is a parent, save its error type e.g.:
      //  Error 191 = "highway-highway"
      //  Error 190 = "intersections without junctions"  (parent)
      const issueTemplate = this._krData.errorTypes[itemType];
      const parentIssueType = (Math.floor(itemType / 10) * 10).toString();

      // try to handle error type directly, fallback to parent error type.
      const whichType = issueTemplate ? itemType : parentIssueType;
      const whichTemplate = this._krData.errorTypes[whichType];

      // Rewrite a few of the errors at this point..
      // This is done to make them easier to linkify and translate.
      switch (whichType) {
        case '170':
          description = `This feature has a FIXME tag: ${description}`;
          break;
        case '292':
        case '293':
          description = description.replace('A turn-', 'This turn-');
          break;
        case '294':
        case '295':
        case '296':
        case '297':
        case '298':
          description = `This turn-restriction~${description}`;
          break;
        case '300':
          description = 'This highway is missing a maxspeed tag';
          break;
        case '411':
        case '412':
        case '413':
          description = `This feature~${description}`;
          break;
      }

      loc = spatial.getFreeLoc(spatialID, loc);

      const props: Record<string, any> = {
        id:              id,
        loc:             loc,
        itemType:        itemType,
        comment:         comment,
        description:     description,
        whichType:       whichType,
        parentIssueType: parentIssueType,
        severity:        whichTemplate?.severity || 'error',
        objectId:        objectId,
        objectType:      objectType,
        schema:          schema,
        title:           title,
        serviceID:       this.id
      };

      props.replacements = this._tokenReplacements(props);

      spatial.addData(spatialID, new MarkerData(context, props));
    }

    gfx?.deferredRedraw();
  }


  /**
   * Called to change some properies (status, comments) about the KeepRight data item.
   * Will send the update to the KeepRight API and refresh the local data cache.
   * @param item - the MarkerData item to update
   * @param callback - errback-style callback function to call with results
   */
  public postUpdate(item: MarkerData, callback: (err: any, item: MarkerData) => void): void {
    const network = this.context.systems.network!;
    const dataID = item.id;
    const postKey = `keepright-post-${dataID}`;

    if (network.isInflight(postKey)) {
      return callback({ message: 'Error update already inflight', status: -2 }, item);
    }

    const params: Record<string, any> = { schema: item.props.schema, id: dataID };

    if (item.props.newStatus) {
      params.st = item.props.newStatus;
    }
    if (item.props.newComment !== undefined) {
      params.co = item.props.newComment;
    }

    // NOTE: We'll send a no-cors request to avoid the CORS error.
    // We don't care about the response, so this is fine.
    const url = `${KEEPRIGHT_API}/comment.php?` + utilQsString(params, false);

    network.fetchRaw(url, { requestID: postKey, mode: 'no-cors' })
      .catch(() => {})  // ignore errors for no-cors requests
      .finally(() => {
        if (item.props.newStatus === 'ignore') {    // ignore permanently (false positive)
          this.removeItem(item);
        } else if (item.props.newStatus === 'ignore_t') {   // ignore temporarily (error fixed)
          this.removeItem(item);
          this._closed.add(`${item.props.schema}:${dataID}`);
        } else {
          const replaced = this.replaceItem(item.update({
            comment: item.props.newComment,
            newComment: undefined,
            newState: undefined
          }));
          if (replaced) item = replaced;
        }

        if (callback) callback(null, item);
      });
  }


  /**
   * Get item with given id from cache
   * @param dataID - the data ID to look up
   * @return the cached item, or `undefined` if not found
   */
  public getError(dataID: DataID): KeepRightIssue | undefined {
    const spatial = this.context.systems.spatial!;
    return spatial.getItem<KeepRightIssue>('keepright-data', dataID);
  }


  /**
   * Get the color associated with this issue type
   * @param parentIssueType - the parent issue type key
   * @return hex color
   */
  public getColor(parentIssueType: string): number {
    return KR_COLORS.get(parentIssueType) ?? 0xffffff;
  }


  /**
   * Replace a single item in the cache
   * @param item - MarkerData to replace
   * @return the item, or `null` if it couldn't be replaced
   */
  public replaceItem(item: MarkerData): MarkerData | null {
    if (!(item instanceof MarkerData) || !item.id) return null;

    const spatial = this.context.systems.spatial!;
    spatial.replaceData('keepright-data', item);
    return item;
  }


  /**
   * Remove a single item from the cache
   * @param item - MarkerData to remove
   */
  public removeItem(item: MarkerData): void {
    if (!(item instanceof MarkerData) || !item.id) return;

    const spatial = this.context.systems.spatial!;
    spatial.removeItems('keepright-data', item.id);
  }


  /**
   * Returns the URL to link to details about an item
   * @param item - the MarkerData item
   * @return the url
   */
  public issueURL(item: MarkerData): string {
    return `${KEEPRIGHT_API}/report_map.php?schema=${item.props.schema}&error=${item.id}`;
  }

  /**
   * Get an array of issues closed during this session.
   * Used to populate `closed:keepright` changeset tag
   * @return Array of closed item ids
   */
  public getClosedIDs(): string[] {
    return [...this._closed].sort();
  }


  /**
   * Build a map of token replacements for templating a KeepRight error description.
   * Parses the description using the error type's regex and links any captured IDs.
   * @param props - Properties of the KeepRight issue
   * @return Map of replacement tokens, or `undefined` if the template is missing or unmatched
   */
  protected _tokenReplacements(props: Record<string, any>): Record<string, string> | undefined {
    const l10n = this.context.systems.l10n!;
    const replacements: Record<string, string> = {};

    const issueTemplate = this._krData.errorTypes[props.whichType];
    if (!issueTemplate) {
      /* eslint-disable no-console */
      console.warn('No Template: ', props.whichType);
      console.warn('  ', props.description);
      /* eslint-enable no-console */
      return;
    }

    // some descriptions are just fixed text
    if (!issueTemplate.regex) return;

    // regex pattern should match description with variable details captured
    const errorRegex = new RegExp(issueTemplate.regex, 'i');
    const errorMatch = errorRegex.exec(props.description);
    if (!errorMatch) {
      /* eslint-disable no-console */
      console.warn('Unmatched: ', props.whichType);
      console.warn('  ', props.description);
      console.warn('  ', errorRegex);
      /* eslint-enable no-console */
      return;
    }

    for (let i = 1; i < errorMatch.length; i++) {   // skip first
      let capture = errorMatch[i];
      const idType = 'IDs' in issueTemplate ? issueTemplate.IDs![i-1] : '';
      if (idType && capture) {   // link IDs if present in the capture
        capture = this._parseError(capture, idType);
      } else {
        const compare = capture.toLowerCase();
        if (this._krData.localizeStrings[compare]) {   // some replacement strings can be localized
          capture = l10n.t('QA.keepRight.error_parts.' + this._krData.localizeStrings[compare]);
        }
        capture = utilEscapeHTML(capture);
      }

      replacements['var' + i] = capture;
    }

    return replacements;
  }


  /**
   * Parse a single captured group from an error description regex match.
   * Localizes known strings and wraps IDs/URLs in linkable HTML elements.
   * @param capture - The captured text to parse
   * @param idType - The ID type code indicating how to interpret the capture
   * @return Parsed and linkified string
   */
  protected _parseError(capture: string, idType: string): string {
    const l10n = this.context.systems.l10n!;
    const compare = capture.toLowerCase();

    if (this._krData.localizeStrings[compare]) {   // some replacement strings can be localized
      capture = l10n.t('QA.keepRight.error_parts.' + this._krData.localizeStrings[compare]);
    }

    switch (idType) {
      // link a string like "this node"
      case 'this':
        capture = linkErrorObject(capture);
        break;

      case 'url':
        capture = linkURL(capture);
        break;

      // link an entity ID
      case 'n':
      case 'w':
      case 'r':
        capture = linkEntity(idType + capture);
        break;

      // some errors have more complex ID lists/variance
      case '20':
        capture = parse20(capture);
        break;
      case '211':
        capture = parse211(capture);
        break;
      case '231':
        capture = parse231(capture);
        break;
      case '294':
        capture = parse294(capture);
        break;
      case '370':
        capture = parse370(capture);
        break;
    }

    return capture;


    /**
     *
     * @param d
     */
    function linkErrorObject(d: string): string {
      return `<a class="error_object_link">${d}</a>`;
    }

    /**
     *
     * @param d
     */
    function linkEntity(d: string): string {
      return `<a class="error_entity_link">${d}</a>`;
    }

    /**
     *
     * @param d
     */
    function linkURL(d: string): string {
      return `<a class="kr_external_link" target="_blank" href="${d}">${d}</a>`;
    }

    // arbitrary node list of form: #ID, #ID, #ID...
    /**
     *
     * @param capture
     */
    function parse211(capture: string): string {
      const newList: string[] = [];

      const items = capture.split(', ');
      for (const item of items) {
        const id = linkEntity('n' + item.slice(1));   // ID has # at the front
        newList.push(id);
      }

      return newList.join(', ');
    }

    // arbitrary way list of form: #ID(layer),#ID(layer),#ID(layer)...
    /**
     *
     * @param capture
     */
    function parse231(capture: string): string {
      const newList: string[] = [];

      // unfortunately 'layer' can itself contain commas, so we split on '),'
      const items = capture.split('),');
      for (const item of items) {
        const match = item.match(/\#(\d+)\((.+)\)?/);
        if (match !== null && match.length > 2) {
          newList.push(linkEntity('w' + match[1]) + ' ' +
            l10n.t('QA.keepRight.errorTypes.231.layer', { layer: match[2] })
          );
        }
      }

      return newList.join(', ');
    }

    // arbitrary node/relation list of form: from node #ID,to relation #ID,to node #ID...
    /**
     *
     * @param capture
     */
    function parse294(capture: string): string {
      const newList: string[] = [];
      const items = capture.split(',');

      for (const item of items) {
        const parts = item.split(' ');        // item of form "from/to node/relation #ID"
        const role = `"${parts[0]}"`;         // to/from role is more clear in quotes
        const idType = parts[1].slice(0, 1);  // first letter of node/relation provides the type

        let id = parts[2].slice(1);   // ID has # at the front
        id = linkEntity(idType + id);

        newList.push(`${role} ${parts[1]} ${id}`);
      }

      return newList.join(', ');
    }

    // may or may not include the string "(including the name 'name')"
    /**
     *
     * @param capture
     */
    function parse370(capture: string): string {
      if (!capture) return '';

      const match = capture.match(/\(including the name (\'.+\')\)/);
      if (match?.length) {
        return l10n!.t('QA.keepRight.errorTypes.370.including_the_name', { name: match[1] });
      }
      return '';
    }

    // arbitrary node list of form: #ID,#ID,#ID...
    /**
     *
     * @param capture
     */
    function parse20(capture: string): string {
      const newList: string[] = [];
      const items = capture.split(',');

      for (const item of items) {
        const id = linkEntity('n' + item.slice(1));   // ID has # at the front
        newList.push(id);
      }

      return newList.join(', ');
    }
  }

}
