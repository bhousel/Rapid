
await Promise.all([
   Bun.build({
    entrypoints: ['./modules/main_prod.js'],
    outdir: './dist/js',
    target: 'browser',
    sourcemap: 'linked',
    naming: 'rapid.[ext]'  // .js
  }),

  Bun.build({
    entrypoints: ['./modules/main_dev.js'],
    outdir: './dist/js',
    target: 'browser',
    sourcemap: 'linked',
    naming: 'rapid-dev.[ext]'  // .js
  })
]);
