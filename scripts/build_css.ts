import { Glob } from 'bun';
import autoprefixer from 'autoprefixer';
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

  const processor = postcss([ autoprefixer, prepend({ selector: '.ideditor ' }) as postcss.AcceptedPlugin ]);

  return Promise.resolve()
    .then(() => {
      return [...new Glob('./css/*.css').scanSync()];
    })
    .then((filepaths: string[]) => {
      return Promise.all( filepaths.map((filepath: string) => Bun.file(filepath).text()) );
    })
    .then((contents: string[]) => {
      return Promise.all( contents.map((content: string) => processor.process(content, { from: undefined })) );
    })
    .then(results => {
      let concat = '';
      for (const result of results) {
        concat += result + '\n';
      }
      return Bun.write('./dist/css/rapid.css', concat);
    })
    .then(() => console.timeEnd(END));
}
