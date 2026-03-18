import { styleText } from 'node:util';

export {};
const outdir = './dist/js';

await buildJS();

async function buildJS(): Promise<void> {
  const START = '🏗   ' + styleText('yellow', 'Building js…');
  const END = '👍  ' + styleText('green', 'js built');

  console.log('');
  console.log(START);
  console.time(END);

  await Promise.all([
    Bun.build({
      entrypoints: ['./modules/main_prod.js'],
      outdir: outdir,
      target: 'browser',
      sourcemap: 'linked',
      naming: 'rapid.[ext]',  // .js
      metafile: true
    }).then(result => {
      Bun.write(`${outdir}/rapid.meta.json`, JSON.stringify(result.metafile));
    }),

    Bun.build({
      entrypoints: ['./modules/main_prod.js'],
      outdir: outdir,
      target: 'browser',
      sourcemap: 'linked',
      naming: 'rapid.min.[ext]',  // .js
      minify: true
    }),

    Bun.build({
      entrypoints: ['./modules/main_dev.js'],
      outdir: outdir,
      target: 'browser',
      sourcemap: 'linked',
      naming: 'rapid-dev.[ext]',  // .js
      metafile: true
    }).then(result => {
      Bun.write(`${outdir}/rapid-dev.meta.json`, JSON.stringify(result.metafile));
    }),

    Bun.build({
      entrypoints: ['./modules/main_dev.js'],
      outdir: outdir,
      target: 'browser',
      sourcemap: 'linked',
      naming: 'rapid-dev.min.[ext]',  // .js
      minify: true
    })
  ]);

  console.timeEnd(END);
}
