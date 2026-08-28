// Compiles one screen module by bundling it together with the pipeline.
//
// The pipeline runs INSIDE the bundle rather than in the filter, so it resolves
// `@bedrock-core/ui-runtime` and `@bedrock-core/ui-compile` from the project's
// own node_modules. A screen therefore always compiles against the library
// version the addon actually ships, and the filter can never drift from it.
// That is also why every value the emitted JSON UI shares with the runtime —
// the character table, the layout property, the highest layout key — is read
// off the bundle rather than kept here.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const stub = path.join(import.meta.dirname, 'stubs', 'minecraft.cjs');

/**
 * @typedef {object} CompiledScreen
 * @property {string} name        the screen's name, from its file name
 * @property {string} namespace   JSON UI namespace the layout was emitted into
 * @property {number} layoutId    key the router picks this layout by, derived from `<namespace>_<name>`
 * @property {string} entity      type of the entity the screen opens from
 * @property {object} document    the emitted JSON UI document
 * @property {{ sentinels: number, drawn: number, channels: number, size: number }} allocation
 * @property {boolean} hasBackdrop
 * @property {boolean} hasText    whether any text is live, i.e. decoded through the character table
 */

/**
 * @typedef {object} CompiledFormScreen
 * @property {string} name
 * @property {string} addon
 * @property {string} namespace   JSON UI namespace the layout was emitted into
 * @property {string} title       what the runtime shows the form with, and what the mount gates on
 * @property {object} document    the emitted JSON UI document
 * @property {boolean} hasBackdrop
 */

/**
 * @typedef {object} ScreenBundle
 * @property {'chest' | 'form'} kind   which screen the author's root asked for
 * @property {CompiledScreen | CompiledFormScreen} compiled
 * @property {(screens: CompiledScreen[]) => { hooks: { file: string, document: object }[], router: object, routerFile: string }} buildRouter the addon's hooks into vanilla's chest files, its router, and the router's pack path
 * @property {(screens: object[], addon: string) => { hook: { file: string, document: object }, router: object, routerFile: string }} formRouter the addon's hook into the compiled-form mount, and its router
 * @property {string[]} lang           the `.lang` lines live text decodes through
 * @property {string} layoutProperty   entity property the runtime reads the layout key from
 * @property {number} maxLayout        highest layout key the runtime can address
 */

/**
 * The generated entry: import the screen, compile it, and hand back the result
 * together with what the filter needs from the project's library.
 *
 * @param {string} screenPath absolute path of the screen module
 * @param {string} name       the screen's name
 * @param {string} namespace  the addon namespace the screen is emitted under
 */
const entrySource = (screenPath, name, namespace) => `
// Namespace import, not a named one: esbuild fails the build outright on a
// named import a module does not export, and a missing default deserves the
// message below instead.
import * as screenModule from ${JSON.stringify(screenPath)};
import { buildRouter, compileFormScreen, compileScreen, formRouter } from '@bedrock-core/ui-compile';
import {
  buildScreenOnce, charsetLang, concreteRoots, CONTAINER_TYPE, LAYOUT_PROPERTY, MAX_LAYOUT,
} from '@bedrock-core/ui-runtime/compile';

const Screen = screenModule.default;

if (typeof Screen !== 'function') {
  throw new Error('a screen module must default-export a component');
}

// Which screen the author asked for is the root they wrote: \`<Container>\` is a
// chest screen the way \`<Form>\` is a modal. Built once here to read that, and
// again by the compiler — a build render is cheap and leaves nothing behind.
const roots = concreteRoots(buildScreenOnce(Screen));
const kind = roots.length === 1 && roots[0].type === CONTAINER_TYPE ? 'chest' : 'form';

// The COMPONENT, not the result of calling it: the compiler renders it under
// its own owner, which is what makes the hooks inside it resolve.
export default {
  kind,
  compiled: kind === 'chest'
    ? compileScreen(Screen, { name: ${JSON.stringify(name)}, namespace: ${JSON.stringify(namespace)} })
    : compileFormScreen(Screen, { name: ${JSON.stringify(name)}, namespace: ${JSON.stringify(namespace)} }),
  buildRouter,
  formRouter,
  lang: charsetLang(),
  layoutProperty: LAYOUT_PROPERTY,
  maxLayout: MAX_LAYOUT,
};
`;

/**
 * @param {object} options
 * @param {string} options.screenPath      absolute path of the screen module
 * @param {string} options.name            the screen's name
 * @param {string} options.namespace       the addon namespace the screen is emitted under
 * @param {string} options.cacheDir        where transpiled intermediates land
 * @param {string} options.jsxImportSource jsxImportSource for the screen's JSX
 * @returns {Promise<ScreenBundle>}
 */
export async function loadScreen({ screenPath, name, namespace, cacheDir, jsxImportSource }) {
  const result = await build({
    stdin: {
      contents: entrySource(screenPath, name, namespace),
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
