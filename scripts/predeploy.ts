// This script should normally only be run from a GitHub deploy action.
// It rewrites the urls in `index.html` to instead point to a unique 'buildID' in our S3 bucket.
// Then we can just copy this `index.html` around and things will just work.
// This is how we do deploys of Rapid.

import { updateContentSecurityPolicy } from './content_security_policy.ts';


const now = new Date();
const yyyy = now.getUTCFullYear();
const mm = ('0' + (now.getUTCMonth() + 1)).slice(-2);
const dd = ('0' + now.getUTCDate()).slice(-2);

// Get these things from environment (fallbacks for testing)
const yyyymmdd = process.env.YYYYMMDD  ?? `${yyyy}${mm}${dd}`;
const buildSHA = process.env.BUILD_SHA ?? 'deadc0de';     // normally the git short hash
const buildID  = process.env.BUILD_ID  ?? `local-${buildSHA}`;

const isDebug = /^(local|main|pull-request)-/.test(buildID);
const path = `/rapid/${buildID}`;
const file = 'dist/index.html';

// If you want to test this script, uncomment these lines to copy 'index.html' instead of modifying it in place.
// Then run `bun scripts/predeploy.ts`
// file = 'dist/index-copy.html';
// await Bun.write(file, await Bun.file('dist/index.html').text());

// Read the file
let content = await Bun.file(file).text();

// Replace strings to use the buildID urls
content = content.replaceAll('dist/', `${path}/`);
content = content.replaceAll('img/', `${path}/img/`);
content = content.replaceAll('rapid.css', `${path}/rapid.css`);
content = content.replaceAll('rapid.js', `${path}/rapid.js`);
content = content.replace(/context.assetPath.*;/, `context.assetPath = '${path}/';`);
content = content.replace(/context.buildID.*;/, `context.buildID = '${buildID}';`);
content = content.replace(/context.buildSHA.*;/, `context.buildSHA = '${buildSHA}';`);
content = content.replace(/context.buildDate.*;/, `context.buildDate = '${yyyymmdd}';`);

if (isDebug) {
  content = content.replaceAll('rapid.min.js', `${path}/rapid.js`);      // don't use minified rapid
} else {
  content = content.replaceAll('rapid.min.js', `${path}/rapid.min.js`);
}

// The replacements above change an inline script, so refresh its CSP hash.
content = updateContentSecurityPolicy(content, { allowUnsafeEval: true });

// Write the file back
await Bun.write(file, content);

export {};
