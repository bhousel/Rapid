import { Glob } from 'bun';
import autoprefixer from 'autoprefixer';
import cssnano from 'cssnano';
import postcss from 'postcss';
import prepend from 'postcss-selector-prepend';
import { styleText } from 'node:util';


await buildCSS();

// This script concats all of the `/css/*` files into a single `dist/rapid.css` file.
async function buildCSS(): Promise<void> {
  const START = '🏗   ' + styleText('yellow', 'Building css…');
  const END = '👍  ' + styleText('green', 'css built');

  console.log('');
  console.log(START);
  console.time(END);

  const prefixer = postcss([ autoprefixer, prepend({ selector: '.ideditor ' }) ]);
  const minifier = postcss([ cssnano({ preset: 'default' })]);

  // Read and prefix all CSS files
  const filepaths = [...new Glob('./css/*.css').scanSync()];
  const sources = await Promise.all( filepaths.map((filepath: string) => Bun.file(filepath).text()) );
  const prefixed = await Promise.all( sources.map((src: string) => prefixer.process(src, { from: undefined })) );

  // Concatenate prefixed results
  const concat = prefixed.map(result => result.css).join('\n');

  // Write regular and minified CSS
  const minified = await minifier.process(concat, { from: undefined });
  await Bun.write('./dist/css/rapid.css', concat);
  await Bun.write('./dist/css/rapid.min.css', minified.css);

  console.timeEnd(END);
}
