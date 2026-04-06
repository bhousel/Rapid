import { styleText } from 'node:util';

const project = '@rapideditor/rapid';
const hostname = '127.0.0.1';
const port = 8080;
const matchCDN = new RegExp(`(['"\`])(https?://cdn.jsdelivr.*${project}.*/)(dist.*["'\`])`, 'gi');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*'
};


//
// Note: we don't use this for Rapid currently, but leave it in anyway
//
// Replace urls for CDN `dist/*` files with local `dist/*` files.
// e.g. 'https://cdn.jsdelivr.net/npm/path/to/dist/file.js' -> '/dist/file.js'
function replaceCDNPath(s: string): string {
  return s.replaceAll(matchCDN, replacer);
}

// The replacer function for replaceAll:
// p1 = "           - begin string
// p2 = cdn url     - removed
// p3 = dist/file"  - 'dist' + file (if any) + end string
function replacer(match: string, p1: string, p2: string, p3: string): string {
  return p1 + p3;
}


// Start the server!
const server = Bun.serve({
  hostname: hostname,
  port: port,
  development: {
    console: true
  },
  async fetch(req) {
    const url = new URL(req.url);

    // Handle special cases first
    // CORS preflight requests
    if (req.method === 'OPTIONS') {
      console.log(styleText('yellowBright', `${req.method}:  ${url.pathname}`));
      console.log(styleText('greenBright', `200:  Preflight OK`));
      return new Response('Preflight OK', { status: 200, ...CORS });
    }

    // By default, redirect root `/` to `dist/`
    if (url.pathname === '/') {
      console.log(styleText('yellowBright', `307:  Temporary Redirect → 'dist/'`));
      return new Response('Temporary Redirect', { status: 307, headers: { location: 'dist/', ...CORS }});
    }
    // Chrome Devtools - generate a workspace JSON file
    // see: http://goo.gle/devtools-automatic-workspace-folders
    if (url.pathname === '/.well-known/appspecific/com.chrome.devtools.json') {
      const contentType = 'application/json;charset=utf-8';
      const root = process.cwd();
      const json = {
        workspace: {
          root: root,
          uuid: Bun.randomUUIDv7()
        }
      };

      console.log(styleText('yellowBright', `${req.method}:  ${url.pathname}`));
      console.log(
        styleText('greenBright', `200:  Generating workspace JSON`) +
        styleText('green', `  ${contentType}`)
      );
      return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': contentType, ...CORS }});
    }

    const path = url.pathname.split('/');
    const last = path.length - 1;
    console.log(styleText('yellowBright', `${req.method}:  ${url.pathname}`));

    if (path[last] === '') {   // no filename, default to 'index.html'
      path[last] = 'index.html';
    }

    const filepath = '.' + path.join('/');  // .replace('.min', '');
    try {
      const file = Bun.file(filepath);
      if (await file.exists()) {
        console.log(
          styleText('greenBright', `200:  Found → '${file.name}'`) +
          styleText('green', `  ${file.type}`)
        );
        if (/(html|javascript)/.test(file.type)) {
          const content: string = await file.text();
          return new Response(replaceCDNPath(content), { headers: { 'content-type': file.type, ...CORS }});
        } else {
          return new Response(file, { headers: { 'content-type': file.type, ...CORS } });
        }
      } else {
        console.log(styleText('redBright', `404:  Not Found → '${filepath}'`));
        return new Response('Not Found', { status: 404 });
      }
    } catch (error) {
      console.log(styleText('redBright', `500:  Server Error → '${filepath}'`));
      console.error(error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
});

console.log('');
console.log(styleText(['blue', 'bold'], `Bun v${Bun.version}`));
console.log(styleText('cyanBright', `Serving:    dist/*, test/*`));
console.log(styleText('cyanBright', `Listening:  ${server.url}`));
console.log(styleText('cyanBright', `Dev Build:  http://127.0.0.1:8080/dist/index-dev.html`));
console.log(styleText(['whiteBright', 'bold'], `Ctrl-C to stop`));
console.log('');
