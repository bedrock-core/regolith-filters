// Import a TypeScript resource module from disk: esbuild bundles it (relative
// imports between locale files are allowed) into an .mjs under the Regolith
// cache, which is then dynamic-imported. Resource modules are data-only —
// anything reaching for game APIs fails right here, which is intended.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from 'esbuild';

/**
 * @param {string} absPath  absolute path of the .ts module
 * @param {string} cacheDir directory for the transpiled intermediates
 * @returns {Promise<unknown>} the module's default export
 */
export async function loadTsModule(absPath, cacheDir) {
  const result = await build({
    entryPoints: [absPath],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    write: false,
    logLevel: 'silent',
  });

  const code = result.outputFiles[0].text;
  const hash = crypto.createHash('sha1').update(absPath).update(code).digest('hex').slice(0, 16);
  const file = path.join(cacheDir, `${hash}.mjs`);

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, code, 'utf-8');

  const mod = await import(pathToFileURL(file).href);
  if (mod.default === undefined) {
    throw new Error(`${absPath} has no default export — resource modules must default-export their object`);
  }
  return mod.default;
}
