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

import { gameStubPlugin } from './stubs/game.ts';
import { desugarJsxConditionals } from './sugar.ts';

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
/** A screen drawn as faces alone, mounted on the action form for the gallery. */
export interface Preview {
  /** The JSON UI namespace: `<screen namespace>__preview`. */
  namespace: string;
  /** The title the runtime opens it with, and what its gate reads. */
  title: string;
  document: Document;
  hasBackdrop: boolean;
}

/** What the form router needs of a screen it gates: its name, its namespace, and whether a backdrop goes behind it. */
export interface RoutedFormScreen {
  name: string;
  namespace: string;
  hasBackdrop: boolean;
  marker?: string;
  /** With `marker`: the host's frame and the area's offset in it, which the mount places the screen by. */
  embed?: EmbedPlacement;
}

/** How an embedded screen sits in its host's frame. */
export interface EmbedPlacement {
  readonly frame: readonly [number, number];
  readonly offset: readonly [number, number];
}

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
  /** The screen as faces alone: what the gallery draws. */
  face: { document: Document };
  /** The namespace of the addon's shared faces, and the looks this screen contributes to it. */
  facesNamespace: string;
  faces: Record<string, unknown>;
  /** The screen as faces alone under its preview namespace, for the gallery. */
  preview: Preview;
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
  marker?: string;
  embed?: EmbedPlacement;
  document: Document;
  /** The screen as faces alone: what the gallery draws. */
  face: { document: Document };
  /** The namespace of the addon's shared faces, and the looks this screen contributes to it. */
  facesNamespace: string;
  faces: Record<string, unknown>;
  /** The screen as faces alone under its preview namespace, for the gallery. */
  preview: Preview;
  /** Every entry the runtime emits, in order. The nth is `response.selection` n. */
  entries: readonly unknown[];
  /** What the build baked, registered beside the title for the runtime and `debug`. */
  snapshot: { shape: string; baked: readonly string[]; vis: readonly number[] };
  /**
   * Present when nothing about the screen can change: the value each entry is
   * shown with and where each press leads. Such a screen ships as this row
   * rather than as a component — there is nothing left for one to decide.
   */
  table?: {
    values: readonly string[];
    targets: readonly ({ to: string } | { back: true } | null)[];
  };
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
  formRouter: (screens: RoutedFormScreen[], addon: string) => {
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
  buildScreenOnce, charsetLang, ENCODING_MAX, ENCODING_MIN, hostFor,
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
// chest screen the way \`<Form>\` is a modal and \`<Screen>\` an action form, and
// a screen with no root fails here by the list of roots. Built once to read
// that, and again by the compiler — a build render is cheap and leaves nothing
// behind.
const kind = hostFor(buildScreenOnce(Screen)).id === 'chest' ? 'chest' : 'form';

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
  /**
   * Bare specifiers resolved to files of this build: the generated bundles a
   * screen's module may import through the project's aliases, which point at
   * the project while the bundles this build wrote live in the workspace.
   */
  aliases?: Record<string, string>;
}

/** Where a module specifier resolves from: a file from its folder, a bare specifier from the workspace. */
const resolveDirOf = (screenPath: string): string =>
  path.isAbsolute(screenPath) ? path.dirname(screenPath) : process.cwd();

export async function loadScreen(
  { screenPath, name, namespace, cacheDir, jsxImportSource, i18nBundle, exportName, aliases = {} }: LoadScreenOptions,
): Promise<ScreenBundle> {
  return evaluateEntry<ScreenBundle>({
    contents: entrySource(screenPath, name, namespace, i18nBundle, exportName),
    resolveDir: resolveDirOf(screenPath),
    sourcefile: `${path.basename(screenPath)}.${name}.entry.tsx`,
    loader: 'tsx',
    cacheDir,
    jsxImportSource,
    aliases,
    key: screenPath,
  });
}

/**
 * The screen names a library's screens module exports: the keys of its
 * default export, read by bundling the module once with nothing else.
 */
export async function listScreenExports(
  specifier: string,
  cacheDir: string,
  aliases: Record<string, string> = {},
): Promise<string[]> {
  const exported = await evaluateEntry<unknown>({
    contents: `import * as mod from ${JSON.stringify(specifier)};
export default Object.keys(mod.default ?? {});
`,
    resolveDir: process.cwd(),
    sourcefile: 'screens.list.entry.ts',
    loader: 'ts',
    cacheDir,
    aliases,
    key: specifier,
  });

  return Array.isArray(exported) ? exported.filter((key): key is string => typeof key === 'string').sort() : [];
}

export interface EvaluateOptions {
  /** The entry module's source. */
  contents: string;
  /** Where the entry's imports resolve from: a file's folder, or the workspace for bare specifiers. */
  resolveDir: string;
  sourcefile: string;
  loader: 'ts' | 'tsx';
  /** Where the bundled intermediate lands before it is imported. */
  cacheDir: string;
  /** `jsxImportSource` for JSX the entry itself contains; modules with a pragma need none. */
  jsxImportSource?: string;
  /** Bare specifiers resolved to files of this build; see {@link LoadScreenOptions.aliases}. */
  aliases?: Record<string, string>;
  /** What tells two entries with the same source apart in the cache. */
  key: string;
}

/**
 * Bundles an entry against the project's own node_modules and evaluates it,
 * handing back its default export.
 *
 * Every build-time use of the library goes through here — compiling a screen,
 * listing a screens module, reducing compiled screens to references — so all
 * of them see one library: the one the project ships, with the game modules
 * stubbed and the same desugaring the shipped scripts get.
 */
export async function evaluateEntry<T>(
  { contents, resolveDir, sourcefile, loader, cacheDir, jsxImportSource, aliases = {}, key }: EvaluateOptions,
): Promise<T> {
  const result = await build({
    stdin: { contents, resolveDir, sourcefile, loader },
    bundle: true,
    format: 'esm',
    platform: 'node',
    ...jsxImportSource === undefined ? {} : { jsx: 'automatic', jsxImportSource },
    alias: aliases,
    // The same desugaring the bundler applies to the shipped scripts, so the
    // shape a compile bakes and the tree the runtime walks agree.
    // The game modules are stubbed rather than resolved; see stubs/game.ts.
    plugins: [jsxSugarPlugin, gameStubPlugin(resolveDir)],
    write: false,
    logLevel: 'silent',
  });

  const [output] = result.outputFiles;

  if (output === undefined) {
    throw new Error(`esbuild produced no output for ${sourcefile}`);
  }

  const code = output.text;
  const hash = crypto.createHash('sha1').update(key).update(code).digest('hex').slice(0, 16);
  const file = path.join(cacheDir, `${hash}.mjs`);

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, code, 'utf-8');

  const mod = (await import(pathToFileURL(file).href)) as { default: T };

  return mod.default;
}
