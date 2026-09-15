// @bedrock-core/regolith-filters — ui-compiler
//
// Container screens are written as JSX under BP/scripts and compiled here into
// static JSON UI. Unlike a server form, a container screen cannot be serialized
// at runtime: the chest screen offers no string channel wide enough to carry a
// layout, so the layout is baked and only state travels at runtime.
//
// For each `BP/scripts/**/*.screen.tsx` this filter:
//   1. bundles the screen together with the compiler, using the PROJECT'S copy
//      of @bedrock-core/ui-runtime and @bedrock-core/ui-compiler, so a screen is
//      always compiled against the library the addon actually ships,
//   2. writes the emitted JSON UI to RP/ui/core-ui/screens/<namespace>/<name>.json,
//      and the looks every screen of the addon shares to faces.json beside them,
//   3. stamps the entity the screen names: `minecraft:inventory` sized to the
//      layout, and the entity property the runtime reads the layout key from.
//
// A cheap protocol check decides whether a chest is ours at all, and a layout
// key — derived from the screen's namespaced name, so addons built apart never
// hand out the same one — decides which screen. A vanilla chest fails the first
// check and renders untouched. The addon's router is a file of its own; what
// lands in vanilla's chest files is one modification each, inserting the
// addon's root beside every other pack's.
//
// Everything is written into the Regolith workspace. A screen is an ordinary
// script module the addon imports itself — the bundler inlines it and strips
// the sources afterwards — so nothing is copied, generated into the project or
// deleted here.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { readDeclaration, type DeclaredApp, type ManifestFields } from './lib/declaration.ts';
import type { Document } from './lib/hooks.ts';
import { mergeHook, parseJsonc } from './lib/hooks.ts';
import type { CompiledFormScreen, CompiledScreen, Hook, RoutedFormScreen, ScreenBundle } from './lib/load.ts';
import { listScreenExports, loadScreen } from './lib/load.ts';
import { registerUiDefs } from './lib/uiDefs.ts';

const projectRoot = process.env['ROOT_DIR'];

if (!projectRoot) {
  console.error('❌ ROOT_DIR environment variable not set');
  console.error('This filter must be run by Regolith');
  process.exit(1);
}

// ─── Settings ─────────────────────────────────────────────────────────────────

// Fixed addon paths: what Minecraft needs for scripts, entities, UI and texts.
// They are not options — the pack does not work anywhere else — so they are
// constants, not settings. The hooks and the router are the compiler's to
// place: the hooks at vanilla's own paths, which is what lets their edits
// stack with every other pack's, and the router under the addon's namespace,
// so two addons' routers never overwrite each other in a world.
const SOURCE_DIR = 'BP/scripts';

// Where an addon says what it is. `core.register({ manifest, config, ... })` is
// declared from the script entry, and the bundler resolves the same file, so
// the build reads the declaration there and shapes the bedrock-core screens the
// addon gets from it.
const ENTRY_FILES = ['BP/scripts/main.ts', 'BP/scripts/index.ts'];

/**
 * The screens an addon's own declaration becomes, written beside the other generated modules:
 * what each installed app shapes from its declaration and the manifest.
 */
const DECLARED_SCREENS_FILE = 'declared.screens.ts';

/** How an addon's scripts reach the module that registers its compiled screens. */
const GENERATED_UI = '@bedrock-core/generated/ui';
const OUTPUT_DIR = 'RP/ui/core-ui/screens';

/** Vanilla's form screen file, hooked by every pack that compiles forms but does not define the mount. */
const SERVER_FORM_HOOK = 'ui/server_form.json';
const RESOURCE_PACK = 'RP';
const ENTITY_DIR = 'BP/entities';
const TEXTS_DIR = 'RP/texts';
const JSX_IMPORT_SOURCE = '@bedrock-core/ui';

// Where the module that tells the runtime which screens were compiled is
// written. Reached as `@bedrock-core/generated/ui`, the way the i18n and guides
// bundles are, and inlined by the bundler that runs after this filter.
const GENERATED_DIR = 'data/ui';
const GENERATED_FILE = 'ui.generated.ts';

// The keys, declared back in the REAL project rather than the workspace: this
// one is for the editor, which reads the source tree and never sees a Regolith
// run. The i18n and guides filters commit their declarations the same way.
const KEYS_FILE = 'screens.generated.d.ts';

// The definition every addon's compiled form screens are added to. Named here
// because the filter has to recognise a pack that DEFINES it — the library's
// own — from one that only extends it.
const MOUNT_TARGET = 'compiled_root';

/** The mount definition an addon's compiled form screens are listed in. */
interface MountRoot {
  controls: Record<string, unknown>[];
}

/** Only the parts of an entity file this filter writes. */
interface EntityFile {
  'minecraft:entity': {
    description: {
      identifier?: string;
      properties?: Record<string, unknown>;
    };
    components?: Record<string, Record<string, unknown>>;
  };
}

/** Settings Regolith passes as argv[2]. */
// ─── Output layout ────────────────────────────────────────────────────────────
// The same in every filter of this repository: generated JSON is minified unless
// a profile asks for it laid out, and then `indent` and `size` say how.

/** How generated JSON is laid out. Absent or `false` writes it minified. */
interface Pretty {
  /** 'tab' or 'space'; spaces when omitted. */
  indent?: 'tab' | 'space';
  /** Characters per level: 2 spaces or 1 tab when omitted. */
  size?: number;
}

/** The indent `JSON.stringify` takes, or `undefined` for minified output. */
function indentOf(pretty: Pretty | false | undefined): string | undefined {
  if (pretty === undefined || pretty === false) return undefined;
  const tab = pretty.indent === 'tab';
  return (tab ? '\t' : ' ').repeat(Math.max(1, Math.trunc(pretty.size ?? (tab ? 1 : 2))));
}

/** A generated JSON file: laid out and newline-terminated when `pretty` says so, minified otherwise. */
function jsonText(value: unknown, pretty: Pretty | false | undefined): string {
  const indent = indentOf(pretty);
  return indent === undefined ? JSON.stringify(value) : `${JSON.stringify(value, null, indent)}\n`;
}

interface Settings {
  namespace?: string;
  /**
   * Draw a build stamp at the HUD's top-left: a short hash of every compiled
   * screen plus the build time. For the development profile of a pack under
   * work, so what the game is running is never in question; never for a
   * shipped pack.
   */
  stamp?: boolean;
  /**
   * Further modules whose default export is a record of screens to compile.
   *
   * The screens the bedrock-core apps serve are already compiled from the
   * addon's declaration, so this is for a library the declaration does not name. Each
   * export key names the screen; the bundle resolves the specifier the way the
   * addon's scripts would.
   */
  screens?: string[];
  /**
   * How the JSON UI this filter emits is laid out. Absent or `false`, every
   * emitted file is minified and headerless: a compiled screen is a file nobody
   * reads by hand in a shipped pack, and the indentation is a large share of its
   * bytes. Laid out, each file is indented as asked and headed with the comment
   * saying it is generated.
   */
  pretty?: Pretty | false;
}

const settings = JSON.parse(process.argv[2] ?? '{}') as Settings;

const indent = indentOf(settings.pretty);

/** A generated file's body, laid out as the profile asked. */
const stringify = (value: unknown): string => jsonText(value, settings.pretty);

/** A generated file's header, dropped with the rest of the whitespace when the output is minified. */
const note = (...lines: string[]): string =>
  indent === undefined ? '' : `${lines.map(line => line === '' ? '//' : `// ${line}`).join('\n')}\n`;

const cacheDir = path.join(projectRoot, '.regolith', 'cache', 'ui-compiler');

// What the i18n filter wrote, when it ran before this one: loaded into every
// screen's build so localized text is measured as its real string.
const I18N_BUNDLE = 'data/i18n/i18n.generated.json';
const i18nBundle = fs.existsSync(I18N_BUNDLE) ? path.resolve(I18N_BUNDLE) : undefined;

// The generated bundles a screen's module may import the way the addon's own
// code does — `@bedrock-core/generated/*` — resolved to what THIS build wrote:
// the project's tsconfig aliases point at the project, and the bundles live
// in the workspace.
const GENERATED_BUNDLES: Record<string, string> = {
  '@bedrock-core/generated/i18n': I18N_BUNDLE,
  '@bedrock-core/generated/guides': 'data/guides/guides.generated.json',
};
const generatedAliases = Object.fromEntries(
  Object.entries(GENERATED_BUNDLES)
    .filter(([, file]) => fs.existsSync(file))
    .map(([specifier, file]) => [specifier, path.resolve(file)]),
);

// ─── Discovery ────────────────────────────────────────────────────────────────

/** Screens are marked by extension, so ordinary .tsx helpers can sit beside them. */
const SCREEN_SUFFIX = '.screen.tsx';

/** Every file under `dir` whose name ends in `suffix`, recursively. */
function findFiles(dir: string, suffix: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return findFiles(full, suffix);
    }

    return entry.name.endsWith(suffix) ? [full] : [];
  });
}

// Sorted so the build is the same from one machine to the next.
const screenPaths = findFiles(path.resolve(SOURCE_DIR), SCREEN_SUFFIX).sort();

const rel = (file: string): string => path.isAbsolute(file) ? path.relative(projectRoot, file).replaceAll('\\', '/') : file;

/** Regolith's data path on real disk (`packs/data` unless the project moved it). */
const projectDataPath = (): string => {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(projectRoot, 'config.json'), 'utf-8')) as { regolith?: { dataPath?: unknown } };

    if (typeof config.regolith?.dataPath === 'string') { return config.regolith.dataPath; }
  } catch {
    // A project without a readable config takes the default.
  }

  return 'packs/data';
};

/** Write into the real project, but only when the content actually moved. */
const writeProjectFileIfChanged = (relPath: string, content: string): void => {
  const abs = path.join(projectRoot, relPath);

  if (fs.existsSync(abs) && fs.readFileSync(abs, 'utf-8') === content) { return; }

  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
  console.log(`   ↳ ${relPath} — regenerated`);
};


/** One screen to compile: the addon's own file, or one export of a library's screens module. */
interface ScreenEntry {
  /** A file under BP/scripts, or the bare specifier of a screens module. */
  screenPath: string;
  name: string;
  /** Set for a library screen: the key it sits under in the module's default export. */
  exportName?: string;
}

const entries: ScreenEntry[] = screenPaths.map(screenPath => ({ screenPath, name: path.basename(screenPath, SCREEN_SUFFIX) }));

// What this addon declares, read where it says it: `core.register`. The
// bedrock-core screens an addon is served follow from that — each app it
// installed names the module to bake and shapes the rest from the declaration,
// a config screen per section of its schema say — so nothing is wired up twice.
// Declaring is what asks for them.
const entryPath = ENTRY_FILES.map(file => path.resolve(file)).find(file => fs.existsSync(file));

const read = entryPath === undefined
  ? {}
  : await readDeclaration({ entryPath, cacheDir, jsxImportSource: JSX_IMPORT_SOURCE, aliases: generatedAliases })
    .catch((error: unknown) => {
      console.error(`❌ ui-compiler: cannot read the declaration in ${rel(entryPath)}: ${String(error)}`);

      return process.exit(1);
    });

const { declaration } = read;

// An addon whose entry throws on the way to its register call gets none of the
// screens that follow from declaring, so the reason is said out loud here: the
// alternative is a pack that builds clean with none of its app screens in it.
if (read.failure !== undefined && entryPath !== undefined) {
  console.warn(`⚠️  ui-compiler: ${rel(entryPath)} registered nothing — ${read.failure}`);
}

const generatedScreens: string[] = [];

// The manifest, wherever the runtime the addon ships keeps it.
const manifest = { ...declaration, ...declaration?.manifest };

/** The manifest as the apps are handed it: its own fields alone, since what else the declaration holds is installers. */
const manifestFields: ManifestFields = Object.fromEntries(
  (['creator', 'pack', 'packName', 'version', 'creatorName', 'description', 'icon', 'thumbnail'] as const)
    .flatMap(field => (manifest[field] === undefined ? [] : [[field, manifest[field]]])),
);

// The apps with a module to bake. Each is compiled the way a `screens` module
// is, and asked in a module generated here for the screens that follow from
// the declaration: the page the manifest becomes, a config screen per section.
// That module is imported at runtime too — `ui.generated.ts` imports it to
// register the compiled screens, and the bundler inlines it — so an app also
// registers what it shaped there, and finds it later under the name it was
// compiled as.
const apps = (declaration?.apps ?? []).filter((app): app is DeclaredApp & { compiled: string } => app.compiled !== undefined);

if (apps.length > 0) {
  const module = path.join(path.resolve(GENERATED_DIR), DECLARED_SCREENS_FILE);
  const alias = (app: DeclaredApp): string => `app_${app.name.replace(/[^a-z0-9_]/gi, '_')}`;
  const literal = (value: unknown): string => JSON.stringify(value, undefined, 2).replaceAll('\n', '\n  ');

  fs.mkdirSync(path.dirname(module), { recursive: true });
  fs.writeFileSync(module, [
    '// GENERATED by the ui-compiler filter — do not edit.',
    '//',
    '// The screens that follow from what this addon declared, shaped by each app',
    '// it installed from its own declaration and the manifest.',
    '',
    ...apps.map(app => `import * as ${alias(app)} from '${app.compiled}';`),
    '',
    `const manifest = ${JSON.stringify(manifestFields, undefined, 2)};`,
    '',
    'export default {',
    ...apps.map(app => `  ...${alias(app)}.shape?.(${literal(app.declared)}, manifest),`),
    '};',
    '',
  ].join('\n'), 'utf-8');

  // Relative to the WORKSPACE, which is where the filter runs and where a
  // `screens` specifier is resolved from.
  generatedScreens.push(`./${path.relative(process.cwd(), module).replaceAll('\\', '/')}`);
  console.log(`\u{1F9E9} ui-compiler: declaration \u2192 ${GENERATED_DIR}/${DECLARED_SCREENS_FILE}`);
}

// The screens each bedrock-core app serves, compiled into THIS addon's pack the
// way its own files are: the runtime that renders them is the one this addon
// ships. The declaration is what asks for them, because an app is a field of
// `core.register` and that is what the build reads.
const specifiers = [...new Set([
  ...settings.screens ?? [],
  ...apps.map(app => app.compiled),
  ...generatedScreens,
])];

for (const specifier of specifiers) {
  const exported = await listScreenExports(specifier, cacheDir, generatedAliases)
    .catch((error: unknown) => {
      console.error(`❌ ui-compiler: cannot list the screens of ${specifier}: ${String(error)}`);

      return process.exit(1);
    });

  // The generated module may shape nothing: a manifest with no display fields has no page.
  if (exported.length === 0 && !generatedScreens.includes(specifier)) {
    console.error(`❌ ui-compiler: ${specifier} default-exports no screens`);
    process.exit(1);
  }

  for (const exportName of exported) {
    entries.push({ screenPath: specifier, name: exportName, exportName });
  }
}

if (entries.length === 0) {
  console.log(`ℹ️  ui-compiler: no *${SCREEN_SUFFIX} under ${SOURCE_DIR} and no screens setting, nothing to do`);
  process.exit(0);
}

// The name is the JSON UI namespace and the output file, so it has to be unique
// across the addon whatever directory a screen sits in.
const names = entries.map(entry => entry.name);
const duplicate = names.find((name, index) => names.indexOf(name) !== index);

if (duplicate !== undefined) {
  console.error(`❌ ui-compiler: two screens are named "${duplicate}"; a screen's name has to be unique`);
  process.exit(1);
}

// ─── Namespace ────────────────────────────────────────────────────────────────

// The addon's namespace prefixes every screen's JSON UI namespace, so a screen
// is `<namespace>_<name>` — the addon's own name, not the library's. Taken from
// the `namespace` setting, or from the manifest the addon declared: the same
// `core.register({ manifest })` the game reads it from.
const declaredNamespace = manifest.creator !== undefined && manifest.pack !== undefined
  ? `${manifest.creator}_${manifest.pack}`
  : undefined;

let namespace = settings.namespace;

if (namespace) {
  if (!/^[a-z0-9_]+$/.test(namespace)) {
    console.error(`❌ ui-compiler: namespace "${namespace}" must be lowercase a-z, 0-9 and _`);
    process.exit(1);
  }
} else {
  namespace = declaredNamespace;

  if (namespace === undefined) {
    console.error(
      '❌ ui-compiler: no namespace — set the "namespace" setting, '
      + 'or declare `manifest: { creator, pack }` in core.register()',
    );
    process.exit(1);
  }
}

console.log(`🏷️  ui-compiler: namespace "${namespace}"`);

/**
 * The key a screen is navigated by: `<addon>:<name>`.
 *
 * The same two halves the JSON UI namespace joins with `_`, kept apart here
 * because this is the one an author types — in a `<Link to>`, in a `navigate()`
 * — and because an addon namespace may itself contain an underscore, so only
 * the build can say where the screen's name begins.
 */
const screenKey = (name: string): string => `${namespace}:${name}`;

// ─── Compile ──────────────────────────────────────────────────────────────────

/**
 * Reads a pack JSON file that may carry comments. Vanilla tolerates JSONC in
 * pack files and authors use it. Comments do not survive the round trip, but
 * only the workspace copy is ever written back -- the author's own file is
 * left exactly as they wrote it.
 */
const readJsonc = (file: string): Document => parseJsonc(fs.readFileSync(file, 'utf-8'));

/**
 * Relays a failure the way the compiler worded it, and stops the build.
 *
 * The compiler's own errors already say what to do — an unsupported control
 * lists what is supported, an oversized screen gives the canvas. Relaying the
 * message unchanged beats wrapping it.
 */
const fail = (context: string, error: unknown): never => {
  console.error(`❌ ui-compiler: ${context}`);
  console.error(String(error instanceof Error ? error.message : error));
  process.exit(1);
};

/** {@link mergeHook}, with a failure relayed the way every other one is. */
const mergeOrFail = (existing: string | undefined, hook: Document, context: string): Document => {
  try {
    return mergeHook(existing, hook);
  } catch (error) {
    return fail(context, error);
  }
};

// Under the addon's own namespace: a resource pack file is replaced, not
// merged, by a higher pack's file at the same path, so two addons that both
// compiled a screen called `guide_home` would otherwise shadow each other's
// namespace and every gate naming it would fail to construct.
const outputDir = path.resolve(OUTPUT_DIR, namespace);

fs.mkdirSync(outputDir, { recursive: true });

/** @type {import('./lib/load.js').CompiledScreen[]} */
const compiled = [];

/** @type {import('./lib/load.js').CompiledFormScreen[]} */
const forms = [];

/** Screen name -> the source path it came from, for the generated registration module. */
const formSources = new Map<string, string | { specifier: string; exportName: string }>();

/**
 * The looks every screen of the addon shares, by the name each look derives
 * from itself: two screens that draw the same button name the same face, so
 * the addon carries it once. Written beside the screens as `faces.json`.
 */
const faces: Record<string, unknown> = {};
let facesNamespace: string | undefined;

// Every bundle carries the project's own library, and its exports are the same
// from one screen to the next; the last one loaded speaks for all of them.
/** @type {import('./lib/load.js').ScreenBundle} */
let library;

for (const { screenPath, name, exportName } of entries) {

  // `.catch` rather than try/catch, so the result stays a value.
  //
  // A `let` assigned inside a `try` is never DEFINITELY assigned afterwards as
  // far as the checker is concerned — the try may throw before the assignment,
  // and it will not follow a `never`-returning call in the catch to rule that
  // out. Catching on the promise keeps `fail`'s `never` in the type, so there
  // is no `undefined` to assert away.
  const bundle = await loadScreen({
    screenPath,
    name,
    namespace,
    cacheDir,
    jsxImportSource: JSX_IMPORT_SOURCE,
    i18nBundle,
    aliases: generatedAliases,
    ...exportName === undefined ? {} : { exportName },
  }).catch((error: unknown) => fail(rel(screenPath), error));

  library = bundle;

  const screen = bundle.compiled;

  const header = note(
    'GENERATED by the ui-compiler filter — do not edit.',
    `Source: ${rel(screenPath)}`,
  );

  fs.writeFileSync(
    path.join(outputDir, `${name}.json`),
    `${header}${stringify(screen.document)}`,
    'utf-8',
  );

  facesNamespace = screen.facesNamespace;

  for (const [id, face] of Object.entries(screen.faces)) {
    const existing = faces[id];

    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(face)) {
      fail(rel(screenPath), new Error(`face "${id}" differs from the one another screen of this addon shares under that name`));
    }

    faces[id] = face;
  }

  if (bundle.kind === 'chest') {
    const chest = screen as CompiledScreen;

    compiled.push(chest);

    const { drawn, channels, size } = chest.allocation;

    console.log(
      `✅ ui-compiler: ${name} — chest, ${drawn} slot(s), ${channels} channel(s), inventory_size ${size}`,
    );
  } else {
    const form = screen as CompiledFormScreen;

    forms.push(form);
    formSources.set(name, exportName === undefined ? screenPath : { specifier: screenPath, exportName });

    console.log(`✅ ui-compiler: ${name} — form, ${form.entries.length} entry(s)`);
  }
}

if (library === undefined) {
  throw new Error('unreachable: every screen either loads a bundle or stops the build');
}

// Captured as a const: narrowing a `let` does not survive into a later loop
// body, and re-asserting it at each use is worse than naming it once.
const runtime = library;

// ─── Faces ────────────────────────────────────────────────────────────────────

// The addon's shared looks, one file: every screen references them by name,
// the same on every screen that draws them.
const facesFile = path.join(outputDir, 'faces.json');

fs.writeFileSync(
  facesFile,
  note(
    'GENERATED by the ui-compiler filter — do not edit.',
    'The looks this addon\'s compiled screens share: no bindings, the same',
    'on every screen that draws them.',
  ) + stringify({ namespace: facesNamespace ?? `${namespace}_faces`, ...faces }),
  'utf-8',
);

console.log(`   ↳ ${Object.keys(faces).length} shared face(s) → ${rel(facesFile)}`);

// ─── Character table ──────────────────────────────────────────────────────────

// A container slot publishes no text, so a string reaches a screen one
// character at a time: each cell reads its slot's stack size and localizes a
// key built from it. This is the table that turns those codes back into glyphs.
//
// It comes from the project's runtime rather than from here because it is the
// contract between the compiler and the runtime — they encode against the same
// list or nothing renders — and it lands in the WORKSPACE, never in the user's
// own texts/.
if (compiled.some(screen => screen.hasText)) {
  const textsDir = path.resolve(TEXTS_DIR);
  const lines = runtime.lang;

  fs.mkdirSync(textsDir, { recursive: true });

  for (const file of fs.readdirSync(textsDir).filter(name => name.endsWith('.lang'))) {
    const target = path.join(textsDir, file);
    const existing = fs.readFileSync(target, 'utf-8');

    // Guarded on the first line the table actually produces, so a rebuild over
    // a workspace that already carries it does not append it again.
    if (lines[0] !== undefined && existing.includes(lines[0])) {
      continue;
    }

    fs.writeFileSync(
      target,
      [
        existing.replace(/\s*$/, ''),
        '',
        '## Generated by the ui-compiler filter -- the character table live text',
        '## is decoded through. One slot carries one code; the label localizes',
        '## this key and the value below is what gets drawn.',
        ...lines,
        '',
      ].join('\n'),
      'utf-8',
    );
  }

  console.log(`   ↳ character table → ${lines.length} entries per language`);
}

// ─── Router ───────────────────────────────────────────────────────────────────

// The router — one gated host per screen, under the addon's own root — is a
// file named after the addon. The hooks are the addon's copies of vanilla's
// chest files, desktop and pocket, each holding ONE modification that inserts
// that root into the chest panel. Nothing is defined in a vanilla file: a
// definition there would replace vanilla's and every other pack's, while a
// modification of the file at vanilla's own path stacks with them in whatever
// order the packs sit — the one mechanism that lets addons built apart meet
// on the same chest.
let routing: { hooks: Hook[]; router: Document | undefined; routerFile: string | undefined } = {
  hooks: [],
  router: undefined,
  routerFile: undefined,
};

if (compiled.length > 0) {
  try {
    routing = runtime.buildRouter(compiled);
  } catch (error) {
    fail(OUTPUT_DIR, error);
  }
}

const routerFile = routing.routerFile === undefined
  ? undefined
  : path.resolve(RESOURCE_PACK, routing.routerFile);
const hookFiles = routing.hooks.map(hook => path.resolve(RESOURCE_PACK, hook.file));

if (routerFile !== undefined) {
  fs.mkdirSync(path.dirname(routerFile), { recursive: true });
}

// A pack may already carry its own copy of a vanilla file — the render pack
// does — so the addon's modification is added to it rather than replacing it.
for (const [index, hook] of routing.hooks.entries()) {
  const file = hookFiles[index];
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : undefined;
  let document;

  try {
    document = mergeHook(existing, hook.document);
  } catch (error) {
    fail(rel(file), error);
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    note(
      'GENERATED by the ui-compiler filter — do not edit.',
      'Inserts this addon\'s compiled-screen root on vanilla\'s chest screen.',
      '',
      'A modification of vanilla\'s own file at vanilla\'s own path: it stacks',
      'with the render pack\'s edit and with every other addon\'s, whatever order',
      'the packs sit in. Nothing is defined here on purpose.',
    ) + stringify(document),
    'utf-8',
  );
  console.log(`   ↳ hook → ${rel(file)}${existing === undefined ? '' : ' (merged)'}`);
}

if (routerFile !== undefined) {
  fs.writeFileSync(
    routerFile,
    note(
      'GENERATED by the ui-compiler filter — do not edit.',
      'Gates this addon\'s compiled layouts onto the chest screen; vanilla\'s own',
      'chest shows when no layout claims it.',
    ) + stringify(routing.router),
    'utf-8',
  );

  console.log(`   ↳ router → ${rel(routerFile)}`);
}

// ─── Compiled form screens ────────────────────────────────────────────────────

// The same two documents a chest screen needs, for a different screen: one
// gated host per screen under the addon's root, and one modification putting
// that root on the library's mount. The mount is the library's OWN file rather
// than a vanilla one — a compiled form needs no vanilla edit at all, because
// the library's container is already gated on the protocol header.
const formFiles = [];

if (forms.length > 0) {
  let formRouting: ReturnType<ScreenBundle['formRouter']> | undefined;

  try {
    formRouting = runtime.formRouter(forms, namespace);
  } catch (error) {
    fail(OUTPUT_DIR, error);
  }

  if (formRouting === undefined) {
    throw new Error('unreachable: formRouter neither returned nor failed');
  }

  const formRouterFile = path.resolve(RESOURCE_PACK, formRouting.routerFile);
  const mountFile = path.resolve(RESOURCE_PACK, formRouting.hook.file);
  const existingMount = fs.existsSync(mountFile) ? fs.readFileSync(mountFile, 'utf-8') : undefined;
  const owned = existingMount !== undefined
    && (parseJsonc(existingMount)[MOUNT_TARGET] as MountRoot | undefined)?.controls !== undefined;
  const inserted = (formRouting.hook.document[MOUNT_TARGET] as {
    modifications: { value: Record<string, unknown>[] }[];
  }).modifications[0]?.value ?? [];

  if (owned) {
    // The one pack that both DEFINES the mount and compiles screens onto it is
    // the library's own. Modifying a definition the same file declares would be
    // asking the engine to patch what it is reading; the root goes straight
    // into the definition instead.
    const mount = parseJsonc(existingMount as string);
    const root = mount[MOUNT_TARGET] as MountRoot;

    root.controls = [
      ...root.controls.filter(entry => Object.keys(entry)[0] !== namespace),
      ...inserted,
    ];

    fs.mkdirSync(path.dirname(mountFile), { recursive: true });
    fs.writeFileSync(
      mountFile,
      note(
        'GENERATED by the ui-compiler filter — do not edit.',
        'Puts this addon\'s compiled form screens on the library\'s mount.',
        '',
        'This pack defines the mount, so its own screens are listed in it directly.',
      ) + stringify(mount),
      'utf-8',
    );
    formFiles.push(mountFile);
  } else {
    // Every other pack hooks VANILLA's form screen, the way the library itself
    // does: a `modifications` entry only stacks onto a file a lower pack
    // defined when that file is vanilla's — against another pack's file the
    // engine merges the two definitions as plain objects, and `modifications`
    // arrives as an unknown property: the engine reports "Unknown property
    // [modifications]" on the mount and the screens never mount. The addon's
    // router goes straight into `main_screen_content`, beside the library's
    // containers; every screen under it gates on its own title.
    const serverFormFile = path.resolve(RESOURCE_PACK, SERVER_FORM_HOOK);
    const existingHook = fs.existsSync(serverFormFile) ? fs.readFileSync(serverFormFile, 'utf-8') : undefined;
    const hook: Document = {
      namespace: 'server_form',
      main_screen_content: {
        modifications: [{ array_name: 'controls', operation: 'insert_back', value: inserted }],
      },
    };
    const document = mergeOrFail(existingHook, hook, rel(serverFormFile));

    fs.mkdirSync(path.dirname(serverFormFile), { recursive: true });
    fs.writeFileSync(
      serverFormFile,
      note(
        'GENERATED by the ui-compiler filter — do not edit.',
        'Puts this addon\'s compiled form screens on the form screen: a hook at',
        'vanilla\'s own path, defining nothing, which stacks across packs.',
      ) + stringify(document),
      'utf-8',
    );
    console.log(`   ↳ form hook → ${rel(serverFormFile)}${existingHook === undefined ? '' : ' (merged)'}`);
    formFiles.push(serverFormFile);
  }

  fs.mkdirSync(path.dirname(formRouterFile), { recursive: true });
  fs.writeFileSync(
    formRouterFile,
    note(
      'GENERATED by the ui-compiler filter — do not edit.',
      'Gates this addon\'s compiled form screens; each shows for exactly the',
      'title the runtime opens it with.',
    ) + stringify(formRouting.router),
    'utf-8',
  );

  formFiles.push(formRouterFile);

  if (owned) {
    console.log(`   ↳ form mount → ${rel(mountFile)}`);
  }
  console.log(`   ↳ form router → ${rel(formRouterFile)}`);

  // What tells the runtime a screen was compiled. The build knows a screen by
  // its file and the runtime by the component it is handed, so the one thing
  // that can carry the association is a module importing both — which the
  // bundler inlines like any other import.
  const generatedDir = path.resolve(GENERATED_DIR);
  const specifierFor = (source: string): string => {
    const relative = path.relative(generatedDir, source).replaceAll('\\', '/').replace(/\.tsx?$/, '');

    return relative.startsWith('.') ? relative : `./${relative}`;
  };

  /**
   * A screens module as the generated file must import it.
   *
   * A package is named the same from anywhere, but an addon's OWN module is
   * named relative to the workspace in the setting — where the author writes
   * it — and the generated file sits two folders down from there.
   */
  const moduleSpecifier = (specifier: string): string => (specifier.startsWith('.')
    ? specifierFor(path.resolve(specifier))
    : specifier);

  // A screen the build described in full ships as a ROW rather than as a module:
  // no import, so its component, everything it renders and everything that data
  // came from stay out of the addon. A screen with something live keeps its
  // component, because only the component knows what to show next time.
  const table = forms.flatMap((screen) => {
    const described = screen.table;

    return described === undefined
      ? []
      : [{
          key: screenKey(screen.name),
          title: screen.title,
          values: described.values,
          targets: described.targets,
        }];
  });

  const registrations = forms.map((screen, index) => {
    const from = formSources.get(screen.name);
    const library = typeof from === 'object';

    return {
      alias: `Screen${index}`,
      source: library ? moduleSpecifier(from.specifier) : specifierFor(from ?? ''),
      // A library screen is a member of its module's default export.
      member: library ? from.exportName : undefined,
      // What anything outside this bundle names the screen by. The title carries
      // the same two halves the JSON UI way (`<addon>_<name>`), which cannot be
      // split back apart — an addon namespace may contain the separator — so the
      // key is written out rather than derived.
      key: screenKey(screen.name),
      title: screen.title,
      snapshot: screen.snapshot,
      static: screen.table !== undefined,
    };
  }).filter(entry => !entry.static);

  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(
    path.join(generatedDir, GENERATED_FILE),
    [
      '// GENERATED by the ui-compiler filter — do not edit.',
      '//',
      '// Which screens this addon compiled, and what title reaches each layout.',
      '// The build knows a screen by its file and the runtime by the component it',
      '// is handed, so this module is what associates the two: import it once and',
      '// every compiled screen renders from the pack instead of being serialized.',
      '//',
      '// Each registration also carries the build\'s snapshot: the carried-visible',
      '// ordinals the runtime re-marks on its own tree, and the shape and baked',
      '// strings a `debug` render is diffed against.',
      '//',
      `// encoding ${runtime.windows.encodingMax} (window ${runtime.windows.encodingMin}..${runtime.windows.encodingMax}), vocabulary ${runtime.windows.vocabularyMax} (window ${runtime.windows.vocabularyMin}..${runtime.windows.vocabularyMax})`,
      '',
      "import { addonReference, registerCompiledScreen, registerStaticScreens, render, type AddonReference, type RenderOptions } from '@bedrock-core/ui';",
      'import type { Player } from \'@minecraft/server\';',
      ...registrations.map(entry => `import ${entry.alias} from '${entry.source}';`),
      '',
      '/**',
      ' * The screens nothing about which can change: every string baked, every press a link.',
      ' * They are shown from this table — there is no component to render, and none ships.',
      ' * It is also what this addon publishes, so any realm can show these screens.',
      ' */',
      `export const UI_REFERENCE = ${JSON.stringify(table, null, 2)} as const;`,
      '',
      'registerStaticScreens(UI_REFERENCE);',
      '',
      ...registrations.map(entry =>
        `registerCompiledScreen(${entry.alias}${entry.member === undefined ? '' : `[${JSON.stringify(entry.member)}]`}, `
        + `{ key: ${JSON.stringify(entry.key)}, title: ${JSON.stringify(entry.title)}, snapshot: ${JSON.stringify(entry.snapshot)} });`),
      '',
      '/** Every screen this addon compiled, by the key it is navigated with. */',
      `export const SCREEN_KEYS = ${JSON.stringify(forms.map(screen => screenKey(screen.name)), null, 2)} as const;`,
      '',
      "/** The key of one of this addon's screens. */",
      'export type ScreenKey = typeof SCREEN_KEYS[number];',
      '',
      "// What `navigate()` accepts is typed from this addon's own keys, while",
      "// staying open to another addon's: a foreign key is a string this build",
      '// has never seen and still resolves, through the replicated references.',
      "declare module '@bedrock-core/ui-runtime' {",
      '  interface ScreenKeys extends Record<ScreenKey, true> {}',
      '}',
      '',
      "/** This addon's namespace, as the build wrote it into every key and title. */",
      `export const UI_NAMESPACE = ${JSON.stringify(namespace)};`,
      '',
      '/**',
      ' * Every static screen of this addon as another realm can show it: the title,',
      ' * the entry values and where each press leads. The realm announces it at',
      ' * startup; announce it directly with `screens(core).provide(uiReference())`',
      " * from '@bedrock-core/navigation' — and any realm draws this addon's screens",
      ' * from the pack every client already holds.',
      ' */',
      'export function uiReference(): AddonReference {',
      '  return addonReference(UI_NAMESPACE);',
      '}',
      '',
    ].join('\n'),
    'utf-8',
  );

  console.log(`   ↳ ${forms.length} compiled form screen(s) → ${GENERATED_DIR}/${GENERATED_FILE}`);

  // The same keys, declared back in the project the author edits. The module
  // above only ever exists inside a Regolith run, so without this the editor
  // has no keys to offer and `navigate('…')` takes any string it is given.
  writeProjectFileIfChanged(path.join(projectDataPath(), 'ui', KEYS_FILE), [
    '// GENERATED by the ui-compiler filter — do not edit.',
    '//',
    '// The screens this addon compiled, as the keys they are navigated by. Declared',
    '// so the editor can offer them: `navigate()` and `<Link to>` take one of these,',
    "// and still accept another addon's key — a screen this build never saw is",
    '// resolved at runtime from the reference its owner published.',
    '',
    "declare module '@bedrock-core/ui-runtime' {",
    '  interface ScreenKeys {',
    ...forms.map(screen => `    ${JSON.stringify(screenKey(screen.name))}: true;`),
    '  }',
    '}',
    '',
    'export {};',
    '',
  ].join('\n'));

  // The generated module only registers what it registers once something
  // imports it, and an addon that forgets the import gets no failure — every
  // compiled screen quietly serializes instead, which is the bug that is
  // hardest to see. So the build adds the import to the entry it just compiled
  // these screens for. The workspace copy, which is the one bundled; the
  // addon's own file is untouched.
  if (entryPath !== undefined) {
    const entrySource = fs.readFileSync(entryPath, 'utf-8');

    if (!entrySource.includes(GENERATED_UI)) {
      fs.writeFileSync(entryPath, `import '${GENERATED_UI}';
${entrySource}`, 'utf-8');
      console.log(`   ↳ ${rel(entryPath)} imports ${GENERATED_UI}`);
    }
  }
}

// ─── Build stamp ──────────────────────────────────────────────────────────────

const stampFiles: string[] = [];

if (settings.stamp === true) {
  // The hash is over everything the client will read under RP/ui — the
  // compiled screens and the render pack's own files alike — so two builds
  // of the same source read the same and any change to either reads
  // differently; the time says which of two identical builds this is.
  const digest = crypto.createHash('sha1');
  const uiRoot = path.resolve(RESOURCE_PACK, 'ui');

  for (const file of findFiles(uiRoot, '.json').sort()) {
    digest.update(rel(file)).update(fs.readFileSync(file));
  }

  for (const screen of [...compiled, ...forms]) {
    digest.update(screen.name).update(JSON.stringify(screen.document));
  }

  const now = new Date();
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const stamp = `ui ${digest.digest('hex').slice(0, 6)} ${clock}`;
  const stampFile = path.join(outputDir, 'core_build.json');
  const hudFile = path.resolve(RESOURCE_PACK, 'ui', 'hud_screen.json');
  const existingHud = fs.existsSync(hudFile) ? fs.readFileSync(hudFile, 'utf-8') : undefined;

  fs.writeFileSync(
    stampFile,
    note('GENERATED by the ui-compiler filter — do not edit.')
    + stringify({
      namespace: 'core_ui_build',
      stamp: {
        type: 'label',
        text: stamp,
        localize: false,
        font_size: 'small',
        color: [1, 1, 0],
        shadow: true,
        size: ['default', 'default'],
        anchor_from: 'top_left',
        anchor_to: 'top_left',
        offset: [2, 2],
        layer: 50,
      },
    }),
    'utf-8',
  );

  // A hook at vanilla's own path, defining nothing, so it stacks with every
  // other pack's edits to the HUD.
  fs.writeFileSync(
    hudFile,
    note('GENERATED by the ui-compiler filter — do not edit.')
    + stringify(mergeOrFail(existingHud, {
      namespace: 'hud',
      root_panel: {
        modifications: [
          {
            array_name: 'controls',
            operation: 'insert_back',
            value: [{ 'core_build_stamp@core_ui_build.stamp': {} }],
          },
        ],
      },
    }, rel(hudFile))),
    'utf-8',
  );

  stampFiles.push(stampFile, hudFile);
  console.log(`   ↳ build stamp "${stamp}" → ${rel(stampFile)}`);
}

// ─── _ui_defs.json ────────────────────────────────────────────────────────────

// The hooks, the router and the screens are files nobody wrote until this
// build ran; the library's static files are the render pack's own business.
const added = registerUiDefs({
  uiDefsFile: path.resolve(RESOURCE_PACK, 'ui', '_ui_defs.json'),
  indent,
  files: [
    ...hookFiles,
    ...routerFile === undefined ? [] : [routerFile],
    ...formFiles,
    ...stampFiles,
    facesFile,
    ...[...compiled, ...forms].map(screen => path.join(outputDir, `${screen.name}.json`)),
  ],
});

if (added > 0) {
  console.log(`   ↳ registered ${added} file(s) in _ui_defs.json`);
}

// ─── Entities ─────────────────────────────────────────────────────────────────

// A screen names the entity it opens from; the compiler knows how many slots
// that needs, and the router which key picks it. Stamping both here means
// nobody keeps `inventory_size` or a layout key in step with a layout by hand —
// the failure mode of which is a screen that silently draws cells the container
// does not have, or an entity that opens the wrong screen.
const entityFiles = findFiles(path.resolve(ENTITY_DIR), '.json');

/** The workspace definition of the entity with this identifier, if there is one. */
const findEntity = (identifier: string): string | undefined => entityFiles.find(
  file => (readJsonc(file) as unknown as EntityFile)['minecraft:entity']?.description?.identifier === identifier,
);

/** @type {Map<string, string>} entity type → the screen that claimed it */
const hosts = new Map();

for (const screen of compiled) {
  const claimed = hosts.get(screen.entity);

  if (claimed !== undefined) {
    console.error(`❌ ui-compiler: ${claimed} and ${screen.name} both name entity "${screen.entity}"; one entity opens one screen`);
    process.exit(1);
  }

  hosts.set(screen.entity, screen.name);

  const match = findEntity(screen.entity);

  if (!match) {
    console.error(`❌ ui-compiler: ${screen.name} names entity "${screen.entity}", which is not in ${ENTITY_DIR}`);
    process.exit(1);
  }

  const definition = readJsonc(match) as unknown as EntityFile;
  const entity = definition['minecraft:entity'];
  const components = entity.components ??= {};
  const inventory = components['minecraft:inventory'] ??= {};

  // `container` is the only container_type that routes to the chest screen, and
  // `private: true` stops the player opening it at all.
  inventory.container_type = 'container';
  inventory.inventory_size = screen.allocation.size;
  inventory.private = false;

  // The entity carries its own layout key: the runtime reads this property when
  // a player opens it, so a screen is never looked up by entity type. The key
  // is derived from the screen's namespaced name, so a rebuild — or another
  // addon's build — never moves it.
  const properties = entity.description.properties ??= {};
  const { layoutProperty, maxLayout } = runtime;

  properties[layoutProperty] = {
    type: 'int',
    range: [0, maxLayout],
    default: screen.layoutId,
  };

  fs.writeFileSync(match, stringify(definition), 'utf-8');

  console.log(
    `   ↳ ${screen.entity}: inventory_size ${screen.allocation.size}, ${layoutProperty} = ${screen.layoutId}`,
  );
}
