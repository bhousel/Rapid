
/** Browser/platform detection results */
export interface DetectResult {
  /** Is Rapid supported? (basically - not Internet Explorer) */
  support: boolean;
  /** Browser name, e.g. 'Edge', 'msie', 'Opera', 'Chrome', 'Safari', 'Firefox' */
  browser: string;
  /** Reported browser version, e.g. '133.0' */
  version: string;
  /** Array of locale codes from navigator.languages */
  locales: string[];
  /** Host URL including pathname */
  host?: string;
  /** Operating system: 'mac', 'win', or 'linux' */
  os: 'mac' | 'win' | 'linux';
  /** Platform name: 'Macintosh', 'Windows', 'Linux', or 'Unknown' */
  platform: string;
  /** Whether running in a test environment */
  isTestEnvironment: boolean;
  /** User's preferred color scheme: 'light' or 'dark' */
  prefersColorScheme?: 'light' | 'dark';
  /** User's preferred contrast: 'more', 'less', or null */
  prefersContrast?: 'more' | 'less' | null;
  /** Whether user prefers reduced motion */
  prefersReducedMotion?: boolean;
  /** Whether user prefers reduced transparency */
  prefersReducedTransparency?: boolean;
}

let _cached: DetectResult | undefined;

/**
 * `utilDetect` detects things from the user's browser.
 * @param refresh - If true, refresh the cached result
 * @returns Detection results object
 */
export function utilDetect(refresh?: boolean): DetectResult {
  if (_cached && !refresh) return _cached;

  const result: Partial<DetectResult> = {};

  const ua = globalThis.navigator?.userAgent ?? '';
  let m: RegExpMatchArray | null;

  /* Browser */
  m = ua.match(/(edg)\/?\s*(\.?\d+(\.\d+)*)/i);   // Edge
  if (m !== null) {
    result.browser = 'Edge';
    result.version = m[2];
  }
  if (!result.browser) {
    m = ua.match(/Trident\/.*rv:([0-9]{1,}[\.0-9]{0,})/i);   // IE11
    if (m !== null) {
      result.browser = 'msie';
      result.version = m[1];
    }
  }
  if (!result.browser) {
    m = ua.match(/(opr)\/?\s*(\.?\d+(\.\d+)*)/i);   // Opera 15+
    if (m !== null) {
      result.browser = 'Opera';
      result.version = m[2];
    }
  }
  if (!result.browser) {
    m = ua.match(/(opera|chrome|safari|firefox|msie|node\.js|deno)\/?\s*(\.?\d+(\.\d+)*)/i);
    if (m !== null) {
      result.browser = m[1];
      result.version = m[2];
      m = ua.match(/version\/([\.\d]+)/i);
      if (m !== null) result.version = m[1];
    }
  }
  if (!result.browser) {
    result.browser = globalThis.navigator?.appName ?? '';
    result.version = globalThis.navigator?.appVersion ?? '';
  }

  // Keep major.minor version only..
  result.version = (result.version ?? '').split(/\W/).slice(0, 2).join('.');

  if (result.browser.toLowerCase() === 'msie') {
    result.support = false;
  } else {
    result.support = true;
  }

  /* Platform */
  if (/Win/.test(ua)) {
    result.os = 'win';
    result.platform = 'Windows';
  } else if (/Mac/.test(ua)) {
    result.os = 'mac';
    result.platform = 'Macintosh';
  } else if (/X11/.test(ua) || /Linux/.test(ua)) {
    result.os = 'linux';
    result.platform = 'Linux';
  } else {
    result.os = 'win';
    result.platform = 'Unknown';
  }

  /* Locale */
  result.locales = globalThis.navigator?.languages?.slice() ?? ['en-US'];  // shallow copy

  result.isTestEnvironment = (!('window' in globalThis)) || ('assert' in globalThis) || ('expect' in globalThis);

  // test environment will not have `window`
  if (!result.isTestEnvironment) {
    /* Host */
    const loc = window.top?.location ?? window.location;
    let origin = loc.origin;
    if (!origin) {  // for unpatched IE11
      origin = loc.protocol + '//' + loc.hostname + (loc.port ? ':' + loc.port : '');
    }

    result.host = origin + loc.pathname;

    result.prefersColorScheme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    result.prefersContrast = window.matchMedia?.('(prefers-contrast: more)').matches ? 'more'
      : window.matchMedia?.('(prefers-contrast: less)').matches ? 'less' : null;
    result.prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    result.prefersReducedTransparency = window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches;
  }

  _cached = result as DetectResult;
  return _cached;
}
