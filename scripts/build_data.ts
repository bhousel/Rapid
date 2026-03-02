import { $, Glob } from 'bun';
$.nothrow();  // If a shell command returns nonzero, keep going.

import stringify from 'json-stringify-pretty-compact';
import { styleText } from 'node:util';

import * as CLDR from './cldr.ts';

import type { ImageryInput } from '../modules/core/ImagerySystem.ts';
import type { SchemaInput } from '../modules/core/SchemaSystem.ts';
import type { CategoryProps } from '../modules/lib/Category.ts';
import type { PresetProps } from '../modules/lib/Preset.ts';

const localeCompare = new Intl.Collator('en').compare;


// Interfaces for external data sources that lack their own type definitions

/** QA service entry — only osmose has `icons` */
interface QAService {
  icons?: Record<string, string>;
  localizeStrings?: Record<string, string>;
  errorTypes?: Record<string, unknown>;
}

/** CLDR territory info JSON structure */
interface TerritoryLanguagePopulation {
  _populationPercent: string;
  _officialStatus?: string;
}
interface TerritoryEntry {
  _gdp?: string;
  _literacyPercent?: string;
  _population?: string;
  languagePopulation?: Record<string, TerritoryLanguagePopulation>;
}
interface TerritoriesJSON {
  supplemental: {
    territoryInfo: Record<string, TerritoryEntry>;
  };
}

/** Locale JSON for core translations (core.yaml → core.en.json) */
interface CoreLocale {
  en: {
    languageNames?: Record<string, string>;
    scriptNames?: Record<string, string>;
    [key: string]: unknown;
  };
}

/** Locale JSON for imagery translations */
interface ImageryLocale {
  en: {
    imagery: Record<string, { attribution?: { text: string }; name?: string; description?: string }>;
  };
}

/** Locale JSON for tagging translations */
interface TaggingLocale {
  en: {
    presets: {
      categories: Record<string, unknown>;
      presets: Record<string, unknown>;
      fields: Record<string, unknown>;
      [key: string]: Record<string, unknown>;
    };
  };
}

// Load source data
const categoriesFile = './node_modules/@openstreetmap/id-tagging-schema/dist/preset_categories.min.json';
const presetsFile = './node_modules/@openstreetmap/id-tagging-schema/dist/presets.min.json';
const qaDataFile = './data/qa_data.json5';
const territoriesFile = './node_modules/cldr-core/supplemental/territoryInfo.json';

const categoriesJSON = await Bun.file(categoriesFile).json() as Record<string, Partial<CategoryProps>>;
const presetsJSON = await Bun.file(presetsFile).json() as Record<string, Partial<PresetProps>>;
const qaDataJSON = Bun.JSON5.parse(await Bun.file(qaDataFile).text()) as Record<string, QAService>;
const territoriesJSON = await Bun.file(territoriesFile).json() as TerritoriesJSON;


await buildData();

// This script builds all the data files
// Files under `/data/*` are part of the project and checked in.
// Files under `/dist.*` are build artifacts and not checked in.
async function buildData() {
  const START = '🏗   ' + styleText('yellow', 'Building data…');
  const END = '👍  ' + styleText('green', 'data built');

  console.log('');
  console.log(START);
  console.time(END);

//  // Create symlinks if necessary..  { 'target': 'source' }
//  const symlinks = {
//    img: 'dist/img'
//  };
//
//  for (const [target, source] of Object.entries(symlinks)) {
//    if (!shell.test('-L', target)) {
//      console.log(`Creating symlink:  ${target} -> ${source}`);
//      shell.ln('-sf', source, target);
//    }
//  }

  // Start clean
  await $`rm -rf ./data/languages.json`;
  await $`rm -rf ./data/territory_languages.json`;
  await $`rm -rf ./data/l10n/*.en.json`;
  await $`rm -rf ./data/modules`;
  await $`rm -rf ./dist/data/**/*.json{,c,5}`;
  await $`rm -rf ./dist/data/modules`;
  await $`rm -rf ./svg/fontawesome/*.svg`;

  // Create target folders if necessary
  await $`mkdir -p ./data/l10n`;
  await $`mkdir -p ./dist/data/l10n`;


  // Gather icons from various places that we need assembled into a spritesheet.
  // Start with icons we want to use in the UI that aren't tied to other data.
  const icons = new Set([
    'far-star',
    'fas-circle-arrow-up',
    'fas-arrow-rotate-left',
    'fas-arrow-rotate-right',
    'fas-backward-step',
    'fas-filter',
    'fas-forward-step',
    'fas-i-cursor',
    'fas-lock',
    'fas-palette',
    'fas-question',
    'fas-star',
    'fas-th-list',
    'fas-triangle-exclamation',
    'fas-user-cog'
  ]);

  gatherQAIssueIcons(icons);
  gatherPresetIcons(icons);
  await writeIcons(icons);

  const territoryLanguages = { territoryLanguages: sortObject(gatherTerritoryLanguages()) };
  await Bun.write('./data/territory_languages.json', stringify(territoryLanguages, { maxLength: 9999 }) + '\n');

  const langInfo = Object.fromEntries(await CLDR.langNamesInNativeLang());
  const languages = { languages: sortObject(langInfo) };
  await Bun.write('./data/languages.json', stringify(languages, { maxLength: 200 }) + '\n');

  await writeEnJson();

  // copy `./data/*` files to `./dist/data/*`
  const glob = new Glob('./data/**/*.json{,c,5}');
  for (const src of glob.scanSync()) {
    const dest = src.replace(/\\/g, '/').replace('data/', 'dist/data/');
    await $`cp -f ${src} ${dest}`;
  }

  console.timeEnd(END);
}


function gatherQAIssueIcons(icons: Set<string>): void {
  for (const service of Object.values(qaDataJSON)) {
    if (!service.icons) continue;
    for (const icon of Object.values(service.icons)) {
      if (icon) {
        icons.add(icon);
      }
    }
  }
}


function gatherPresetIcons(icons: Set<string>): void {
  for (const source of [presetsJSON, categoriesJSON]) {
    for (const item of Object.values(source)) {
      if (item.icon) {
        // fix: FontAwesome v7 no longer has 'fas-vector-square'
        // see https://github.com/openstreetmap/id-tagging-schema/pull/1707 and previous
        if (item.icon === 'fas-vector-square') {
          item.icon = 'temaki-portrait_framed';
        }
        icons.add(item.icon);
      }
    }
  }
}


async function writeIcons(icons: Set<string>): Promise<void> {
  for (const icon of icons) {
    const [prefix, ...rest] = icon.split('-');
    const name = rest.join('-');

    if (['iD', 'rapid', 'maki', 'temaki', 'roentgen'].includes(prefix)) {
      continue;  // These are expected to live in an existing spritesheet..

    } else if (['fas', 'far', 'fab'].includes(prefix)) {   // FontAwesome..
      const folderMap: Record<string, string> = {
        fas: 'node_modules/@fortawesome/fontawesome-free/svgs/solid',
        far: 'node_modules/@fortawesome/fontawesome-free/svgs/regular',
        fab: 'node_modules/@fortawesome/fontawesome-free/svgs/brands'
      };
      const folder = folderMap[prefix];

      try {
        // copy and remove the comments
        const contents = await Bun.file(`${folder}/${name}.svg`).text();
        await Bun.write(`./svg/fontawesome/${icon}.svg`, contents.replace(/<!--[\s\S\n]*?-->/g, ''));
      } catch {
        console.error(styleText('yellow', `Error: No FontAwesome icon for ${icon}`));
      }

    } else {
      console.warn(`Unknown icon: ${icon}`);
    }
  }
}


function gatherTerritoryLanguages(): Record<string, string[]> {
  const allRawInfo = territoriesJSON.supplemental.territoryInfo;
  const territoryLanguages: Record<string, string[]> = {};

  for (const [territoryCode, territoryData] of Object.entries(allRawInfo)) {
    const territoryLangInfo = territoryData.languagePopulation;
    if (!territoryLangInfo) continue;
    const langCodes = Object.keys(territoryLangInfo);

    territoryLanguages[territoryCode.toLowerCase()] = langCodes.sort((langCode1, langCode2) => {
      const popPercent1 = parseFloat(territoryLangInfo[langCode1]._populationPercent);
      const popPercent2 = parseFloat(territoryLangInfo[langCode2]._populationPercent);
      if (popPercent1 === popPercent2) {
        return langCode1.localeCompare(langCode2, 'en', { sensitivity: 'base' });
      }
      return popPercent2 - popPercent1;
    }).map(langCode => langCode.replace('_', '-'));
  }

  return territoryLanguages;
}


// writeEnJson
// This generates the English language localization files
async function writeEnJson(): Promise<void> {
  // core.yaml
  const core = Bun.YAML.parse(await Bun.file('./data/core.yaml').text()) as CoreLocale;
  core.en.languageNames = Object.fromEntries(await CLDR.languageNamesInLanguageOf('en'));
  core.en.scriptNames = Object.fromEntries(await CLDR.scriptNamesInLanguageOf('en'));
  await Bun.write('./data/l10n/core.en.json', JSON.stringify(core, null, 2) + '\n');

  // community index
  const community = Bun.YAML.parse(await Bun.file('./node_modules/osm-community-index/i18n/en.yaml').text());
  await Bun.write('./data/l10n/community.en.json', JSON.stringify(community, null, 2) + '\n');

  // imagery
  const imagery = Bun.YAML.parse(await Bun.file('./node_modules/editor-layer-index/i18n/en.yaml').text()) as ImageryLocale;

  // Gather strings for Rapid imagery not included in the imagery index
  const rapidImageryData = Bun.JSON5.parse(await Bun.file('./data/rapid_imagery.json5').text()) as ImageryInput;

  // Imagery data is scoped now - look for the osm scope
  for (const scopeInput of rapidImageryData.scopes ?? []) {
    if (scopeInput?.scope !== 'osm') continue;

    for (const [id, props] of Object.entries(scopeInput.imagery ?? {})) {
      if (!props) continue;
      const target: ImageryLocale['en']['imagery'][string] = {};
      if (props.terms_text)   target.attribution = { text: props.terms_text };
      if (props.name)         target.name = props.name;
      if (props.description)  target.description = props.description;

      if (Object.keys(target).length) {
        imagery.en.imagery[id] = target;
      }
    }
  }

  await Bun.write('./data/l10n/imagery.en.json', stringify(imagery, { maxLength: 9999 }) + '\n');

  // tagging
  const taggingFile = './node_modules/@openstreetmap/id-tagging-schema/dist/translations/en.json';
  const tagging = await Bun.file(taggingFile).json() as TaggingLocale;

  // Gather strings for Rapid schema not included in the tagging index
  const rapidSchema = Bun.JSON5.parse(await Bun.file('./data/rapid_schema.json5').text()) as SchemaInput;

  // Schema data is scoped now - look for the osm scope
  for (const data of rapidSchema.scopes ?? []) {
    if (data?.scope !== 'osm') continue;

    // categories, presets
    for (const group of ['categories', 'presets'] as const) {
      const obj = data[group] ?? {};
      for (const [id, props] of Object.entries(obj)) {
        if (!props) continue;
        const target: Record<string, unknown> = {};
        if (props.name)                    target.name = props.name;
        if (Array.isArray(props.terms))    target.terms = props.terms.join(',');
        if (Array.isArray(props.aliases))  target.aliases = props.aliases.join('\n');

        if (Object.keys(target).length) {
          tagging.en.presets[group][id] = target;
        }
      }
    }

    // fields
    const obj = data.fields ?? {};
    for (const [id, props] of Object.entries(obj)) {
      if (!props) continue;
      const target: Record<string, unknown> = {};
      if (props.label && !props.label.startsWith('{')) {
        target.label = props.label;
      }
      if (props.placeholder && !props.placeholder.startsWith('{')) {
        target.placeholder = props.placeholder;
      }
      if (props.strings?.options) {
        target.options = props.strings.options;
      }

      if (Object.keys(target).length) {
        tagging.en.presets.fields[id] = target;
      }
    }

  }

  await Bun.write('./data/l10n/tagging.en.json', JSON.stringify(tagging, null, 2) + '\n');
}


// Returns an object with sorted keys and sorted values.
// (This is useful for file diffing)
function sortObject(obj: Record<string, unknown>): Record<string, unknown> | null {
  if (!obj) return null;

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj).sort(localeCompare);
  for (const k of keys) {
    sorted[k] = obj[k];
  }
  return sorted;
}
