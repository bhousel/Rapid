import { select } from 'd3-selection';


/** Augment globalThis with JSONP-related properties used for testing/mocking */
declare global {
  /** Cache of JSONP callback functions keyed by callback name */
  var jsonpCache: Record<string, ((data: any) => void) | undefined>;
  /** If set, bypasses actual JSONP and returns this fixed data (for testing) */
  var JSONP_FIX: any;
  /** Delay in ms before returning JSONP_FIX data (for testing) */
  var JSONP_DELAY: number | undefined;
}


/** A JSONP request that can be aborted */
export interface JsonpRequest {
  /** Abort the pending JSONP request */
  abort: () => void;
}

/** Callback function invoked with JSONP response data */
export type JsonpCallback = (data: any) => void;


const jsonpCache: Record<string, ((data: any) => void) | undefined> = {};
globalThis.jsonpCache = jsonpCache;


/**
 * Makes a JSONP request to the given URL.
 * The URL should contain `{callback}` or `%7Bcallback%7D` placeholder.
 *
 * @param url - The URL with callback placeholder
 * @param callback - Function to call with the response data
 * @returns A request object with an abort method
 */
export function jsonpRequest(url: string, callback: JsonpCallback): JsonpRequest {
  const request: JsonpRequest = {
    abort: function() {}
  };

  if (globalThis.JSONP_FIX) {
    if (globalThis.JSONP_DELAY === 0) {
      callback(globalThis.JSONP_FIX);
    } else {
      const t = globalThis.setTimeout(function() {
        callback(globalThis.JSONP_FIX);
      }, globalThis.JSONP_DELAY || 0);

      request.abort = function() { globalThis.clearTimeout(t); };
    }

    return request;
  }

  /** Generates a random 15-character alphabetic string for a unique JSONP callback name. */
  function rand(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let c = '';
    let i = -1;
    while (++i < 15) c += chars.charAt(Math.floor(Math.random() * 52));
    return c;
  }

  /**
   *
   * @param url
   */
  function create(url: string): string {
    const e = url.match(/callback=(\w+)/);
    const c = e ? e[1] : rand();

    jsonpCache[c] = function(data: any) {
      if (jsonpCache[c]) {
        callback(data);
      }
      finalize();
    };

    /** Removes the callback from the global JSONP cache and deletes the script element. */
    function finalize(): void {
      delete jsonpCache[c];
      script.remove();
    }

    request.abort = finalize;
    return 'jsonpCache.' + c;
  }

  const cb = create(url);

  const script = select('head')
    .append('script')
    .attr('type', 'text/javascript')
    .attr('src', url.replace(/(\{|%7B)callback(\}|%7D)/, cb));

  return request;
}
