/* eslint-disable no-console */
import autoprefixer from 'autoprefixer';
import concat from 'concat-files';
import fs from 'node:fs';
import postcss from 'postcss';
import prepend from 'postcss-selector-prepend';
import { promisify, styleText } from 'node:util';

//
// This script concats all of the `/css/*` files into a single `dist/rapid.css` file.
//

let _buildPromise = null;

// If called directly, do the thing.
if (process.argv[1].indexOf('build_css.js') > -1) {
  buildCSSAsync();
}

export function buildCSSAsync() {
  if (_buildPromise) return _buildPromise;

  const START = '🏗   ' + styleText('yellow', 'Building css...');
  const END = '👍  ' + styleText('green', 'css built');

  console.log('');
  console.log(START);
  console.time(END);

  const globProm = promisify(fs.glob);
  const concatProm = promisify(concat);

  return _buildPromise = globProm('css/**/*.css')
    .then(files => concatProm(files.sort(), 'dist/rapid.css'))
    .then(() => {
      const css = fs.readFileSync('dist/rapid.css', 'utf8');
      return postcss([ autoprefixer, prepend({ selector: '.ideditor ' }) ])
        .process(css, { from: 'dist/rapid.css', to: 'dist/rapid.css' });
    })
    .then(result => fs.writeFileSync('dist/rapid.css', result.css))
    .then(() => {
      console.timeEnd(END);
      console.log('');
      _buildPromise = null;
    })
    .catch(err => {
      console.error(err);
      console.log('');
      _buildPromise = null;
      process.exit(1);
    });
}
