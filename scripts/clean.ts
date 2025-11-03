import { $, Glob } from 'bun';

$.nothrow();  // If a shell command returns nonzero, keep going.

// Remove these files if found anywhere
const files = [
  '.DS_Store',
  'npm-debug.log',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock'
];

for (const f of files) {
  const glob = new Glob(`**/${f}`);
  for await (const file of glob.scan({ dot: true })) {
    await $`rm -f ${file}`;
  }
}

// Remove these specific folders
const folders = [
  './coverage',
  './dist/css',
  './dist/javascript',
  './dist/js',
  './dist/json',
  './dist/svg',
  './dist/ts'
];
for (const f of folders) {
  await $`rm -rf ${f}`;
}

// Legacy: what `run clean` did before:
await $`rm -f ./dist/esbuild.json`;
await $`rm -f ./dist/*.js`;
await $`rm -f ./dist/*.map`;
await $`rm -f ./dist/*.css`;
await $`rm -f ./dist/img/*-sprite.svg`;
