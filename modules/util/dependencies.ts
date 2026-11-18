// Make very sure this resolves to Rapid's `package.json`
// If you mess up the `../`s, the resolver may import another random package.json from somewhere else.
import { dependencies } from '../../package.json' with { type: 'json' };


/** The name of a package listed in the `dependencies` of Rapid's `package.json` */
export type DependencyName = keyof typeof dependencies;

const CDN_BASE = 'https://cdn.jsdelivr.net/npm';


/**
 * Returns the version of a dependency, as listed in Rapid's `package.json`, without its range prefix.
 * `bun update` keeps the lower bound of each range equal to the installed version,
 * so this is the version that Rapid was built and tested with.
 *
 * @param name - The package name, e.g. `'maplibre-gl'`
 * @return The exact version, e.g. `'6.18.0'` for a `'^6.18.0'` range, or `undefined` if the package
 *   isn't a dependency or its specifier isn't a plain version (e.g. a `github:` dependency)
 *
 * @example
 * ```ts
 * utilDependencyVersion('maplibre-gl');   // '6.18.0'
 * ```
 */
export function utilDependencyVersion(name: DependencyName): string | undefined {
  const deps: Record<string, string> = dependencies;
  const specifier = deps[name];
  if (typeof specifier !== 'string') return undefined;

  const match = specifier.match(/^[\^~]?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/);
  return match?.[1];
}


/**
 * Returns a CDN URL for a file in a dependency, pinned to the exact version in Rapid's `package.json`.
 * This keeps the files that Rapid loads at runtime in step with the package versions it was built with.
 *
 * @param name - The package name, e.g. `'maplibre-gl'`
 * @param asset - Optional path within the package, e.g. `'dist'` or `'dist/maplibre-gl.css'`
 * @return The CDN URL, e.g. `'https://cdn.jsdelivr.net/npm/maplibre-gl@6.18.0/dist'`
 * @throws Error if the package has no exact version in `package.json` (see `utilDependencyVersion`)
 *
 * @example
 * ```ts
 * utilCDNPath('maplibre-gl', 'dist');   // 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.18.0/dist'
 * ```
 */
export function utilCDNPath(name: DependencyName, asset: string = ''): string {
  const version = utilDependencyVersion(name);
  if (!version) {
    throw new Error(`utilCDNPath: "${name}" has no exact version in package.json`);
  }

  const path = asset.replace(/^\/+/, '');
  return `${CDN_BASE}/${name}@${version}` + (path ? `/${path}` : '');
}
