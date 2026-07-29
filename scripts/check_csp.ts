import { updateContentSecurityPolicy } from './content_security_policy.ts';


const documents = [
  { file: 'dist/index.html', options: { allowUnsafeEval: true } },
  { file: 'dist/index-dev.html', options: { allowUnsafeEval: true } },
  { file: 'dist/land.html', options: {} }
];

let failed = false;

for (const { file, options } of documents) {
  const html = await Bun.file(file).text();
  if (updateContentSecurityPolicy(html, options) !== html) {
    console.error(`${file}: Content Security Policy is missing or stale`);
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
}
