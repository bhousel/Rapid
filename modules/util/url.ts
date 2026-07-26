const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);


/**
 * Accepts navigation and resource URLs that cannot execute script.
 * @param value - Untrusted URL
 * @return The trimmed URL, or `null` when its protocol is unsafe or invalid
 */
export function utilSafeURL(value: Nullable<string>): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed, 'https://rapid.local');
    return SAFE_PROTOCOLS.has(parsed.protocol) ? trimmed : null;
  } catch {
    return null;
  }
}
