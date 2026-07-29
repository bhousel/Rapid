const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

const ALLOWED_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'hr', 'i', 'img', 'kbd', 'li', 'mark', 'ol', 'option', 'p',
  'pre', 'select', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody',
  'td', 'th', 'thead', 'tr', 'u', 'ul'
]);

const ALLOWED_ATTRIBUTES = new Set([
  'alt', 'class', 'data-osm-id', 'data-osm-type', 'href', 'id', 'lang', 'name',
  'rel', 'src', 'target', 'title', 'value'
]);

const DROP_CONTENT_TAGS = new Set([
  'base', 'embed', 'iframe', 'link', 'meta', 'noscript', 'object', 'script',
  'style', 'template'
]);

const ALLOWED_TARGETS = new Set(['_blank', '_parent', '_self', '_top']);

let _isSupported: boolean | undefined;


function isSafeURL(value: string, attributeName: string): boolean {
  const baseURL = /^https?:/.test(document.baseURI) ?
    document.baseURI :
    'http://localhost/';

  try {
    const url = new URL(value, baseURL);
    if (url.protocol === 'http:' || url.protocol === 'https:') return true;
    return attributeName === 'href' && (url.protocol === 'mailto:' || url.protocol === 'tel:');
  } catch {
    return false;
  }
}


function sanitizeElement(element: Element): void {
  const tagName = element.localName.toLowerCase();

  if (element.namespaceURI !== HTML_NAMESPACE || !ALLOWED_TAGS.has(tagName)) {
    if (DROP_CONTENT_TAGS.has(tagName)) {
      element.remove();
    } else {
      element.replaceWith(...element.childNodes);
    }
    return;
  }

  for (const attribute of [...element.attributes]) {
    const attributeName = attribute.name.toLowerCase();
    const isURL = attributeName === 'href' || attributeName === 'src';
    const isTarget = attributeName === 'target';

    if (
      !ALLOWED_ATTRIBUTES.has(attributeName) ||
      (isURL && !isSafeURL(attribute.value, attributeName)) ||
      (isTarget && !ALLOWED_TARGETS.has(attribute.value.toLowerCase()))
    ) {
      element.removeAttribute(attribute.name);
    }
  }

  if (tagName === 'a' && element.getAttribute('target')?.toLowerCase() === '_blank') {
    const rel = new Set(element.getAttribute('rel')?.split(/\s+/).filter(Boolean));
    rel.add('noopener');
    rel.add('noreferrer');
    element.setAttribute('rel', [...rel].join(' '));
  }
}


function sanitizeOnce(dirty: string): string {
  const cleanDocument = document.implementation.createHTMLDocument('');
  const container = cleanDocument.createElement('div');
  container.innerHTML = dirty;

  for (const element of [...container.querySelectorAll('*')]) {
    sanitizeElement(element);
  }

  return container.innerHTML;
}


function supportsSanitization(): boolean {
  if (
    typeof document === 'undefined' ||
    typeof document.implementation?.createHTMLDocument !== 'function'
  ) return false;

  try {
    const clean = sanitizeOnce(
      '<img src="x" onerror="x"><script>x</script><a href="javascript:x">link</a>'
    );
    return clean.includes('<img') && !/onerror|script|javascript/i.test(clean);
  } catch {
    return false;
  }
}


/**
 * Escapes text so it can be safely interpolated into an HTML string.
 * @param value - Untrusted text
 * @return Text with HTML-significant characters encoded
 */
export function utilEscapeHTML(value: Nullable<string>): string {
  if (!value) return '';
  return value.replace(/[&<>"']/g, char => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case '\'': return '&#39;';
      default: return char;
    }
  });
}


/**
 * Sanitizes untrusted HTML while preserving the markup used by Rapid's UI.
 * Falls back to escaping all markup when a compatible DOM is unavailable.
 * @param dirty - Untrusted HTML
 * @return HTML with executable content removed
 */
export function utilSanitizeHTML(dirty: Nullable<string>): string {
  if (!dirty) return '';

  _isSupported ??= supportsSanitization();
  if (!_isSupported) return utilEscapeHTML(dirty);

  try {
    let clean = dirty;

    // Reparse until stable so markup cannot become executable after serialization.
    for (let i = 0; i < 3; i++) {
      const next = sanitizeOnce(clean);
      if (next === clean) return next;
      clean = next;
    }

    return utilEscapeHTML(dirty);
  } catch {
    return utilEscapeHTML(dirty);
  }
}
