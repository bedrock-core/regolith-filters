// Compiles one screen module by bundling it together with the pipeline.
//
// The pipeline runs INSIDE the bundle rather than in the filter, so it resolves
// `@bedrock-core/ui-runtime` and `@bedrock-core/ui-compile` from the project's
// own node_modules. A screen therefore always compiles against the library
// version the addon actually ships, and the filter can never drift from it.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const stub = path.join(import.meta.dirname, 'stubs', 'minecraft.cjs');

/**
 * The generated entry: import the screen, run every phase, hand back both the
 * IR — which the caller needs for allocation — and the emitted document.
 *
 * @param {string} screenPath absolute path of the screen module
 * @param {string} namespace  JSON UI namespace for this screen
 * @param {string} collection collection every slot and channel reads
 */
const entrySource = (screenPath, namespace, collection, keyPrefix) => `
// Namespace import, not a named one: \`entity\` is optional, and esbuild fails
// the build outright on a named import a module does not export.
import * as screenModule from ${JSON.stringify(screenPath)};

const Screen = screenModule.default;
import { charsetLang, computeLayout, expandStatic } from '@bedrock-core/ui-runtime/compile';
import { emit, toIr } from '@bedrock-core/ui-compile';

if (typeof Screen !== 'function') {
  throw new Error('a screen module must default-export a component');
}

// The COMPONENT, not the result of calling it: hooks resolve against the
// dispatcher expandStatic installs, so calling it first runs them with none.
const ir = toIr(computeLayout(expandStatic({ type: Screen, props: {} })), {
  namespace: ${JSON.stringify(namespace)},
  collection: ${JSON.stringify(collection)},
});

// The character table comes from the PROJECT'S runtime, not the filter's, so
// the codes a screen is compiled against are the codes its runtime writes.
export default {
  ir,
  document: emit(ir),
  entity: screenModule.entity,
  lang: charsetLang(${JSON.stringify(keyPrefix)}),
};
`;

/**
 * @param {object} options
 * @param {string} options.screenPath absolute path of the screen module
 * @param {string} options.namespace  JSON UI namespace for this screen
 * @param {string} options.collection collection every slot and channel reads
 * @param {string} options.cacheDir   where transpiled intermediates land
 * @param {string} options.jsxImportSource jsxImportSource for the screen's JSX
 * @param {string} options.keyPrefix    key the character table is generated under
 * @returns {Promise<{ ir: object, document: object, entity?: string }>}
 */
export async function compileScreen({
  screenPath, namespace, collection, cacheDir, jsxImportSource, keyPrefix,
}) {
  const result = await build({
    stdin: {
      contents: entrySource(screenPath, namespace, collection, keyPrefix),
      resolveDir: path.dirname(screenPath),
      sourcefile: `${path.basename(screenPath)}.entry.tsx`,
      loader: 'tsx',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    jsxImportSource,
    // The game modules only have to exist; see the stub for why.
    alias: {
      '@minecraft/server': stub,
      '@minecraft/server-ui': stub,
    },
    write: false,
    logLevel: 'silent',
  });

  const code = result.outputFiles[0].text;
  const hash = crypto.createHash('sha1').update(screenPath).update(code).digest('hex').slice(0, 16);
  const file = path.join(cacheDir, `${hash}.mjs`);

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, code, 'utf-8');

  const mod = await import(pathToFileURL(file).href);

  return mod.default;
}
