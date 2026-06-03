import { DOMParser } from '@xmldom/xmldom';
import JSON5 from 'json5';

/**
 * Pack up the parts of the response that we may need later for error handling.
 */
export class FetchError extends Error {

  /** HTTP status code (e.g. 404) */
  public status: number;
  /** HTTP status text (e.g. 'Not Found') */
  public statusText: string;
  /** The original Fetch API Response object, available for further inspection */
  public response: Response;


  /**
   * @constructor
   * @param response - The failed Fetch API Response
   */
  public constructor(response: Response) {
    const message = response.status + ' ' + response.statusText;    // e.g. '404 Not Found'
    super(message);

    this.name = 'FetchError';
    this.status = response.status;
    this.statusText = response.statusText;
    this.response = response;   // make full response available, in case anyone wants it
  }
}


/**
 * Handle the response from a `fetch`.
 * d3-fetch previously did some of this for us, see https://github.com/d3/d3-fetch
 *
 * @example
 * fetch(resource, options)
 *   .then(utilFetchResponse)
 *   .then(result => … )
 *   .catch(err => {
 *      if (err.name === 'AbortError') return;  // ok, expected
 *      if (err.name === 'FetchError') …        // deal with error
 *   })
 *
 * @param response - The `Response` from a `fetch`
 * @param domParser - Optional, specify a DOMParser to handle XML with
 * @returns Result suitable to be returned to a `.then()` (a value or Promise)
 * @throws FetchError
 */
export function utilFetchResponse(response: Response, domParser?: DOMParser): Promise<any> | any {
  if (!response.ok) {
    throw new FetchError(response);
  }

  let contentType = (response.headers.get('content-type') || '').split(';')[0];

  // Some poorly configured servers might not set a content-type header.
  // We'll try to infer it from the filename extension, if any.
  if (!contentType) {
    const url = new URL(response.url);
    const filename = url.pathname.split('/').at(-1) || '';
    const extension = filename.toLowerCase().split('.').at(-1) || '';

    switch (extension) {
      case 'geojson':
      case 'json':
        contentType = 'application/json';
        break;

      case 'json5':
        contentType = 'application/json5';
        break;

      case 'jsonc':
        contentType = 'application/jsonc';
        break;

      case 'htm':
      case 'html':
        contentType = 'text/html';
        break;

      case 'svg':
        contentType = 'image/svg+xml';
        break;

      case 'gpx':
      case 'kml':
      case 'xml':
        contentType = 'application/xml';
        break;

      case 'mvt':
      case 'pb':
      case 'pbf':
      case 'pmtiles':
      case 'proto':
        contentType = 'application/protobuf';
        break;

      default:
        contentType = 'text/plain';
    }
  }

  switch (contentType) {
    case 'application/geo+json':
    case 'application/json':
    case 'application/vnd.geo+json':
    case 'text/x-json':
      if (response.status === 204 || response.status === 205) return;  // No Content, Reset Content
      return response.json();

    case 'application/jsonc':  // JSON5 can handle both of these
    case 'application/json5':
      if (response.status === 204 || response.status === 205) return;  // No Content, Reset Content
      return response.text().then(text => JSON5.parse(text));

    // bhousel note 9/8/25:  Now prefer xmldom instead of builtin browser DOMParser,
    // 1. to better handle the togeojson usecases:
    // 2. and also to support browserless environments (node testing, etc)
    // see https://github.com/placemark/togeojson?tab=readme-ov-file#protips
    // see https://github.com/xmldom/xmldom
    // see https://developer.mozilla.org/en-US/docs/Web/API/DOMParser/parseFromString
    case 'application/xhtml+xml':
    case 'application/xml':
    case 'image/svg+xml':
    case 'text/html':
    case 'text/xml':
      return response.text()
        .then(txt => {
          if (!domParser) domParser = new DOMParser();  // use xmldom parser unless specified
          return domParser.parseFromString(txt.trimStart(), contentType);
        });

    case 'application/octet-stream':
    case 'application/protobuf':
    case 'application/vnd.google.protobuf':
    case 'application/vnd.mapbox-vector-tile':
    case 'application/x-protobuf':
      return response.arrayBuffer();

    default:
      return response.text();
  }
}
