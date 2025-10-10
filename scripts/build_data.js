/* eslint-disable no-console */
import fs from 'node:fs';
import stringify from 'json-stringify-pretty-compact';
import shell from 'shelljs';
import { styleText } from 'node:util';
import JSON5 from 'json5';
import YAML from 'js-yaml';

import { writeFileWithMeta } from './write_file_with_meta.js';
import * as CLDR from './cldr.js';
const localeCompare = new Intl.Collator('en').compare;

// Load source data
const categoriesFile = 'node_modules/@openstreetmap/id-tagging-schema/dist/preset_categories.min.json';
const fieldsFile = 'node_modules/@openstreetmap/id-tagging-schema/dist/fields.min.json';
const presetsFile = 'node_modules/@openstreetmap/id-tagging-schema/dist/presets.min.json';
const qaDataFile = 'data/qa_data.json';
const territoriesFile = 'node_modules/cldr-core/supplemental/territoryInfo.json';

const categoriesJSON = JSON5.parse(fs.readFileSync(categoriesFile, 'utf8'));
const fieldsJSON = JSON5.parse(fs.readFileSync(fieldsFile, 'utf8'));
const presetsJSON = JSON5.parse(fs.readFileSync(presetsFile, 'utf8'));
const qaDataJSON = JSON5.parse(fs.readFileSync(qaDataFile, 'utf8'));
const territoriesJSON = JSON5.parse(fs.readFileSync(territoriesFile, 'utf8'));


//
// This script builds all the data files
// Files under `/data` are part of the project and checked in
// Files under `/dist` are build artifacts and not checked in
//

let _buildPromise = null;


// If called directly, do the thing.
if (process.argv[1].indexOf('build_data.js') > -1) {
  buildDataAsync();
} else {
  module.exports = buildDataAsync;
}


function buildDataAsync() {
  if (_buildPromise) return _buildPromise;

  const START = '🏗   ' + styleText('yellow', 'Building data...');
  const END = '👍  ' + styleText('green', 'data built');

  console.log('');
  console.log(START);
  console.time(END);

  return _buildPromise = Promise.resolve(true)
    .then(() => {
      // Create symlinks if necessary..  { 'target': 'source' }
      const symlinks = {
        img: 'dist/img'
      };

      for (const [target, source] of Object.entries(symlinks)) {
        if (!shell.test('-L', target)) {
          console.log(`Creating symlink:  ${target} -> ${source}`);
          shell.ln('-sf', source, target);
        }
      }

      // Start clean
      shell.rm('-rf', [
        'data/languages.json',
        'data/territory_languages.json',
        'data/l10n/*.en.json',
        'data/modules',
        'dist/data/**/*.json',
        'dist/data/modules',
        'svg/fontawesome/*.svg'
      ]);

      // Create target folders if necessary
      shell.mkdir('-p', [
        'data/l10n',
        'dist/data/l10n'
      ]);

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
      writeIcons(icons);

      const territoryLanguages = { territoryLanguages: sortObject(gatherTerritoryLanguages()) };
      fs.writeFileSync('data/territory_languages.json', stringify(territoryLanguages, { maxLength: 9999 }) + '\n');

      const languages = { languages: sortObject(CLDR.langNamesInNativeLang()) };
      fs.writeFileSync('data/languages.json', stringify(languages, { maxLength: 200 }) + '\n');

      writeEnJson();

      // copy `data/` files to `dist/data/` and stamp with metadata
      for (const sourceFile of fs.globSync('data/**/*.json')) {
        const destinationFile = sourceFile.replace(/\\/g, '/').replace('data/', 'dist/data/');
        copyToDistSync(sourceFile, destinationFile);
      }

      for (const file of fs.globSync('dist/data/**/*.json')) {
        minifySync(file);
      }
    })
    .then(() => {
      console.timeEnd(END);
      console.log('');
      _buildPromise = null;
    })
    .catch((err) => {
      console.error(err);
      console.log('');
      _buildPromise = null;
      process.exit(1);
    });
}


function gatherQAIssueIcons(icons) {
  for (const service of Object.values(qaDataJSON)) {
    if (!service.icons) continue;
    for (const icon of Object.values(service.icons)) {
      if (icon) {
        icons.add(icon);
      }
    }
  }
}


function gatherPresetIcons(icons) {
  for (const source of [presetsJSON, categoriesJSON, fieldsJSON]) {
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


function writeIcons(icons) {
  for (const icon of icons) {
    const [prefix, ...rest] = icon.split('-');
    const name = rest.join('-');

    if (['iD', 'rapid', 'maki', 'temaki', 'roentgen'].includes(prefix)) {
      continue;  // These are expected to live in an existing spritesheet..

    } else if (['fas', 'far', 'fab'].includes(prefix)) {   // FontAwesome..
      const folder = {
        fas: 'node_modules/@fortawesome/fontawesome-free/svgs/solid',
        far: 'node_modules/@fortawesome/fontawesome-free/svgs/regular',
        fab: 'node_modules/@fortawesome/fontawesome-free/svgs/brands'
      }[prefix];

      try {
        // copy and remove the comments
        const src = fs.readFileSync(`${folder}/${name}.svg`, 'utf8');
        fs.writeFileSync(`svg/fontawesome/${icon}.svg`, src.replace(/<!--[\s\S\n]*?-->/g, ''));
      } catch {
        console.error(styleText('yellow', `Error: No FontAwesome icon for ${icon}`));
      }

    } else {
      console.warn(`Unknown icon: ${icon}`);
    }
  }
}


function gatherTerritoryLanguages() {
  let allRawInfo = territoriesJSON.supplemental.territoryInfo;
  let territoryLanguages = {};

  for (const [territoryCode, territoryData] of Object.entries(allRawInfo)) {
    let territoryLangInfo = territoryData.languagePopulation;
    if (!territoryLangInfo) continue;
    let langCodes = Object.keys(territoryLangInfo);

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
// This generates the English language localication files
function writeEnJson() {
  try {
    //
    // core.yaml
    //
    const core = YAML.load(fs.readFileSync('data/core.yaml', 'utf8'));
    core.en.languageNames = CLDR.languageNamesInLanguageOf('en');
    core.en.scriptNames = CLDR.scriptNamesInLanguageOf('en');
    fs.writeFileSync('data/l10n/core.en.json', JSON.stringify(core, null, 2) + '\n');

    //
    // community index
    //
    const community = YAML.load(fs.readFileSync('node_modules/osm-community-index/i18n/en.yaml', 'utf8'));
    fs.writeFileSync('data/l10n/community.en.json', JSON.stringify(community, null, 2) + '\n');

    //
    // imagery
    //
    const imagery = YAML.load(fs.readFileSync('node_modules/editor-layer-index/i18n/en.yaml', 'utf8'));

    // Gather strings for imagery overrides not included in the imagery index
    const manualImagery = JSON5.parse(fs.readFileSync('data/manual_imagery.json', 'utf8')).manualImagery;

    for (const source of manualImagery) {
      if (!source) continue;
      const target = {};
      if (source.attribution?.text)  target.attribution = { text: source.attribution.text };
      if (source.name)               target.name = source.name;
      if (source.description)        target.description = source.description;

      if (Object.keys(target).length) {
        imagery.en.imagery[source.id] = target;
      }
    }

    fs.writeFileSync('data/l10n/imagery.en.json', stringify(imagery, { maxLength: 9999 }) + '\n');

    //
    // tagging
    //
    const taggingFile = 'node_modules/@openstreetmap/id-tagging-schema/dist/translations/en.json';
    const tagging = JSON5.parse(fs.readFileSync(taggingFile, 'utf8'));

    // Gather strings for tagging overrides not included in the tagging index
    const taggingOverrides = JSON5.parse(fs.readFileSync('data/preset_overrides.json', 'utf8'));

    // categories, presets
    for (const group of ['categories', 'presets']) {
      for (const [key, source] of Object.entries(taggingOverrides[group])) {
        if (!source) continue;
        const target = {};
        if (source.name)                    target.name = source.name;
        if (Array.isArray(source.terms))    target.terms = source.terms.join(',');
        if (Array.isArray(source.aliases))  target.aliases = source.aliases.join('\n');

        if (Object.keys(target).length) {
          tagging.en.presets[group][key] = target;
        }
      }
    }

    // fields
    for (const [key, source] of Object.entries(taggingOverrides.fields)) {
      if (!source) continue;
      const target = {};
      if (source.label && !source.label.startsWith('{')) {
        target.label = source.label;
      }
      if (source.placeholder && !source.placeholder.startsWith('{')) {
        target.placeholder = source.placeholder;
      }
      if (source.strings?.options) {
        target.options = source.strings.options;
      }

      if (Object.keys(target).length) {
        tagging.en.presets.fields[key] = target;
      }
    }

    fs.writeFileSync('data/l10n/tagging.en.json', JSON.stringify(tagging, null, 2) + '\n');

  } catch (err) {
    console.error(styleText('red', `Error - ${err.message}`));
    process.exit(1);
  }
}


// copyToDistSync
// Copies a file to the /dist folder, but includes a block of metadata when saving it
function copyToDistSync(inFile, outFile) {
  try {
    const contents = fs.readFileSync(inFile, 'utf8');
    writeFileWithMeta(outFile, contents);
  } catch (err) {
    console.error(styleText('red', `Error - ${err.message} copying:`));
    console.error(styleText('yellow', '  ' + inFile));
    process.exit(1);
  }
}


// minifySync
// Minifies a JSON file, saving the `.min.json` file alongside the source file
function minifySync(inFile) {
  try {
    const contents = fs.readFileSync(inFile, 'utf8');
    const outFile = inFile.replace('.json', '.min.json');
    fs.writeFileSync(outFile, JSON.stringify(JSON5.parse(contents)));
  } catch (err) {
    console.error(styleText('red', `Error - ${err.message} minifying:`));
    console.error(styleText('yellow', '  ' + inFile));
    process.exit(1);
  }
}


// Returns an object with sorted keys
function sortObject(obj) {
  if (!obj) return null;

  const sorted = {};
  Object.keys(obj).sort(localeCompare).forEach(k => sorted[k] = obj[k]);

  return sorted;
}


export default buildDataAsync;
