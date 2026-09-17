// Reads what an addon declares, by evaluating its entry with the register call
// intercepted.
//
// `core.register({ ... })` is where an addon says what it is: its manifest, and
// a declaration per subsystem — the config it declares, what it shares, what it
// emits. The bedrock-core screens an addon gets are shaped from that, so the
// build reads the declaration rather than asking the author to repeat it
// anywhere.
//
// The runtime itself is the REAL one — `core` is a singleton the addon and this
// module import alike, so replacing its `register` before the entry runs is all
// the interception there is. Standing in for the whole package instead would
// mean standing in for every name a declaration is assembled from — `event()`,
// `schema()`, the db verbs — and those have to work for the argument of
// register to be what the addon wrote.

import path from 'node:path';

import { evaluateEntry } from './load.ts';

const empty = path.join(import.meta.dirname, 'stubs', 'empty.cjs');

/** Who the addon is, and everything its page in the shared list draws. */
export interface ManifestFields {
  /** With `pack`, the namespace every screen is emitted under. */
  creator?: string;
  pack?: string;
  packName?: string;
  version?: string;
  creatorName?: string;
  description?: string;
  icon?: string;
  thumbnail?: string;
}

/** One bedrock-core app the addon installed, as its declaration describes it to the build. */
export interface DeclaredApp {
  /** The app's name, from the `app` tag on its declaration: `catalog`, `config`, `guide`. */
  name: string;
  /**
   * The module the build bakes for it, from the `compiled` field on its declaration. Its default
   * export is the app's own screens; its `shape` export, when it has one, the screens that follow
   * from what the addon declared. Absent for an app whose screens another filter writes.
   */
  compiled?: string;
  /** The declaration as data — every JSON field on it, the installer dropped — for `shape` to read. */
  declared: Record<string, unknown>;
}

/** What an addon declared, as far as the build reads it. */
export interface Declaration extends ManifestFields {
  /** The same fields, where the runtime the addon ships nests them. */
  manifest?: ManifestFields;
  /**
   * The bedrock-core apps this addon installed.
   *
   * Each app's declaration names itself and the module to bake, so the build reads what to
   * compile from the same call the addon already writes rather than from a setting repeating
   * it, and knows no app by name.
   */
  apps?: DeclaredApp[];
}

/**
 * Which apps a declaration installed.
 *
 * An app's declaration carries its own name — `catalog: registerCatalog()` hands `register()` an
 * installer tagged `app: 'catalog'` — and, when the build has a module to bake for it, that
 * module's specifier. Whatever else it carries, config's definition say, rides along as data:
 * the installer is a function and serialises to nothing.
 */
function appsOf(options: Record<string, unknown>): DeclaredApp[] {
  const apps = new Map<string, DeclaredApp>();

  for (const value of Object.values(options)) {
    if (typeof value !== 'object' || value === null || !('app' in value) || typeof value.app !== 'string') { continue; }

    const compiled = 'compiled' in value && typeof value.compiled === 'string' ? value.compiled : undefined;

    apps.set(value.app, {
      name: value.app,
      ...compiled === undefined ? {} : { compiled },
      declared: JSON.parse(JSON.stringify(value)) as Record<string, unknown>,
    });
  }

  return [...apps.values()];
}

/** What the read found: the declaration, and why it found none when it did not. */
export interface ReadResult {
  declaration?: Declaration;
  /** What the entry threw before it registered. Only set when nothing was captured. */
  failure?: string;
}

export interface ReadDeclarationOptions {
  /** Absolute path of the addon's script entry. */
  entryPath: string;
  cacheDir: string;
  jsxImportSource: string;
  /** The generated bundles the entry may import; see the filter's own map. */
  aliases?: Record<string, string>;
}

/**
 * The addon's declaration, or why its entry registered nothing.
 *
 * The entry is imported for its side effect, and dynamically: the half that
 * serves the game — event subscriptions, commands, anything reaching for a
 * world that is not there — may well fail against the stubbed game modules, and
 * the declaration is already captured by then. A throw BEFORE the register call
 * takes the declaration with it, so the reason is carried back rather than
 * swallowed: an addon silently left without its screens is the worse failure.
 */
export async function readDeclaration(
  { entryPath, cacheDir, jsxImportSource, aliases = {} }: ReadDeclarationOptions,
): Promise<ReadResult> {
  const read = await evaluateEntry<ReadResult>({
    contents: `import { core } from '@bedrock-core/server-runtime';

const captured = {};

// Something that answers to being read, called and destructured, and means
// nothing: what register hands back, since nothing is going online here.
const handler = {
  get: (target, key) => typeof key === 'symbol' ? undefined : anything(),
  apply: () => anything(),
};
const anything = () => new Proxy(function registered() {}, handler);

core.register = (options) => {
  captured.options = options;

  return anything();
};

let failure;

try {
  await import(${JSON.stringify(entryPath)});
} catch (error) {
  failure = error instanceof Error ? error.stack ?? error.message : String(error);
}

export default captured.options === undefined ? { failure } : { declaration: captured.options };
`,
    resolveDir: path.dirname(entryPath),
    sourcefile: 'declaration.entry.ts',
    loader: 'ts',
    cacheDir,
    jsxImportSource,
    aliases: {
      // What this build is about to write does not exist while the declaration
      // is read; see the stub.
      '@bedrock-core/generated/ui': empty,
      ...aliases,
    },
    key: `declaration:${entryPath}`,
  });

  if (read.declaration === undefined) { return read; }

  return {
    ...read,
    declaration: {
      ...read.declaration,
      apps: appsOf(read.declaration as unknown as Record<string, unknown>),
    },
  };
}
