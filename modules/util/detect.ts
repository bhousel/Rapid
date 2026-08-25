
/** Browser/platform detection results */
export interface DetectResult {
  /** Is Rapid supported? (basically - not Internet Explorer) */
  isSupported: boolean;
  /** Is Rapid running in a secure context */
  isSecureContext: boolean;
  /** Whether running in a test environment */
  isTestEnvironment: boolean;

  /** Browser name, e.g. 'Edge', 'msie', 'Opera', 'Chrome', 'Safari', 'Firefox' */
  browser: string;
  /** Reported browser version, e.g. '133.0' */
  version: string;
  /** Host URL including pathname */
  host?: string;
  /** Operating system: 'mac', 'win', or 'linux' */
  os: 'mac' | 'win' | 'linux';
  /** Platform name: 'Macintosh', 'Windows', 'Linux', or 'Unknown' */
  platform: string;
  /** Array of locale codes from navigator.languages */
  locales: string[];

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
 * `utilDetect` detects things in the user's browser context.
 * @param   [refresh] - If true, refresh the cached result
 * @returns Detection results object
 */
export function utilDetect(refresh?: boolean): DetectResult {
  if (_cached && !refresh) return _cached;

  const result: Partial<DetectResult> = {};

  const ua = globalThis.navigator?.userAgent ?? '';
  let m: RegExpMatchArray | null;

  // Detect browser..
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

  // Detect browser version - keep major.minor version only..
  result.version = (result.version ?? '').split(/\W/).slice(0, 2).join('.');

  // Determine support flags
  result.isSupported = (result.browser.toLowerCase() !== 'msie');
  result.isSecureContext = globalThis.isSecureContext;
  result.isTestEnvironment = (!('window' in globalThis)) || ('assert' in globalThis) || ('expect' in globalThis);

  // Detect OS, platform..
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

  // Detect locale..
  result.locales = globalThis.navigator?.languages?.slice() ?? ['en-US'];  // shallow copy

  // Test environment will not have `window`
  if (!result.isTestEnvironment) {
    // Detect host..
    const loc = window.top?.location ?? window.location;
    let origin = loc.origin;
    if (!origin) {  // for unpatched IE11
      origin = loc.protocol + '//' + loc.hostname + (loc.port ? ':' + loc.port : '');
    }

    result.host = origin + loc.pathname;

    // Detect preferences..
    result.prefersColorScheme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    result.prefersContrast = window.matchMedia?.('(prefers-contrast: more)').matches ? 'more'
      : window.matchMedia?.('(prefers-contrast: less)').matches ? 'less' : null;
    result.prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    result.prefersReducedTransparency = window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches;
  }

  _cached = result as DetectResult;
  return _cached;
}
