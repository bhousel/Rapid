import { Glob } from 'bun';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { styleText } from 'node:util';
import SVGSpriter from 'svg-sprite';

export {};

await buildSVG();

async function buildSVG(): Promise<void> {
  const START = '🏗   ' + styleText('yellow', 'Building svg…');
  const END = '👍  ' + styleText('green', 'svg built');

  console.log('');
  console.log(START);
  console.time(END);

  const spritesheets = [
    { name: 'community-sprite',  idPrefix: 'community-',  glob: 'node_modules/osm-community-index/dist/img/*.svg' },
    { name: 'fa-sprite',         idPrefix: null,          glob: 'svg/fontawesome/*.svg' },
    { name: 'maki-sprite',       idPrefix: 'maki-',       glob: 'node_modules/@mapbox/maki/icons/*.svg' },
    { name: 'mapillary-sprite',  idPrefix: null,          glob: 'node_modules/@rapideditor/mapillary_sprite_source/package_signs/*.svg' },
    // { name: 'mapillary-object-sprite', idPrefix: null,    glob: 'node_modules/@rapideditor/mapillary_sprite_source/package_objects/*.svg' },
    { name: 'pinhead-sprite',    idPrefix: 'pinhead-',    glob: 'node_modules/@waysidemapping/pinhead/dist/icons/*.svg' },
    { name: 'rapid-sprite',      idPrefix: 'rapid-',      glob: 'svg/rapid-sprite/**/*.svg' },
    { name: 'roentgen-sprite',   idPrefix: 'roentgen-',   glob: 'node_modules/@enzet/roentgen/icons/*.svg' },
    { name: 'temaki-sprite',     idPrefix: 'temaki-',     glob: 'node_modules/@rapideditor/temaki/icons/*.svg' },
  ];

  await Promise.all(spritesheets.map(d => buildSpritesheet(d)));

  console.timeEnd(END);
}


interface SpritesheetConfig {
  name: string;
  idPrefix: string | null;
  glob: string;
}

async function buildSpritesheet(config: SpritesheetConfig): Promise<void> {
  const outFile = `dist/svg/${config.name}.svg`;

  const spriter = new SVGSpriter({
    dest: '.',
    shape: {
      id: {
        generator: config.idPrefix ? `${config.idPrefix}%s` : undefined,
      },
    },
    mode: {
      symbol: {
        dest: '.',
        sprite: outFile,
      },
    },
  });

  const glob = new Glob(config.glob);
  for (const filePath of glob.scanSync('.')) {
    const absPath = resolve(filePath);
    spriter.add(absPath, null, readFileSync(absPath, 'utf-8'));
  }

  const { result } = await spriter.compileAsync();

  for (const mode of Object.values(result) as Record<string, { path: string; contents: Buffer }>[]) {
    for (const resource of Object.values(mode)) {
      await Bun.write(resource.path, resource.contents);
    }
  }
}
