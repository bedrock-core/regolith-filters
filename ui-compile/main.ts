// @bedrock-core/regolith-filters — ui-compile
//
// Container screens are written as JSX under BP/scripts and compiled here into
// static JSON UI. Unlike a server form, a container screen cannot be serialized
// at runtime: the chest screen offers no string channel wide enough to carry a
// layout, so the layout is baked and only state travels at runtime.
//
// For each `BP/scripts/**/*.screen.tsx` this filter:
//   1. bundles the screen together with the compiler, using the PROJECT'S copy
//      of @bedrock-core/ui-runtime and @bedrock-core/ui-compile, so a screen is
//      always compiled against the library the addon actually ships,
//   2. writes the emitted JSON UI to RP/ui/core-ui/screens/<namespace>/<name>.json,
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

import type { Document } from './lib/hooks.ts';
import { mergeHook, parseJsonc } from './lib/hooks.ts';
import type { CompiledFormScreen, CompiledScreen, Hook, ScreenBundle } from './lib/load.ts';
import { loadScreen } from './lib/load.ts';
import { registerUiDefs } from './lib/uiDefs.ts';

const projectRoot = process.env['ROOT_DIR'];

if (!projectRoot) {
  console.error('❌ ROOT_DIR environment variable not set');
  console.error('This filter must be run by Regolith');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

// Fixed addon paths: what Minecraft needs for scripts, entities, UI and texts.
// They are not options — the pack does not work anywhere else — so they are
// constants, not settings. The hooks and the router are the compiler's to
// place: the hooks at vanilla's own paths, which is what lets their edits
// stack with every other pack's, and the router under the addon's namespace,
// so two addons' routers never overwrite each other in a world.
const SOURCE_DIR = 'BP/scripts';
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
interface Settings {
  namespace?: string;
  /**
   * Draw a build stamp at the HUD's top-left: a short hash of every compiled
   * screen plus the build time. For the development profile of a pack under
   * work, so what the game is running is never in question; never for a
   * shipped pack.
   */
  stamp?: boolean;
}

const settings = JSON.parse(process.argv[2] ?? '{}') as Settings;

const cacheDir = path.join(projectRoot, '.regolith', 'cache', 'ui-compile');

// What the i18n filter wrote, when it ran before this one: loaded into every
// screen's build so localized text is measured as its real string.
const I18N_BUNDLE = 'data/i18n/i18n.generated.json';
const i18nBundle = fs.existsSync(I18N_BUNDLE) ? path.resolve(I18N_BUNDLE) : undefined;

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

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

if (screenPaths.length === 0) {
  console.log(`ℹ️  ui-compile: no *${SCREEN_SUFFIX} under ${SOURCE_DIR}, nothing to do`);
  process.exit(0);
}

const rel = (file: string): string => path.relative(projectRoot, file).replaceAll('\\', '/');

// The name is the JSON UI namespace and the output file, so it has to be unique
// across the addon whatever directory a screen sits in.
const names = screenPaths.map(screenPath => path.basename(screenPath, SCREEN_SUFFIX));
const duplicate = names.find((name, index) => names.indexOf(name) !== index);

if (duplicate !== undefined) {
  console.error(`❌ ui-compile: two screens are named "${duplicate}"; a screen's file name has to be unique`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Namespace
// ---------------------------------------------------------------------------

// The addon's namespace prefixes every screen's JSON UI namespace, so a screen
// is `<namespace>_<name>` — the addon's own name, not the library's. Taken from
// the `namespace` setting, or scanned from the `core.register({ creator, pack })`
// the server package writes, the way the other filters resolve it.
const CREATOR_RE = /\bcreator\s*:\s*(['"`])([a-z0-9_]+)\1/g;
const PACK_RE = /\bpack\s*:\s*(['"`])([a-z0-9_]+)\1/g;

const scanNamespace = (dir: string): string | undefined => {
  const creators = new Set<string>();
  const packs = new Set<string>();

  for (const file of [...findFiles(dir, '.ts'), ...findFiles(dir, '.tsx'), ...findFiles(dir, '.js')]) {
    const text = fs.readFileSync(file, 'utf-8');

    if (!text.includes('.register(')) {
      continue;
    }

    for (const m of text.matchAll(CREATOR_RE)) if (m[2] !== undefined) creators.add(m[2]);
    for (const m of text.matchAll(PACK_RE)) if (m[2] !== undefined) packs.add(m[2]);
  }

  return creators.size === 1 && packs.size === 1
    ? `${[...creators][0] ?? ''}_${[...packs][0] ?? ''}`
    : undefined;
};

let namespace = settings.namespace;

if (namespace) {
  if (!/^[a-z0-9_]+$/.test(namespace)) {
    console.error(`❌ ui-compile: namespace "${namespace}" must be lowercase a-z, 0-9 and _`);
    process.exit(1);
  }
} else {
  namespace = scanNamespace(path.resolve(SOURCE_DIR));

  if (namespace === undefined) {
    console.error(
      '❌ ui-compile: no namespace — set the "namespace" setting, '
      + 'or write creator/pack as string literals in core.register()',
    );
    process.exit(1);
  }
}

console.log(`🏷️  ui-compile: namespace "${namespace}"`);

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

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
  console.error(`❌ ui-compile: ${context}`);
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
const formSources = new Map();

// Every bundle carries the project's own library, and its exports are the same
// from one screen to the next; the last one loaded speaks for all of them.
/** @type {import('./lib/load.js').ScreenBundle} */
let library;

for (const [index, screenPath] of screenPaths.entries()) {
  const name = names[index] ?? path.basename(screenPath, SCREEN_SUFFIX);

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
  }).catch((error: unknown) => fail(rel(screenPath), error));

  library = bundle;

  const screen = bundle.compiled;

  const header = [
    '// GENERATED by the ui-compile filter — do not edit.',
    `// Source: ${rel(screenPath)}`,
    '',
  ].join('\n');

  fs.writeFileSync(
    path.join(outputDir, `${name}.json`),
    `${header}${JSON.stringify(screen.document, null, '\t')}\n`,
    'utf-8',
  );

  if (bundle.kind === 'chest') {
    const chest = screen as CompiledScreen;

    compiled.push(chest);

    const { drawn, channels, size } = chest.allocation;

    console.log(
      `✅ ui-compile: ${name} — chest, ${drawn} slot(s), ${channels} channel(s), inventory_size ${size}`,
    );
  } else {
    const form = screen as CompiledFormScreen;

    forms.push(form);
    formSources.set(name, screenPath);

    console.log(`✅ ui-compile: ${name} — form, ${form.entries.length} entry(s)`);
  }
}

if (library === undefined) {
  throw new Error('unreachable: every screen either loads a bundle or stops the build');
}

// Captured as a const: narrowing a `let` does not survive into a later loop
// body, and re-asserting it at each use is worse than naming it once.
const runtime = library;

// ---------------------------------------------------------------------------
// Character table
// ---------------------------------------------------------------------------

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
        '## Generated by the ui-compile filter -- the character table live text',
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

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

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
    '// GENERATED by the ui-compile filter — do not edit.\n'
    + '// Inserts this addon\'s compiled-screen root on vanilla\'s chest screen.\n'
    + '//\n'
    + '// A modification of vanilla\'s own file at vanilla\'s own path: it stacks\n'
    + '// with the render pack\'s edit and with every other addon\'s, whatever order\n'
    + '// the packs sit in. Nothing is defined here on purpose.\n'
    + `${JSON.stringify(document, null, '\t')}\n`,
    'utf-8',
  );
  console.log(`   ↳ hook → ${rel(file)}${existing === undefined ? '' : ' (merged)'}`);
}

if (routerFile !== undefined) {
  fs.writeFileSync(
    routerFile,
    '// GENERATED by the ui-compile filter — do not edit.\n'
    + '// Gates this addon\'s compiled layouts onto the chest screen; vanilla\'s own\n'
    + '// chest shows when no layout claims it.\n'
    + `${JSON.stringify(routing.router, null, '\t')}\n`,
    'utf-8',
  );

  console.log(`   ↳ router → ${rel(routerFile)}`);
}

// ---------------------------------------------------------------------------
// Compiled form screens
// ---------------------------------------------------------------------------

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
      '// GENERATED by the ui-compile filter — do not edit.\n'
      + '// Puts this addon\'s compiled form screens on the library\'s mount.\n'
      + '//\n'
      + '// This pack defines the mount, so its own screens are listed in it directly.\n'
      + `${JSON.stringify(mount, null, '\t')}\n`,
      'utf-8',
    );
    formFiles.push(mountFile);
  } else {
    // Every other pack hooks VANILLA's form screen, the way the library itself
    // does: a `modifications` entry only stacks onto a file a lower pack
    // defined when that file is vanilla's — against another pack's file the
    // engine merges the two definitions as plain objects, and `modifications`
    // arrives as an unknown property (measured: "Unknown property
    // [modifications]" on the mount, with the screens never mounted). The
    // addon's router goes straight into `main_screen_content`, beside the
    // library's containers; every screen under it gates on its own title.
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
      '// GENERATED by the ui-compile filter — do not edit.\n'
      + '// Puts this addon\'s compiled form screens on the form screen: a hook at\n'
      + '// vanilla\'s own path, defining nothing, which stacks across packs.\n'
      + `${JSON.stringify(document, null, '\t')}\n`,
      'utf-8',
    );
    console.log(`   ↳ form hook → ${rel(serverFormFile)}${existingHook === undefined ? '' : ' (merged)'}`);
    formFiles.push(serverFormFile);
  }

  fs.mkdirSync(path.dirname(formRouterFile), { recursive: true });
  fs.writeFileSync(
    formRouterFile,
    '// GENERATED by the ui-compile filter — do not edit.\n'
    + '// Gates this addon\'s compiled form screens; each shows for exactly the\n'
    + '// title the runtime opens it with.\n'
    + `${JSON.stringify(formRouting.router, null, '\t')}\n`,
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

  const registrations = forms.map((screen, index) => ({
    alias: `Screen${index}`,
    source: specifierFor(formSources.get(screen.name)),
    title: screen.title,
    snapshot: screen.snapshot,
  }));

  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(
    path.join(generatedDir, GENERATED_FILE),
    [
      '// GENERATED by the ui-compile filter — do not edit.',
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
      'import { registerCompiledScreen } from \'@bedrock-core/ui\';',
      ...registrations.map(entry => `import ${entry.alias} from '${entry.source}';`),
      '',
      ...registrations.map(entry =>
        `registerCompiledScreen(${entry.alias}, ${JSON.stringify(entry.title)}, ${JSON.stringify(entry.snapshot)});`),
      '',
    ].join('\n'),
    'utf-8',
  );

  console.log(`   ↳ ${forms.length} compiled form screen(s) → ${GENERATED_DIR}/${GENERATED_FILE}`);
}

// ---------------------------------------------------------------------------
// Build stamp
// ---------------------------------------------------------------------------

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
    '// GENERATED by the ui-compile filter — do not edit.\n'
    + JSON.stringify({
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
    }, null, '\t') + '\n',
    'utf-8',
  );

  // A hook at vanilla's own path, defining nothing, so it stacks with every
  // other pack's edits to the HUD.
  fs.writeFileSync(
    hudFile,
    '// GENERATED by the ui-compile filter — do not edit.\n'
    + JSON.stringify(mergeOrFail(existingHud, {
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
    }, rel(hudFile)), null, '\t') + '\n',
    'utf-8',
  );

  stampFiles.push(stampFile, hudFile);
  console.log(`   ↳ build stamp "${stamp}" → ${rel(stampFile)}`);
}

// ---------------------------------------------------------------------------
// _ui_defs.json
// ---------------------------------------------------------------------------

// The hooks, the router and the screens are files nobody wrote until this
// build ran; the library's static files are the render pack's own business.
const added = registerUiDefs({
  uiDefsFile: path.resolve(RESOURCE_PACK, 'ui', '_ui_defs.json'),
  files: [
    ...hookFiles,
    ...routerFile === undefined ? [] : [routerFile],
    ...formFiles,
    ...stampFiles,
    ...[...compiled, ...forms].map(screen => path.join(outputDir, `${screen.name}.json`)),
  ],
});

if (added > 0) {
  console.log(`   ↳ registered ${added} file(s) in _ui_defs.json`);
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

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
    console.error(`❌ ui-compile: ${claimed} and ${screen.name} both name entity "${screen.entity}"; one entity opens one screen`);
    process.exit(1);
  }

  hosts.set(screen.entity, screen.name);

  const match = findEntity(screen.entity);

  if (!match) {
    console.error(`❌ ui-compile: ${screen.name} names entity "${screen.entity}", which is not in ${ENTITY_DIR}`);
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

  fs.writeFileSync(match, `${JSON.stringify(definition, null, '\t')}\n`, 'utf-8');

  console.log(
    `   ↳ ${screen.entity}: inventory_size ${screen.allocation.size}, ${layoutProperty} = ${screen.layoutId}`,
  );
}
