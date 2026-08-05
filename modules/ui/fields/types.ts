/** A set of tag changes to apply: key → new value (`undefined` removes the tag). */
export type TagChange = Record<string, string | undefined>;

/**
 * The tags on the selected entity or entities.
 * A value may be a `string`, or an array of strings when multiple entities are
 * selected and they disagree on the value (a "mixed" value).
 */
export type Tags = Record<string, string | string[] | undefined>;


/**
 * Matches a localized tag key `key:<code>`, capturing the base key and the BCP47 locale code
 * (e.g. `name:en`, `name:zh-Hant-TW`). Group 1 is the base key, group 2 is the locale code.
 */
export const LANGUAGE_SUFFIX_REGEX = /^(.*):([a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2})?)$/;
