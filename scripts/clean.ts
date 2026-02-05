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

// Legacy: Remove some older things from the project
await $`rm -f ./dist/esbuild.json`.quiet();
await $`rm -f ./dist/data/*.json{,c,5}`.quiet();
await $`rm -f ./dist/*.js`.quiet();
await $`rm -f ./dist/*.map`.quiet();
await $`rm -f ./dist/*.css`.quiet();
await $`rm -f ./dist/img/*-sprite.svg`.quiet();
await $`rm -f ./img`.quiet();
