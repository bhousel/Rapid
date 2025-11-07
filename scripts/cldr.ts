import { Glob } from 'bun';

//
// This script gets all the supported language names from CLDR
// - langNamesInNativeLang()
// - languageNamesInLanguageOf(code)
// - scriptNamesInLanguageOf(code)
//

const CLDR_ROOT = 'node_modules/cldr-localenames-full/main';

const substitutions = {
  'zh-CN': 'zh',
  'zh-HK': 'zh-Hant-HK',
  'zh-TW': 'zh-Hant',
  'pt-BR': 'pt',
  'pt':    'pt-PT'
};

const skipLanguages = new Set([
  'ase',   // American Sign Language
  'mis',   // "not yet assigned"
  'mul',   // "multiple languages"
  'und',   // "undefined"
  'zxx'    // "no linguistic content / not applicable"
]);



export type LangCode = string;       // e.g. 'en', 'en-GB', 'zh-CN'
export type ScriptCode = string;     // e.g. 'Latn', 'Arab', 'Hant'

export interface LangInfo {
  base?: string;
  script?: string;
  nativeName?: string;
};


/**
 * langNamesInNativeLang
 * Returns all of the available languages, with info from CLDR
 * about their native language name and script.
 *  {
 *    "en":      { "nativeName": "English"},
 *    "haw":     { "nativeName": "ʻŌlelo Hawaiʻi"},
 *    "kk-Arab": { "base": "kk", "script": "Arab", "nativeName": "قازاق ءتىلى (توتە)"},
 *    …
 *  }
 * @return  {Map<LangCode, LangInfo>}  Language code, language info
 */
export async function langNamesInNativeLang(): Map<LangCode, LangInfo> {
  const results = new Map<LangCode, LangInfo>();

  // Manually add languages we want that aren't in CLDR.
  results.set('ja-Hira', { base: 'ja', script: 'Hira' });
  results.set('ja-Latn', { base: 'ja', script: 'Latn' });
  results.set('ko-Latn', { base: 'ko', script: 'Latn' });
  results.set('zh_pinyin', { base: 'zh', script: 'Latn' });

  // The directory names are the codes
  const glob = new Glob(`${CLDR_ROOT}/**/languages.json`);
  for (const filepath of glob.scanSync()) {
    const match = filepath.match(/\/([\w-]+)\/languages\.json$/);  // capture the code
    if (!match) continue;
    const code = match[1];
    if (!code) continue;

    const json = await Bun.file(filepath).json();
    const languageData = json.main[code];
    const identity = languageData.identity;

    // skip locale-specific languages
    if (identity.letiant || identity.territory) continue;

    const info = {};
    const script = identity.script;
    if (script) {
      info.base = identity.language;
      info.script = script;
    }

    const nativeName = languageData.localeDisplayNames.languages[code];
    if (nativeName) {
      info.nativeName = nativeName;
    }

    results.set(code, info);
  }

  // CLDR locales don't cover all the languages people might want to use for OSM tags,
  // so also add the language names that we have English translations for
  const languagesFile = `${CLDR_ROOT}/en/languages.json`;
  const languagesJSON = await Bun.file(languagesFile).json();
  const englishNamesByCode = languagesJSON.main.en.localeDisplayNames.languages;
  for (const code of Object.keys(englishNamesByCode)) {
    if (results.has(code)) continue;
    if (code.includes('-')) continue;
    if (skipLanguages.has(code)) continue;
    results.set(code, {});
  }

  return results;
}


/**
 * languageNamesInLanguageOf
 * Returns the language names for the given language code.
 * For example, if passed 'en':
 *  {
 *    "en":    "English",
 *    "en-GB": "British English",
 *    "haw":   "Hawaiian",
 *    "kk":    "Kurdish"
 *    …
 *  }
 * @param   {LangCode}   code  - the language code to lookup
 * @return  {Map<LangCode, string>}  Language code -> language names for the given language code
 */
export async function languageNamesInLanguageOf(code: LangCode): Map<LangCode, string> {
  if (substitutions[code])  code = substitutions[code];

  const results = new Map<LangCode, string>();
  const file = Bun.file(`${CLDR_ROOT}/${code}/languages.json`);
  if (!await file.exists()) return results;

  const languagesJSON = await file.json();
  const languages = languagesJSON.main[code].localeDisplayNames.languages;

  for (const [code, name] of Object.entries(languages)) {
    if (skipLanguages.has(code)) continue;

    // Note: the codes are already sorted, so alternate forms will override standard forms
    const match = code.match(/^(.*)-alt-(.*)$/);  // e.g. "zh-Hans-alt-long"
    if (match !== null) {
      const base = match[1];
      const type = match[2];
      if (type === 'long' || type === 'menu') {   // only prefer these ones
        results.set(base, name);
      }
    } else {
      results.set(code, name);
    }
  }

  return results;
}


/**
 * scriptNamesInLanguageOf
 * Returns the script names for the given language code.
 * For example, if passed 'en':
 *  {
 *    "Arab":  "Arabic",
 *    "Hant":  "Traditional Han",
 *    "Latn":  "Latin",
 *    …
 *  }
 * @param   {LangCode}   code  - the language code to lookup
 * @return  {Map<ScriptCode, string>}  Script codes -> script names for the given language code
 */
export async function scriptNamesInLanguageOf(code: LangCode): Map<ScriptCode, string> {
  if (substitutions[code])  code = substitutions[code];

  const results = new Map<ScriptCode, string>();
  const file = Bun.file(`${CLDR_ROOT}/${code}/scripts.json`);
  if (!await file.exists()) return results;

  const scriptsJSON = await file.json();
  const scripts = scriptsJSON.main[code].localeDisplayNames.scripts;

  for (const [code, name] of Object.entries(scripts)) {
    if (skipLanguages.has(code)) continue;

    // Note: the codes are already sorted, so alternate forms will override standard forms
    const match = code.match(/^(.*)-alt-(.*)$/);  // e.g. "Hans-alt-stand-alone"
    if (match !== null) {
      const base = match[1];
      const type = match[2];
      if (type === 'stand-alone') {   // only prefer these ones
        results.set(base, name);
      }
    } else {
      results.set(code, name);
    }
  }

  return results;
}
