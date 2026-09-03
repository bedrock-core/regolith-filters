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

import { build, type Plugin } from 'esbuild';

import { desugarJsxConditionals } from './sugar.ts';

const stub = path.join(import.meta.dirname, 'stubs', 'minecraft.cjs');

/** Rewrites React's conditional-rendering idioms in screen modules; see sugar.ts. */
export const jsxSugarPlugin: Plugin = {
  name: 'jsx-conditional-sugar',
  setup(pluginBuild) {
    pluginBuild.onLoad({ filter: /\.screen\.tsx$/ }, args => ({
      contents: desugarJsxConditionals(fs.readFileSync(args.path, 'utf-8'), args.path),
      loader: 'tsx',
    }));
  },
};

import type { Document } from './hooks.ts';

/** What `compileScreen` hands back for a chest screen. */
export interface CompiledScreen {
  /** The screen's name, from its file name. */
  name: string;
  /** JSON UI namespace the layout was emitted into. */
  namespace: string;
  /** Key the router picks this layout by, derived from `<namespace>_<name>`. */
  layoutId: number;
  /** Type of the entity the screen opens from. */
  entity: string;
  document: Document;
  allocation: { sentinels: number; drawn: number; channels: number; size: number };
  hasBackdrop: boolean;
  /** Whether any text is live, i.e. decoded through the character table. */
  hasText: boolean;
}

/** What `compileFormScreen` hands back, for an action form or a modal alike. */
export interface CompiledFormScreen {
  name: string;
  addon: string;
  /** JSON UI namespace the layout was emitted into. */
  namespace: string;
  /** What the runtime shows the form with, and what the mount gates on. */
  title: string;
  document: Document;
  /** Every entry the runtime emits, in order. The nth is `response.selection` n. */
  entries: readonly unknown[];
  /** What the build baked, registered beside the title for the runtime and `debug`. */
  snapshot: { shape: string; baked: readonly string[]; vis: readonly number[] };
  hasBackdrop: boolean;
}

/** One file the addon writes over a vanilla one, holding modifications only. */
export interface Hook {
  file: string;
  document: Document;
}

/**
 * Everything the bundle hands back: the compiled screen, and the pieces of the
 * project's own library the filter needs to emit around it.
 *
 * Structural rather than imported, on purpose. The types live in
 * `@bedrock-core/ui-compile`, which resolves from the ADDON's node_modules at
 * build time and not from this filter's — the same reason the pipeline runs
 * inside the bundle instead of here.
 */
export interface ScreenBundle {
  /** Which screen the author's root asked for. */
  kind: 'chest' | 'form';
  compiled: CompiledScreen | CompiledFormScreen;
  /** The addon's hooks into vanilla's chest files, its router, and the router's pack path. */
  buildRouter: (screens: CompiledScreen[]) => { hooks: Hook[]; router: Document; routerFile: string };
  /** The addon's hook into the compiled-form mount, and its router. */
  formRouter: (screens: CompiledFormScreen[], addon: string) => {
    hook: Hook;
    router: Document;
    routerFile: string;
  };
  /** The `.lang` lines live text decodes through. */
  lang: string[];
  /** Entity property the runtime reads the layout key from. */
  layoutProperty: string;
  /** Highest layout key the runtime can address. */
  maxLayout: number;
  /** The encoding and vocabulary windows of the library the screen was compiled against. */
  windows: { encodingMin: number; encodingMax: number; vocabularyMin: number; vocabularyMax: number };
}

/**
 * The generated entry: import the screen, compile it, and hand back the result
 * together with what the filter needs from the project's library.
 *
 * @param screenPath absolute path of the screen module
 * @param name       the screen's name
 * @param namespace  the addon namespace the screen is emitted under
 */
const entrySource = (screenPath: string, name: string, namespace: string, i18nBundle: string | undefined, exportName: string | undefined): string => `
${i18nBundle === undefined ? '' : `
// The addon's translations, registered as the build's default resolver the
// way the addon's own createI18n() call registers them at runtime: a
// localized <Text> is detected AND MEASURED through it, so a paragraph reserves
// the height of its default-locale string instead of the height of its key.
import i18nBundle from ${JSON.stringify(i18nBundle)};
import { createI18n } from '@bedrock-core/i18n';

createI18n(i18nBundle);
`}
// Namespace import, not a named one: esbuild fails the build outright on a
// named import a module does not export, and a missing default deserves the
// message below instead.
import * as screenModule from ${JSON.stringify(screenPath)};
import { buildRouter, compileFormScreen, compileScreen, formRouter } from '@bedrock-core/ui-compile';
import {
  buildScreenOnce, charsetLang, concreteRoots, CONTAINER_TYPE, ENCODING_MAX, ENCODING_MIN,
  LAYOUT_PROPERTY, MAX_LAYOUT, VOCABULARY_MAX, VOCABULARY_MIN,
} from '@bedrock-core/ui-runtime/compile';

// A screen module default-exports its component; a library's screens module
// default-exports a record of them, and one is picked by name.
const Screen = ${exportName === undefined
    ? 'screenModule.default'
    : `(screenModule.default ?? {})[${JSON.stringify(exportName)}]`};

if (typeof Screen !== 'function') {
  throw new Error(${JSON.stringify(exportName === undefined
    ? 'a screen module must default-export a component'
    : `the screens module must default-export a record with a component under "${exportName}"`)});
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
  windows: {
    encodingMin: ENCODING_MIN,
    encodingMax: ENCODING_MAX,
    vocabularyMin: VOCABULARY_MIN,
    vocabularyMax: VOCABULARY_MAX,
  },
};
`;

export interface LoadScreenOptions {
  /** Absolute path of the screen module. */
  screenPath: string;
  /** The screen's name. */
  name: string;
  /** The addon namespace the screen is emitted under. */
  namespace: string;
  /** Where transpiled intermediates land. */
  cacheDir: string;
  /** `jsxImportSource` for the screen's JSX. */
  jsxImportSource: string;
  /** Absolute path of the addon's runtime i18n bundle, when the i18n filter wrote one. */
  i18nBundle?: string;
  /**
   * The key the screen sits under when `screenPath` is a library's screens
   * module (a bare specifier whose default export is a record of screens).
   */
  exportName?: string;
}

/** Where a module specifier resolves from: a file from its folder, a bare specifier from the workspace. */
const resolveDirOf = (screenPath: string): string =>
  path.isAbsolute(screenPath) ? path.dirname(screenPath) : process.cwd();

export async function loadScreen(
  { screenPath, name, namespace, cacheDir, jsxImportSource, i18nBundle, exportName }: LoadScreenOptions,
): Promise<ScreenBundle> {
  const result = await build({
    stdin: {
      contents: entrySource(screenPath, name, namespace, i18nBundle, exportName),
      resolveDir: resolveDirOf(screenPath),
      sourcefile: `${path.basename(screenPath)}.${name}.entry.tsx`,
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
    // The same desugaring the bundler applies to the shipped scripts, so the
    // shape this compile bakes and the tree the runtime walks agree.
    plugins: [jsxSugarPlugin],
    write: false,
    logLevel: 'silent',
  });

  const [output] = result.outputFiles;

  if (output === undefined) {
    throw new Error(`esbuild produced no output for ${screenPath}`);
  }

  const code = output.text;
  const hash = crypto.createHash('sha1').update(screenPath).update(code).digest('hex').slice(0, 16);
  const file = path.join(cacheDir, `${hash}.mjs`);

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, code, 'utf-8');

  const mod = (await import(pathToFileURL(file).href)) as { default: ScreenBundle };

  return mod.default;
}

/**
 * The screen names a library's screens module exports: the keys of its
 * default export, read by bundling the module once with nothing else.
 */
export async function listScreenExports(specifier: string, cacheDir: string): Promise<string[]> {
  const result = await build({
    stdin: {
      contents: `import * as mod from ${JSON.stringify(specifier)};\nexport default Object.keys(mod.default ?? {});\n`,
      resolveDir: process.cwd(),
      sourcefile: 'screens.list.entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    alias: {
      '@minecraft/server': stub,
      '@minecraft/server-ui': stub,
    },
    write: false,
    logLevel: 'silent',
  });

  const [output] = result.outputFiles;

  if (output === undefined) {
    throw new Error(`esbuild produced no output listing ${specifier}`);
  }

  const hash = crypto.createHash('sha1').update(specifier).update(output.text).digest('hex').slice(0, 16);
  const file = path.join(cacheDir, `${hash}.list.mjs`);

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, output.text, 'utf-8');

  const mod = (await import(pathToFileURL(file).href)) as { default: unknown };

  return Array.isArray(mod.default) ? mod.default.filter((key): key is string => typeof key === 'string').sort() : [];
}
