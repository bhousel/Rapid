import { createHash } from 'node:crypto';


const CSP_META_PATTERN = /^([ \t]*)<meta http-equiv=(?:'Content-Security-Policy'|"Content-Security-Policy") content="[^"]*">\r?\n?/im;
const CHARSET_META_PATTERN = /(^[ \t]*<meta charset=(?:'utf-8'|"utf-8")>\r?\n)/im;
const INLINE_SCRIPT_PATTERN = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;


export interface ContentSecurityPolicyOptions {
  /** Allow optional extension libraries such as Mapillary JS 4 to compile expressions. */
  allowUnsafeEval?: boolean;
}


/**
 * Returns a SHA-256 CSP source expression for a script.
 * @param script - Exact inline script contents
 */
export function scriptHash(script: string): string {
  const digest = createHash('sha256').update(script).digest('base64');
  return `'sha256-${digest}'`;
}


/**
 * Builds the Content Security Policy for an HTML document.
 * Inline scripts are allowed only when their exact hashes match.
 * @param html - Complete HTML document
 * @param options - Capabilities required by this document
 */
export function contentSecurityPolicy(
  html: string,
  options: ContentSecurityPolicyOptions = {}
): string {
  const hashes = new Set<string>();

  for (const match of html.matchAll(INLINE_SCRIPT_PATTERN)) {
    hashes.add(scriptHash(match[1]));
  }

  const scriptSources = [
    `'self'`,
    'https://browser-update.org',
    'https://cdn.jsdelivr.net',
    `'strict-dynamic'`,
    ...hashes
  ];
  if (options.allowUnsafeEval) {
    scriptSources.push(`'unsafe-eval'`);
  }

  return [
    `default-src 'self'`,
    `base-uri 'self'`,
    `connect-src 'self' blob: data: http: https:`,
    `font-src 'self' data: https:`,
    `form-action 'self' https:`,
    `frame-src 'self' https:`,
    `img-src 'self' blob: data: http: https:`,
    `media-src 'self' blob: data: http: https:`,
    `object-src 'none'`,
    `script-src ${scriptSources.join(' ')}`,
    `script-src-attr 'none'`,
    `style-src 'self' 'unsafe-inline' https:`,
    `worker-src 'self' blob:`
  ].join('; ');
}


/**
 * Inserts or refreshes an HTML document's CSP meta element.
 * @param html - Complete HTML document
 * @param options - Capabilities required by this document
 * @throws Error if the document has no UTF-8 charset meta element
 */
export function updateContentSecurityPolicy(
  html: string,
  options: ContentSecurityPolicyOptions = {}
): string {
  const policy = contentSecurityPolicy(html, options);
  const meta = `    <meta http-equiv="Content-Security-Policy" content="${policy}">\n`;

  if (CSP_META_PATTERN.test(html)) {
    return html.replace(CSP_META_PATTERN, meta);
  }
  if (!CHARSET_META_PATTERN.test(html)) {
    throw new Error('Unable to insert CSP: missing UTF-8 charset meta element');
  }

  return html.replace(CHARSET_META_PATTERN, `$1${meta}`);
}
